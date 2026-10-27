import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRefreshingNow } from "../israel-clock";
import { claudeCodeCommand, flowMcpUrl } from "../mcp-address";
import { Button } from "../ui/button";
import { CodeField, type CopyTarget } from "../ui/code-field";
import { ConnectionHead, ConnectionNote, StepList } from "../ui/connection-page";
import { FormError } from "../ui/layout";
import { ListRow } from "../ui/list-row";
import { SegmentedControl } from "../ui/segmented-control";
import { TextField } from "../ui/text-field";
import {
  CLIENTS,
  defaultKeyName,
  mintKey,
  revokeKey,
  scopeChoice,
  TooManyKeys,
  type AssistantClient,
  type AssistantKey,
  type AssistantScope,
  type Minted,
} from "./assistant-keys";
import { AllKeysLink } from "./assistant-key-views";
import { useTopToast } from "../ui/top-toast";

/** The three questions the board shows under "מה אפשר לשאול" (the project and supplier are invented). */
export const EXAMPLE_QUESTIONS = [
  '"כמה הוצאתי על Elm Court החודש?"',
  '"מה מהקבועים עוד לא הגיע?"',
  '"שייך את כל Harlow מהשבוע ל־Elm Court"',
];

export const MINT_ERROR = "לא הצלחנו להתחבר. נסו שוב.";
export const TOO_MANY_KEYS = "יש כבר 20 מפתחות פעילים. בטלו מפתח שלא בשימוש ונסו שוב.";
const MINT_REASON = "יוצרים קוד. אי אפשר לשנות עכשיו.";
const CODE_NOTE = "הקוד מוצג פעם אחת ותקף ל־90 יום. אל תשתפו אותו.";
const SCOPE_FIELD = "מה העוזר יכול לעשות";
export const NAME_FIELD = "שם למפתח";
const NAME_PLACEHOLDER = "למשל: Claude במחשב העבודה";
const NAME_MAX = 60;

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

const scopeHint = (choice: AssistantScope) => (choice === "read" ? "העוזר רואה ועונה. לא משנה כלום." : "יכול גם לשייך, לאשר וליצור. כל שינוי נרשם וניתן לביטול.");

/**
 * Today's setup (FLOW-512), with the key's name on top (FLOW-939): access, assistant, mint, the code
 * once with the steps for that assistant, then a first question. The code is shown once: leaving
 * the page drops it. A code dropped in the same setup (the access changed) is revoked, so a
 * shown-and-replaced code does not stay open as a key nobody uses.
 */
export function AssistantSetup({
  keys,
  allKeysTo,
  sampleSecret,
  initialSecret,
  initialClient = "claude-code",
  sample,
  guard,
  onMinted,
  onLeave,
  onAdded,
}: {
  /** The keys already listed. A name left empty takes the next number. */
  keys: readonly AssistantKey[];
  /** "‹ כל המפתחות", when there is a list to go back to. */
  allKeysTo: string | null;
  sampleSecret?: string;
  initialSecret?: Minted;
  initialClient?: AssistantClient;
  /** Stories and the dev route: a mint shows the sample secret and never calls the server. */
  sample: boolean;
  guard: () => boolean;
  /** A code was made: the key exists now, before the assistant has used it. */
  onMinted: () => void;
  /** "‹ כל המפתחות" was tapped. */
  onLeave: () => void;
  /** The key is set up (סיום, or the assistant's first call): it joins the list. */
  onAdded: (key: { id: string; name: string; client: AssistantClient; scope: string[] }) => void;
}) {
  const client = useQueryClient();
  // Every toast on the connection pages sits under the header (decisions 0222, 0223).
  const toast = useTopToast();
  const [now] = useRefreshingNow();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AssistantScope>("read_write");
  const [assistant, setAssistant] = useState<AssistantClient>(initialClient);
  const [secret, setSecret] = useState<(Minted & { name: string }) | null>(
    initialSecret ? { ...initialSecret, name: defaultKeyName(initialClient, keys.length) } : null,
  );
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [manualField, setManualField] = useState<CopyTarget | null>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);
  const mcpUrl = flowMcpUrl();
  const command = secret != null && mcpUrl !== "" ? claudeCodeCommand(mcpUrl, secret.secret) : "";

  // The first call on the new key (its first use) finishes the setup, as סיום does.
  const firstUse = secret != null && !sample && keys.some((key) => key.id === secret.id && key.last_used_at != null);
  useEffect(() => {
    if (!firstUse) return;
    setSecret(null);
    onAdded({ id: secret.id, name: secret.name, client: assistant, scope: secret.scope });
  }, [firstUse, secret, assistant, onAdded]);

  async function mint() {
    if (minting || guard()) return;
    const keyName = name.trim() === "" ? defaultKeyName(assistant, keys.length) : name.trim();
    const scopeList = scope === "read" ? ["read"] : ["read", "write"];
    if (sample) {
      if (sampleSecret == null || sampleSecret === "") return;
      setSecret({ id: `mcp-sample-${String(keys.length + 1)}`, secret: sampleSecret, scope: scopeList, name: keyName });
      onMinted();
      return;
    }
    setMinting(true);
    setMintError(null);
    try {
      const minted = await mintKey({ scope, name: keyName, client: assistant });
      setSecret({ ...minted, name: keyName });
      onMinted();
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
    } catch (error) {
      setMintError(error instanceof TooManyKeys ? TOO_MANY_KEYS : MINT_ERROR);
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

  // The code on screen stays tied to the access it was minted for; picking the other access drops it (board: SettingsMcpCode).
  const shownScope = secret != null ? scopeChoice(secret.scope) : scope;
  function pickScope(next: AssistantScope) {
    if (next !== shownScope && secret != null) {
      if (!sample) void revokeKey(secret.id).finally(() => client.invalidateQueries({ queryKey: ["mcp-status"] }));
      setSecret(null);
    }
    setScope(next);
  }
  const month = currentMonthName(new Date(now));
  const steps = clientSteps(assistant);

  return (
    <>
      {allKeysTo != null ? <AllKeysLink to={allKeysTo} onClick={onLeave} /> : null}
      <TextField
        label={NAME_FIELD}
        value={secret?.name ?? name}
        placeholder={NAME_PLACEHOLDER}
        maxLength={NAME_MAX}
        readOnly={secret != null || minting}
        onChange={(event) => { setName(event.target.value); }}
      />
      <div className="ui-settings-card ui-ai-questions">
        <p className="ui-ai-questions-head">מה אפשר לשאול</p>
        {EXAMPLE_QUESTIONS.map((question) => <p key={question} className="ui-ai-question">{question}</p>)}
      </div>
      <ConnectionHead>1 · מה העוזר יכול לעשות</ConnectionHead>
      <div role="radiogroup" aria-label={SCOPE_FIELD} className="ui-ai-scope">
        <ListRow control="radio"
          title="קריאה בלבד"
          description={scopeHint("read")}
          selected={shownScope === "read"}
          disabled={minting}
          onSelect={() => { pickScope("read"); }}
        />
        <ListRow control="radio"
          title="קריאה וכתיבה"
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
          {minting ? <p className="t-caption t-muted" role="status">{MINT_REASON}</p> : null}
          {mintError != null ? <FormError>{mintError}</FormError> : null}
          <Button busy={minting} onClick={() => { void mint(); }}>יצירת קוד</Button>
        </>
      ) : (
        <>
          <div className="ui-settings-card ui-connection-steps">
            <StepList steps={steps.steps} />
            {steps.fields === "command" ? (
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
          <ConnectionNote>{`שאלו את העוזר: "מה מצב התזרים של ${month}?". כשהוא עונה, המפתח מוכן ויופיע ברשימת המפתחות.`}</ConnectionNote>
          <Button onClick={() => {
            const done = secret;
            setSecret(null);
            onAdded({ id: done.id, name: done.name, client: assistant, scope: done.scope });
          }}>סיום</Button>
        </>
      )}
    </>
  );
}
