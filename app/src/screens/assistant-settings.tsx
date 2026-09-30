import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { FormError, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";

export type AssistantScope = "read" | "read_write";

export type AssistantSample = {
  state: "empty" | "loading" | "connected" | "expired" | "no-company";
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
}: {
  sample?: AssistantSample;
  noCompany?: boolean;
  blocked?: () => boolean;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["mcp-status"],
    enabled: sample == null,
    queryFn: readStatus,
  });
  const [open, setOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [choice, setChoice] = useState<AssistantScope>("read_write");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState(false);
  const [secret, setSecret] = useState<Minted | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const openRef = useRef(false);
  const secretRef = useRef<HTMLInputElement>(null);

  const live = status.data;
  const view: AssistantSample = sample ?? (
    noCompany
      ? { state: "no-company" }
      : live
        ? {
          state: live.state,
          scope: scopeChoice(live.scope),
          lastUsedAt: live.last_used_at,
          id: live.id,
          error: status.isError,
        }
        : status.isPending
          ? { state: "loading" }
          : { state: "empty", error: status.isError }
  );
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
      secretRef.current?.select();
      setManualCopy(true);
    }
  }

  async function disconnect() {
    if (!view.id || revoking) return;
    if (blocked?.()) return;
    setRevoking(true);
    try {
      await revokeCode(view.id);
      setDisconnectOpen(false);
      toast.show({ tone: "info", message: "העוזר נותק." });
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
    } catch {
      toast.show({ tone: "bad", message: "לא הצלחנו לנתק." });
    } finally {
      setRevoking(false);
    }
  }

  const row = view.state === "loading" ? (
    <ListRow variant="button" title="עוזר" hint="טוען" busy disabled onClick={() => undefined} />
  ) : view.state === "no-company" ? (
    <ListRow variant="button" title="עוזר" hint="אין עסק עדיין" disabled onClick={() => undefined} />
  ) : view.state === "connected" ? (
    <ListRow variant="static" title="עוזר" hint={connectedHint(scope, view.lastUsedAt)} />
  ) : view.state === "expired" ? (
    <ListRow variant="button" title="חיבור מחדש" hint="התוקף פג" chevron onClick={() => { closeSheet(true); }} />
  ) : (
    <ListRow variant="button" title="חיבור עוזר" hint="לא מחובר" chevron onClick={() => { closeSheet(true); }} />
  );

  return (
    <>
      <SectionHead title="עוזר" />
      <List>
        {row}
        {showDisconnect && view.id ? (
          <ListRow variant="danger" title="ניתוק" onClick={() => { setDisconnectOpen(true); }} />
        ) : null}
      </List>
      {view.error ? <div className="ui-page-pad"><FormError>לא הצלחנו לטעון את החיבור.</FormError></div> : null}
      <Sheet open={open} onOpenChange={closeSheet} title="חיבור עוזר">
        {secret ? (
          <div className="ui-stack">
            <p>הקוד מוצג פעם אחת. העתיקו אותו לחלון העוזר.</p>
            <label className="ui-field">
              <span className="ui-field-label">קוד החיבור</span>
              <input
                ref={secretRef}
                className="ui-field-control ui-secret-value"
                readOnly
                dir="ltr"
                value={secret.secret}
                aria-label="קוד החיבור"
              />
            </label>
            <p>{scopeLabel(scopeChoice(secret.scope))}</p>
            {manualCopy ? <p>העתיקו ידנית</p> : null}
            <Button type="button" onClick={() => { void copySecret(); }}>העתקה</Button>
          </div>
        ) : (
          <div className="ui-stack">
            <div role="radiogroup" aria-label="היקף הגישה">
              <RadioRow
                marker="start"
                label="קריאה וכתיבה"
                selected={choice === "read_write"}
                disabled={minting}
                disabledReason={minting ? MINT_REASON : undefined}
                onSelect={() => { setChoice("read_write"); }}
              />
              <RadioRow
                marker="start"
                label="קריאה בלבד"
                selected={choice === "read"}
                disabled={minting}
                disabledReason={minting ? MINT_REASON : undefined}
                onSelect={() => { setChoice("read"); }}
              />
            </div>
            {mintError ? <FormError>{MINT_ERROR}</FormError> : null}
            <Button type="button" busy={minting} onClick={() => { void mint(); }}>יצירת קוד</Button>
          </div>
        )}
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
