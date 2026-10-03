import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { AlertIcon, InboxIcon, LogoutIcon } from "../ui/icons";
import { FormError, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
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

function connectedHint(scope: AssistantScope, lastUsedAt: string | null | undefined) {
  const label = scopeLabel(scope);
  if (!lastUsedAt) return `מחובר · ${label} · עדיין אין שימוש`;
  return (
    <>
      {`מחובר · ${label} · שימוש אחרון `}
      <bdi dir="ltr">{formatAssistantUse(lastUsedAt)}</bdi>
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
  noCompany = false,
  blocked,
  initialSecret,
  initialOpen = false,
  showHeading = true,
}: {
  sample?: AssistantSample;
  noCompany?: boolean;
  blocked?: () => boolean;
  initialSecret?: Minted;
  initialOpen?: boolean;
  /** Settings puts this block under חיבורים, so the עוזר heading would repeat. */
  showHeading?: boolean;
}) {
  const toast = useToast();
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
  const openRef = useRef(initialSecret != null || initialOpen);
  const secretRef = useRef<HTMLElement>(null);

  const live = status.data;
  const view: AssistantSample = sample
    ? (sample.state === "error" || sample.error ? { ...sample, state: "error" } : sample)
    : noCompany
      ? { state: "no-company" }
      : status.isError && live == null
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
    }
  }

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
      setDisconnectOpen(false);
      return;
    }
    setRevoking(true);
    try {
      await revokeCode(view.id);
      setDisconnectOpen(false);
      toast.show({ tone: "info", message: "העוזר נותק." });
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
    } catch {
      toast.show({ tone: "bad", message: "לא הצלחנו לנתק. נסו שוב." });
    } finally {
      setRevoking(false);
    }
  }

  const row = view.state === "loading" ? (
    <ListRow variant="button" title="עוזר" hint="טוען" icon={<InboxIcon />} wrapHint describeHint busy disabled onClick={() => undefined} />
  ) : view.state === "no-company" ? (
    <ListRow variant="button" title="עוזר AI" hint="אין עסק עדיין" icon={<InboxIcon />} wrapHint describeHint disabled onClick={() => undefined} />
  ) : view.state === "error" ? (
    <ListRow variant="static" title="עוזר" hint="לא הצלחנו לטעון את החיבור." icon={<AlertIcon />} wrapHint describeHint />
  ) : view.state === "connected" ? (
    <ListRow variant="button" title="עוזר" hint={connectedHint(scope, view.lastUsedAt)} icon={<InboxIcon />} wrapHint describeHint chevron onClick={() => { setDetailsOpen(true); }} />
  ) : view.state === "expired" ? (
    <ListRow variant="button" title="חיבור מחדש" hint="התוקף פג" icon={<InboxIcon />} wrapHint describeHint chevron onClick={() => { closeSheet(true); }} />
  ) : (
    <ListRow variant="button" title="חיבור עוזר" hint="לא מחובר" icon={<InboxIcon />} wrapHint describeHint chevron onClick={() => { closeSheet(true); }} />
  );

  return (
    <>
      {showHeading ? <SectionHead title="עוזר" /> : null}
      <List>
        {row}
      </List>
      {view.state === "error" ? (
        <div className="ui-page-pad">
          <Button type="button" variant="secondary" onClick={() => { void status.refetch(); }}>נסו שוב</Button>
        </div>
      ) : null}
      <Sheet open={open} onOpenChange={closeSheet} title="חיבור עוזר">
        {secret ? (
          <div className="ui-stack ui-assistant-step">
            <p>הקוד מוצג פעם אחת. העתיקו אותו לחלון העוזר.</p>
            <p className="ui-field-label" id="assistant-secret-label">קוד החיבור</p>
            <bdi ref={secretRef} className="ui-secret-value" dir="ltr" data-vaul-no-drag="" aria-labelledby="assistant-secret-label">{secret.secret}</bdi>
            <p className="ui-field-label" id="assistant-scope-label">היקף הגישה</p>
            <p aria-labelledby="assistant-scope-label">{scopeLabel(scopeChoice(secret.scope))}</p>
            {manualCopy ? <p className="t-hint" id="assistant-manual-copy" role="status">העתיקו ידנית</p> : null}
            <Button type="button" variant="secondary" aria-describedby={manualCopy ? "assistant-manual-copy" : undefined} onClick={() => { void copySecret(); }}>העתקה</Button>
            <Button type="button" onClick={() => { closeSheet(false); }}>סיום</Button>
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
            <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} onClick={() => { setDisconnectOpen(true); }} />
          </List>
        ) : null}
      </Sheet>
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen} title="עוזר">
        <List>
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} onClick={() => { setDisconnectOpen(true); }} />
        </List>
      </Sheet>
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
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
