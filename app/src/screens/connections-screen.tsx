import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useHoldWrites, useIsViewer, ViewerNote, ViewerScope } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useRefreshingNow } from "../israel-clock";
import { hebrewMercuryError } from "../mercury-copy";
import { hebrewSumitError, israelSyncPhrase, retryClockParts } from "../sumit-copy";
import { useDashboardQuery, useMercuryStatusQuery, useSumitStatusQuery } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { useSyncSettled } from "../use-sync-settled";
import { invokeEdge } from "../edge";
import { useMercuryConnect } from "../use-mercury-connect";
import { useSumitConnect } from "../use-sumit-connect";
import { MercuryConnectSheet } from "../ui/mercury-connect-sheet";
import { SumitConnectSheet } from "../ui/sumit-connect-sheet";
import { AssistantSettings } from "./assistant-settings";
import { bindJevConnectorScope } from "./jev-review";
import { JEV_DEFAULT, JevSettings } from "./jev-settings";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { historyIndex, popSheetLayers, sheetStack, useSheetHistory } from "../ui/back";
import { useFocusRowAfterRetry } from "../ui/focus-retry";
import { BankIcon, DocumentIcon, LogoutIcon, RefreshIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { ConnectorRow } from "../ui/connector-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Sheet } from "../ui/sheet";
import { TextLink } from "../ui/text-link";
import { useBlockedPreview } from "./screen-shared";
import type { SettingsSample } from "./settings-screen";

type SumitKind = "loading" | "error" | "reconnect" | "connected" | "disconnected";

function sumitKind(input: {
  forced: "loading" | "error" | null;
  noCompany: boolean;
  statusLoading: boolean;
  statusFailed: boolean;
  authReconnect: boolean;
  connected: boolean;
}): SumitKind {
  if (input.forced === "loading") return "loading";
  if (input.forced === "error") return "error";
  if (input.noCompany) return "disconnected";
  if (input.statusLoading) return "loading";
  if (input.statusFailed) return "error";
  if (input.authReconnect) return "reconnect";
  if (input.connected) return "connected";
  return "disconnected";
}

/** Connections → onboarding, then back to Connections with the same connector's sheet open. */
function onboardingFromSettings(search: string, sheet: "sumit" | "mercury"): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : "");
  params.set("return", `/settings/connections?sheet=${sheet}`);
  return `/onboarding?${params.toString()}`;
}

const REFRESH_DONE = "הרענון הסתיים.";
const SUMIT_REFRESH_KEYS = ["sumit", "dashboard", "unpaid", "review", "project"];
const MERCURY_REFRESH_KEYS = ["mercury", "dashboard", "unpaid", "review", "project"];

/** A connector's one-word status (0082 §3). */
function connectorWord(kind: SumitKind): string {
  if (kind === "reconnect") return "צריך לחבר מחדש";
  if (kind === "connected") return "מחובר";
  return "לא מחובר";
}

/**
 * `/settings/connections` (FLOW-501): SUMIT and Mercury under ספרים ובנק,
 * Jev and the assistant under עזרים. The rows, sheets and focus returns moved
 * here from Settings unchanged. `?sheet=sumit|mercury|assistant` opens one.
 */
export function ConnectionsScreen({
  sample,
  sampleSecret,
}: {
  sample?: SettingsSample;
  /** Dev route only. Production preview never mints a local code. */
  sampleSecret?: string;
} = {}) {
  const preview = useHomePreview();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const previewValue = params.get("preview");
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { session } = useAuth();
  const viewer = useIsViewer();
  const holdWrites = useHoldWrites();
  const blocked = useBlockedPreview();
  const status = useSumitStatusQuery(sample == null);
  const mercuryStatus = useMercuryStatusQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null);
  const signedInUserId = session?.user.id;
  const signedInCompanyId = dashboard.data?.company_id;
  if (signedInUserId && signedInCompanyId) {
    bindJevConnectorScope({ userId: signedInUserId, companyId: signedInCompanyId });
  }
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mercuryApiKey, setMercuryApiKey] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [mercuryConnectOpen, setMercuryConnectOpen] = useState(false);
  const [mercuryStatusOpen, setMercuryStatusOpen] = useState(false);
  const [mercuryDisconnectOpen, setMercuryDisconnectOpen] = useState(false);
  const adoptSheet = useRef(false);
  const setConnectSheet = useSheetHistory("sumit-connect", connectOpen, setConnectOpen, undefined, adoptSheet);
  const setStatusSheet = useSheetHistory("sumit-status", statusOpen, setStatusOpen, undefined, adoptSheet);
  const setDisconnectSheet = useSheetHistory("sumit-disconnect", disconnectOpen, setDisconnectOpen);
  // Every close path (✕, Escape, Back, success) drops the pasted token.
  const setMercuryConnectOpenClearing = useCallback((open: boolean) => {
    if (!open) setMercuryApiKey("");
    setMercuryConnectOpen(open);
  }, []);
  const setMercuryConnectSheet = useSheetHistory("mercury-connect", mercuryConnectOpen, setMercuryConnectOpenClearing, undefined, adoptSheet);
  const setMercuryStatusSheet = useSheetHistory("mercury-status", mercuryStatusOpen, setMercuryStatusOpen, undefined, adoptSheet);
  const setMercuryDisconnectSheet = useSheetHistory("mercury-disconnect", mercuryDisconnectOpen, setMercuryDisconnectOpen);
  const [clockNow, setClockNow] = useRefreshingNow();
  const [focusSumit, setFocusSumit] = useState(false);
  const [focusMercury, setFocusMercury] = useState(false);
  const [sumitRetrying, setSumitRetrying] = useState(false);
  const [mercuryRetrying, setMercuryRetrying] = useState(false);
  const [sumitHint, setSumitHint] = useState("לא הצלחנו לטעון");
  const [mercuryHint, setMercuryHint] = useState("לא הצלחנו לטעון");
  const [sumitOffline, setSumitOffline] = useState(0);
  const [mercuryOffline, setMercuryOffline] = useState(0);
  const [sumitNonce, setSumitNonce] = useState(0);
  const [mercuryNonce, setMercuryNonce] = useState(0);
  const sumitRowRef = useRef<HTMLButtonElement>(null);
  const sumitRetryRef = useRef<HTMLButtonElement>(null);
  const sumitDisconnectRef = useRef<HTMLButtonElement>(null);
  const mercuryRowRef = useRef<HTMLButtonElement>(null);
  const mercuryRetryRef = useRef<HTMLButtonElement>(null);
  const mercuryDisconnectRef = useRef<HTMLButtonElement>(null);
  const sheetApplied = useRef(false);
  const wantSheet = useRef<"sumit" | "mercury" | null>(null);
  const retrySource = sample ? sample.nextAttemptAt : status.data?.next_attempt_at;
  useEffect(() => {
    if (!retrySource) return;
    const at = Date.parse(retrySource);
    const wait = at - Date.now();
    if (!Number.isFinite(wait) || wait <= 0) return;
    const id = window.setTimeout(() => { setClockNow(Date.now()); }, wait + 25);
    return () => { window.clearTimeout(id); };
  }, [retrySource, setClockNow]);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  const connect = useSumitConnect({
    companyId,
    apiKey,
    setApiKey,
    onSuccess: () => {
      setConnectSheet(false);
    },
  });
  const mercuryConnect = useMercuryConnect({
    apiKey: mercuryApiKey,
    setApiKey: setMercuryApiKey,
    onSuccess: () => {
      setMercuryConnectSheet(false);
    },
  });
  const refresh = useWrite({
    failure: (error) => hebrewSumitError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    success: REFRESH_DONE,
    keys: SUMIT_REFRESH_KEYS,
    run: async () => {
      const data = await invokeEdge("sumit-sync", { force: true });
      if (data != null && typeof data === "object" && "skipped" in data && data.skipped === true) {
        // Another tab or an earlier load holds the claim: show it as syncing, without a skip toast.
        await queryClient.refetchQueries({ queryKey: ["sumit"] });
        const held = queryClient.getQueriesData<{ syncing?: boolean }>({ queryKey: ["sumit"] }).some(([, d]) => d?.syncing === true);
        throw new Error(held ? "sync_held" : "sync_skipped");
      }
    },
  });
  const disconnect = useWrite({
    failure: "לא הצלחנו לנתק.",
    success: "החיבור נותק. הספרים נשארו.",
    keys: ["sumit"],
    onSuccess: () => {
      setDisconnectOpen(false);
      setStatusOpen(false);
      setConnectOpen(false);
      popSheetLayers(navigate, 2);
      setFocusSumit(true);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("disconnect_sumit"));
    },
  });
  const mercuryRefresh = useWrite({
    failure: (error) => hebrewMercuryError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    success: REFRESH_DONE,
    keys: MERCURY_REFRESH_KEYS,
    run: async () => {
      const data = await invokeEdge("mercury-sync", { force: true });
      if (data != null && typeof data === "object" && "skipped" in data && data.skipped === true) {
        await queryClient.refetchQueries({ queryKey: ["mercury"] });
        const held = queryClient.getQueriesData<{ syncing?: boolean }>({ queryKey: ["mercury"] }).some(([, d]) => d?.syncing === true);
        throw new Error(held ? "sync_held" : "sync_skipped");
      }
    },
  });
  // syncing comes from the server claim, so the busy row survives a reload, a new tab, and reopening the app.
  const sumitSyncing = status.data?.syncing === true;
  const mercurySyncing = mercuryStatus.data?.syncing === true;
  const sumitRefreshBusy = refresh.isPending || sumitSyncing;
  const mercuryRefreshBusy = mercuryRefresh.isPending || mercurySyncing;
  useSyncSettled({
    syncing: sumitSyncing,
    pending: refresh.isPending,
    lastSyncAt: status.data?.last_sync_at,
    lastError: status.data?.last_error,
    keys: SUMIT_REFRESH_KEYS,
    success: REFRESH_DONE,
  });
  useSyncSettled({
    syncing: mercurySyncing,
    pending: mercuryRefresh.isPending,
    lastSyncAt: mercuryStatus.data?.last_sync_at,
    lastError: mercuryStatus.data?.last_error,
    keys: MERCURY_REFRESH_KEYS,
    success: REFRESH_DONE,
  });
  const mercuryDisconnect = useWrite({
    failure: "לא הצלחנו לנתק.",
    success: "החיבור נותק. הספרים נשארו.",
    keys: ["mercury"],
    onSuccess: () => {
      setMercuryDisconnectOpen(false);
      setMercuryStatusOpen(false);
      setMercuryConnectOpen(false);
      popSheetLayers(navigate, 2);
      setFocusMercury(true);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("disconnect_connector", { p_provider: "mercury" }));
    },
  });

  useEffect(() => {
    if (sumitNonce === 0) return;
    setSumitHint("");
    const id = window.setTimeout(() => {
      setSumitHint("לא הצלחנו לטעון");
      const retry = sumitRetryRef.current;
      const active = document.activeElement;
      if (retry == null || active === retry) return;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return;
      retry.focus();
    }, 30);
    return () => { window.clearTimeout(id); };
  }, [sumitNonce]);

  useEffect(() => {
    if (mercuryNonce === 0) return;
    setMercuryHint("");
    const id = window.setTimeout(() => {
      setMercuryHint("לא הצלחנו לטעון");
      const retry = mercuryRetryRef.current;
      const active = document.activeElement;
      if (retry == null || active === retry) return;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return;
      retry.focus();
    }, 30);
    return () => { window.clearTimeout(id); };
  }, [mercuryNonce]);

  const sumitNoCompany = sample
    ? sample.noCompany === true
    : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
  const sumitPaused = sample == null && preview === "off" && !sumitNoCompany && status.fetchStatus === "paused" && status.data == null;
  const sumitShowsRetry = sample?.sumit === "error" || (
    sample == null
    && !sumitNoCompany
    && (sumitRetrying || sumitPaused || (status.isError && status.data == null))
  );
  const sumitRowReady = phase.kind !== "loading"
    && phase.kind !== "error"
    && sample?.sumit !== "loading"
    && sample?.sumit !== "error"
    && !sumitShowsRetry
    && !(sample == null && !sumitNoCompany && status.isLoading && !sumitRetrying);
  useFocusRowAfterRetry(sumitShowsRetry, sumitRetryRef, sumitRowRef, sumitRowReady, sumitNonce);

  const mercuryPaused = sample == null && preview === "off" && !sumitNoCompany && mercuryStatus.fetchStatus === "paused" && mercuryStatus.data == null;
  const mercuryShowsRetry = sample?.mercury === "error" || (
    sample == null
    && !sumitNoCompany
    && (mercuryRetrying || mercuryPaused || (mercuryStatus.isError && mercuryStatus.data == null))
  );
  const mercuryRowReady = phase.kind !== "loading"
    && phase.kind !== "error"
    && sample?.mercury !== "loading"
    && sample?.mercury !== "error"
    && !mercuryShowsRetry
    && !(sample == null && !sumitNoCompany && mercuryStatus.isLoading && !mercuryRetrying);
  useFocusRowAfterRetry(mercuryShowsRetry, mercuryRetryRef, mercuryRowRef, mercuryRowReady, mercuryNonce);

  useEffect(() => onlineManager.subscribe((online) => {
    if (online) {
      setSumitOffline(0);
      setMercuryOffline(0);
    }
  }), []);

  useEffect(() => {
    if (!focusSumit) return;
    if (sumitRowRef.current == null) return;
    const id = window.setTimeout(() => {
      sumitRowRef.current?.focus();
      setFocusSumit(false);
    }, 0);
    return () => { window.clearTimeout(id); };
  }, [focusSumit, status.data, status.isError, status.isLoading]);

  useEffect(() => {
    if (!focusMercury) return;
    if (mercuryRowRef.current == null) return;
    const id = window.setTimeout(() => {
      mercuryRowRef.current?.focus();
      setFocusMercury(false);
    }, 0);
    return () => { window.clearTimeout(id); };
  }, [focusMercury, mercuryStatus.data, mercuryStatus.isError, mercuryStatus.isLoading]);

  useEffect(() => {
    if (holdWrites) return;
    if (sheetApplied.current) return;
    const noCo = sample
      ? sample.noCompany === true
      : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
    const asked = params.get("sheet");
    if (asked === "sumit" || asked === "mercury") {
      if (phase.kind === "loading" || phase.kind === "error") {
        adoptSheet.current = false;
        return;
      }
      if (sample == null && !noCo && (asked === "sumit" ? status.isLoading : mercuryStatus.isLoading)) {
        adoptSheet.current = false;
        return;
      }
      const companySettling = sample == null && preview === "off" && dashboard.isFetching && dashboard.data?.company_id == null;
      if (companySettling) {
        adoptSheet.current = false;
        return;
      }
      wantSheet.current = asked;
      const next = new URLSearchParams(params);
      next.delete("sheet");
      setParams(next, { replace: true });
      return;
    }
    const wanted = wantSheet.current;
    if (wanted == null) return;
    const mercury = wanted === "mercury";
    const query = mercury ? mercuryStatus : status;
    const auth = mercury
      ? (sample ? sample.mercuryLastError : mercuryStatus.data?.last_error) === "auth"
      : (sample ? sample.lastError : status.data?.last_error) === "sumit_auth";
    const isConnected = noCo
      ? false
      : mercury
        ? (sample ? sample.mercuryConnected === true : mercuryStatus.data?.connected === true)
        : (sample ? sample.connected : status.data?.connected === true);
    const statusPaused = sample == null && preview === "off" && !noCo && query.fetchStatus === "paused" && query.data == null;
    const opened = sumitKind({
      forced: (mercury ? sample?.mercury : sample?.sumit) ?? null,
      noCompany: noCo,
      statusLoading: false,
      statusFailed: sample == null && (statusPaused || (query.isError && query.data == null)),
      authReconnect: auth,
      connected: isConnected,
    });
    sheetApplied.current = true;
    wantSheet.current = null;
    if (opened === "connected" || opened === "reconnect" || opened === "disconnected") {
      const earlier = historyIndex();
      adoptSheet.current = earlier != null && earlier > 0;
    }
    if (mercury) {
      if (opened === "connected") setMercuryStatusOpen(true);
      else if (opened === "reconnect" || opened === "disconnected") setMercuryConnectOpen(true);
      return;
    }
    if (opened === "connected") setStatusOpen(true);
    else if (opened === "reconnect" || opened === "disconnected") setConnectOpen(true);
  }, [params, setParams, phase.kind, sample, preview, previewValue, dashboard.data, dashboard.isFetching, status, mercuryStatus, holdWrites]);

  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="חיבורים"
        kicker="הגדרות"
        backTo={`/settings${search}`}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
      />
    );
  }

  const noCompany = sample
    ? sample.noCompany === true
    : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
  const connected = noCompany ? false : sample ? sample.connected : status.data?.connected === true;
  const sumitId = sample ? sample.companyId : status.data?.sumit_company_id;
  const rawError = sample ? sample.lastError : status.data?.last_error;
  const lastError = hebrewSumitError(rawError);
  const authReconnect = rawError === "sumit_auth";
  const retry = authReconnect ? null : retryClockParts(retrySource, clockNow);
  const refreshHeld = retry != null;
  const statusPaused = sample == null && preview === "off" && !noCompany && status.fetchStatus === "paused" && status.data == null;
  const kind = sumitKind({
    forced: sample?.sumit ?? null,
    noCompany,
    statusLoading: sample == null && !noCompany && status.isLoading && !sumitRetrying,
    statusFailed: sample == null && (sumitRetrying || statusPaused || (status.isError && status.data == null)),
    authReconnect,
    connected,
  });
  const syncPhrase = israelSyncPhrase(sample ? sample.lastSyncAt : status.data?.last_sync_at, clockNow);
  const mercuryConnected = noCompany ? false : sample ? sample.mercuryConnected === true : mercuryStatus.data?.connected === true;
  const mercuryRawError = sample ? sample.mercuryLastError : mercuryStatus.data?.last_error;
  const mercuryLastError = hebrewMercuryError(mercuryRawError);
  const mercuryAuthReconnect = mercuryRawError === "auth";
  const mercuryRetrySource = sample ? undefined : mercuryStatus.data?.next_attempt_at;
  const mercuryRetry = mercuryAuthReconnect ? null : retryClockParts(mercuryRetrySource, clockNow);
  const mercuryRefreshHeld = mercuryRetry != null;
  const mercuryStatusPaused = sample == null && preview === "off" && !noCompany && mercuryStatus.fetchStatus === "paused" && mercuryStatus.data == null;
  const mercuryKind = sumitKind({
    forced: sample?.mercury ?? null,
    noCompany,
    statusLoading: sample == null && !noCompany && mercuryStatus.isLoading && !mercuryRetrying,
    statusFailed: sample == null && (mercuryRetrying || mercuryStatusPaused || (mercuryStatus.isError && mercuryStatus.data == null)),
    authReconnect: mercuryAuthReconnect,
    connected: mercuryConnected,
  });
  const mercurySyncPhrase = israelSyncPhrase(sample ? sample.mercuryLastSyncAt : mercuryStatus.data?.last_sync_at, clockNow);
  const retryHint = retry == null ? undefined : (
    <>
      {retry.tomorrow ? "אפשר לנסות שוב מחר ב-" : "אפשר לנסות שוב ב-"}
      <bdi className="ui-num" dir="ltr">{retry.clock}</bdi>
    </>
  );
  const refreshHint = retryHint;
  const mercuryRetryHint = mercuryRetry == null ? undefined : (
    <>
      {mercuryRetry.tomorrow ? "אפשר לנסות שוב מחר ב-" : "אפשר לנסות שוב ב-"}
      <bdi className="ui-num" dir="ltr">{mercuryRetry.clock}</bdi>
    </>
  );
  const mercuryRefreshHint = mercuryRetryHint;
  return (
    <ViewerScope>
    <div>
      <ScreenHeader title="חיבורים" kicker="הגדרות" backTo={`/settings${search}`} />
      <ViewerNote />
      <SectionHead title="ספרים ובנק" />
      {kind === "loading" || mercuryKind === "loading" ? <p className="sr-only" role="status">טוען…</p> : null}
      <List>
        <ConnectorRow
          title="SUMIT"
          icon={<DocumentIcon size={24} />}
          state={kind === "loading" ? "loading" : kind === "error" ? "error" : "ready"}
          hint={connectorWord(kind)}
          warning={kind === "reconnect"}
          rowRef={sumitRowRef}
          onOpen={holdWrites ? undefined : () => {
            if (kind === "connected") setStatusSheet(true);
            else setConnectSheet(true);
          }}
          retry={{
            hint: (
              <>
                {sumitHint}
                {sumitOffline > 0 ? <span className="sr-only">אין חיבור לאינטרנט</span> : null}
              </>
            ),
            label: "ניסיון חוזר: SUMIT",
            busy: sumitRetrying,
            retryRef: sumitRetryRef,
            onRetry: () => {
              if (sample != null || sumitRetrying) return;
              if (!onlineManager.isOnline()) {
                setSumitOffline((nonce) => nonce + 1);
                return;
              }
              setSumitRetrying(true);
              void status.refetch().then((result) => {
                const stayed = document.activeElement === sumitRetryRef.current;
                setSumitRetrying(false);
                if (result.fetchStatus === "paused" || !onlineManager.isOnline()) {
                  setSumitOffline((nonce) => nonce + 1);
                  return;
                }
                if (result.isError || result.data == null) {
                  setSumitNonce((nonce) => nonce + 1);
                  return;
                }
                if (stayed) setFocusSumit(true);
              });
            },
          }}
        />
        <ConnectorRow
          title="Mercury"
          icon={<BankIcon size={24} />}
          state={mercuryKind === "loading" ? "loading" : mercuryKind === "error" ? "error" : "ready"}
          hint={connectorWord(mercuryKind)}
          warning={mercuryKind === "reconnect"}
          rowRef={mercuryRowRef}
          onOpen={holdWrites ? undefined : () => {
            if (mercuryKind === "connected") setMercuryStatusSheet(true);
            else setMercuryConnectSheet(true);
          }}
          retry={{
            hint: (
              <>
                {mercuryHint}
                {mercuryOffline > 0 ? <span className="sr-only">אין חיבור לאינטרנט</span> : null}
              </>
            ),
            label: "ניסיון חוזר: Mercury",
            busy: mercuryRetrying,
            retryRef: mercuryRetryRef,
            onRetry: () => {
              if (sample != null || mercuryRetrying) return;
              if (!onlineManager.isOnline()) {
                setMercuryOffline((nonce) => nonce + 1);
                return;
              }
              setMercuryRetrying(true);
              void mercuryStatus.refetch().then((result) => {
                const stayed = document.activeElement === mercuryRetryRef.current;
                setMercuryRetrying(false);
                if (result.fetchStatus === "paused" || !onlineManager.isOnline()) {
                  setMercuryOffline((nonce) => nonce + 1);
                  return;
                }
                if (result.isError || result.data == null) {
                  setMercuryNonce((nonce) => nonce + 1);
                  return;
                }
                if (stayed) setFocusMercury(true);
              });
            },
          }}
        />
      </List>
      <SectionHead title="עזרים" />
      <JevSettings
        noCompany={noCompany}
        blocked={blocked}
        readOnly={holdWrites}
        sample={
          noCompany
            ? undefined
            : sample
              ? (sample.jev ?? JEV_DEFAULT)
              : preview !== "off"
                ? JEV_DEFAULT
                : undefined
        }
      />
      <AssistantSettings
        announceLoading={kind !== "loading"}
        sample={
          // A missing company, and any preview, must not call flow-mcp/status.
          sample
            ? (noCompany ? { state: "no-company" } : (sample.assistant ?? { state: "empty" }))
            : noCompany
              ? { state: "no-company" }
              : preview !== "off"
                ? { state: "empty" }
                : undefined
        }
        noCompany={noCompany}
        blocked={import.meta.env.DEV && params.get("e2e") === "stack" ? undefined : blocked}
        sampleSecret={import.meta.env.DEV && params.get("e2e") === "stack" ? sampleSecret : undefined}
        showHeading={false}
        initialOpen={params.get("sheet") === "assistant"}
        readOnly={holdWrites}
        viewerCopy={viewer}
      />
      <SumitConnectSheet
        open={connectOpen}
        onOpenChange={setConnectSheet}
        title={authReconnect && !noCompany ? "SUMIT" : "חיבור SUMIT"}
        returnFocusRef={sumitRowRef}
        noCompanyBody={noCompany ? (
          <div className="ui-stack">
            <p>כדי לחבר את SUMIT צריך עסק.</p>
            <TextLink to={onboardingFromSettings(search, "sumit")} replace={sheetStack(location.state).includes("sumit-connect")}>פרטי העסק</TextLink>
          </div>
        ) : undefined}
        authReconnect={authReconnect}
        companyId={companyId}
        setCompanyId={setCompanyId}
        apiKey={apiKey}
        setApiKey={setApiKey}
        submitLabel={authReconnect ? "חיבור מחדש" : "חיבור"}
        busy={connect.isPending}
        disabled={holdWrites}
        onSubmit={() => {
          if (holdWrites || blocked()) return;
          connect.mutate();
        }}
        onDisconnect={authReconnect ? () => {
          if (holdWrites) return;
          setDisconnectSheet(true);
        } : undefined}
        disconnectRef={sumitDisconnectRef}
      />
      <Sheet open={statusOpen} onOpenChange={setStatusSheet} title="SUMIT" returnFocusRef={sumitRowRef}>
        <div className="ui-stack">
          <p>
            מחובר
            {sumitId != null ? <span className="ui-nowrap">{` · מספר חברה `}<bdi dir="ltr">{String(sumitId)}</bdi></span> : null}
            {syncPhrase != null ? <><br /><span className="ui-nowrap">{syncPhrase}</span></> : null}
          </p>
          {refreshHeld && rawError != null && rawError !== "sumit_auth" ? <p>הרענון נכשל</p> : null}
          {!refreshHeld && rawError != null && rawError !== "sumit_auth" && lastError ? <p>{lastError}</p> : null}
        </div>
        <List>
          <ListRow
            variant="button"
            title={sumitRefreshBusy ? "מרענן…" : "רענון עכשיו"}
            hint={refreshHint}
            icon={<RefreshIcon />}
            chevron
            clearHint={retry != null}
            describeHint={refreshHint != null}
            wrapHint
            busy={sumitRefreshBusy}
            disabled={refreshHeld}
            onClick={() => {
              if (holdWrites || refreshHeld || sumitRefreshBusy) return;
              if (blocked()) return;
              refresh.mutate();
            }}
          />
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={sumitDisconnectRef} onClick={() => { if (holdWrites) return; setDisconnectSheet(true); }} />
        </List>
      </Sheet>
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectSheet}
        returnFocusRef={sumitDisconnectRef}
        title="לנתק את SUMIT?"
        consequence="המפתח נמחק. הספרים שכבר ירדו נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={disconnect.isPending}
        onConfirm={() => {
          if (holdWrites || blocked()) return;
          disconnect.mutate();
        }}
      />
      <MercuryConnectSheet
        open={mercuryConnectOpen}
        onOpenChange={setMercuryConnectSheet}
        title={mercuryAuthReconnect && !noCompany ? "צריך לחבר מחדש את Mercury" : "חיבור Mercury"}
        returnFocusRef={mercuryRowRef}
        noCompanyBody={noCompany ? (
          <div className="ui-stack">
            <p>כדי לחבר את Mercury צריך עסק.</p>
            <TextLink to={onboardingFromSettings(search, "mercury")} replace={sheetStack(location.state).includes("mercury-connect")}>פרטי העסק</TextLink>
          </div>
        ) : undefined}
        authReconnect={mercuryAuthReconnect}
        apiKey={mercuryApiKey}
        setApiKey={setMercuryApiKey}
        submitLabel={mercuryAuthReconnect ? "חיבור מחדש" : "חיבור"}
        busy={mercuryConnect.isPending}
        disabled={holdWrites}
        onSubmit={() => {
          if (holdWrites || blocked()) return;
          mercuryConnect.mutate();
        }}
        onDisconnect={mercuryAuthReconnect ? () => {
          if (holdWrites) return;
          setMercuryDisconnectSheet(true);
        } : undefined}
        disconnectRef={mercuryDisconnectRef}
      />
      <Sheet open={mercuryStatusOpen} onOpenChange={setMercuryStatusSheet} title="Mercury" returnFocusRef={mercuryRowRef}>
        <div className="ui-stack">
          <p>
            מחובר
            {mercurySyncPhrase != null ? <><br /><span className="ui-nowrap">{mercurySyncPhrase}</span></> : null}
          </p>
          {mercuryRefreshHeld && mercuryRawError != null && mercuryRawError !== "auth" ? <p>הרענון נכשל</p> : null}
          {!mercuryRefreshHeld && mercuryRawError != null && mercuryRawError !== "auth" && mercuryLastError ? <p>{mercuryLastError}</p> : null}
        </div>
        <List>
          <ListRow
            variant="button"
            title={mercuryRefreshBusy ? "מרענן…" : "רענון עכשיו"}
            hint={mercuryRefreshHint}
            icon={<RefreshIcon />}
            chevron
            clearHint={mercuryRetry != null}
            describeHint={mercuryRefreshHint != null}
            wrapHint
            busy={mercuryRefreshBusy}
            disabled={mercuryRefreshHeld}
            onClick={() => {
              if (holdWrites || mercuryRefreshHeld || mercuryRefreshBusy) return;
              if (blocked()) return;
              mercuryRefresh.mutate();
            }}
          />
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={mercuryDisconnectRef} onClick={() => { if (holdWrites) return; setMercuryDisconnectSheet(true); }} />
        </List>
      </Sheet>
      <ConfirmSheet
        open={mercuryDisconnectOpen}
        onOpenChange={setMercuryDisconnectSheet}
        returnFocusRef={mercuryDisconnectRef}
        title="לנתק את Mercury?"
        consequence="המפתח נמחק. הספרים שכבר ירדו נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={mercuryDisconnect.isPending}
        onConfirm={() => {
          if (holdWrites || blocked()) return;
          mercuryDisconnect.mutate();
        }}
      />
    </div>
    </ViewerScope>
  );
}
