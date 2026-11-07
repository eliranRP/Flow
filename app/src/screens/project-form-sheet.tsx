import { shekelsToAgorot } from "@flow/shared";
import { useEffect, useRef, useState, type ReactNode, type RefObject, type SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useCompanyCurrency } from "../company-currency";
import { kindLabel, PROJECT_KINDS, resolveProjectKind, type ProjectKind } from "../project-list";
import { useHoldWrites } from "../use-is-viewer";
import { useInvalidateBooks } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { Button } from "../ui/button";
import { israelToday } from "../ui/date-math";
import { MoneyField } from "../ui/money-field";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { LOAN_CURRENCY_MARK } from "./loan-form";
import { useBlockedPreview } from "./screen-shared";

/** The project an edit sheet opens on. `type` is the owner's own text (or none); `budget` is in agorot. */
export type ProjectFormValues = { id: string; name: string; type: string | null; budget: bigint | null; status: string; overhead?: boolean };

/** What each kind asks for, and the one line that says how it is measured (board V3-NewProject). */
const KIND_HELP: Record<ProjectKind, string> = {
  renovation: "קונים, משפצים ומוכרים. נמדד מול תקציב.",
  rental: "נכס מושכר. נמדד בתשואה.",
  client: "עבודה ללקוח. נמדד מול החוזה.",
  overhead: "הוצאות החברה שלא שייכות לפרויקט.",
};

type AmountField = "purchase" | "budget" | "arv" | "value";

const FIELD_LABEL: Record<AmountField, string> = {
  purchase: "מחיר קנייה",
  budget: "תקציב שיפוץ",
  arv: "שווי צפוי אחרי שיפוץ",
  value: "שווי הנכס היום",
};

/** A new project's fields by kind. The edit sheet keeps the budget (the contract for a client); the rest live on the investment page. */
function fieldsOf(kind: ProjectKind, editing: boolean): AmountField[] {
  if (kind === "overhead") return [];
  if (kind === "client") return ["budget"];
  if (editing) return kind === "renovation" ? ["budget"] : [];
  return kind === "renovation" ? ["purchase", "budget", "arv"] : ["purchase", "value"];
}

/**
 * FLOW-445: the new-project sheet (no project) and the edit sheet (a project). FLOW-1044 (board V3-NewProject):
 * the kind is picked first, שיפוץ, השכרה, לקוח or תקורה, and the fields follow it. The pick is stored as the
 * project's type word, which the list and the page read the kind from (plan §5); purchase, ARV and value go to
 * the investment, the budget (a client's contract) to the project. A new project opens its page.
 */
export function ProjectFormSheet({
  open,
  onOpenChange,
  project,
  extras,
  focusBudget = false,
  onCreated,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectFormValues;
  /** The edit sheet's own controls after the fields: the overhead switch and the group. */
  extras?: ReactNode;
  /** FLOW-961: opened from הוספת תקציב, the sheet puts the cursor in the budget. */
  focusBudget?: boolean;
  /** FLOW-1093: a new project goes here (its id and name) in place of opening its page and the create toast. */
  onCreated?: (id: string, name: string) => void;
  /** FLOW-1093: ✕ and Escape put focus back on the control that opened the sheet (a removed control is skipped). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef} title={project ? "עריכת פרויקט" : "פרויקט חדש"} panelClassName="ui-sheet-wide ui-sheet-g14 ui-sheet-pad28 ui-project-new">
      <ProjectForm key={project == null ? "new" : `${project.id}:${project.name}:${project.type ?? ""}:${String(project.budget)}`} project={project} extras={extras} focusBudget={focusBudget} onCreated={onCreated} onClose={() => { onOpenChange(false); }} />
    </Sheet>
  );
}

function shekelsText(agorot: bigint | null): string {
  return agorot == null ? "" : String(Number(agorot) / 100);
}

/** FLOW-961: why the save waits, under the name, in place of a disabled button. */
export function projectNameError(trimmed: string, editing: boolean): string | undefined {
  if (trimmed === "") return editing ? "צריך שם כדי לשמור את הפרויקט" : "צריך שם כדי ליצור את הפרויקט";
  if (trimmed.length < 2) return "השם צריך לפחות שתי אותיות";
  return undefined;
}

function minorOf(text: string): number | null {
  return text.trim() === "" ? null : Number(shekelsToAgorot(text));
}

function ProjectForm({ project, extras, focusBudget, onCreated, onClose }: { project?: ProjectFormValues; extras?: ReactNode; focusBudget: boolean; onCreated?: (id: string, name: string) => void; onClose: () => void }) {
  const blocked = useBlockedPreview();
  const companyCurrency = useCompanyCurrency();
  // The amounts are in the company currency, so each field shows that currency's mark.
  const mark = companyCurrency === "USD" ? LOAN_CURRENCY_MARK.USD : LOAN_CURRENCY_MARK.ILS;
  const holdWrites = useHoldWrites();
  const navigate = useNavigate();
  const editing = project != null;
  const storedKind = project == null ? null : resolveProjectKind({ overhead: project.overhead === true, type: project.type, budget: project.budget != null });
  const [name, setName] = useState(project?.name ?? "");
  const [kind, setKind] = useState<ProjectKind>(storedKind ?? "renovation");
  const [amounts, setAmounts] = useState<Record<AmountField, string>>({ purchase: "", budget: shekelsText(project?.budget ?? null), arv: "", value: "" });
  const createdId = useRef<string | null>(null);
  const invalidate = useInvalidateBooks();
  const trimmed = name.trim();
  // Shown after a tap on the button, cleared as the name changes.
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  // FLOW-1088: each tap that stops on the name redraws its message, so a repeated tap is announced again.
  const [nameTries, setNameTries] = useState(0);
  const nameField = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!focusBudget) return;
    // After the sheet's own focus on its title (its open runs first), the budget takes the cursor.
    const timer = window.setTimeout(() => { form.current?.querySelector<HTMLInputElement>(".ui-money-field input")?.focus(); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [focusBudget]);
  const fields = fieldsOf(kind, editing);
  const save = useWrite({
    // FLOW-1101: once the project is made, only its figures are left to save.
    failure: () => (project == null && createdId.current != null ? "הפרויקט נוצר, אבל הנתונים לא נשמרו. נסו שוב." : "לא הצלחנו לשמור את הפרויקט."),
    // FLOW-1093: a create the caller goes on with (an assign) leaves the toast to it.
    success: project ? "הפרטים נשמרו" : onCreated == null ? "הפרויקט נוצר" : undefined,
    keys: ["dashboard", "project", "projects-cash"],
    // The project exists once its create worked, so a failed figures save still refreshes the list (no refetch wait).
    onError: () => { if (createdId.current != null) void invalidate(["dashboard", "project", "projects-cash"]); },
    onSuccess: () => {
      const created = createdId.current;
      createdId.current = null;
      onClose();
      if (project || created == null) return;
      if (onCreated == null) void navigate(`/projects/${created}`);
      else onCreated(created, trimmed);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const budget = fields.includes("budget") ? minorOf(amounts.budget) : null;
      // An edit that keeps the kind keeps the owner's own type words; a new pick stores the kind's word.
      const keepType = project != null && kind === storedKind;
      // FLOW-1101: a retry after the figures failed updates the project the first try made, never a second one.
      const knownId = project?.id ?? createdId.current;
      const result = await supabase.rpc("upsert_project", {
        ...(knownId == null ? {} : { p_id: knownId }),
        p_name: trimmed,
        ...(keepType ? (project.type == null ? {} : { p_type: project.type }) : { p_type: kindLabel(kind) }),
        p_status: project?.status ?? "active",
        ...(budget == null ? {} : { p_budget_agorot: budget }),
      });
      assertNoError(result);
      if (project == null && createdId.current == null && typeof result.data === "string") createdId.current = result.data;
      const id = project?.id ?? createdId.current;
      const patch: Record<string, number | string> = {};
      for (const field of fields) {
        const minor = field === "budget" ? null : minorOf(amounts[field]);
        if (minor == null) continue;
        if (field === "purchase") patch.purchase_minor = minor;
        if (field === "arv") patch.arv_minor = minor;
        if (field === "value") {
          patch.value_minor = minor;
          patch.value_date = israelToday();
        }
      }
      if (id != null && Object.keys(patch).length > 0) {
        assertNoError(await supabase.rpc("set_project_investment", { p_project_id: id, p_patch: patch }));
      }
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (holdWrites) return;
    // The name is checked on the phone, so the preview says it too; only the save is the preview's to block.
    const error = projectNameError(trimmed, project != null);
    setNameError(error);
    if (error != null) {
      // FLOW-1088: the cursor goes to the name, which says why the save waits.
      setNameTries((tries) => tries + 1);
      nameField.current?.focus();
      return;
    }
    if (blocked()) return;
    save.mutate();
  }

  return (
    <form ref={form} className="ui-stack" onSubmit={submit}>
      <TextField
        ref={nameField}
        label="שם הפרויקט"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setNameError(undefined);
        }}
        placeholder={project ? undefined : "למשל: Ashby Rd"}
        error={nameError}
        liveMessage
        messageKey={nameTries}
      />
      <div className="ui-project-kind">
        <SegmentedControl
          label="סוג"
          value={kind}
          options={PROJECT_KINDS.map((entry) => ({ value: entry.kind, label: entry.label }))}
          onChange={setKind}
          describedBy="project-kind-help"
        />
        <p id="project-kind-help" className="ui-muted">{KIND_HELP[kind]}</p>
      </div>
      {/* FLOW-1053 (board V3-NewProject): the kind's amounts as one outlined group of 60px rows, label then figure. */}
      {fields.length === 0 ? null : (
        <div className="ui-project-amounts">
          {fields.map((field) => (
            <MoneyField
              key={field}
              label={field === "budget" && kind === "client" ? "סכום החוזה" : FIELD_LABEL[field]}
              prefix={mark}
              placeholder="0"
              value={amounts[field]}
              onValueChange={(value) => { setAmounts((current) => ({ ...current, [field]: value })); }}
            />
          ))}
        </div>
      )}
      {fields.length === 0 ? null : <p className="ui-muted">אפשר להשאיר ריק ולמלא אחר כך בדף הפרויקט.</p>}
      {project ? null : <p className="ui-muted">רק השם חובה. פרויקטים מ־SUMIT נוספים לבד.</p>}
      {extras}
      {/* FLOW-961: never a dead button; without a name the tap says why, under the field. */}
      <Button type="submit" busy={save.isPending} disabled={holdWrites}>
        {project ? "שמירה" : "יצירת פרויקט"}
      </Button>
    </form>
  );
}
