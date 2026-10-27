import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  answerPushPrompt,
  PUSH_PREFS_KEY,
  pushSupport,
  DEVICE_PUSH_KEY,
  subscribeThisDevice,
  useDevicePushQuery,
  useNotificationPrefsQuery,
  useRecordPushAnswer,
  type DevicePush,
  type NotificationPrefs,
  type PushSupport,
} from "../push";
import { PUSH_ON, subscribeFailure } from "./push-copy";
import { PromptCard } from "../ui/prompt-card";
import { Button } from "../ui/button";
import { useTopToast } from "../ui/top-toast";
import { focusReviewEmptyAction } from "./review-focus";

export const PUSH_QUESTION = "התראה על תנועה חדשה ותזכורת בערב?";
export const IOS_HOME_NOTE = "כדי לקבל תזכורות באייפון, מוסיפים את Flow למסך הבית ופותחים משם.";
const IOS_HOME_LINK = "למסך הבית";
const [IOS_HOME_BEFORE, IOS_HOME_AFTER] = IOS_HOME_NOTE.split(IOS_HOME_LINK) as [string, string];

/** IOS_HOME_NOTE with "למסך הבית" linked to the install steps (Settings → התראות and the review card). */
export function IosHomeNote() {
  const search = usePreviewSearch();
  return (
    <>
      {IOS_HOME_BEFORE}
      <Button variant="link" to={`/install${search}`} className="ui-btn-link-inline">{IOS_HOME_LINK}</Button>
      {IOS_HOME_AFTER}
    </>
  );
}


function focusInCard(): boolean {
  return document.activeElement?.closest(".ui-prompt-card") != null;
}

/**
 * FLOW-502 option A: one quiet card under the review empty state, asked once per user.
 * כן asks the browser for permission (from the tap), subscribes this device and turns on the
 * evening reminder; לא עכשיו only records the answer. An iPhone tab gets the Home Screen note.
 * Setup step 5 shows the same card with the same asked-once answer (`focusAfter`, `iphoneTab`).
 */
export function ReviewPushPrompt({
  sample,
  support,
  device,
  focusAfter = focusReviewEmptyAction,
  iphoneTab = "note",
}: {
  sample?: NotificationPrefs;
  support?: PushSupport;
  /** This device's push state in a sample; live, it is read from the browser. */
  device?: DevicePush;
  /** Where focus goes when the card closes with focus in it. */
  focusAfter?: () => void;
  /** "hide": the page already teaches the Home Screen (setup step 5), so an iPhone tab is not asked. */
  iphoneTab?: "note" | "hide";
} = {}) {
  const [can] = useState<PushSupport>(() => support ?? pushSupport());
  const preview = useHomePreview();
  const live = sample == null && preview === "off" && can !== "not-configured";
  const prefs = useNotificationPrefsQuery(live);
  const deviceQuery = useDevicePushQuery(live && can === "ok");
  const client = useQueryClient();
  const recordAnswer = useRecordPushAnswer();
  // FLOW-977 (decision 0212): its refusal and failure notes sit under the header, as every toast.
  const toast = useTopToast();
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(false);
  const dismissRef = useRef<HTMLButtonElement>(null);
  // Focus that was on the card when it went away goes to the empty state's own action.
  const refocus = useRef(false);

  useEffect(() => {
    if (note) dismissRef.current?.focus({ preventScroll: true });
  }, [note]);
  useEffect(() => {
    if (answered && refocus.current) {
      refocus.current = false;
      focusAfter();
    }
  }, [answered, focusAfter]);

  const data = sample ?? prefs.data;
  // FLOW-516: "already on" means this device gets the reminder, not some other device of the user.
  const here = device ?? (live ? deviceQuery.data?.state : undefined);
  if (answered || can === "unsupported" || can === "not-configured" || data == null) return null;
  if (can === "ios-home-screen" && iphoneTab === "hide") return null;
  if (live && can === "ok" && here == null) return null;
  if (data.prompt_answered || (data.evening_reminder && here === "subscribed")) return null;

  function hide() {
    refocus.current = focusInCard();
    setAnswered(true);
  }

  function record(yes: boolean) {
    if (live) recordAnswer(yes);
  }

  async function yes() {
    if (can === "ios-home-screen") {
      setNote(true);
      return;
    }
    if (!live) {
      hide();
      return;
    }
    // Called before any state change or await: the permission request needs this tap.
    const pending = subscribeThisDevice();
    setBusy(true);
    const { result } = await pending.finally(() => { setBusy(false); });
    if (result !== "ok") {
      toast.show(subscribeFailure(result));
      if (result !== "denied" && result !== "dismissed") return;
      hide();
      record(false);
      return;
    }
    void client.invalidateQueries({ queryKey: DEVICE_PUSH_KEY });
    hide();
    try {
      client.setQueryData(PUSH_PREFS_KEY, await answerPushPrompt(true));
      toast.show({ message: PUSH_ON });
    } catch {
      toast.show(subscribeFailure("save-failed"));
    }
  }

  return (
    <PromptCard
      question={PUSH_QUESTION}
      busy={busy}
      note={note ? <IosHomeNote /> : undefined}
      dismissRef={dismissRef}
      onYes={() => { void yes(); }}
      onNo={() => {
        hide();
        record(false);
      }}
      // The note is not an answer: the card asks again from the installed app.
      onNoteDismiss={hide}
    />
  );
}
