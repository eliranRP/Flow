import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

export const PUSH_QUESTION = "תזכורת בערב כשיש תנועות לאישור?";
export const IOS_HOME_NOTE = "כדי לקבל תזכורות באייפון, מוסיפים את Flow למסך הבית ופותחים משם.";
export const PUSH_ON = "נשלח תזכורת בערב כשיש תנועות לאישור.";
export const PUSH_BLOCKED = "ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות הדפדפן.";
export const PUSH_FAILED = "לא הצלחנו להפעיל תזכורות.";

/**
 * FLOW-502 option A: one quiet card under the review empty state, asked once per user.
 * כן asks the browser for permission (from the tap), subscribes this device and turns on the
 * evening reminder; לא עכשיו only records the answer. An iPhone tab gets the Home Screen note.
 */
export function ReviewPushPrompt({ sample, support }: { sample?: NotificationPrefs; support?: PushSupport } = {}) {
  const preview = useHomePreview();
  const live = sample == null && preview === "off";
  const prefs = useNotificationPrefsQuery(live);
  const client = useQueryClient();
  const toast = useToast();
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(false);
  const [can] = useState<PushSupport>(() => support ?? pushSupport());
  const data = sample ?? prefs.data;
  if (answered || can === "unsupported" || data == null) return null;
  if (data.prompt_answered || (data.evening_reminder && data.has_subscription)) return null;

  function record(yes: boolean) {
    if (!live) return;
    void answerPushPrompt(yes)
      .then(() => client.invalidateQueries({ queryKey: PUSH_PREFS_KEY }))
      .catch(() => undefined);
  }

  async function yes() {
    if (can === "ios-home-screen") {
      setNote(true);
      return;
    }
    if (!live) {
      setAnswered(true);
      return;
    }
    setBusy(true);
    const result = await subscribeThisDevice();
    setBusy(false);
    if (result === "failed") {
      toast.show({ message: PUSH_FAILED, tone: "bad" });
      return;
    }
    setAnswered(true);
    if (result === "denied") {
      record(false);
      toast.show({ message: PUSH_BLOCKED, tone: "info" });
      return;
    }
    try {
      await answerPushPrompt(true);
      await client.invalidateQueries({ queryKey: PUSH_PREFS_KEY });
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
      onYes={() => { void yes(); }}
      onNo={() => {
        setAnswered(true);
        record(false);
      }}
      // The note is not an answer: the card asks again from the installed app.
      onNoteDismiss={() => { setAnswered(true); }}
    />
  );
}
