import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRefreshingNow } from "../israel-clock";
import { getSupabase } from "../lib/supabase";
import { claudeCodeCommand, flowMcpUrl } from "../mcp-address";
import { israelUsePhrase } from "../sumit-copy";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useDashboardQuery } from "../use-books";
import { useHoldOwnerSettings, ViewerNote, ViewerScope } from "../use-is-viewer";
import { useToast } from "../ui/toast";
import { Button } from "../ui/button";
import { CodeField, type CopyTarget } from "../ui/code-field";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { ConnectionFacts, ConnectionHead, ConnectionNote, ConnectionPage, StepList } from "../ui/connection-page";
import { FormError } from "../ui/layout";
import { RadioRow } from "../ui/radio-row";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { TextLink } from "../ui/text-link";
import { useBlockedPreview } from "./screen-shared";
import { screenPhase } from "../query-phase";

export type AssistantScope = "read" | "read_write";
export type AssistantClient = "claude-code" | "claude-ai" | "chatgpt" | "other";

export type AssistantSample = {
  state: "empty" | "loading" | "connected" | "expired" | "no-company" | "error";
  scope?: AssistantScope;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  id?: string;
  error?: boolean;
};

type Status = {
  state: "empty" | "connected" | "expired";
  id?: string;
  scope?: string[];
  last_used_at?: string | null;
  expires_at?: string | null;
};

type Minted = { id: string; secret: string; scope: string[] };

/** The assistant choices, in the board's order. */
const CLIENTS: Array<{ value: AssistantClient; label: string }> = [
  { value: "claude-code", label: "Claude Code" },
  { value: "claude-ai", label: "Claude.ai" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "other", label: "אחר" },
];

/** The three questions the board shows under "מה אפשר לשאול" (the project and supplier are invented). */
export const EXAMPLE_QUESTIONS = [
  '"כמה הוצאתי על Elm Court החודש?"',
  '"מה מהקבועים עוד לא הגיע?"',
  '"שייך את כל Harlow מהשבוע ל־Elm Court"',
];

export const MINT_ERROR = "לא הצלחנו להתחבר. נסו שוב.";
const MINT_REASON = "יוצרים קוד. אי אפשר לשנות עכשיו.";
const CONNECTED_TOAST = "העוזר מחובר";
const DISCONNECTED_TOAST = "העוזר נותק. הקוד הפסיק לעבוד";
const EXPIRED_BOX = "הקוד פג אחרי 90 יום. צרו קוד חדש כדי להמשיך.";
const CODE_NOTE = "הקוד מוצג פעם אחת ותקף ל־90 יום. אל תשתפו אותו.";
const SCOPE_FIELD = "מה העוזר יכול לעשות";
const CONNECTED_NOTE = "כל פעולה של העוזר נרשמת ואפשר לבטל אותה כמו כל שינוי אחר.";
/** How often the page asks the server while the code is on screen, so the first call turns it to connected. */
export const POLL_MS = 5000;

function scopeChoice(scope: string[] | undefined): AssistantScope {
  return scope?.includes("write") ? "read_write" : "read";
}

function scopeLabel(scope: AssistantScope): string {
  return scope === "read" ? "קריאה בלבד" : "קריאה וכתיבה";
}

async function readStatus(): Promise<Status> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<Status>("flow-mcp/status", { body: {} });
  if (response.error || response.data == null) throw new Error("status");
  return response.data;
}

/** The assistant's status, shared by the Connections page and the Settings חיבורים row (FLOW-501). */
export function useAssistantStatusQuery(enabled: boolean, poll = false) {
  return useQuery({
    queryKey: ["mcp-status"],
    enabled,
    queryFn: readStatus,
    refetchInterval: poll ? POLL_MS : false,
  });
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

/** The steps and fields for the chosen assistant (board: SettingsMcpCode). */
function clientSteps(client: AssistantClient): { steps: readonly string[]; fields: "command" | "url-header" } {
  if (client === "claude-code") {
    return { steps: ["פתחו טרמינל במחשב.", "הדביקו את הפקודה והריצו. היא מוסיפה את Flow כשרת MCP.", "פתחו את Claude Code מחדש."], fields: "command" };
  }
  if (client === "claude-ai") {
    return { steps: ["ב־Claude.ai: הגדרות ← Connectors ← הוספת connector מותאם.", "הדביקו את כתובת השרת.", "בכותרת מותאמת הוסיפו Authorization עם הקוד."], fields: "url-header" };
  }
  if (client === "chatgpt") {
    return { steps: ["ב־ChatGPT: הגדרות ← Connectors ← מצב מפתחים.", "הוסיפו שרת MCP והדביקו את הכתובת.", "באימות בחרו כותרת והדביקו את הקוד."], fields: "url-header" };
  }
  return { steps: ["בעוזר שלכם, הוסיפו שרת MCP מסוג HTTP.", "הדביקו את הכתובת ואת הכותרת."], fields: "url-header" };
}

/** The month the first question asks about, in Hebrew ("אוקטובר"). */
export function currentMonthName(now = new Date()): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long" }).format(now);
}

/** A date in the board's dd/MM/yyyy, read in Israel time. */
function expiryDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

/**
 * The AI connection page (FLOW-512, §1.6; was the "עוזר AI" sheet). Four faces: the setup
 * (access, assistant, mint), the code once (steps and fields), connected (last use, expiry,
 * new code, ניתוק), and expired. The code is shown once: leaving the page shows setup again.
 */
export function AiConnectionPage({
  sample,
  sampleSecret,
  initialSecret,
  initialClient = "claude-code",
  blocked,
  readOnly,
}: {
  sample?: AssistantSample;
  /** A preview mint shows this secret. Stories and the dev route pass it. */
  sampleSecret?: string;
  initialSecret?: Minted;
  initialClient?: AssistantClient;
  blocked?: () => boolean;
  /** Read-only for the viewer and editor: the page shows the state, not the actions. */
  readOnly?: boolean;
}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const client = useQueryClient();
  const toast = useToast();
  const localBlocked = useBlockedPreview();
  const guard = blocked ?? localBlocked;
  const holdOwner = useHoldOwnerSettings();
  const dashboard = useDashboardQuery(sample == null);
  const liveNoCompany = sample == null && preview === "off" && dashboard.isSuccess && dashboard.data.company_id == null;
  const readonly = readOnly ?? holdOwner;
  const disconnectFocus = useRef<HTMLElement | null>(null);
  const [now] = useRefreshingNow();
  const [scope, setScope] = useState<AssistantScope>("read_write");
  const [assistant, setAssistant] = useState<AssistantClient>(initialClient);
  const [secret, setSecret] = useState<Minted | null>(initialSecret ?? null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState(false);
  const [manualField, setManualField] = useState<CopyTarget | null>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const status = useAssistantStatusQuery(sample == null && !liveNoCompany && preview === "off", secret != null);
  const live = status.data;
  const mcpUrl = flowMcpUrl();
  const command = secret != null && mcpUrl !== "" ? claudeCodeCommand(mcpUrl, secret.secret) : "";

  // The first call (a last use on the new code) turns the code screen to connected, with a toast.
  // A status that is already connected is not that: the new code is the newest row, so only its use counts.
  const firstUse = secret != null && live != null && live.id === secret.id && live.last_used_at != null;
  useEffect(() => {
    if (!firstUse) return;
    setSecret(null);
    setSetupOpen(false);
    toast.show({ message: CONNECTED_TOAST, tone: "info" });
  }, [firstUse, toast]);

  const view: AssistantSample = sample
    ? sample
    : liveNoCompany
      ? { state: "no-company" }
      : status.isError && status.data == null
        ? { state: "error" }
        : live
          ? { state: live.state, scope: scopeChoice(live.scope), lastUsedAt: live.last_used_at, expiresAt: live.expires_at, id: live.id }
          : { state: "loading" };

  if (view.state === "loading" && sample == null) {
    return <ScreenState title="חיבור ל־AI" kicker="חיבורים" backTo={`/settings/connections${search}`} phase={{ kind: "loading" }} onRetry={() => { void status.refetch(); }} />;
  }
  if (view.state === "error") {
    return (
      <ScreenState
        title="חיבור ל־AI"
        kicker="חיבורים"
        backTo={`/settings/connections${search}`}
        phase={{ kind: "error", offline: !navigator.onLine }}
        onRetry={() => { void status.refetch(); }}
      />
    );
  }
  if (sample == null && dashboard.isLoading) {
    return <ScreenState title="חיבור ל־AI" kicker="חיבורים" backTo={`/settings/connections${search}`} phase={screenPhase(preview, dashboard)} onRetry={() => { void dashboard.refetch(); }} />;
  }

  async function mint() {
    if (minting || guard()) return;
    if (sample != null) {
      if (sampleSecret == null || sampleSecret === "") return;
      setSecret({ id: "mcp-sample", secret: sampleSecret, scope: scope === "read" ? ["read"] : ["read", "write"] });
      return;
    }
    setMinting(true);
    setMintError(false);
    try {
      const minted = await mintCode(scope);
      setSecret(minted);
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
    } catch {
      setMintError(true);
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
    if (view.id == null || revoking) return;
    if (guard()) {
      setDisconnectOpen(false);
      return;
    }
    setRevoking(true);
    try {
      await revokeCode(view.id);
      setDisconnectOpen(false);
      setSecret(null);
      setSetupOpen(false);
      toast.show({ tone: "info", message: DISCONNECTED_TOAST });
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
    } catch {
      toast.show({ tone: "bad", message: "לא הצלחנו לנתק. נסו שוב." });
    } finally {
      setRevoking(false);
    }
  }

  const scopeHint = (choice: AssistantScope) => (choice === "read" ? "העוזר רואה ועונה. לא משנה כלום." : "יכול גם לשייך, לאשר וליצור. כל שינוי נרשם וניתן לביטול.");
  const useLine = view.lastUsedAt ? israelUsePhrase(view.lastUsedAt, now) : null;
  const expires = expiryDate(view.expiresAt);
  const connected = view.state === "connected" && secret == null && !setupOpen;
  // An expired code shows its box and one button; the setup steps follow the button.
  const expiredWaiting = view.state === "expired" && secret == null && !setupOpen;
  const showSetup = !connected && !expiredWaiting;
  // The code on screen stays tied to the scope it was minted for; picking the other scope drops it (board: SettingsMcpCode).
  const shownScope = secret != null ? scopeChoice(secret.scope) : scope;
  function pickScope(next: AssistantScope) {
    if (next !== shownScope) setSecret(null);
    setScope(next);
  }
  const month = currentMonthName(new Date(now));
  const headerSubtitle = "MCP · העוזר שלכם עובד עם הספרים של Flow";
  const backTo = `/settings/connections${search}`;

  if (view.state === "no-company") {
    return (
      <ViewerScope>
      <ConnectionPage title="חיבור ל־AI" subtitle={headerSubtitle} backTo={backTo}>
        <div className="ui-stack">
          <p>כדי לחבר עוזר צריך עסק.</p>
          <TextLink to={`/onboarding?return=${encodeURIComponent(backTo)}`}>פרטי העסק</TextLink>
        </div>
      </ConnectionPage>
      </ViewerScope>
    );
  }
  if (readonly && !connected) {
    return (
      <ViewerScope>
      <ConnectionPage title="חיבור ל־AI" subtitle={headerSubtitle} backTo={backTo}>
        <ViewerNote />
        <ConnectionNote>רק בעל העסק יכול לחבר את העוזר.</ConnectionNote>
      </ConnectionPage>
      </ViewerScope>
    );
  }

  return (
    <ViewerScope>
    <ConnectionPage
      title="חיבור ל־AI"
      subtitle={headerSubtitle}
      backTo={backTo}
      problem={expiredWaiting ? EXPIRED_BOX : undefined}
    >
      <ViewerNote />
      {connected ? (
        <>
          <div className="ui-settings-card ui-connection-card ui-ai-connected-card">
            <p className="ui-ai-status">
              <span className="ui-ai-status-name">מחובר</span>
              <span className="ui-ai-status-scope">{scopeLabel(view.scope ?? "read_write")}</span>
            </p>
            <ConnectionFacts
              rows={[
                { label: "שימוש אחרון", value: useLine ?? "עדיין אין שימוש" },
                ...(expires != null ? [{ label: "הקוד בתוקף עד", value: expires, ltr: true }] : []),
              ]}
            />
            <p className="ui-ai-code-note">{CONNECTED_NOTE}</p>
          </div>
          {readonly ? null : (
            <div className="ui-connection-actions">
              <Button variant="secondary" onClick={() => { setSetupOpen(true); }}>יצירת קוד חדש</Button>
              <Button variant="danger-link" onClick={(event) => { disconnectFocus.current = event.currentTarget; setDisconnectOpen(true); }}>ניתוק</Button>
            </div>
          )}
        </>
      ) : null}
      {expiredWaiting && !readonly ? (
        <Button onClick={() => { setSetupOpen(true); }}>יצירת קוד חדש</Button>
      ) : null}
      {showSetup && !readonly ? (
        <>
          <div className="ui-settings-card ui-ai-questions">
            <p className="ui-ai-questions-head">מה אפשר לשאול</p>
            {EXAMPLE_QUESTIONS.map((question) => <p key={question} className="ui-ai-question">{question}</p>)}
          </div>
              <ConnectionHead>1 · מה העוזר יכול לעשות</ConnectionHead>
              <div role="radiogroup" aria-label={SCOPE_FIELD} className="ui-ai-scope">
                <RadioRow
                  label="קריאה בלבד"
                  description={scopeHint("read")}
                  selected={shownScope === "read"}
                  disabled={minting}
                  onSelect={() => { pickScope("read"); }}
                />
                <RadioRow
                  label="קריאה וכתיבה"
                  description={scopeHint("read_write")}
                  selected={shownScope === "read_write"}
                  disabled={minting}
                  onSelect={() => { pickScope("read_write"); }}
                />
              </div>
              <ConnectionHead>2 · באיזה עוזר</ConnectionHead>
              <SegmentedControl<AssistantClient>
                label="באיזה עוזר"
                showLabel={false}
                value={assistant}
                disabled={minting}
                options={CLIENTS}
                onChange={(next) => { setAssistant(next); }}
              />
              <ConnectionHead>3 · מחברים</ConnectionHead>
              {secret == null ? (
                <>
                  <ConnectionNote>Flow ייצור קוד גישה אישי. הוא מוצג פעם אחת, כמו סיסמה.</ConnectionNote>
                  {minting ? <p className="t-hint" role="status">{MINT_REASON}</p> : null}
                  {mintError ? <FormError>{MINT_ERROR}</FormError> : null}
                  <Button busy={minting} onClick={() => { void mint(); }}>יצירת קוד</Button>
                </>
              ) : (
                <>
                  <div className="ui-settings-card ui-connection-steps">
                    <StepList steps={clientSteps(assistant).steps} />
                  {clientSteps(assistant).fields === "command" ? (
                    <CodeField
                      label="פקודת חיבור"
                      labelId="ai-command-label"
                      value={command}
                      valueRef={commandRef}
                      failed={manualField === "command"}
                      copyLabel="העתקה: פקודה"
                      onCopy={() => { void copyValue("command", command, commandRef.current); }}
                    />
                  ) : (
                    <>
                      <CodeField
                        label="כתובת שרת MCP"
                        labelId="ai-url-label"
                        value={mcpUrl}
                        valueRef={urlRef}
                        failed={manualField === "url"}
                        copyLabel="העתקה: כתובת"
                        onCopy={() => { void copyValue("url", mcpUrl, urlRef.current); }}
                      />
                      <CodeField
                        label="כותרת"
                        labelId="ai-header-label"
                        value={`Authorization: Bearer ${secret.secret}`}
                        valueRef={headerRef}
                        failed={manualField === "secret"}
                        copyLabel="העתקה: כותרת"
                        onCopy={() => { void copyValue("secret", `Authorization: Bearer ${secret.secret}`, headerRef.current); }}
                      />
                    </>
                  )}
                    <p className="ui-ai-code-note">{CODE_NOTE}</p>
                  </div>
                  <ConnectionHead>4 · בודקים</ConnectionHead>
                  <ConnectionNote>{`שאלו את העוזר: "מה מצב התזרים של ${month}?". כשהוא עונה, החיבור מוכן ויופיע כאן כמחובר.`}</ConnectionNote>
                  <Button onClick={() => { setSecret(null); setSetupOpen(false); }}>סיום</Button>
                </>
              )}
        </>
      ) : null}
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="לנתק את העוזר?"
        consequence="הקוד יפסיק לעבוד. הספרים נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={revoking}
        returnFocusRef={disconnectFocus}
        onConfirm={() => { void disconnect(); }}
      />
    </ConnectionPage>
    </ViewerScope>
  );
}
