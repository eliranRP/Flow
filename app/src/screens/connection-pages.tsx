import { useState } from "react";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useHoldOwnerSettings, ViewerNote, ViewerScope } from "../use-is-viewer";
import { useDashboardQuery, useSumitStatusQuery } from "../use-books";
import { getSupabase } from "../lib/supabase";
import { israelSyncPhrase } from "../sumit-copy";
import { useRefreshingNow } from "../israel-clock";
import { assertNoError, useWrite } from "../use-write";
import { useSumitConnect } from "../use-sumit-connect";
import { REFRESH_DONE, useSumitRefresh } from "../use-sumit-refresh";
import { useSyncSettled } from "../use-sync-settled";
import { Button } from "../ui/button";
import { ImportFromField } from "../ui/import-from-field";
import { ConnectionFacts, ConnectionHead, ConnectionNote, ConnectionPage, StepList } from "../ui/connection-page";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { TextField } from "../ui/text-field";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";
import { screenPhase } from "../query-phase";
import { connectionToast, holdForUndo, UNDONE, type UndoHold } from "../connection-toast";
import type { SumitStatus } from "@flow/shared";

/** FLOW-938: Mercury has its own page (mercury-connection-screen.tsx); this one is SUMIT's. */
export type Provider = "sumit";

/** A connection page's state for stories and the preview (the live page reads the status). */
export type ConnectionSample = {
  state: "new" | "problem" | "connected" | "loading" | "error" | "viewer";
  /** SUMIT: the company number on file. */
  companyId?: string;
  /** What has come in so far, already in words ("312 מסמכים"). */
  imported?: string;
  /** The last sync, already in words ("היום, 06:05"). */
  lastSync?: string;
  /** A connect is in flight. */
  busy?: boolean;
};

/** A tap on חיבור checks the key and the company number first, and says what is missing (decision 0223). */
const MIN_KEY = 8;
const MIN_COMPANY_DIGITS = 6;
const SHORT = "צריך מספר חברה (6 ספרות לפחות) ומפתח מלא";
const REJECTED = "SUMIT לא קיבל את המפתח. בדקו את מספר החברה ואת המפתח.";

const COPY: Record<Provider, {
  title: string;
  subtitle: string;
  steps: readonly string[];
  stepsHead: string;
  importNote: { start: string; date: string };
  footNote: string;
  problem: string;
  keyPlaceholder: string;
}> = {
  sumit: {
    title: "SUMIT",
    subtitle: "חשבוניות, קבלות והוצאות נכנסות ל־Flow לבד",
    stepsHead: "1 · מוצאים את הפרטים ב־SUMIT",
    steps: [
      "נכנסים ל־SUMIT במחשב.",
      "הגדרות ← כללי ← מפתחות API (חיבור למערכות חיצוניות).",
      "מעתיקים את מספר החברה ואת מפתח ה־API.",
    ],
    importNote: {
      start: "כל המסמכים מאז שנפתח החשבון ב־SUMIT. בפעם הראשונה זה לוקח כמה דקות.",
      date: "רק מסמכים מהתאריך הזה והלאה.",
    },
    footNote: "Flow רק קורא מ־SUMIT. הוא לא יוצר ולא משנה מסמכים שם.",
    problem: "המפתח הקודם הפסיק לעבוד, כנראה הוחלף ב־SUMIT. מה שכבר נכנס נשמר. הדביקו מפתח חדש וכל מה שחסר ייכנס.",
    keyPlaceholder: "מדביקים כאן",
  },
};

/** The SUMIT connection page (FLOW-512, §1.5). Live reads the status; a sample skips it. */
export function ConnectionDetailPage({ provider, sample }: { provider: Provider; sample?: ConnectionSample }) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdOwner = useHoldOwnerSettings();
  const dashboard = useDashboardQuery(sample == null);
  const live = sample == null && preview === "off";
  const companyId = dashboard.data?.company_id;
  const sumit = useSumitStatusQuery(sample == null && (preview !== "off" || companyId != null));
  const status = sumit;
  const copy = COPY[provider];
  const backTo = `/settings/connections${search}`;
  const [now] = useRefreshingNow();

  const [typedCompany, setTypedCompany] = useState<string | null>(null);
  const [form, setForm] = useState({ key: "" });
  const [showKey, setShowKey] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [importTouched, setImportTouched] = useState(false);
  const [importValue, setImportValue] = useState<string | null>(null);
  // "short": a tap with something missing; "rejected": SUMIT refused the key (decision 0223).
  const [keyError, setKeyError] = useState<"short" | "rejected" | null>(null);
  const refreshSumit = useSumitRefresh();
  const storedCompany = live && sumit.data?.sumit_company_id != null ? String(sumit.data.sumit_company_id) : (sample?.companyId ?? "");
  // A reconnect starts with the company number on file; a typed one replaces it.
  const companyValue = typedCompany ?? storedCompany;
  const sumitConnect = useSumitConnect({
    companyId: companyValue,
    apiKey: form.key,
    setApiKey: (key) => { setForm((current) => ({ ...current, key })); },
    importFrom: importTouched ? importValue : undefined,
    onSuccess: () => { setReplacing(false); },
    onRejected: () => { setKeyError("rejected"); },
  });
  // Decision 0223: the page shows SUMIT disconnected at once; the key is deleted only once ביטול runs out.
  const disconnect = useWrite<UndoHold>({
    failure: "לא הצלחנו לנתק.",
    keys: [provider],
    place: "top",
    silent: (error) => error.message === UNDONE,
    optimistic: () => [{ key: ["sumit", preview], update: (old) => (old == null ? old : { ...(old as SumitStatus), connected: false, last_error: null, syncing: false }) }],
    run: async (hold) => {
      await hold.done;
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("disconnect_sumit"));
    },
  });
  // A refresh started before a reload or in another tab: when its claim clears, reload the books and say so.
  const liveStatus = live ? status.data : undefined;
  useSyncSettled({
    syncing: liveStatus?.syncing === true,
    pending: refreshSumit.isPending,
    lastSyncAt: liveStatus?.last_sync_at,
    lastError: liveStatus?.last_error,
    success: REFRESH_DONE,
  });

  if (live && (dashboard.isLoading || status.isLoading)) {
    return <ScreenState title={copy.title} kicker="חיבורים" backTo={backTo} phase={{ kind: "loading" }} onRetry={() => { void status.refetch(); }} loading={<List><ListRow variant="skeleton" /><ListRow variant="skeleton" /></List>} />;
  }
  if (live && status.isError && status.data == null) {
    return <ScreenState title={copy.title} kicker="חיבורים" backTo={backTo} phase={screenPhase(preview, status)} onRetry={() => { void status.refetch(); }} />;
  }
  if (live && dashboard.isError && dashboard.data == null) {
    return <ScreenState title={copy.title} kicker="חיבורים" backTo={backTo} phase={screenPhase(preview, dashboard)} onRetry={() => { void dashboard.refetch(); }} />;
  }

  const [sampleGone, setSampleGone] = useState(false);
  const shown = sample ?? liveView(provider, live, status.data, now);
  // A disconnect waiting on its ביטול already shows the page as SUMIT will be after it.
  const view: ConnectionSample = (disconnect.isPending || sampleGone) && shown.state === "connected" ? { state: "new" } : shown;
  const noCompany = live && companyId == null && dashboard.isSuccess;
  const problem = view.state === "problem";
  const connected = view.state === "connected";
  const loading = view.state === "loading";
  const viewerOnly = holdOwner;
  const storedImport = sumit.data?.import_from;
  const importFrom = importTouched ? importValue : (live ? (storedImport ?? null) : null);
  const companyOk = new RegExp(`^\\d{${String(MIN_COMPANY_DIGITS)},}$`).test(companyValue.trim());
  const keyOk = form.key.trim().length >= MIN_KEY;
  const canConnect = keyOk && companyOk;
  const keyMessage = keyError === "rejected" ? REJECTED : keyError === "short" && !canConnect ? SHORT : undefined;
  // A preview passes busy to show the connect in flight; the live page reads its own mutation.
  const busy = view.busy === true || sumitConnect.isPending;
  const showForm = !loading && !viewerOnly && (!connected || replacing);

  const connect = () => {
    if (busy || blocked() || viewerOnly) return;
    if (!canConnect) {
      setKeyError("short");
      return;
    }
    setKeyError(null);
    sumitConnect.mutate();
  };
  const disconnectNow = () => {
    if (holdOwner || blocked()) return;
    const hold = holdForUndo();
    if (sample != null) {
      setSampleGone(true);
      void hold.done.then(() => undefined, () => { setSampleGone(false); });
    } else {
      disconnect.mutate(hold);
    }
    toast.show(connectionToast({ message: "SUMIT נותק. מה שכבר נכנס נשמר", action: "ביטול", onAction: () => { hold.cancel(); } }));
  };

  const syncLine = view.lastSync ?? israelSyncPhrase(live ? sumit.data?.last_sync_at : null, now);
  const facts = [
    { label: "מצב", value: "מחובר" },
    { label: "מספר חברה", value: view.companyId ?? companyValue, ltr: true },
    { label: "עדכון אחרון", value: syncLine ?? "—" },
    { label: "מה מגיע", value: "חשבוניות, קבלות והוצאות" },
    ...(view.imported != null ? [{ label: "נכנסו עד היום", value: view.imported }] : []),
  ];

  if (noCompany) {
    return (
      <ViewerScope>
      <ConnectionPage title={copy.title} subtitle={copy.subtitle} backTo={backTo}>
        <div className="ui-stack">
          <p>כדי לחבר את {copy.title} צריך עסק.</p>
          <Button variant="link" to="/setup/1" chevron>פרטי העסק</Button>
        </div>
      </ConnectionPage>
      </ViewerScope>
    );
  }

  return (
    <ViewerScope>
    <ConnectionPage
      title={copy.title}
      subtitle={copy.subtitle}
      backTo={backTo}
      problem={problem && !viewerOnly ? copy.problem : undefined}
    >
      <ViewerNote />
      {loading ? (
        <List>
          <ListRow variant="skeleton" />
          <ListRow variant="skeleton" />
        </List>
      ) : null}
      {connected && !replacing ? (
        <>
          <div className="ui-settings-card ui-connection-card">
            <ConnectionFacts rows={facts} />
          </div>
          {viewerOnly ? null : (
            <div className="ui-connection-actions">
              <Button variant="secondary" busy={refreshSumit.isPending || live && sumit.data?.syncing === true} onClick={() => { if (!blocked()) refreshSumit.mutate(); }}>
                רענון עכשיו
              </Button>
              <Button variant="link" onClick={() => { setReplacing(true); }}>החלפת מפתח API</Button>
              <Button variant="danger-link" onClick={disconnectNow}>ניתוק</Button>
            </div>
          )}
        </>
      ) : null}
      {showForm ? (
        <>
          <ConnectionHead>{copy.stepsHead}</ConnectionHead>
          <div className="ui-settings-card ui-connection-steps">
            <StepList steps={copy.steps} />
          </div>
          <ConnectionHead>2 · מדביקים</ConnectionHead>
          <TextField
            label="מספר חברה"
            dir="ltr"
            numeric
            value={companyValue}
            inputMode="numeric"
            placeholder="למשל 1234567890"
            reserveMessage
            onChange={(event) => { setKeyError(null); setTypedCompany(event.target.value); }}
            readOnly={busy}
          />
          <div className="ui-secret-wrap">
            <TextField
              label="מפתח API"
              type={showKey ? "text" : "password"}
              dir="ltr"
              value={form.key}
              placeholder={copy.keyPlaceholder}
              autoComplete="off"
              reserveMessage
              error={keyMessage}
              readOnly={busy}
              onChange={(event) => { setKeyError(null); setForm((current) => ({ ...current, key: event.target.value })); }}
            />
            <button type="button" className="ui-secret-toggle m-press" onClick={() => { setShowKey((value) => !value); }}>
              {showKey ? "הסתרה" : "הצגה"}
            </button>
          </div>
          <ConnectionHead>3 · מאיפה לייבא</ConnectionHead>
          <ImportFromField
            value={importFrom}
            disabled={busy}
            onChange={(next) => { setImportTouched(true); setImportValue(next); }}
          />
          <ConnectionNote>{importFrom == null ? copy.importNote.start : copy.importNote.date}</ConnectionNote>
          <Button busy={busy} onClick={connect}>
            {busy ? "מתחבר…" : problem || replacing || keyError === "rejected" ? "חיבור מחדש" : "חיבור"}
          </Button>
          <ConnectionNote>{copy.footNote}</ConnectionNote>
        </>
      ) : null}
      {viewerOnly && !connected ? <ConnectionNote>רק הבעלים יכולים לחבר.</ConnectionNote> : null}
      {viewerOnly && connected ? <ConnectionNote>רק בעל העסק יכול לשנות חיבורים.</ConnectionNote> : null}
      {connected && replacing ? (
        <Button variant="link" onClick={() => { setForm({ key: "" }); setShowKey(false); setReplacing(false); }}>ביטול</Button>
      ) : null}
    </ConnectionPage>
    </ViewerScope>
  );
}

/** The live page's view, read from the status. A reconnect (auth) shows the problem box. */
function liveView(
  provider: Provider,
  live: boolean,
  data: { connected: boolean; last_error: string | null; last_sync_at: string | null; sumit_company_id?: number | string | null } | undefined,
  now: number,
): ConnectionSample {
  if (!live) return { state: "new" };
  if (data == null) return { state: "loading" };
  const authError = data.last_error === "sumit_auth";
  if (authError) return { state: "problem", companyId: data.sumit_company_id != null ? String(data.sumit_company_id) : undefined };
  if (data.connected) {
    return {
      state: "connected",
      companyId: data.sumit_company_id != null ? String(data.sumit_company_id) : undefined,
      lastSync: israelSyncPhrase(data.last_sync_at, now) ?? undefined,
    };
  }
  return { state: "new" };
}

/** `/settings/connections/sumit`. */
export function SumitConnectionRoute({ sample }: { sample?: ConnectionSample } = {}) {
  return <ConnectionDetailPage provider="sumit" sample={sample} />;
}
