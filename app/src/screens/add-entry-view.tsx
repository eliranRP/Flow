// FLOW-369: the add form (the tall sheet from the board, "Add (+)"). Presentational: the container
// (add-entry-sheet.tsx) owns the lists, the writes and the toasts. Rules are in ../add-entry.ts.
import { useState, type ReactNode } from "react";
import { Sheet } from "../ui/sheet";
import { Chip } from "../ui/chip";
import {
  chequeProblem,
  isEntryReady,
  matchLine,
  NO_PROJECT,
  orderChips,
  parseDisplayDate,
  type AttachedDocument,
  type BankMatch,
  type EntryDraft,
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
  draft: EntryDraft;
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
  /** Cash only: the optional photo button. */
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
  return (
    <div className="ui-add-field">
      <span className="ui-add-label" id={`seg-${label}`}>{label}</span>
      <div role="radiogroup" aria-labelledby={`seg-${label}`} className="ui-add-seg" style={{ gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))` }}>
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

function ChipRow({ children }: { children: ReactNode }) {
  return <div className="ui-add-chips">{children}</div>;
}

export function AddEntryView(props: AddEntryViewProps) {
  const { draft } = props;
  function patch(change: Partial<EntryDraft>) {
    props.onDraftChange({ ...draft, ...change });
  }
  const [addedProjects, setAddedProjects] = useState<AddEntryItem[]>([]);
  const [addedCategories, setAddedCategories] = useState<AddEntryCategory[]>([]);
  const [adding, setAdding] = useState<null | "project" | "category">(null);

  const isIncome = draft.direction === "in";
  const kindWanted = isIncome ? "income" : "expense";
  const projectList = [...props.projects, ...addedProjects];
  const categoryList = [...props.categories, ...addedCategories].filter((c) => c.kind === kindWanted);
  const categoryNames = orderChips(categoryList.map((c) => c.name), [LAST_CATEGORY]);
  const projectNames = projectList.map((p) => p.name);
  const ready = isEntryReady(draft);
  const hasMatch = props.kind === "receipt" && props.match != null;
  const amountColor = isIncome ? "var(--color-income)" : "var(--color-text)";
  const dateOk = parseDisplayDate(draft.date) != null;
  const chequeBad = draft.method === "cheque" && chequeProblem(draft.cheque);
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
      panelClassName="ui-sheet-tall ui-add-entry"
      action={(
        <div className="ui-add-foot">
          {props.error ? <p role="alert" className="ui-add-error">{props.error}</p> : null}
          <button
            type="button"
            className="ui-add-save"
            disabled={!ready || props.busy === true}
            aria-disabled={!ready || props.busy === true}
            onClick={() => { if (ready && props.busy !== true) props.onSave(draft); }}
          >
            {hasMatch ? "שמירה וצירוף לתנועה" : "שמירה"}
          </button>
        </div>
      )}
    >
      <div className="ui-add-body">
        {props.document != null ? (
          <div className="ui-add-doc">
            <span className="ui-add-doc-thumb" aria-hidden="true" />
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
          <span className="ui-add-label">סכום</span>
          <span className="ui-add-amount">
            <input
              className="ui-add-amount-input"
              dir="ltr"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.amount}
              style={{ color: amountColor }}
              onChange={(e) => { const value = e.target.value; patch({ amount: value }); }}
            />
            <span className="ui-add-currency" aria-hidden="true">{currencySymbol(props.currency ?? "ILS")}</span>
          </span>
        </label>

        <label className="ui-add-field">
          <span className="ui-add-label">{isIncome ? "ממי" : "למי"}</span>
          <input
            className="ui-add-input"
            value={draft.payee}
            placeholder={isIncome ? "שם הלקוח או הדייר" : "שם הספק או בעל המקצוע"}
            onChange={(e) => { const value = e.target.value; patch({ payee: value }); }}
          />
        </label>

        <div className="ui-add-row2">
          <label className="ui-add-field">
            <span className="ui-add-label">תאריך</span>
            <input
              className="ui-add-input"
              dir="ltr"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              aria-invalid={!dateOk}
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

        {props.kind === "cash" && draft.method === "cheque" ? (
          <label className="ui-add-field">
            <span className="ui-add-label">מספר צ׳ק</span>
            <input
              className="ui-add-input"
              dir="ltr"
              inputMode="numeric"
              aria-invalid={chequeBad}
              value={draft.cheque}
              onChange={(e) => { const value = e.target.value; patch({ cheque: value }); }}
            />
          </label>
        ) : null}

        <div className="ui-add-field">
          <span className="ui-add-label" id="add-entry-project">פרויקט</span>
          <ChipRow>
            {projectNames.map((name) => {
              const project = projectList.find((p) => p.name === name);
              const id = project?.id ?? name;
              return (
                <Chip key={id} pressed={draft.projectId === id} onClick={() => { patch({ projectId: id }); }}>
                  {name}
                </Chip>
              );
            })}
            <Chip pressed={draft.projectId === NO_PROJECT} onClick={() => { patch({ projectId: NO_PROJECT }); }}>
              בלי פרויקט
            </Chip>
            {adding !== "project" && props.fromProject == null ? (
              <button type="button" className="ui-add-chip-new" onClick={() => { setAdding("project"); }}>+ פרויקט חדש</button>
            ) : null}
          </ChipRow>
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
          <span className="ui-add-label" id="add-entry-category">קטגוריה</span>
          <ChipRow>
            {categoryNames.map((name) => {
              const category = categoryList.find((c) => c.name === name);
              const id = category?.id ?? name;
              return (
                <Chip key={id} pressed={draft.categoryId === id} onClick={() => { patch({ categoryId: id }); }}>
                  {name}
                </Chip>
              );
            })}
            {adding !== "category" ? (
              <button type="button" className="ui-add-chip-new" onClick={() => { setAdding("category"); }}>+ קטגוריה חדשה</button>
            ) : null}
          </ChipRow>
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

        {draft.date.length > 0 && !dateOk ? <p className="ui-add-hint ui-add-hint-bad">התאריך צריך להיות dd/mm/yyyy</p> : null}
      </div>
    </Sheet>
  );
}

