import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useRefreshingNow } from "../israel-clock";
import { getSupabase } from "../lib/supabase";
import { claudeCodeCommand, flowMcpUrl } from "../mcp-address";
import { israelUsePhrase } from "../sumit-copy";
import { popSheetLayers, useSheetHistory } from "../ui/back";
import { useFocusRowAfterRetry } from "../ui/focus-retry";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { CodeField, type CopyTarget } from "../ui/code-field";
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
const INSTALL_HINT = "אם Claude Code לא מותקן, התקינו אותו קודם.";
const SCOPE_INTRO = "בחרו מה העוזר יכול לעשות.";
const SHOWN_ONCE = "הקוד מוצג פעם אחת.";
const SCOPE_FIELD = "היקף הגישה";
const CHANGE_SCOPE = "כדי לשנות את הגישה מנתקים ומחברים שוב.";
const HELP_TITLE = "איך מחברים ב־Claude";
const HELP_LEAD = "ב־Claude Code הריצו את הפקודה.";
const CLAUDE_WEB = "ב־Claude.ai צריך כותרת מותאמת";
const CLAUDE_HEADER = "Authorization: Bearer <הקוד>.";

function scopeChoice(scope: string[] | undefined): AssistantScope {
  return scope?.includes("write") ? "read_write" : "read";
}

const COMMAND_FIELD = "פקודת חיבור ל־Claude Code";

function scopeLabel(scope: AssistantScope): string {
  return scope === "read" ? "קריאה בלבד" : "קריאה וכתיבה";
}

function scopeShownOnce(scope: AssistantScope): string {
  return `גישה: ${scopeLabel(scope)}. ${SHOWN_ONCE}`;
}

function connectedHint(scope: AssistantScope): ReactNode {
  return (
    <>
      מחובר
      <span className="ui-nowrap">{` · ${scopeLabel(scope)}`}</span>
    </>
  );
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
  sampleSecret,
  noCompany = false,
  blocked,
  initialSecret,
  initialOpen = false,
  showHeading = true,
  announceLoading = true,
  readOnly = false,
  viewerCopy = false,
}: {
  sample?: AssistantSample;
  /** A preview mint shows this secret. Stories and the dev route pass it. */
  sampleSecret?: string;
  noCompany?: boolean;
  blocked?: () => boolean;
  initialSecret?: Minted;
  initialOpen?: boolean;
  /** Settings puts this block under חיבורים, so the עוזר heading would repeat. */
  showHeading?: boolean;
  /** Settings already announced טוען… for the SUMIT row. */
  announceLoading?: boolean;
  /** A viewer sees the row and cannot open connect or details. */
  readOnly?: boolean;
  /** A confirmed viewer sees a neutral expired line. Loading stays on the short hint. */
  viewerCopy?: boolean;
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [now] = useRefreshingNow();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [choice, setChoice] = useState<AssistantScope>("read_write");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState(false);
  const [secret, setSecret] = useState<Minted | null>(initialSecret ?? null);
  const [manualField, setManualField] = useState<CopyTarget | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [intro, setIntro] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [hint, setHint] = useState("לא הצלחנו לטעון");
  const [offlineNote, setOfflineNote] = useState(0);
  const [hintNonce, setHintNonce] = useState(0);
  const [focusRow, setFocusRow] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const helpLinkRef = useRef<HTMLButtonElement>(null);
  const connectTitleRef = useRef<HTMLHeadingElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const focusStep = useRef(false);
  const hadSecret = useRef(initialSecret != null);
  const openRef = useRef(initialSecret != null || initialOpen);
  const secretRef = useRef<HTMLInputElement>(null);
  const closeConnectRef = useRef<(next: boolean) => void>(() => undefined);
  const connectCloseRef = useRef<(() => void) | null>(null);
  const setDetailsSheet = useSheetHistory("assistant-details", detailsOpen, setDetailsOpen);
  const setHelpSheet = useSheetHistory("assistant-help", helpOpen, setHelpOpen);
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
  }
  closeConnectRef.current = closeSheet;

  function finishConnectClose() {
    const reopened = openRef.current;
    setMintError(false);
    setManualField(null);
    setSecret(null);
    setChoice("read_write");
    if (!reopened) setIntro(false);
  }

  async function mint() {
    if (minting) return;
    if (blocked?.()) return;
    if (sample != null) {
      if (sampleSecret == null || sampleSecret === "") return;
      setSecret({
        id: "mcp-sample",
        secret: sampleSecret,
        scope: choice === "read" ? ["read"] : ["read", "write"],
      });
      return;
    }
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

  async function copyValue(field: CopyTarget, value: string, node: HTMLInputElement | null) {
    try {
      await navigator.clipboard.writeText(value);
      setManualField(null);
      toast.show({ tone: "info", message: "הועתק" });
    } catch {
      if (node) {
        node.focus();
        node.select();
      }
      setManualField(field);
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

  useFocusRowAfterRetry(view.state === "error", retryRef, rowRef, view.state !== "error" && view.state !== "loading", hintNonce);

  useEffect(() => onlineManager.subscribe((online) => {
    if (online) setOfflineNote(0);
  }), []);

  useEffect(() => {
    if (!focusStep.current || intro || !open || secret != null) return;
    focusStep.current = false;
    connectTitleRef.current?.focus();
  }, [intro, open, secret]);

  useLayoutEffect(() => {
    const arrived = secret != null && !hadSecret.current;
    hadSecret.current = secret != null;
    if (!arrived || !open) return;
    connectTitleRef.current?.focus();
  }, [open, secret]);

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

  const mcpUrl = flowMcpUrl();
  const urlReady = mcpUrl !== "";
  const command = secret != null && urlReady ? claudeCodeCommand(mcpUrl, secret.secret) : "";
  const useLine = view.lastUsedAt ? israelUsePhrase(view.lastUsedAt, now) : null;
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
    readOnly ? (
      <ListRow variant="static" title="עוזר AI" hint={connectedHint(scope)} icon={spark} wrapHint describeHint />
    ) : (
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
    )
  ) : view.state === "expired" ? (
    readOnly ? (
      <ListRow
        variant="static"
        title="עוזר AI"
        hint={viewerCopy ? "לא מחובר כרגע" : "לא מחובר"}
        icon={spark}
        wrapHint
        describeHint
      />
    ) : (
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
    )
  ) : readOnly ? (
    <ListRow variant="static" title="עוזר AI" hint="לא מחובר" icon={spark} wrapHint describeHint />
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
      <Sheet open={open} onOpenChange={setConnectSheet} onClosed={finishConnectClose} onRequestClose={connectCloseRef} closeOnBackdrop={secret == null} title={secret != null ? "הקוד מוכן" : intro ? "עוזר AI" : "חיבור עוזר AI"} titleRef={connectTitleRef} returnFocusRef={rowRef}>
        {secret ? (
          <div className="ui-stack ui-assistant-step">
            <p className="t-hint">{scopeShownOnce(scopeChoice(secret.scope))}</p>
            <CodeField
              label="כתובת"
              labelId="assistant-url-label"
              value={mcpUrl}
              valueRef={urlRef}
              failed={manualField === "url"}
              copyLabel="העתקה: כתובת"
              onCopy={() => { void copyValue("url", mcpUrl, urlRef.current); }}
            />
            <CodeField
              label="קוד"
              labelId="assistant-secret-label"
              value={secret.secret}
              valueRef={secretRef}
              failed={manualField === "secret"}
              copyLabel="העתקה: קוד"
              onCopy={() => { void copyValue("secret", secret.secret, secretRef.current); }}
            />
            {urlReady ? (
              <TextLink chevron={false} buttonRef={helpLinkRef} onClick={() => { setHelpSheet(true); }}>{HELP_TITLE}</TextLink>
            ) : null}
            <Button type="button" onClick={() => { connectCloseRef.current?.(); }}>סיום</Button>
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
            <p>{SCOPE_INTRO}</p>
            <div role="radiogroup" aria-label={SCOPE_FIELD}>
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
            <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={disconnectRef} onClick={() => { setDisconnectSheet(true); }} />
          </List>
        ) : null}
      </Sheet>
      <Sheet open={helpOpen} onOpenChange={setHelpSheet} title={HELP_TITLE} returnFocusRef={helpLinkRef}>
        <div className="ui-stack">
          <p>{HELP_LEAD}</p>
          {command !== "" ? (
            <CodeField
              fieldLabel={COMMAND_FIELD}
              value={command}
              valueRef={commandRef}
              failed={manualField === "command"}
              copyLabel="העתקה: פקודה"
              onCopy={() => { void copyValue("command", command, commandRef.current); }}
            />
          ) : null}
          <p className="t-hint">{INSTALL_HINT}</p>
          <p className="t-hint">{CLAUDE_WEB} <bdi dir="ltr" tabIndex={-1} className="ui-nowrap ui-assistant-header" data-vaul-no-drag="">{CLAUDE_HEADER}</bdi></p>
        </div>
      </Sheet>
      <Sheet open={detailsOpen} onOpenChange={setDetailsSheet} title="עוזר AI" returnFocusRef={rowRef}>
        <div className="ui-stack">
          <div className="ui-assistant-status">
            <p>{connectedHint(scope)}</p>
            <p className={useLine != null ? "ui-nowrap" : undefined}>{useLine ?? "עדיין אין שימוש"}</p>
          </div>
          <p className="t-hint">{CHANGE_SCOPE}</p>
        </div>
        <List>
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={disconnectRef} onClick={() => { setDisconnectSheet(true); }} />
        </List>
      </Sheet>
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectSheet}
        returnFocusRef={disconnectRef}
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
