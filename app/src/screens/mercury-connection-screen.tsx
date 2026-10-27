import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useHoldOwnerSettings, ViewerNote, ViewerScope } from "../use-is-viewer";
import { useDashboardQuery, useMercuryStatusQuery } from "../use-books";
import { getSupabase } from "../lib/supabase";
import { invokeEdge } from "../edge";
import { LEDGER_KEYS } from "../ledger-keys";
import { hebrewMercuryError, mercuryRefreshDone } from "../mercury-copy";
import { accountName, connectionName } from "../mercury-connections";
import { MERCURY_NONE, type MercuryAccount, type MercuryConnection, type MercuryState } from "../mercury-state";
import { israelSyncPhrase } from "../sumit-copy";
import { useRefreshingNow } from "../israel-clock";
import { assertNoError, useWrite } from "../use-write";
import { useMercuryConnect } from "../use-mercury-connect";
import { useMercuryAccounts, type MercuryAccountsSave } from "../use-mercury-accounts";
import { REFRESH_DONE } from "../use-sumit-refresh";
import { useSyncSettled } from "../use-sync-settled";
import { screenPhase } from "../query-phase";
import { Button } from "../ui/button";
import { ConnectionHead, ConnectionNote, ConnectionPage, StepList } from "../ui/connection-page";
import { BankIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { TextField } from "../ui/text-field";
import { useBlockedPreview } from "./screen-shared";
import { connectionToast, holdForUndo, UNDONE, type UndoHold } from "../connection-toast";
import { useToast } from "../ui/toast";
import { MercuryAccountsStep, type MercuryAccountsPick } from "./mercury-accounts-step";
import { MercuryConnectedView } from "./mercury-connected-view";

const TITLE = "Mercury";
const SUBTITLE = "תנועות הבנק נכנסות ל־Flow כל 15 דקות";
const STEPS = [
  "נכנסים ל־Mercury במחשב, כבעלים או מנהל.",
  "Settings ← API Tokens ← יצירת token חדש מסוג Read Only.",
  "מעתיקים את ה־token. Mercury מציג אותו פעם אחת.",
] as const;
const FOOT_NOTE = "מפתח Read Only: Flow רואה תנועות ויתרות, ולא יכול להעביר כסף או לשנות שום דבר ב־Mercury.";
const PROBLEM = "Mercury הפסיק לקבל את המפתח, כנראה נמחק או פג. מה שכבר נכנס נשמר. הדביקו מפתח חדש וכל התנועות שחסרות ייכנסו.";
const LIST_NOTE = "לכל חיבור מפתח משלו, חשבונות משלו ותאריך משלו. כל החשבונות המסונכרנים נכנסים לאותו עסק ב־Flow; העברה בין חשבונות מסונכרנים, גם בחיבורים שונים, לא נספרת.";
const MIN_KEY = 8;
const SHORT = "צריך את המפתח המלא, לפחות 8 תווים";
const REJECTED = "Mercury לא קיבל את המפתח. בדקו שהוא Read Only ושהעתקתם אותו כולו.";
const GONE = "Mercury נותק. מה שכבר נכנס נשמר";

/** The Mercury page's sample (stories, the dev routes): its connections, or a loading or failed read. */
export type MercurySample = {
  state?: "loading" | "error";
  connections: MercuryConnection[];
  /** The last sync, already in words ("לפני 5 דקות"). */
  lastSync?: string;
  /** What has come in so far, already in words ("1,284 תנועות"). */
  imported?: string;
  /** The edit list opens with these accounts checked (the board's frame). */
  editSelection?: string[];
};

/**
 * `/settings/connections/mercury` (FLOW-938, decision 0203). One page for every Mercury connection:
 * the key, then step 3 (which accounts, from which date), then the connected page; with two or more
 * connections it opens on their list. `?slot=N` opens a connection, `?add=1` adds one, `?edit=1` opens
 * the synced accounts list. A sample draws the same page and keeps its changes in memory.
 */
export function MercuryConnectionRoute({ sample }: { sample?: MercurySample } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const blocked = useBlockedPreview();
  const holdOwner = useHoldOwnerSettings();
  const dashboard = useDashboardQuery(sample == null);
  const live = sample == null && preview === "off";
  const companyId = dashboard.data?.company_id;
  const status = useMercuryStatusQuery(sample == null && (preview !== "off" || companyId != null));
  const [now] = useRefreshingNow();
  const backTo = `/settings/connections${search}`;

  // A sample keeps its changes here, so its frames can be clicked through.
  const [local, setLocal] = useState<MercuryConnection[]>(() => sample?.connections ?? []);
  const state = live ? (status.data ?? MERCURY_NONE) : MERCURY_NONE;
  const shownConnections = sample != null ? local : state.connections;

  const slotParam = Number(params.get("slot") ?? Number.NaN);
  const adding = params.get("add") === "1";
  const editing = params.get("edit") === "1";
  const go = (next: { slot?: number; add?: boolean; edit?: boolean }, replace = false) => {
    const kept = new URLSearchParams(params);
    for (const key of ["slot", "add", "edit", "sheet"]) kept.delete(key);
    if (next.slot != null) kept.set("slot", String(next.slot));
    if (next.add === true) kept.set("add", "1");
    if (next.edit === true) kept.set("edit", "1");
    setParams(kept, { replace });
  };

  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  // "short": a tap with the key missing; "rejected": Mercury refused it (decision 0223).
  const [keyError, setKeyError] = useState<"short" | "rejected" | null>(null);
  const [replacing, setReplacing] = useState(false);
  const toast = useToast();

  const disconnect = useWrite<{ slot: number; hold: UndoHold }>({
    failure: "לא הצלחנו לנתק.",
    keys: ["mercury"],
    place: "top",
    silent: (error) => error.message === UNDONE,
    // Decision 0223: the connection leaves the page at once; its key is deleted only once ביטול runs out.
    optimistic: ({ slot }) => [{ key: ["mercury", preview], update: (old) => (old == null ? old : withoutSlot(old as MercuryState, slot)) }],
    run: async ({ slot, hold }) => {
      await hold.done;
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("disconnect_connector", { p_provider: "mercury", p_slot: slot }));
    },
  });
  // A disconnect waiting on its ביטול already shows the page without it, even if a read lands meanwhile.
  const leaving = disconnect.isPending ? disconnect.variables?.slot : undefined;
  const connections = shownConnections.filter((connection) => connection.slot !== leaving);

  const multi = connections.length > 1;
  // A slot that is gone (disconnected elsewhere) falls back to the list, or to the one connection.
  const target = (Number.isInteger(slotParam) ? connections.find((connection) => connection.slot === slotParam) : undefined)
    ?? (connections.length === 1 ? connections[0] : undefined);
  const keySlot = adding ? undefined : target?.slot;

  const connect = useMercuryConnect({
    apiKey: key,
    setApiKey: setKey,
    slot: keySlot,
    onSuccess: (connected) => {
      setReplacing(false);
      go({ slot: connected.slot }, true);
    },
    onRejected: () => { setKeyError("rejected"); },
  });
  const accounts = useMercuryAccounts({
    onSuccess: (save) => {
      if (save.kind === "connect" && connections.length > 1) go({}, true);
      else if (save.kind === "edit") go({ slot: multi ? save.slot : undefined }, true);
    },
  });
  const refreshResult = useRef<unknown>(null);
  const refresh = useWrite({
    failure: (error) => hebrewMercuryError(error.message) ?? "הרענון נכשל.",
    place: "top",
    silent: (error) => error.message === "sync_held",
    success: () => mercuryRefreshDone(refreshResult.current),
    keys: LEDGER_KEYS,
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

  // A refresh started before a reload or in another tab: when its claim clears, reload the books and say so.
  useSyncSettled({
    syncing: live && state.syncing,
    pending: refresh.isPending,
    lastSyncAt: live ? state.last_sync_at : undefined,
    lastError: live ? state.last_error : undefined,
    success: REFRESH_DONE,
  });

  if (sample?.state === "loading" || (live && (dashboard.isLoading || status.isLoading))) {
    return <ScreenState title={TITLE} kicker="חיבורים" backTo={backTo} phase={{ kind: "loading" }} onRetry={() => { void status.refetch(); }} loading={<List><ListRow variant="skeleton" /><ListRow variant="skeleton" /></List>} />;
  }
  if (sample?.state === "error" || (live && status.isError && status.data == null)) {
    return <ScreenState title={TITLE} kicker="חיבורים" backTo={backTo} phase={sample ? { kind: "error", offline: false } : screenPhase(preview, status)} onRetry={() => { void status.refetch(); }} />;
  }
  if (live && dashboard.isError && dashboard.data == null) {
    return <ScreenState title={TITLE} kicker="חיבורים" backTo={backTo} phase={screenPhase(preview, dashboard)} onRetry={() => { void dashboard.refetch(); }} />;
  }
  if (live && companyId == null && dashboard.isSuccess) {
    return (
      <ViewerScope>
        <ConnectionPage title={TITLE} subtitle={SUBTITLE} backTo={backTo}>
          <div className="ui-stack">
            <p>כדי לחבר את {TITLE} צריך עסק.</p>
            <Button variant="link" to="/setup/1" chevron>פרטי העסק</Button>
          </div>
        </ConnectionPage>
      </ViewerScope>
    );
  }

  const viewerOnly = holdOwner;
  const keyOk = key.trim().length >= MIN_KEY;
  const busyKey = connect.isPending;

  /** A sample keeps a save in memory; live writes go to the server. */
  const saveAccounts = (save: MercuryAccountsSave) => {
    if (blocked() || viewerOnly) return;
    if (sample == null) {
      accounts.mutate(save);
      return;
    }
    setLocal((current) => current.map((connection) => connection.slot !== save.slot ? connection : {
      ...connection,
      chosen: true,
      synced: [...save.accounts],
      skipped: connection.accounts.map((account) => account.id).filter((id) => !save.accounts.includes(id)),
    }));
    if (save.kind === "connect" && local.length > 1) go({}, true);
    if (save.kind === "edit") go({ slot: multi ? save.slot : undefined }, true);
  };
  const pick = (connection: MercuryConnection, kind: "connect" | "edit") => (chosen: MercuryAccountsPick) => {
    saveAccounts({ slot: connection.slot, accounts: chosen.accounts, from: chosen.from, kind });
  };
  const answer = (connection: MercuryConnection) => (account: MercuryAccount, sync: boolean) => {
    const name = accountName(account);
    saveAccounts({
      slot: connection.slot,
      accounts: sync ? [...connection.synced, account.id] : connection.synced,
      // A yes reads the new account from the connection's own start: a new account has little history.
      from: sync ? (connection.importFrom ?? "start") : null,
      kind: "answer",
      answer: sync ? `${name} מסונכרן` : `${name} לא יסונכרן`,
    });
  };
  const sendKey = () => {
    if (busyKey || blocked() || viewerOnly) return;
    if (!keyOk) {
      setKeyError("short");
      return;
    }
    setKeyError(null);
    connect.mutate();
  };
  const disconnectNow = (connection: MercuryConnection) => {
    if (holdOwner || blocked()) return;
    const hold = holdForUndo();
    if (sample != null) {
      const before = local;
      setLocal((current) => current.filter((item) => item.slot !== connection.slot));
      void hold.done.then(() => undefined, () => { setLocal(before); });
    } else {
      disconnect.mutate({ slot: connection.slot, hold });
    }
    go({}, true);
    toast.show(connectionToast({ message: GONE, action: "ביטול", onAction: () => { hold.cancel(); } }));
  };

  const keyForm = (reconnect: boolean, onCancel?: () => void) => (
    <>
      <ConnectionHead>1 · יוצרים מפתח ב־Mercury</ConnectionHead>
      <div className="ui-settings-card ui-connection-steps">
        <StepList steps={STEPS} />
      </div>
      <ConnectionHead>2 · מדביקים</ConnectionHead>
      <div className="ui-secret-wrap">
        <TextField
          label="מפתח API"
          type={showKey ? "text" : "password"}
          dir="ltr"
          value={key}
          placeholder="מדביקים כאן"
          autoComplete="off"
          reserveMessage
          error={keyError === "rejected" ? REJECTED : keyError === "short" && !keyOk ? SHORT : undefined}
          readOnly={busyKey}
          onChange={(event) => { setKeyError(null); setKey(event.target.value); }}
        />
        <button type="button" className="ui-secret-toggle m-press" onClick={() => { setShowKey((value) => !value); }}>
          {showKey ? "הסתרה" : "הצגה"}
        </button>
      </div>
      <Button busy={busyKey} onClick={sendKey}>
        {busyKey ? "מתחבר…" : reconnect || keyError === "rejected" ? "חיבור מחדש" : "חיבור"}
      </Button>
      <ConnectionNote>{FOOT_NOTE}</ConnectionNote>
      {onCancel ? <Button variant="link" onClick={() => { setKey(""); setShowKey(false); onCancel(); }}>ביטול</Button> : null}
    </>
  );

  let body: ReactNode;
  let problem: string | undefined;
  if (adding || connections.length === 0) {
    body = viewerOnly
      ? <ConnectionNote>רק הבעלים יכולים לחבר.</ConnectionNote>
      : keyForm(false, adding && connections.length > 0 ? () => { go(multi ? {} : { slot: connections[0]?.slot }, true); } : undefined);
  } else if (target == null) {
    body = (
      <>
        <ConnectionHead>{`חיבורים ל־Mercury · ${String(connections.length)}`}</ConnectionHead>
        <List>
          {connections.map((connection) => (
            <ListRow
              key={connection.slot}
              variant="item"
              href={`${pathname}?${withSlot(params, connection.slot)}`}
              icon={<BankIcon size={24} />}
              title={connectionName(connection)}
              ltrTitle
              hint={connectionSub(connection, now)}
              tone={connection.keyWorks ? undefined : "warning"}
              chevron
            />
          ))}
        </List>
        {viewerOnly ? null : <Button variant="secondary" onClick={() => { go({ add: true }); }}>+ חיבור Mercury נוסף</Button>}
        <ConnectionNote>{LIST_NOTE}</ConnectionNote>
      </>
    );
  } else if (!target.keyWorks) {
    problem = viewerOnly ? undefined : PROBLEM;
    body = viewerOnly ? <ConnectionNote>רק בעל העסק יכול לשנות חיבורים.</ConnectionNote> : keyForm(true, multi ? () => { go({}, true); } : undefined);
  } else if (replacing && !viewerOnly) {
    body = keyForm(true, () => { setReplacing(false); });
  } else if (!target.chosen && !viewerOnly) {
    body = <MercuryAccountsStep key={`connect-${String(target.slot)}`} connection={target} editing={false} busy={accounts.isPending} onSave={pick(target, "connect")} onBack={() => { setReplacing(true); }} initialFrom={params.get("sheet") === "from" ? "date" : "start"} initialFromOpen={params.get("sheet") === "from"} />;
  } else if (editing && !viewerOnly) {
    body = <MercuryAccountsStep key={`edit-${String(target.slot)}`} connection={target} editing busy={accounts.isPending} onSave={pick(target, "edit")} onBack={() => { go({ slot: multi ? target.slot : undefined }, true); }} initialSelected={sample?.editSelection} />;
  } else {
    body = (
      <>
        <MercuryConnectedView
          connection={target}
          multi={multi}
          readOnly={viewerOnly}
          syncLine={sample?.lastSync ?? israelSyncPhrase(target.lastSyncAt, now)}
          imported={sample?.imported}
          refreshing={refresh.isPending || target.syncing}
          answering={accounts.isPending}
          onAllConnections={() => { go({}); }}
          onEditAccounts={() => { go({ slot: multi ? target.slot : undefined, edit: true }); }}
          onAnswer={answer(target)}
          onRefresh={() => { if (!blocked() && sample == null) refresh.mutate(); }}
          onReplaceKey={() => { setReplacing(true); }}
          onAdd={() => { go({ add: true }); }}
          onDisconnect={() => { disconnectNow(target); }}
        />
        {viewerOnly ? <ConnectionNote>רק בעל העסק יכול לשנות חיבורים.</ConnectionNote> : null}
      </>
    );
  }

  return (
    <ViewerScope>
      <ConnectionPage title={TITLE} subtitle={SUBTITLE} backTo={backTo} problem={problem}>
        <ViewerNote />
        {body}
      </ConnectionPage>
    </ViewerScope>
  );
}

/** The status without one connection: what the page shows while that connection's disconnect waits on its ביטול. */
function withoutSlot(state: MercuryState, slot: number): MercuryState {
  const connections = state.connections.filter((connection) => connection.slot !== slot);
  return { ...state, connections, connected: connections.some((connection) => connection.chosen && connection.keyWorks), syncing: false };
}

/** The page's query with `slot` set, keeping its other flags (the preview, a dev fixture's state). */
function withSlot(current: URLSearchParams, slot: number): string {
  const next = new URLSearchParams(current);
  for (const key of ["add", "edit", "sheet"]) next.delete(key);
  next.set("slot", String(slot));
  return next.toString();
}

/** A connection's line in the list: "3 מתוך 5 חשבונות · עודכן ב-06:05", or what it waits for. */
function connectionSub(connection: MercuryConnection, now: number): string {
  if (!connection.keyWorks) return "צריך חיבור";
  if (!connection.chosen) return "בחרו חשבונות לסנכרון";
  const synced = connection.accounts.filter((account) => connection.synced.includes(account.id)).length;
  const when = israelSyncPhrase(connection.lastSyncAt, now);
  return [`${String(synced)} מתוך ${String(connection.accounts.length)} חשבונות`, when].filter(Boolean).join(" · ");
}
