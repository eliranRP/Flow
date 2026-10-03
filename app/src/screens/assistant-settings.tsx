import { useEffect, useRef, useState } from "react";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { popSheetLayers, useSheetHistory } from "../ui/back";
import { useFocusRowAfterRetry } from "../ui/focus-retry";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { AlertIcon, LogoutIcon, SparkIcon } from "../ui/icons";
import { FormError, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";

export type AssistantScope = "read" | "read_write";

export type AssistantSample = {
  state: "empty" | "loading" | "connected" | "expired" | "no-company" | "error";
  scope?: AssistantScope;
  lastUsedAt?: string | null;
  id?: string;
  error?: boolean;
};

type Status = {
  state: "empty" | "connected" | "expired";
  id?: string;
  scope?: string[];
  last_used_at?: string | null;
};

type Minted = { id: string; secret: string; scope: string[] };

const MINT_ERROR = "לא הצלחנו להתחבר. נסו שוב.";
const MINT_REASON = "יוצרים קוד. אי אפשר לשנות עכשיו.";

export function formatAssistantUse(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")}, ${part("hour")}:${part("minute")}`;
}

function scopeChoice(scope: string[] | undefined): AssistantScope {
  return scope?.includes("write") ? "read_write" : "read";
}

function scopeLabel(scope: AssistantScope): string {
  return scope === "read" ? "קריאה בלבד" : "קריאה וכתיבה";
}

function connectedHint(scope: AssistantScope): string {
  return `מחובר · ${scopeLabel(scope)}`;
}

async function readStatus(): Promise<Status> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<Status>("flow-mcp/status", { body: {} });
  if (response.error || response.data == null) throw new Error("status");
  return response.data;
}

async function mintCode(scope: AssistantScope): Promise<Minted> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<Minted>("flow-mcp/mint", { body: { scope } });
  if (response.error || response.data == null) throw new Error("mint");
  return response.data;
}

async function revokeCode(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke("flow-mcp/revoke", { body: { id } });
  if (response.error) throw new Error("revoke");
}

export function AssistantSettings({
  sample,
  noCompany = false,
  blocked,
  initialSecret,
  initialOpen = false,
  showHeading = true,
  announceLoading = true,
}: {
  sample?: AssistantSample;
  noCompany?: boolean;
  blocked?: () => boolean;
  initialSecret?: Minted;
  initialOpen?: boolean;
  /** Settings puts this block under חיבורים, so the עוזר heading would repeat. */
  showHeading?: boolean;
  /** Settings already announced טוען… for the SUMIT row. */
  announceLoading?: boolean;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["mcp-status"],
    enabled: sample == null,
    queryFn: readStatus,
  });
  const [open, setOpen] = useState(initialSecret != null || initialOpen);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [choice, setChoice] = useState<AssistantScope>("read_write");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState(false);
  const [secret, setSecret] = useState<Minted | null>(initialSecret ?? null);
  const [manualCopy, setManualCopy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [intro, setIntro] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [hint, setHint] = useState("לא הצלחנו לטעון");
  const [offlineNote, setOfflineNote] = useState(0);
  const [hintNonce, setHintNonce] = useState(0);
  const [focusRow, setFocusRow] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const connectTitleRef = useRef<HTMLHeadingElement>(null);
  const focusStep = useRef(false);
  const openRef = useRef(initialSecret != null || initialOpen);
  const secretRef = useRef<HTMLElement>(null);
  const closeConnectRef = useRef<(next: boolean) => void>(() => undefined);
  const setDetailsSheet = useSheetHistory("assistant-details", detailsOpen, setDetailsOpen);
  const setDisconnectSheet = useSheetHistory("assistant-disconnect", disconnectOpen, setDisconnectOpen);
  const setConnectSheet = useSheetHistory("assistant-connect", open, (next) => {
    closeConnectRef.current(next);
  });

  const live = status.data;
  const paused = sample == null && !noCompany && status.fetchStatus === "paused" && status.data == null;
  const failed = sample == null && (retrying || paused || (status.isError && status.data == null));
  const view: AssistantSample = sample
    ? (sample.state === "error" || sample.error ? { ...sample, state: "error" } : sample)
    : noCompany
      ? { state: "no-company" }
      : failed
        ? { state: "error" }
        : live
          ? {
            state: live.state,
            scope: scopeChoice(live.scope),
            lastUsedAt: live.last_used_at,
            id: live.id,
          }
          : { state: "loading" };
  const scope = view.scope ?? "read_write";
  const showDisconnect = view.state === "connected" || view.state === "expired";

  function closeSheet(next: boolean) {
    openRef.current = next;
    setOpen(next);
    if (!next) {
      setMintError(false);
      setManualCopy(false);
      setSecret(null);
      setChoice("read_write");
      setIntro(false);
    }
  }
  closeConnectRef.current = closeSheet;

  async function mint() {
    if (minting) return;
    if (blocked?.()) return;
    setMinting(true);
    setMintError(false);
    try {
      const minted = await mintCode(choice);
      if (!openRef.current) {
        await revokeCode(minted.id);
        await client.invalidateQueries({ queryKey: ["mcp-status"] });
        return;
      }
      setSecret(minted);
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
    } catch {
      if (openRef.current) setMintError(true);
    } finally {
      setMinting(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.secret);
      setManualCopy(false);
      toast.show({ tone: "info", message: "הועתק" });
    } catch {
      const node = secretRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setManualCopy(true);
    }
  }

  async function disconnect() {
    if (!view.id || revoking) return;
    if (blocked?.()) {
      setDisconnectSheet(false);
      return;
    }
    setRevoking(true);
    try {
      await revokeCode(view.id);
      setDisconnectOpen(false);
      if (view.state === "connected") setDetailsOpen(false);
      else closeSheet(false);
      popSheetLayers(navigate, 2);
      toast.show({ tone: "info", message: "העוזר נותק." });
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
      setFocusRow(true);
    } catch {
      toast.show({ tone: "bad", message: "לא הצלחנו לנתק. נסו שוב." });
    } finally {
      setRevoking(false);
    }
  }

  useEffect(() => {
    if (hintNonce === 0) return;
    setHint("");
    const id = window.setTimeout(() => {
      setHint("לא הצלחנו לטעון");
      const retry = retryRef.current;
      const active = document.activeElement;
      if (retry == null || active === retry) return;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return;
      retry.focus();
    }, 30);
    return () => { window.clearTimeout(id); };
  }, [hintNonce]);

  useFocusRowAfterRetry(view.state === "error", retryRef, rowRef, view.state !== "error" && view.state !== "loading");

  useEffect(() => {
    if (!focusStep.current || intro || !open || secret != null) return;
    focusStep.current = false;
    connectTitleRef.current?.focus();
  }, [intro, open, secret]);

  useEffect(() => {
    if (!focusRow) return;
    if (rowRef.current == null) return;
    const id = window.setTimeout(() => {
      rowRef.current?.focus();
      setFocusRow(false);
    }, 0);
    return () => { window.clearTimeout(id); };
  }, [focusRow, view.state, status.data]);

  function retryStatus() {
    if (sample != null || retrying) return;
    if (!onlineManager.isOnline()) {
      setOfflineNote((nonce) => nonce + 1);
      return;
    }
    setRetrying(true);
    void status.refetch().then((result) => {
      const stayed = document.activeElement === retryRef.current;
      setRetrying(false);
      if (result.fetchStatus === "paused" || !onlineManager.isOnline()) {
        setOfflineNote((nonce) => nonce + 1);
        return;
      }
      if (result.isError || result.data == null) {
        setHintNonce((nonce) => nonce + 1);
        return;
      }
      if (stayed) setFocusRow(true);
    });
  }

  const spark = <SparkIcon size={24} />;
  const row = view.state === "loading" ? (
    <ListRow variant="static" title="עוזר AI" icon={spark} hint={<Skeleton width="sm" />} skelHint busy />
  ) : view.state === "no-company" ? (
    <ListRow variant="button" title="עוזר AI" hint="אין עסק עדיין" icon={spark} wrapHint describeHint clearHint ariaDisabled className="ui-row-ring" buttonRef={rowRef} />
  ) : view.state === "error" ? (
    <ListRow
      variant="static"
      title="עוזר AI"
      icon={<AlertIcon size={24} />}
      tone="muted"
      describeHint
      hintStatus
      hint={(
        <>
          {hint}
          {offlineNote > 0 ? <span className="sr-only">אין חיבור לאינטרנט</span> : null}
        </>
      )}
      action={(
        <TextLink
          size="label"
          chevron={false}
          label="ניסיון חוזר: עוזר AI"
          busy={retrying}
          buttonRef={retryRef}
          onClick={retryStatus}
        >
          ניסיון חוזר
        </TextLink>
      )}
    />
  ) : view.state === "connected" ? (
    <ListRow
      variant="button"
      title="עוזר AI"
      hint={connectedHint(scope)}
      icon={spark}
      wrapHint
      describeHint
      chevron
      className="ui-row-ring"
      buttonRef={rowRef}
      onClick={() => { setDetailsSheet(true); }}
    />
  ) : view.state === "expired" ? (
    <ListRow
      variant="button"
      title="עוזר AI"
      hint="צריך לחבר מחדש"
      icon={<AlertIcon size={24} />}
      tone="warning"
      wrapHint
      describeHint
      chevron
      className="ui-row-ring"
      buttonRef={rowRef}
      onClick={() => { setIntro(true); setConnectSheet(true); }}
    />
  ) : (
    <ListRow
      variant="button"
      title="עוזר AI"
      hint="לא מחובר"
      icon={spark}
      wrapHint
      describeHint
      chevron
      className="ui-row-ring"
      buttonRef={rowRef}
      onClick={() => { setIntro(false); setConnectSheet(true); }}
    />
  );

  return (
    <>
      {showHeading ? <SectionHead title="עוזר AI" /> : null}
      {view.state === "loading" && announceLoading ? <p className="sr-only" role="status">טוען…</p> : null}
      <List>
        {row}
      </List>
      <Sheet open={open} onOpenChange={setConnectSheet} title={intro && secret == null ? "עוזר AI" : "חיבור עוזר AI"} titleRef={connectTitleRef}>
        {secret ? (
          <div className="ui-stack ui-assistant-step">
            <p>הקוד מוצג פעם אחת. העתיקו אותו לחלון העוזר.</p>
            <p className="ui-field-label" id="assistant-secret-label">קוד החיבור</p>
            <bdi ref={secretRef} className="ui-secret-value" dir="ltr" data-vaul-no-drag="" aria-labelledby="assistant-secret-label">{secret.secret}</bdi>
            <p className="ui-field-label" id="assistant-scope-label">היקף הגישה</p>
            <p aria-labelledby="assistant-scope-label">{scopeLabel(scopeChoice(secret.scope))}</p>
            {manualCopy ? <p className="t-hint" id="assistant-manual-copy" role="status">העתיקו ידנית</p> : null}
            <Button type="button" variant="secondary" aria-describedby={manualCopy ? "assistant-manual-copy" : undefined} onClick={() => { void copySecret(); }}>העתקה</Button>
            <Button type="button" onClick={() => { setConnectSheet(false); }}>סיום</Button>
          </div>
        ) : intro ? (
          <div className="ui-stack">
            <List>
              <ListRow
                variant="static"
                title="פג תוקף"
                hint="הקוד הפסיק לעבוד אחרי 90 יום."
                icon={<AlertIcon size={24} />}
                tone="muted"
                describeHint
                wrapHint
                heading
              />
            </List>
            <Button type="button" onClick={() => { focusStep.current = true; setIntro(false); }}>חיבור מחדש</Button>
          </div>
        ) : (
          <div className="ui-stack ui-assistant-step">
            <div role="radiogroup" aria-label="היקף הגישה">
              <RadioRow
                marker="start"
                label="קריאה וכתיבה"
                selected={choice === "read_write"}
                disabled={minting}
                onSelect={() => { setChoice("read_write"); }}
              />
              <RadioRow
                marker="start"
                label="קריאה בלבד"
                selected={choice === "read"}
                disabled={minting}
                onSelect={() => { setChoice("read"); }}
              />
            </div>
            {minting ? <p className="t-hint" id="assistant-mint-reason" role="status">{MINT_REASON}</p> : null}
            {mintError ? <FormError>{MINT_ERROR}</FormError> : null}
            <Button type="button" busy={minting} aria-describedby={minting ? "assistant-mint-reason" : undefined} onClick={() => { void mint(); }}>יצירת קוד</Button>
          </div>
        )}
        {showDisconnect && view.id && view.state === "expired" ? (
          <List>
            <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} onClick={() => { setDisconnectSheet(true); }} />
          </List>
        ) : null}
      </Sheet>
      <Sheet open={detailsOpen} onOpenChange={setDetailsSheet} title="עוזר AI">
        <div className="ui-stack">
          <p>
            {view.lastUsedAt ? (
              <>
                שימוש אחרון{" "}
                <bdi className="ui-nowrap" dir="ltr">{formatAssistantUse(view.lastUsedAt)}</bdi>
              </>
            ) : "עדיין אין שימוש"}
          </p>
        </div>
        <List>
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} onClick={() => { setDisconnectSheet(true); }} />
        </List>
      </Sheet>
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectSheet}
        title="לנתק את העוזר?"
        consequence="הקוד יפסיק לעבוד. הספרים נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={revoking}
        onConfirm={() => { void disconnect(); }}
      />
    </>
  );
}
