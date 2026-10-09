import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Navigate } from "react-router-dom";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  NO_PREFS,
  PUSH_PREFS_KEY,
  pushSupport,
  saveNotificationPrefs,
  subscribeThisDevice,
  useNotificationPrefsQuery,
  type NotificationPrefKey,
  type NotificationPrefs,
  type PushSupport,
} from "../push";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Toggle } from "../ui/toggle";
import { useToast } from "../ui/toast";
import { IOS_HOME_NOTE, PUSH_BLOCKED, PUSH_FAILED } from "./review-push-prompt";

const SWITCHES: Array<{ key: NotificationPrefKey; label: string; hint?: string }> = [
  { key: "new_transaction", label: "תנועה חדשה", hint: "כשנכנסת תנועה מהבנק" },
  { key: "evening_reminder", label: "תזכורת ערב" },
  { key: "weekly_summary", label: "סיכום שבועי", hint: "ראשון בבוקר" },
];

const UNSUPPORTED_NOTE = "הדפדפן הזה לא שולח התראות.";
const SAVE_FAILED = "לא הצלחנו לשמור.";

/** The Settings row's hint: the switches that are on, or כבוי. */
export function notificationsHint(prefs: NotificationPrefs): string {
  const on = SWITCHES.filter((item) => prefs[item.key]).map((item) => item.label);
  return on.length === 0 ? "כבוי" : on.join(" · ");
}

/**
 * `/settings/notifications` (FLOW-502 option A): three switches, per user, all off by default.
 * Turning one on from a device that is not subscribed asks the browser first (from the tap);
 * turning one off only saves. A viewer sets their own switches too.
 */
export function NotificationsScreen({ sample, support }: { sample?: NotificationPrefs; support?: PushSupport } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const [can] = useState<PushSupport>(() => support ?? pushSupport());
  const live = sample == null && preview === "off" && can !== "not-configured";
  const query = useNotificationPrefsQuery(live);
  const client = useQueryClient();
  const toast = useToast();
  const [local, setLocal] = useState<NotificationPrefs>(sample ?? NO_PREFS);
  const [busy, setBusy] = useState<NotificationPrefKey | null>(null);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const backTo = `/settings${search}`;
  const noteId = useId();

  // A build without the VAPID key shows nothing about push; an old link lands on Settings.
  if (can === "not-configured" && sample == null) return <Navigate to={backTo} replace />;

  if (live && (query.isPending || query.isError)) {
    return (
      <ScreenState
        title="התראות"
        kicker="הגדרות"
        backTo={backTo}
        phase={query.isError ? { kind: "error", offline: !navigator.onLine } : { kind: "loading" }}
        onRetry={() => { void query.refetch(); }}
        loading={(
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        )}
      />
    );
  }
  const prefs = live ? (query.data ?? NO_PREFS) : local;
  const note = can === "ios-home-screen" ? IOS_HOME_NOTE : can === "unsupported" ? UNSUPPORTED_NOTE : null;

  async function change(key: NotificationPrefKey, on: boolean) {
    if (busy != null) return;
    if (on && can !== "ok") return;
    if (!live) {
      setLocal((current) => ({ ...current, [key]: on }));
      return;
    }
    setBusy(key);
    try {
      if (on && !subscribedHere) {
        const result = await subscribeThisDevice();
        if (result !== "ok") {
          toast.show({ message: result === "denied" ? PUSH_BLOCKED : PUSH_FAILED, tone: result === "denied" ? "info" : "bad" });
          return;
        }
        setSubscribedHere(true);
      }
      const saved = await saveNotificationPrefs({ [key]: on });
      client.setQueryData(PUSH_PREFS_KEY, saved);
    } catch {
      toast.show({ message: SAVE_FAILED, tone: "bad" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ScreenHeader title="התראות" kicker="הגדרות" backTo={backTo} />
      {note != null ? <p className="ui-page-pad t-hint" id={noteId} data-push-note="">{note}</p> : null}
      <List>
        {SWITCHES.map((item) => (
          <Toggle
            key={item.key}
            label={item.label}
            hint={item.hint}
            checked={prefs[item.key]}
            busy={busy === item.key}
            // Off stays reachable on any device; on needs a browser that can subscribe. While one
            // switch saves, the others wait.
            disabled={(can !== "ok" && !prefs[item.key]) || (busy != null && busy !== item.key)}
            disabledNoteId={note != null && can !== "ok" && !prefs[item.key] ? noteId : undefined}
            onChange={(checked) => { void change(item.key, checked); }}
          />
        ))}
      </List>
    </div>
  );
}
