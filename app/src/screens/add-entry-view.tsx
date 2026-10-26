// FLOW-369: the add form (the tall sheet from the board, "Add (+)"). Presentational: the container
// (add-entry-sheet.tsx) owns the lists, the writes and the toasts. Rules are in ../add-entry.ts.
// FLOW-966 (Add v2): save is never disabled; a tap with something missing marks each field and says
// what it needs, and the first one takes the focus.
import { useId, useState, type ReactNode } from "react";
import { Sheet } from "../ui/sheet";
import { Chip } from "../ui/chip";
import { AlertIcon } from "../ui/icons";
import {
  datePresets,
  ENTRY_FIELDS,
  entryProblems,
  matchLine,
  NO_PROJECT,
  orderChips,
  type AttachedDocument,
  type BankMatch,
  type EntryDraft,
  type EntryField,
  type EntryKind,
} from "../add-entry";
import { AddNewEditor } from "./add-entry-new";

export interface AddEntryItem {
  id: string;
  name: string;
}
export interface AddEntryCategory extends AddEntryItem {
  kind: "expense" | "income";
}

export interface AddEntryViewProps {
  kind: EntryKind;
  /** The project the form was opened from ("הוספה ל־<project>"), or null from Home. */
  fromProject?: string | null;
  projects: readonly AddEntryItem[];
  categories: readonly AddEntryCategory[];
  edit: EntryDraft;
  onDraftChange: (next: EntryDraft) => void;
  document?: AttachedDocument | null;
  match?: BankMatch | null;
  busy?: boolean;
  error?: string | null;
  formatMoney: (minor: number) => string;
  onClose: () => void;
  onSave: (draft: EntryDraft) => void;
  onAddProject: (name: string) => Promise<string>;
  onAddCategory: (name: string, kind: "expense" | "income") => Promise<string>;
  /** Cash only: the optional photo button, which opens the camera. */
  onAttach?: () => void;
  /** The company's currency code; the amount field shows its symbol. */
  currency?: string;
}

/** The symbol inside the amount field: ₪ for shekels, $ for dollars, else the code. */
function currencySymbol(currency: string): string {
  if (currency === "ILS") return "₪";
  if (currency === "USD") return "$";
  return currency;
}

/** The chips that always come last: a category named אחר, and the overhead chip. */
const LAST_CATEGORY = "אחר";

function Segment<T extends string>({ label, value, options, onPick, cols }: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onPick: (next: T) => void;
  cols: number;
}) {
  const id = useId();
  return (
    <div className="ui-add-field">
      <span className="ui-add-label" id={id}>{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="ui-add-seg" style={{ gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))` }}>
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            className="ui-add-seg-btn"
            onClick={() => { onPick(key); }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A field's error line under it, linked by its id (aria-describedby). */
function FieldError({ id, text }: { id: string; text: string | undefined }) {
  if (text == null) return null;
  return <span id={id} className="ui-add-err"><AlertIcon size={16} />{text}</span>;
}

/** The single-choice chips of a field: one radiogroup, named by the field's label. */
function ChipGroup({ id, labelId, errorId, invalid, children }: { id: string; labelId: string; errorId: string; invalid: boolean; children: ReactNode }) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      className="ui-add-chips"
    >
      {children}
    </div>
  );
}

export function AddEntryView(props: AddEntryViewProps) {
  const { edit: draft } = props;
  function patch(change: Partial<EntryDraft>) {
    props.onDraftChange({ ...draft, ...change });
  }
  const [addedProjects, setAddedProjects] = useState<AddEntryItem[]>([]);
  const [addedCategories, setAddedCategories] = useState<AddEntryCategory[]>([]);
  const [adding, setAdding] = useState<null | "project" | "category">(null);

  const isIncome = draft.direction === "in";
  const kindWanted = isIncome ? "income" : "expense";
  // A refetch can land before the local add is dropped, so an added item is listed once, by its id.
  const projectList = [...props.projects, ...addedProjects.filter((a) => !props.projects.some((p) => p.id === a.id))];
  const categoryList = [...props.categories, ...addedCategories.filter((a) => !props.categories.some((c) => c.id === a.id))].filter((c) => c.kind === kindWanted);
  const categoryNames = orderChips(categoryList.map((c) => c.name), [LAST_CATEGORY]);
  const projectNames = projectList.map((p) => p.name);
  const [tried, setTried] = useState(false);
  const uid = useId();
  const problems = entryProblems(draft);
  // The date says it at once when typed wrong; the other fields wait for the first tap on save.
  const shown: Partial<Record<EntryField, string>> = tried ? problems : (draft.date.length > 0 && problems.date != null ? { date: problems.date } : {});
  const errId = (field: EntryField) => `${uid}-err-${field}`;
  const fieldId = (field: EntryField) => `${uid}-${field}`;
  // An input is named by its label alone, so the error under it is its description, not its name.
  const labelId = (field: EntryField) => `${uid}-${field}-label`;
  const invalid = (field: EntryField) => shown[field] != null;
  const described = (field: EntryField) => (invalid(field) ? errId(field) : undefined);
  const hasMatch = props.kind === "receipt" && props.match != null;
  const amountColor = isIncome ? "var(--color-income)" : "var(--color-text)";
  const saveLabel = hasMatch ? "שמירה וצירוף לתנועה" : isIncome ? "שמירת ההכנסה" : "שמירת ההוצאה";

  function trySave() {
    if (props.busy === true) return;
    const first = ENTRY_FIELDS.find((field) => problems[field] != null);
    if (first == null) {
      props.onSave(draft);
      return;
    }
    setTried(true);
    // The first missing field takes the focus: its input, or the first chip of its group.
    const target = document.getElementById(fieldId(first));
    const focusable = target?.getAttribute("role") === "radiogroup" ? target.querySelector<HTMLElement>("[role=\"radio\"]") : target;
    focusable?.focus();
  }
  const headerSub = props.kind === "receipt"
    ? (props.document?.name ?? "קבלה")
    : `${props.fromProject != null ? `ל־${props.fromProject} · ` : ""}תנועה בלי מסמך מהבנק`;

  function setDirection(next: EntryDraft["direction"]) {
    patch({ direction: next, categoryId: null });
  }

  const titleText = props.kind === "receipt" ? "קבלה" : "מזומן או צ׳ק";

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={titleText}
      subtitle={headerSub}
      panelClassName="ui-sheet-tall ui-add-entry ui-sheet-g14"
      action={(
        <div className="ui-add-foot">
          {props.error ? <p role="alert" className="ui-add-error">{props.error}</p> : null}
          <button
            type="button"
            className="ui-add-save"
            aria-busy={props.busy === true || undefined}
            onClick={trySave}
          >
            {saveLabel}
          </button>
        </div>
      )}
    >
      <div className="ui-add-body">
        {props.document != null ? (
          <div className="ui-add-doc">
            <span className="ui-add-doc-thumb" aria-hidden="true"><i /><i /><i /></span>
            <span className="ui-add-doc-text">
              <span>המסמך צורף</span>
              <span className="ui-add-hint">הפרטים ממלאים אתם</span>
            </span>
          </div>
        ) : null}

        <Segment
          label="סוג"
          cols={2}
          value={draft.direction}
          options={[["out", "הוצאה"], ["in", "הכנסה"]] as const}
          onPick={setDirection}
        />

        <label className="ui-add-field">
          <span className="ui-add-label" id={labelId("amount")}>סכום</span>
          <span className="ui-add-amount" data-invalid={invalid("amount") || undefined}>
            <input
              id={fieldId("amount")}
              aria-labelledby={labelId("amount")}
              className="ui-add-amount-input"
              dir="ltr"
              inputMode="decimal"
              placeholder="0.00"
              aria-invalid={invalid("amount")}
              aria-describedby={described("amount")}
              value={draft.amount}
              style={{ color: amountColor }}
              onChange={(e) => { const value = e.target.value; patch({ amount: value }); }}
            />
            <span className="ui-add-currency" aria-hidden="true">{currencySymbol(props.currency ?? "ILS")}</span>
          </span>
          <FieldError id={errId("amount")} text={shown.amount} />
        </label>

        <label className="ui-add-field">
          <span className="ui-add-label" id={labelId("payee")}>{isIncome ? "ממי" : "למי"}</span>
          <input
            id={fieldId("payee")}
            aria-labelledby={labelId("payee")}
            className="ui-add-input"
            dir="auto"
            value={draft.payee}
            placeholder={isIncome ? "שם הלקוח או הדייר" : "שם הספק או בעל המקצוע"}
            aria-invalid={invalid("payee")}
            aria-describedby={described("payee")}
            onChange={(e) => { const value = e.target.value; patch({ payee: value }); }}
          />
          <FieldError id={errId("payee")} text={shown.payee} />
        </label>

        <div className="ui-add-row2">
          <label className="ui-add-field">
            <span className="ui-add-label" id={labelId("date")}>תאריך</span>
            <input
              id={fieldId("date")}
              aria-labelledby={labelId("date")}
              className="ui-add-input"
              dir="ltr"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              aria-invalid={invalid("date")}
              aria-describedby={described("date")}
              value={draft.date}
              onChange={(e) => { const value = e.target.value; patch({ date: value }); }}
            />
          </label>
          {props.kind === "cash" ? (
            <Segment
              label="אמצעי"
              cols={2}
              value={draft.method}
              options={[["cash", "מזומן"], ["cheque", "צ׳ק"]] as const}
              onPick={(method) => { patch({ method }); }}
            />
          ) : null}
        </div>

        <div className="ui-add-presets" role="group" aria-label="תאריך מהיר">
          {datePresets().map(([value, label]) => (
            <Chip key={label} pressed={draft.date === value} onClick={() => { patch({ date: value }); }}>{label}</Chip>
          ))}
        </div>
        <FieldError id={errId("date")} text={shown.date} />

        {props.kind === "cash" && draft.method === "cheque" ? (
          <label className="ui-add-field">
            <span className="ui-add-label" id={labelId("cheque")}>מספר צ׳ק</span>
            <input
              id={fieldId("cheque")}
              aria-labelledby={labelId("cheque")}
              className="ui-add-input"
              dir="ltr"
              inputMode="numeric"
              aria-invalid={invalid("cheque")}
              aria-describedby={described("cheque")}
              value={draft.cheque}
              onChange={(e) => { const value = e.target.value; patch({ cheque: value }); }}
            />
            <FieldError id={errId("cheque")} text={shown.cheque} />
          </label>
        ) : null}

        <div className="ui-add-field">
          <span className="ui-add-label" id={labelId("project")}>פרויקט</span>
          <ChipGroup id={fieldId("project")} labelId={labelId("project")} errorId={errId("project")} invalid={invalid("project")}>
            {projectNames.map((name) => {
              const project = projectList.find((p) => p.name === name);
              const id = project?.id ?? name;
              return (
                <Chip key={id} radio pressed={draft.projectId === id} onClick={() => { patch({ projectId: id }); }}>
                  {name}
                </Chip>
              );
            })}
            <Chip radio pressed={draft.projectId === NO_PROJECT} onClick={() => { patch({ projectId: NO_PROJECT }); }}>
              בלי פרויקט
            </Chip>
            {adding !== "project" && props.fromProject == null ? (
              <button type="button" className="ui-add-chip-new" onClick={() => { setAdding("project"); }}>+ פרויקט חדש</button>
            ) : null}
          </ChipGroup>
          <FieldError id={errId("project")} text={shown.project} />
          {adding === "project" ? (
            <AddNewEditor
              kind="project"
              existing={projectList.map((p) => p.name)}
              onCancel={() => { setAdding(null); }}
              onAdd={async (name) => {
                const id = await props.onAddProject(name);
                setAddedProjects((prev) => [...prev, { id, name }]);
                patch({ projectId: id });
                setAdding(null);
              }}
            />
          ) : null}
        </div>

        <div className="ui-add-field">
          <span className="ui-add-label" id={labelId("category")}>קטגוריה</span>
          <ChipGroup id={fieldId("category")} labelId={labelId("category")} errorId={errId("category")} invalid={invalid("category")}>
            {categoryNames.map((name) => {
              const category = categoryList.find((c) => c.name === name);
              const id = category?.id ?? name;
              return (
                <Chip key={id} radio pressed={draft.categoryId === id} onClick={() => { patch({ categoryId: id }); }}>
                  {name}
                </Chip>
              );
            })}
            {adding !== "category" ? (
              <button type="button" className="ui-add-chip-new" onClick={() => { setAdding("category"); }}>+ קטגוריה חדשה</button>
            ) : null}
          </ChipGroup>
          <FieldError id={errId("category")} text={shown.category} />
          {adding === "category" ? (
            <AddNewEditor
              kind="category"
              existing={categoryList.map((c) => c.name)}
              isIncome={isIncome}
              onCancel={() => { setAdding(null); }}
              onAdd={async (name) => {
                const id = await props.onAddCategory(name, kindWanted);
                setAddedCategories((prev) => [...prev, { id, name, kind: kindWanted }]);
                patch({ categoryId: id });
                setAdding(null);
              }}
            />
          ) : null}
        </div>

        {hasMatch && props.match != null ? (
          <div className="ui-add-match" role="note">
            <span className="ui-add-match-title">נמצאה תנועה בבנק</span>
            <span className="ui-add-match-line">{matchLine(props.match, props.formatMoney)}</span>
            <span className="ui-add-hint">הקבלה תצורף אליה, ולא תיווצר תנועה כפולה.</span>
          </div>
        ) : null}

        {props.kind === "cash" && props.onAttach != null ? (
          <button type="button" className="ui-add-attach" onClick={props.onAttach}>צירוף צילום (לא חובה)</button>
        ) : null}

      </div>
    </Sheet>
  );
}

