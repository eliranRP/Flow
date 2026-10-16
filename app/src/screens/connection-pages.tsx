import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useHoldOwnerSettings, ViewerNote, ViewerScope } from "../use-is-viewer";
import { useDashboardQuery, useMercuryStatusQuery, useSumitStatusQuery } from "../use-books";
import { getSupabase } from "../lib/supabase";
import { invokeEdge } from "../edge";
import { hebrewMercuryError, mercuryRefreshDone } from "../mercury-copy";
import { israelSyncPhrase } from "../sumit-copy";
import { useRefreshingNow } from "../israel-clock";
import { assertNoError, useWrite } from "../use-write";
import { useSumitConnect } from "../use-sumit-connect";
import { useMercuryConnect } from "../use-mercury-connect";
import { useSumitRefresh } from "../use-sumit-refresh";
import { MERCURY_REFRESH_KEYS, onboardingFromSettings } from "./connections-status";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { Button } from "../ui/button";
import { ImportFromField } from "../ui/import-from-field";
import { ConnectionFacts, ConnectionHead, ConnectionNote, ConnectionPage, StepList } from "../ui/connection-page";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";
import { screenPhase } from "../query-phase";
import { LogoutIcon, RefreshIcon } from "../ui/icons";

export type Provider = "sumit" | "mercury";

/** A connection page's state for stories and the preview (the live page reads the status). */
export type ConnectionSample = {
  state: "new" | "problem" | "connected" | "loading" | "error" | "viewer";
  /** SUMIT: the company number on file. */
  companyId?: string;
  /** Mercury: the account labels on file. */
  accounts?: string;
  /** The last sync, already in words ("היום, 06:05"). */
  lastSync?: string;
  /** A connect is in flight. */
  busy?: boolean;
};

/** The key and the company number are checked before the connect button is enabled. */
const MIN_KEY = 8;
const MIN_COMPANY_DIGITS = 6;

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
  mercury: {
    title: "Mercury",
    subtitle: "תנועות הבנק נכנסות ל־Flow כל 15 דקות",
    stepsHead: "1 · יוצרים מפתח ב־Mercury",
    steps: [
      "נכנסים ל־Mercury במחשב, כבעלים או מנהל.",
      "Settings ← API Tokens ← יצירת token חדש מסוג Read Only.",
      "מעתיקים את ה־token. Mercury מציג אותו פעם אחת.",
    ],
    importNote: {
      start: "כל התנועות שיש ל־Mercury (עד 24 חודשים אחורה). בפעם הראשונה זה לוקח כמה דקות.",
      date: "רק תנועות מהתאריך הזה והלאה.",
    },
    footNote: "מפתח Read Only: Flow רואה תנועות ויתרות, ולא יכול להעביר כסף או לשנות שום דבר ב־Mercury.",
    problem: "Mercury הפסיק לקבל את המפתח, כנראה נמחק או פג. מה שכבר נכנס נשמר. הדביקו מפתח חדש וכל התנועות שחסרות ייכנסו.",
    keyPlaceholder: "מדביקים כאן",
  },
};

/** The connection page for SUMIT or Mercury (FLOW-512, §1.5). Live reads the status; a sample skips it. */
export function ConnectionDetailPage({ provider, sample }: { provider: Provider; sample?: ConnectionSample }) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdOwner = useHoldOwnerSettings();
  const dashboard = useDashboardQuery(sample == null);
  const live = sample == null && preview === "off";
  const companyId = dashboard.data?.company_id;
  const sumit = useSumitStatusQuery(sample == null && provider === "sumit" && (preview !== "off" || companyId != null));
  const mercury = useMercuryStatusQuery(sample == null && provider === "mercury" && (preview !== "off" || companyId != null));
  const status = provider === "sumit" ? sumit : mercury;
  const copy = COPY[provider];
  const backTo = `/settings/connections${search}`;
  const [now] = useRefreshingNow();

  const [typedCompany, setTypedCompany] = useState<string | null>(null);
  const [form, setForm] = useState({ key: "" });
  const [showKey, setShowKey] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [importTouched, setImportTouched] = useState(false);
  const [importValue, setImportValue] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const refreshSumit = useSumitRefresh();
  const storedCompany = provider === "sumit" && live && sumit.data?.sumit_company_id != null ? String(sumit.data.sumit_company_id) : (sample?.companyId ?? "");
  // A reconnect starts with the company number on file; a typed one replaces it.
  const companyValue = typedCompany ?? storedCompany;
  const sumitConnect = useSumitConnect({
    companyId: companyValue,
    apiKey: form.key,
    setApiKey: (key) => { setForm((current) => ({ ...current, key })); },
    importFrom: importTouched ? importValue : undefined,
    onSuccess: () => { setReplacing(false); },
  });
  const mercuryConnect = useMercuryConnect({
    apiKey: form.key,
    setApiKey: (key) => { setForm((current) => ({ ...current, key })); },
    importFrom: importTouched ? importValue : undefined,
    onSuccess: () => { setReplacing(false); },
  });
  const disconnect = useWrite({
    failure: "לא הצלחנו לנתק.",
    keys: [provider],
    onSuccess: () => {
      setDisconnectOpen(false);
      toast.show({ message: `${provider === "sumit" ? "SUMIT" : "Mercury"} נותק. מה שכבר נכנס נשמר` });
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      if (provider === "sumit") assertNoError(await supabase.rpc("disconnect_sumit"));
      else assertNoError(await supabase.rpc("disconnect_connector", { p_provider: "mercury" }));
    },
  });
  const refreshResult = useRef<unknown>(null);
  const mercuryRefresh = useWrite({
    failure: (error) => hebrewMercuryError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    success: () => mercuryRefreshDone(refreshResult.current),
    keys: MERCURY_REFRESH_KEYS,
    run: async () => {
      refreshResult.current = null;
      const data = await invokeEdge("mercury-sync", { force: true });
      refreshResult.current = data;
      if (data != null && typeof data === "object" && "skipped" in data && data.skipped === true) {
        await queryClient.refetchQueries({ queryKey: ["mercury"] });
        throw new Error("sync_held");
      }
    },
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

  const view: ConnectionSample = sample ?? liveView(provider, live, status.data, now);
  const noCompany = live && companyId == null && dashboard.isSuccess;
  const problem = view.state === "problem";
  const connected = view.state === "connected";
  const loading = view.state === "loading";
  const viewerOnly = holdOwner;
  const storedImport = provider === "sumit" ? sumit.data?.import_from : mercury.data?.import_from;
  const importFrom = importTouched ? importValue : (live ? (storedImport ?? null) : null);
  const companyOk = provider === "mercury" || new RegExp(`^\\d{${String(MIN_COMPANY_DIGITS)},}$`).test(companyValue.trim());
  const keyOk = form.key.trim().length >= MIN_KEY;
  const canConnect = keyOk && companyOk;
  // A preview passes busy to show the connect in flight; the live page reads its own mutation.
  const busy = view.busy === true || (provider === "sumit" ? sumitConnect.isPending : mercuryConnect.isPending);
  const showForm = !loading && !viewerOnly && (!connected || replacing);

  const connect = () => {
    if (busy || blocked() || viewerOnly) return;
    if (!canConnect) {
      if (!keyOk) setKeyError(true);
      return;
    }
    if (provider === "sumit") sumitConnect.mutate();
    else mercuryConnect.mutate();
  };

  const syncLine = view.lastSync ?? israelSyncPhrase(live ? (provider === "sumit" ? sumit.data?.last_sync_at : mercury.data?.last_sync_at) : null, now);
  const accountLine = provider === "mercury"
    ? (view.accounts ?? (live ? accountNames(mercury.data?.account_labels) : undefined) ?? "—")
    : null;
  const facts = provider === "sumit"
    ? [
      { label: "מצב", value: "מחובר" },
      { label: "מספר חברה", value: view.companyId ?? companyValue, ltr: true },
      { label: "עדכון אחרון", value: syncLine ?? "—" },
      { label: "מה מגיע", value: "חשבוניות, קבלות והוצאות" },
    ]
    : [
      { label: "מצב", value: "מחובר" },
      { label: "חשבונות", value: accountLine ?? "—", ltr: true },
      { label: "עדכון אחרון", value: syncLine ?? "—" },
    ];

  if (noCompany) {
    return (
      <ViewerScope>
      <ConnectionPage title={copy.title} subtitle={copy.subtitle} backTo={backTo}>
        <div className="ui-stack">
          <p>כדי לחבר את {copy.title} צריך עסק.</p>
          <TextLink to={onboardingFromSettings(search, provider)}>פרטי העסק</TextLink>
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
              {provider === "sumit" ? (
                <Button variant="secondary" busy={refreshSumit.isPending || live && sumit.data?.syncing === true} onClick={() => { if (!blocked()) refreshSumit.mutate(); }} icon={<RefreshIcon size={18} />}>
                  רענון עכשיו
                </Button>
              ) : (
                <Button variant="secondary" busy={mercuryRefresh.isPending || live && mercury.data?.syncing === true} onClick={() => { if (!blocked()) mercuryRefresh.mutate(); }} icon={<RefreshIcon size={18} />}>
                  רענון עכשיו
                </Button>
              )}
              <Button variant="link" onClick={() => { setReplacing(true); }}>החלפת מפתח API</Button>
              <Button variant="danger-link" icon={<LogoutIcon size={18} />} onClick={() => { setDisconnectOpen(true); }}>ניתוק</Button>
            </div>
          )}
        </>
      ) : null}
      {showForm && !loading && !viewerOnly ? (
        <>
          <ConnectionHead>{copy.stepsHead}</ConnectionHead>
          <div className="ui-settings-card ui-connection-steps">
            <StepList steps={copy.steps} />
          </div>
          <ConnectionHead>2 · מדביקים</ConnectionHead>
          {provider === "sumit" ? (
            <TextField
              label="מספר חברה"
              dir="ltr"
              numeric
              value={companyValue}
              inputMode="numeric"
              placeholder="למשל 1234567890"
              reserveMessage
              onChange={(event) => { setTypedCompany(event.target.value); }}
              readOnly={busy}
            />
          ) : null}
          <div className="ui-secret-wrap">
            <TextField
              label="מפתח API"
              type={showKey ? "text" : "password"}
              dir="ltr"
              value={form.key}
              placeholder={copy.keyPlaceholder}
              autoComplete="off"
              reserveMessage
              error={keyError && !keyOk ? "חסר מפתח." : undefined}
              readOnly={busy}
              onChange={(event) => { setKeyError(false); setForm((current) => ({ ...current, key: event.target.value })); }}
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
          <Button
            busy={busy}
            disabled={!canConnect}
            onClick={connect}
          >
            {busy ? "מתחבר…" : problem || replacing ? "חיבור מחדש" : "חיבור"}
          </Button>
          <ConnectionNote>{copy.footNote}</ConnectionNote>
        </>
      ) : null}
      {viewerOnly && !connected ? <ConnectionNote>רק הבעלים יכולים לחבר.</ConnectionNote> : null}
      {viewerOnly && connected ? <ConnectionNote>רק בעל העסק יכול לשנות חיבורים.</ConnectionNote> : null}
      {connected && replacing ? (
        <Button variant="link" onClick={() => { setReplacing(false); }}>ביטול</Button>
      ) : null}
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={`לנתק את ${copy.title}?`}
        consequence="המפתח נמחק. הספרים שכבר ירדו נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={disconnect.isPending}
        onConfirm={() => {
          if (holdOwner || blocked()) return;
          disconnect.mutate();
        }}
      />
    </ConnectionPage>
    </ViewerScope>
  );
}

/** The live page's view, read from the status. A reconnect (auth) shows the problem box. */
/** Mercury's account labels as one line; the server sends them as a list of text. */
function accountNames(labels: unknown): string | undefined {
  if (!Array.isArray(labels)) return undefined;
  const names = labels.filter((label): label is string => typeof label === "string");
  return names.length === 0 ? undefined : names.join(" · ");
}

function liveView(
  provider: Provider,
  live: boolean,
  data: { connected: boolean; last_error: string | null; last_sync_at: string | null; sumit_company_id?: number | string | null; account_labels?: unknown } | undefined,
  now: number,
): ConnectionSample {
  if (!live) return { state: "new" };
  if (data == null) return { state: "loading" };
  const authError = provider === "sumit" ? data.last_error === "sumit_auth" : data.last_error === "auth";
  if (authError) return { state: "problem", companyId: data.sumit_company_id != null ? String(data.sumit_company_id) : undefined };
  if (data.connected === true) {
    return {
      state: "connected",
      companyId: data.sumit_company_id != null ? String(data.sumit_company_id) : undefined,
      accounts: accountNames(data.account_labels),
      lastSync: israelSyncPhrase(data.last_sync_at, now) ?? undefined,
    };
  }
  return { state: "new" };
}

/** `/settings/connections/sumit`. */
export function SumitConnectionRoute({ sample }: { sample?: ConnectionSample } = {}) {
  return <ConnectionDetailPage provider="sumit" sample={sample} />;
}

/** `/settings/connections/mercury`. */
export function MercuryConnectionRoute({ sample }: { sample?: ConnectionSample } = {}) {
  return <ConnectionDetailPage provider="mercury" sample={sample} />;
}
