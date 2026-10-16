import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
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
import { CalendarIcon, BellIcon, DocumentIcon } from "../ui/icons";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Toggle } from "../ui/toggle";
import { useToast } from "../ui/toast";
import { IOS_HOME_NOTE, IosHomeNote, PUSH_BLOCKED, PUSH_FAILED } from "./review-push-prompt";

const SWITCHES: Array<{ key: NotificationPrefKey; label: string; hint: string; icon: ReactNode }> = [
  { key: "new_transaction", label: "תנועה חדשה", hint: "כשנכנסת תנועה מהבנק", icon: <BellIcon size={22} /> },
  { key: "evening_reminder", label: "תזכורת ערב", hint: "ב־20:00, אם יש מה לאשר", icon: <CalendarIcon size={22} /> },
  { key: "weekly_summary", label: "סיכום שבועי", hint: "ראשון בבוקר", icon: <DocumentIcon size={22} /> },
];

const UNSUPPORTED_NOTE = "הדפדפן הזה לא שולח התראות.";
const SAVE_FAILED = "לא הצלחנו לשמור.";

/** The התראות row's value: how many switches are on, or כבויות when none is. */
export function notificationsHint(prefs: NotificationPrefs): string {
  const on = SWITCHES.filter((item) => prefs[item.key]).length;
  return on === 0 ? "כבויות" : `${String(on)} פעילות`;
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
  // On an iPhone tab, "למסך הבית" leads to the install steps instead of ending the sentence.
  const noteBody = can === "ios-home-screen" ? <IosHomeNote /> : note;

  /** A saved switch says what it did, and ביטול turns it back (FLOW-512). */
  function said(key: NotificationPrefKey, on: boolean) {
    const label = SWITCHES.find((item) => item.key === key)?.label ?? "";
    toast.show({
      message: `${label} ${on ? "פועלת" : "כבויה"}`,
      action: "ביטול",
      onAction: () => { void change(key, !on); },
    });
  }

  async function change(key: NotificationPrefKey, on: boolean) {
    if (busy != null) return;
    if (on && can !== "ok") return;
    if (!live) {
      setLocal((current) => ({ ...current, [key]: on }));
      said(key, on);
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
      said(key, on);
    } catch {
      toast.show({ message: SAVE_FAILED, tone: "bad" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ScreenHeader
        title="התראות"
        subtitle="מה נשלח לטלפון"
        backTo={backTo}
        below={note != null ? <p className="t-hint" id={noteId} data-push-note="">{noteBody}</p> : undefined}
      />
      <List>
        {SWITCHES.map((item) => (
          <Toggle
            key={item.key}
            label={item.label}
            hint={item.hint}
            icon={item.icon}
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
