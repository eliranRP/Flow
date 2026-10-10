import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  answerPushPrompt,
  PUSH_PREFS_KEY,
  pushSupport,
  subscribeThisDevice,
  useNotificationPrefsQuery,
  type NotificationPrefs,
  type PushSupport,
} from "../push";
import { PromptCard } from "../ui/prompt-card";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
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
      <TextLink to={`/install${search}`} className="ui-text-link-inline" chevron={false}>{IOS_HOME_LINK}</TextLink>
      {IOS_HOME_AFTER}
    </>
  );
}

export const PUSH_ON = "נשלח התראה על כל תנועה חדשה ותזכורת בערב.";
export const PUSH_BLOCKED = "ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות הדפדפן.";
export const PUSH_FAILED = "לא הצלחנו להפעיל תזכורות.";

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
  focusAfter = focusReviewEmptyAction,
  iphoneTab = "note",
}: {
  sample?: NotificationPrefs;
  support?: PushSupport;
  /** Where focus goes when the card closes with focus in it. */
  focusAfter?: () => void;
  /** "hide": the page already teaches the Home Screen (setup step 5), so an iPhone tab is not asked. */
  iphoneTab?: "note" | "hide";
} = {}) {
  const [can] = useState<PushSupport>(() => support ?? pushSupport());
  const preview = useHomePreview();
  const live = sample == null && preview === "off" && can !== "not-configured";
  const prefs = useNotificationPrefsQuery(live);
  const client = useQueryClient();
  const toast = useToast();
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
  if (answered || can === "unsupported" || can === "not-configured" || data == null) return null;
  if (can === "ios-home-screen" && iphoneTab === "hide") return null;
  if (data.prompt_answered || (data.evening_reminder && data.has_subscription)) return null;

  function hide() {
    refocus.current = focusInCard();
    setAnswered(true);
  }

  function record(yes: boolean) {
    if (!live) return;
    // Cached at once, so a quick visit Home and back does not ask again before the save returns.
    client.setQueryData<NotificationPrefs>(PUSH_PREFS_KEY, (current) => current && { ...current, prompt_answered: true });
    void answerPushPrompt(yes)
      .then((saved) => { client.setQueryData(PUSH_PREFS_KEY, saved); })
      .catch(() => undefined);
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
    setBusy(true);
    const result = await subscribeThisDevice();
    setBusy(false);
    if (result === "failed") {
      toast.show({ message: PUSH_FAILED, tone: "bad" });
      return;
    }
    hide();
    if (result === "denied") {
      record(false);
      toast.show({ message: PUSH_BLOCKED, tone: "info" });
      return;
    }
    try {
      client.setQueryData(PUSH_PREFS_KEY, await answerPushPrompt(true));
      toast.show({ message: PUSH_ON });
    } catch {
      toast.show({ message: PUSH_FAILED, tone: "bad" });
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
