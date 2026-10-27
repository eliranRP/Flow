import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  DEVICE_PUSH_KEY,
  forgetThisDevice,
  NO_PREFS,
  PUSH_PREFS_KEY,
  pushSupport,
  saveNotificationPrefs,
  subscribeThisDevice,
  useDevicePushQuery,
  useNotificationPrefsQuery,
  type DevicePush,
  type NotificationPrefKey,
  type NotificationPrefs,
  type PushSupport,
  type SubscribeOutcome,
} from "../push";
import { addedLabel, deviceName, PUSH_DEVICES_KEY, usePushDevicesQuery, type PushDevice } from "../push-devices";
import { sendTestPush, TEST_PUSH_COPY } from "../push-test";
import { List, ListRow } from "../ui/list-row";
import { CalendarIcon, BellIcon, DocumentIcon } from "../ui/icons";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Toggle } from "../ui/toggle";
import { useTopToast } from "../ui/top-toast";
import { PUSH_ACTIVE_HERE, pushBlockedMessage, subscribeDiagnostic, subscribeFailure } from "./push-copy";
import { IOS_HOME_NOTE, IosHomeNote } from "./review-push-prompt";
import { NOTIFICATIONS_OFFLINE, SettingsOfflineLine, useOfflineRefusal } from "./settings-offline";

const SWITCHES: Array<{ key: NotificationPrefKey; label: string; hint: string; icon: ReactNode }> = [
  { key: "new_transaction", label: "תנועה חדשה", hint: "כשנכנסת תנועה מהבנק", icon: <BellIcon size={22} /> },
  { key: "evening_reminder", label: "תזכורת ערב", hint: "ב־20:00, אם יש מה לאשר", icon: <CalendarIcon size={22} /> },
  { key: "weekly_summary", label: "סיכום שבועי", hint: "ראשון בבוקר", icon: <DocumentIcon size={22} /> },
];

const UNSUPPORTED_NOTE = "הדפדפן הזה לא שולח התראות.";
const SAVE_FAILED = "לא הצלחנו לשמור.";
const DEVICE_LABEL = "המכשיר הזה מקבל התראות";
const DEVICE_OFF_HINT = "ההתראות לא מגיעות למכשיר הזה";
const DEVICE_OFF_TOAST = "ההתראות כבויות במכשיר הזה";
const TEST_PUSH = "שליחת התראת בדיקה";
const SWITCHES_HEAD = "מה לקבל · לכל המכשירים";
const DEVICES_HEAD = "מכשירים מחוברים";
const NO_DEVICE_LINE = "ההתראות לא נשלחות לאף מכשיר. אפשר לחבר את המכשיר הזה למעלה.";
const NO_DEVICES = "אין מכשיר מחובר.";
const DEVICES_FAILED = "לא הצלחנו לטעון את המכשירים.";
const THIS_DEVICE = "המכשיר הזה";

/** The התראות row's value: how many switches are on, or כבויות when none is. */
export function notificationsHint(prefs: NotificationPrefs): string {
  const on = SWITCHES.filter((item) => prefs[item.key]).length;
  return on === 0 ? "כבויות" : `${String(on)} פעילות`;
}

function deviceHint(state: DevicePush | undefined): ReactNode {
  if (state === "subscribed") return PUSH_ACTIVE_HERE;
  if (state === "denied") return pushBlockedMessage();
  if (state === "not-subscribed" || state === "no-worker") return DEVICE_OFF_HINT;
  return undefined;
}

function DeviceList({ list, failed, hereTag }: { list: PushDevice[] | undefined; failed: boolean; hereTag: string | null }) {
  if (failed) return <p className="ui-settings-note">{DEVICES_FAILED}</p>;
  if (list == null) {
    return (
      <List layout="inset">
        <ListRow variant="skeleton" />
      </List>
    );
  }
  if (list.length === 0) return <p className="ui-settings-note">{NO_DEVICES}</p>;
  return (
    <List layout="inset">
      {list.map((row) => (
        <ListRow
          key={row.id}
          variant="static"
          title={deviceName(row.userAgent)}
          hint={addedLabel(row.createdAt)}
          value={hereTag != null && row.tag === hereTag ? THIS_DEVICE : undefined}
        />
      ))}
    </List>
  );
}

/**
 * `/settings/notifications` (FLOW-502, reshaped by FLOW-516, decision 0201). This device has its own
 * row: on asks for permission and subscribes it (from the tap), off unsubscribes it here and on the
 * server, and no other device changes. The three switches are what to receive, shared by every
 * device of the account. The connected devices list shows where pushes go.
 */
export function NotificationsScreen({
  sample,
  support,
  device,
  devices,
  thisTag,
}: {
  sample?: NotificationPrefs;
  support?: PushSupport;
  /** This device's state in a sample. Live, it is read from the browser. */
  device?: DevicePush;
  /** The connected devices in a sample. */
  devices?: PushDevice[];
  /** Which of the sample's devices is this one. */
  thisTag?: string;
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const [can] = useState<PushSupport>(() => support ?? pushSupport());
  const live = sample == null && preview === "off" && can !== "not-configured";
  const query = useNotificationPrefsQuery(live);
  const deviceQuery = useDevicePushQuery(live && can === "ok");
  const devicesQuery = usePushDevicesQuery(live);
  const client = useQueryClient();
  const toast = useTopToast();
  const [local, setLocal] = useState<NotificationPrefs>(sample ?? NO_PREFS);
  const [sampleHere, setSampleHere] = useState<DevicePush>(() => device ?? (can === "ok" ? "not-subscribed" : can === "not-configured" ? "unsupported" : can));
  // Each switch's save in the background: the value on screen, the last one the server stored, and
  // whether a save is running. A tap during a save waits for it, then only the latest value is sent.
  const saves = useRef(new Map<NotificationPrefKey, { want: boolean; stored: boolean; running: boolean }>());
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [failure, setFailure] = useState<SubscribeOutcome | null>(null);
  const backTo = `/settings${search}`;
  const noteId = useId();
  // FLOW-972: a switch, this device and the test push all need the server now, so offline they say so instead.
  const refuseOffline = useOfflineRefusal();

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
  const here: DevicePush | undefined = !live ? sampleHere : can === "ok" ? deviceQuery.data?.state : can;
  const hereTag = live ? (deviceQuery.data?.tag ?? null) : (thisTag ?? null);
  const list = live ? devicesQuery.data : (devices ?? []);
  const note = can === "ios-home-screen" ? IOS_HOME_NOTE : can === "unsupported" ? UNSUPPORTED_NOTE : null;
  // On an iPhone tab, "למסך הבית" leads to the install steps instead of ending the sentence.
  const noteBody = can === "ios-home-screen" ? <IosHomeNote /> : note;
  const anyOn = SWITCHES.some((item) => prefs[item.key]);
  const deviceUsable = here === "subscribed" || here === "not-subscribed" || here === "no-worker";

  function refresh() {
    void client.invalidateQueries({ queryKey: DEVICE_PUSH_KEY });
    void client.invalidateQueries({ queryKey: PUSH_DEVICES_KEY });
    void client.invalidateQueries({ queryKey: PUSH_PREFS_KEY });
  }

  function deviceChange(on: boolean) {
    if (deviceBusy) return;
    if (refuseOffline(NOTIFICATIONS_OFFLINE)) return;
    if (!live) {
      setSampleHere(on ? "subscribed" : "not-subscribed");
      toast.show({ message: on ? PUSH_ACTIVE_HERE : DEVICE_OFF_TOAST });
      return;
    }
    if (on) {
      // First, with no await before it: iOS asks for permission only from this tap.
      const pending = subscribeThisDevice();
      setDeviceBusy(true);
      setFailure(null);
      void pending
        .then((outcome) => {
          if (outcome.result === "ok") {
            toast.show({ message: PUSH_ACTIVE_HERE });
            return;
          }
          setFailure(outcome);
          toast.show(subscribeFailure(outcome.result));
        })
        .finally(() => {
          setDeviceBusy(false);
          refresh();
        });
      return;
    }
    setDeviceBusy(true);
    setFailure(null);
    void forgetThisDevice({ server: true })
      .then(() => { toast.show({ message: DEVICE_OFF_TOAST }); })
      .finally(() => {
        setDeviceBusy(false);
        refresh();
      });
  }

  function testPush() {
    if (testBusy) return;
    if (refuseOffline(NOTIFICATIONS_OFFLINE)) return;
    if (!live) {
      toast.show({ message: TEST_PUSH_COPY.sent });
      return;
    }
    setTestBusy(true);
    void sendTestPush()
      .then((result) => {
        toast.show({ message: TEST_PUSH_COPY[result], tone: result === "sent" ? "ok" : result === "limit" ? "info" : "bad" });
        if (result === "no-device") refresh();
      })
      .finally(() => { setTestBusy(false); });
  }

  /** A saved switch says what it did, and ביטול turns it back (FLOW-512). */
  function said(key: NotificationPrefKey, on: boolean) {
    const label = SWITCHES.find((item) => item.key === key)?.label ?? "";
    toast.show({
      message: `${label} ${on ? "פועלת" : "כבויה"}`,
      action: "ביטול",
      onAction: () => { change(key, !on); },
    });
  }

  /** Puts one switch on screen as `on`, keeping the server's other fields and every other switch. */
  function show(key: NotificationPrefKey, on: boolean) {
    client.setQueryData<NotificationPrefs>(PUSH_PREFS_KEY, (current) => ({ ...(current ?? NO_PREFS), [key]: on }));
  }

  /** Sends a switch's latest value until the server holds it; a failure puts the switch back. */
  async function save(key: NotificationPrefKey) {
    const entry = saves.current.get(key);
    if (entry == null || entry.running) return;
    entry.running = true;
    try {
      while (entry.want !== entry.stored) {
        const want = entry.want;
        try {
          await saveNotificationPrefs({ [key]: want });
          entry.stored = want;
          // Only this switch: the answer's other fields are a snapshot from when it committed, and
          // answers can land out of order, so it could draw an older value over a newer one.
          show(key, entry.want);
        } catch {
          entry.want = entry.stored;
          show(key, entry.stored);
          toast.show({ message: SAVE_FAILED, tone: "bad" });
        }
      }
    } finally {
      entry.running = false;
    }
  }

  /**
   * The switches only say what to receive; they never subscribe or drop a device. A tap flips the
   * switch at once and saves in the background, so no switch waits for another (FLOW-936).
   */
  function change(key: NotificationPrefKey, on: boolean) {
    if (refuseOffline(NOTIFICATIONS_OFFLINE)) return;
    if (!live) {
      setLocal((current) => ({ ...current, [key]: on }));
      said(key, on);
      return;
    }
    const current = client.getQueryData<NotificationPrefs>(PUSH_PREFS_KEY) ?? NO_PREFS;
    const entry = saves.current.get(key);
    if (entry?.running === true) entry.want = on;
    else saves.current.set(key, { want: on, stored: current[key], running: false });
    // A read on its way would draw the old value over the tap.
    void client.cancelQueries({ queryKey: PUSH_PREFS_KEY });
    show(key, on);
    said(key, on);
    void save(key);
  }

  return (
    <div className="ui-settings-page ui-notify-page">
      <ScreenHeader
        title="התראות"
        kicker="הגדרות"
        subtitle="מה נשלח לטלפון"
        backTo={backTo}
        below={note != null ? <p className="t-caption t-muted" id={noteId} data-push-note="">{noteBody}</p> : undefined}
      />
      <SettingsOfflineLine words={NOTIFICATIONS_OFFLINE} />
      <List layout="inset">
        <Toggle
          label={DEVICE_LABEL}
          hint={deviceHint(here)}
          icon={<BellIcon size={22} />}
          checked={here === "subscribed"}
          busy={deviceBusy || (live && can === "ok" && here == null)}
          disabled={!deviceUsable}
          disabledNoteId={note != null ? noteId : undefined}
          onChange={deviceChange}
        />
        {list != null && list.length > 0 ? (
          <ListRow variant="button" title={TEST_PUSH} icon={<BellIcon size={22} />} busy={testBusy} onClick={testPush} />
        ) : null}
      </List>
      {failure != null ? <p className="ui-settings-note" data-push-diagnostic="">{subscribeDiagnostic(failure)}</p> : null}
      {anyOn && list != null && list.length === 0 ? <p className="ui-settings-note" role="status" data-push-nudge="">{NO_DEVICE_LINE}</p> : null}
      <h2 className="ui-settings-head">{SWITCHES_HEAD}</h2>
      <List layout="inset">
        {SWITCHES.map((item) => (
          <Toggle
            key={item.key}
            label={item.label}
            hint={item.hint}
            icon={item.icon}
            checked={prefs[item.key]}
            onChange={(checked) => { change(item.key, checked); }}
          />
        ))}
      </List>
      <h2 className="ui-settings-head">{DEVICES_HEAD}</h2>
      <DeviceList list={list} failed={live && devicesQuery.isError} hereTag={hereTag} />
    </div>
  );
}
