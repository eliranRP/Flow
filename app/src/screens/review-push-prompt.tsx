import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useHomePreview } from "../preview";
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
import { useToast } from "../ui/toast";
import { focusReviewEmptyAction } from "./review-focus";

export const PUSH_QUESTION = "תזכורת בערב כשיש תנועות לאישור?";
export const IOS_HOME_NOTE = "כדי לקבל תזכורות באייפון, מוסיפים את Flow למסך הבית ופותחים משם.";
export const PUSH_ON = "נשלח תזכורת בערב כשיש תנועות לאישור.";
export const PUSH_BLOCKED = "ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות הדפדפן.";
export const PUSH_FAILED = "לא הצלחנו להפעיל תזכורות.";

function focusInCard(): boolean {
  return document.activeElement?.closest(".ui-prompt-card") != null;
}

/**
 * FLOW-502 option A: one quiet card under the review empty state, asked once per user.
 * כן asks the browser for permission (from the tap), subscribes this device and turns on the
 * evening reminder; לא עכשיו only records the answer. An iPhone tab gets the Home Screen note.
 */
export function ReviewPushPrompt({ sample, support }: { sample?: NotificationPrefs; support?: PushSupport } = {}) {
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
      focusReviewEmptyAction();
    }
  }, [answered]);

  const data = sample ?? prefs.data;
  if (answered || can === "unsupported" || can === "not-configured" || data == null) return null;
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
      note={note ? IOS_HOME_NOTE : undefined}
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
