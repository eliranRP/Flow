import { parseDecimalHalfEven } from "@flow/shared";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { useLocation } from "react-router-dom";
import { usePreviewSearch, useHomePreview } from "../preview";
import { BigNumber } from "../ui/big-number";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { DateSheet } from "../ui/date-sheet";
import { formatDisplay, israelToday } from "../ui/date-math";
import { HoldLine } from "../ui/hold-line";
import { CalendarIcon } from "../ui/icons";
import {
  INVESTMENT_LABELS,
  InvestmentCard,
  LOANS_LABEL,
  currencyWord,
  type InvestmentField,
  type InvestmentFigures,
  type InvestmentRow,
  type MinorInCurrency,
} from "../ui/investment-card";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
import { Sheet } from "../ui/sheet";
import { TextLink } from "../ui/text-link";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, useWrite, type WriteFailure } from "../use-write";
import { ProjectLoanList } from "./loan-match";
import { categoryHref } from "./project-category-screen";
import {
  REHAB_TOTAL_ONLY,
  rehabBreakdown,
  toProjectInvestment,
  useRehabCategoriesQuery,
  useRehabCostsQuery,
  type CategoryAmount,
  type InvestmentLoan,
  type ProjectInvestment,
  type ProjectSource,
  type RehabCategory,
} from "./project-investment-data";

export {
  NO_CATEGORY,
  REHAB_TOTAL_ONLY,
  rehabBreakdown,
  toProjectInvestment,
  useRehabCategoriesQuery,
  useRehabCostsQuery,
} from "./project-investment-data";
export type {
  CategoryAmount,
  InvestmentLoan,
  ProjectInvestment,
  RehabBreakdown,
  RehabCategory,
  RehabLine,
} from "./project-investment-data";

function OtherLines({ list, note }: { list: readonly MinorInCurrency[]; note: string }) {
  if (list.length === 0) return null;
  return (
    <>
      {list.map((item) => (
        <p key={item.currency} className="ui-invest-other t-hint">
          {"ועוד "}
          <BigNumber agorot={item.minor} currency={item.currency} />
          {` ${currencyWord(item.currency)}, ${note}`}
        </p>
      ))}
    </>
  );
}

/** The rehab figure is every cost since the project started, on the cash basis. */
function rehabLinesSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("period", "all");
  params.set("basis", "cash");
  return `?${params.toString()}`;
}

/** What the category screen's Back reads when the rehab sheet opened it (FLOW-404). */
export type CategoryBackState = { back: string };

export function RehabSheet({
  projectId,
  open,
  onOpenChange,
  figures,
  costs,
  categories,
  loading,
  failed,
  onRetry,
  returnFocusRef,
}: {
  /** FLOW-404: a counted category opens its lines, all time on the cash basis, as the list reads them. */
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  figures: InvestmentFigures;
  costs: readonly CategoryAmount[];
  categories: readonly RehabCategory[] | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const search = usePreviewSearch();
  // Back from the lines returns here (the investment screen, on its own period), not to the overview.
  const location = useLocation();
  const backState: CategoryBackState = { back: `${location.pathname}${location.search}` };
  const breakdown = categories == null ? null : rehabBreakdown(costs, categories, figures.currency, figures.rehabMinor);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="שיפוץ" returnFocusRef={returnFocusRef}>
      <div className="ui-invest-total">
        <span className="t-title-2">
          <BigNumber agorot={figures.rehabMinor} currency={figures.currency} />
        </span>
        <p className="t-hint">כל העלויות מתחילת הפרויקט, בלי חלקי הלוואה</p>
        <OtherLines list={figures.rehabOther} note="לא נכנס להון המאולץ" />
      </div>
      {loading ? (
        <List className="ui-invest-list">
          <p className="sr-only" role="status">טוען…</p>
          <ListRow variant="skeleton" />
          <ListRow variant="skeleton" />
          <ListRow variant="skeleton" />
        </List>
      ) : failed || breakdown == null ? (
        <div className="ui-invest-retry">
          <p className="t-hint" role="status">לא הצלחנו לטעון את הפירוט.</p>
          <TextLink chevron={false} className="ui-invest-link" label="ניסיון חוזר: פירוט השיפוץ" onClick={onRetry}>ניסיון חוזר</TextLink>
        </div>
      ) : !breakdown.addsUp ? (
        <p className="t-hint">{REHAB_TOTAL_ONLY}</p>
      ) : (
        <>
          {breakdown.counted.length === 0 ? (
            <p className="t-hint">אין עדיין עלויות שנספרות בשיפוץ.</p>
          ) : (
            <List className="ui-invest-list">
              {breakdown.counted.map((line) => {
                const href = line.id == null ? undefined : categoryHref(projectId, line.id, figures.currency, rehabLinesSearch(search));
                return (
                  <ListRow
                    key={line.key}
                    variant="project"
                    title={line.name}
                    agorot={line.minor}
                    currency={figures.currency}
                    loss={false}
                    href={href}
                    state={href == null ? undefined : backState}
                    chevron={href != null}
                    chevronSpace={href == null}
                  />
                );
              })}
            </List>
          )}
          {breakdown.left.length > 0 ? (
            <>
              <h3 className="ui-invest-list-head t-label">לא נספרות בשיפוץ</h3>
              <List className="ui-invest-list ui-invest-left">
                {breakdown.left.map((line) => (
                  <ListRow
                    key={line.key}
                    variant="project"
                    title={line.name}
                    hint={line.reason}
                    agorot={line.minor}
                    currency={figures.currency}
                    loss={false}
                    chevronSpace
                  />
                ))}
              </List>
            </>
          ) : null}
        </>
      )}
      <TextLink to={`/settings/categories${search}`} tone="quiet" chevron={false} className="ui-invest-link">
        מה נספר בשיפוץ? בהגדרות הקטגוריות
      </TextLink>
    </Sheet>
  );
}

export function LoansSheet({
  open,
  onOpenChange,
  figures,
  loans,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  figures: InvestmentFigures;
  loans: readonly InvestmentLoan[];
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const own = loans.filter((loan) => loan.currency === figures.currency);
  const other = loans.filter((loan) => loan.currency !== figures.currency);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={LOANS_LABEL} returnFocusRef={returnFocusRef}>
      <div className="ui-invest-total">
        <span className="t-title-2">
          <BigNumber agorot={figures.loanMinor} currency={figures.currency} />
        </span>
        <p className="t-hint">ההלוואות הפתוחות בפרויקט</p>
      </div>
      {own.length === 0 ? <p className="t-hint">אין הלוואות פתוחות {currencyWord(figures.currency)}.</p> : (
        <div className="ui-invest-loans"><ProjectLoanList rows={own} /></div>
      )}
      {other.length > 0 ? (
        <>
          <h3 className="ui-invest-list-head t-label">במטבע אחר</h3>
          <p className="t-hint">לא נכנסות להון הנוכחי.</p>
          <div className="ui-invest-loans"><ProjectLoanList rows={other} /></div>
        </>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The edit sheet: one figure, saved on שמירה or when the sheet closes (0075). מחיקה clears it.
 * ---------------------------------------------------------------------------------------------- */

export type InvestmentPatch = Partial<{
  purchase_minor: number | null;
  arv_minor: number | null;
  value_minor: number | null;
  value_date: string | null;
}>;

const PATCH_KEY: Record<InvestmentField, "purchase_minor" | "arv_minor" | "value_minor"> = {
  purchase: "purchase_minor",
  arv: "arv_minor",
  value: "value_minor",
};

export const EMPTY_HOLD = "הסכום ריק. כדי למחוק אותו, הקישו מחיקה.";

function currencyMark(currency: string): string {
  if (currency === "ILS") return "₪";
  if (currency === "USD") return "$";
  return currency;
}

/** 125000050n → "1250000.5" (the field's own digits). */
export function minorToRaw(value: bigint | null): string {
  if (value == null) return "";
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / 100n).toString();
  const cents = abs % 100n;
  const body = cents === 0n ? whole : `${whole}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
  return negative ? `-${body}` : body;
}

/** The field's digits to minor units; null when there is no amount. */
export function rawToMinor(raw: string): bigint | null {
  const clean = raw.replace(/\.$/, "");
  if (clean === "" || clean === ".") return null;
  return parseDecimalHalfEven(clean.startsWith(".") ? `0${clean}` : clean, 2);
}

type Verdict = { kind: "clean" } | { kind: "hold" } | { kind: "save"; patch: InvestmentPatch };

export function editVerdict(
  field: InvestmentField,
  base: { minor: bigint | null; date: string | null },
  draft: { raw: string; date: string; dateTouched: boolean },
): Verdict {
  const amount = rawToMinor(draft.raw);
  const amountChanged = amount !== base.minor;
  if (amountChanged && amount == null) return { kind: "hold" };
  if (field !== "value") {
    return amountChanged && amount != null ? { kind: "save", patch: { [PATCH_KEY[field]]: Number(amount) } } : { kind: "clean" };
  }
  if (amountChanged && amount != null) return { kind: "save", patch: { value_minor: Number(amount), value_date: draft.date } };
  if (draft.dateTouched && draft.date !== base.date) return { kind: "save", patch: { value_date: draft.date } };
  return { kind: "clean" };
}

export function clearPatch(field: InvestmentField): InvestmentPatch {
  if (field === "value") return { value_minor: null, value_date: null };
  return { [PATCH_KEY[field]]: null };
}

export function InvestmentEditSheet({
  field,
  open,
  onOpenChange,
  currency,
  minor: baseMinor,
  date: baseDate,
  onSave,
  returnFocusRef,
}: {
  field: InvestmentField;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  minor: bigint | null;
  date: string | null;
  /** Resolves true once saved. A failure toasts and keeps the sheet open. */
  onSave: (patch: InvestmentPatch, kind: "save" | "clear", field: InvestmentField) => Promise<boolean>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const label = INVESTMENT_LABELS[field];
  const today = israelToday();
  const [raw, setRaw] = useState(() => minorToRaw(baseMinor));
  const [date, setDate] = useState(today);
  const [dateTouched, setDateTouched] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [hold, setHold] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useRef({ minor: baseMinor, date: baseDate });
  const draft = useRef({ raw, date, dateTouched });
  draft.current = { raw, date, dateTouched };
  const holdShown = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const dateLabelId = useId();

  // Each open starts from the stored figure; שווי היום's date starts on today (FLOW-404).
  useEffect(() => {
    if (!open) return;
    base.current = { minor: baseMinor, date: baseDate };
    setRaw(minorToRaw(baseMinor));
    setDate(israelToday());
    setDateTouched(false);
    setHold(false);
    holdShown.current = false;
    // Only a new open resets the draft; a refetch while it is open must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = useCallback(async (patch: InvestmentPatch, kind: "save" | "clear"): Promise<boolean> => {
    setBusy(true);
    const pending = onSave(patch, kind, field);
    saving.current = pending;
    try {
      const ok = await pending;
      if (ok) {
        const nextMinor = kind === "clear" ? null : rawToMinor(draft.current.raw);
        base.current = field === "value"
          ? { minor: kind === "clear" ? null : (nextMinor ?? base.current.minor), date: kind === "clear" ? null : (patch.value_date ?? base.current.date) }
          : { minor: nextMinor, date: null };
        setRaw(minorToRaw(base.current.minor));
        setDateTouched(false);
        setHold(false);
      }
      return ok;
    } finally {
      saving.current = null;
      setBusy(false);
    }
  }, [field, onSave]);

  /** ✕, scrim, swipe and back save a valid change first; an empty amount holds once (0075). */
  const guard = useCallback(async (): Promise<boolean> => {
    // A second close while a save runs waits for it, and stays open if it fails (0075).
    if (saving.current) return await saving.current;
    const verdict = editVerdict(field, base.current, draft.current);
    if (verdict.kind === "clean") return true;
    if (verdict.kind === "hold") {
      if (holdShown.current) {
        setRaw(minorToRaw(base.current.minor));
        return true;
      }
      holdShown.current = true;
      setHold(true);
      return false;
    }
    return run(verdict.patch, "save");
  }, [field, run]);

  const setSheet = useSheetHistory("investment-edit", open, onOpenChange, guard);

  function discard() {
    setRaw(minorToRaw(base.current.minor));
    setDate(israelToday());
    setDateTouched(false);
    setHold(false);
    holdShown.current = false;
  }

  async function submit() {
    if (busy) return;
    const verdict = editVerdict(field, base.current, draft.current);
    if (verdict.kind === "hold") {
      holdShown.current = true;
      setHold(true);
      return;
    }
    if (verdict.kind === "save" && !(await run(verdict.patch, "save"))) return;
    setSheet(false);
  }

  async function clear() {
    if (busy) return;
    if (await run(clearPatch(field), "clear")) setSheet(false);
  }

  const canClear = base.current.minor != null || (field === "value" && base.current.date != null);
  return (
    <Sheet
      open={open}
      onOpenChange={setSheet}
      title={label}
      returnFocusRef={returnFocusRef}
      onBeforeClose={guard}
      action={(
        <div className="ui-invest-actions">
          <Button full busy={busy} onClick={() => { void submit(); }}>
            שמירה
          </Button>
          {canClear ? (
            <Button variant="danger" disabled={busy} onClick={() => { void clear(); }}>
              מחיקה
            </Button>
          ) : null}
        </div>
      )}
    >
      <MoneyField
        label={label}
        hideLabel
        value={raw}
        prefix={currencyMark(currency)}
        disabled={busy}
        enterKeyHint="done"
        onValueChange={(next) => {
          setRaw(next);
          if (hold) {
            setHold(false);
            holdShown.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {hold ? <HoldLine onDiscard={discard}>{EMPTY_HOLD}</HoldLine> : null}
      {field === "value" ? (
        <>
          <div className="ui-field">
            <span id={dateLabelId} className="ui-field-label">נכון לתאריך</span>
            <button
              type="button"
              className="ui-field-control ui-date-field"
              aria-labelledby={dateLabelId}
              aria-haspopup="dialog"
              disabled={busy}
              onClick={() => { setDateOpen(true); }}
            >
              <span>
                {date === today ? "היום · " : null}
                <bdi className="ui-num" dir="ltr">{formatDisplay(date)}</bdi>
              </span>
              <CalendarIcon size={20} />
            </button>
          </div>
          <DateSheet
            open={dateOpen}
            onOpenChange={setDateOpen}
            title="נכון לתאריך"
            value={date}
            disabled={busy}
            onApply={(iso) => {
              setDate(iso);
              setDateTouched(true);
            }}
          />
        </>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The section the project page mounts under its categories.
 * ---------------------------------------------------------------------------------------------- */

type SaveRequest = { patch: InvestmentPatch; kind: "save" | "clear"; field: InvestmentField };

/** The toast names the figure that failed, whichever sheet is open by then. */
export function investmentFailure(error: Error): WriteFailure {
  const field = (error as { field?: InvestmentField }).field;
  const code = (error as { code?: string }).code;
  if (code === "42501") return { message: INVESTMENT_REFUSED, retry: false };
  return `לא הצלחנו לשמור את ${field == null ? "ההשקעה" : INVESTMENT_LABELS[field]}.`;
}

export const INVESTMENT_REFUSED = "אין הרשאה לשנות את ההשקעה.";

/** Sample mode works the figures out the way the server does (0143). */
function applySample(figures: InvestmentFigures, patch: InvestmentPatch): InvestmentFigures {
  const next: InvestmentFigures = { ...figures };
  if ("purchase_minor" in patch) next.purchaseMinor = patch.purchase_minor == null ? null : BigInt(patch.purchase_minor);
  if ("arv_minor" in patch) next.arvMinor = patch.arv_minor == null ? null : BigInt(patch.arv_minor);
  if ("value_minor" in patch) next.valueMinor = patch.value_minor == null ? null : BigInt(patch.value_minor);
  if ("value_date" in patch) next.valueDate = patch.value_date ?? null;
  next.forcedEquityMinor = next.arvMinor != null && next.purchaseMinor != null && next.rehabOther.length === 0
    ? next.arvMinor - next.purchaseMinor - next.rehabMinor
    : null;
  next.currentEquityMinor = next.valueMinor != null && next.loanOther.length === 0 ? next.valueMinor - next.loanMinor : null;
  return next;
}

type OpenSheet = InvestmentField | "rehab" | "loans" | null;

/**
 * FLOW-404. The השקעה card with its sheets. Mount it under the project's categories with the
 * project the page already read. The overhead project has no card; a viewer sees it read-only.
 * `sample` draws it with no network (stories).
 */
export function ProjectInvestmentSection({
  project,
  sample,
  sampleCategories,
  initialSheet = null,
}: {
  project: ProjectSource;
  sample?: ProjectInvestment;
  sampleCategories?: RehabCategory[];
  /** Stories open a sheet on first draw. */
  initialSheet?: OpenSheet;
}) {
  const preview = useHomePreview();
  const readOnly = useHoldWrites();
  const projectId = project.id;
  const [sampleData, setSampleData] = useState(sample);
  const data = sampleData ?? toProjectInvestment(project);
  const sampled = sample != null;
  const [sheet, setSheet] = useState<OpenSheet>(readOnly ? null : initialSheet);
  const [editField, setEditField] = useState<InvestmentField>(
    initialSheet === "purchase" || initialSheet === "arv" || initialSheet === "value" ? initialSheet : "purchase",
  );
  const rows = {
    purchase: useRef<HTMLButtonElement>(null),
    arv: useRef<HTMLButtonElement>(null),
    value: useRef<HTMLButtonElement>(null),
    rehab: useRef<HTMLButtonElement>(null),
    loans: useRef<HTMLButtonElement>(null),
  } satisfies Record<InvestmentRow, RefObject<HTMLButtonElement | null>>;
  const rehabOpen = sheet === "rehab";
  const costs = useRehabCostsQuery(projectId, rehabOpen && !sampled);
  const categories = useRehabCategoriesQuery(rehabOpen && !sampled);
  const setRehabSheet = useSheetHistory("investment-rehab", rehabOpen, (next) => { setSheet(next ? "rehab" : null); });
  const setLoansSheet = useSheetHistory("investment-loans", sheet === "loans", (next) => { setSheet(next ? "loans" : null); });
  const save = useWrite<SaveRequest>({
    failure: investmentFailure,
    keys: ["project"],
    run: async ({ patch, field }) => {
      try {
        const supabase = getSupabase();
        if (!supabase || projectId === "") throw new Error("supabase");
        assertNoError(await supabase.rpc("set_project_investment", { p_project_id: projectId, p_patch: patch }));
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error("failed"), { field });
      }
    },
  });
  const onSave = useCallback(async (patch: InvestmentPatch, kind: "save" | "clear", field: InvestmentField): Promise<boolean> => {
    if (sampled) {
      setSampleData((current) => current == null || current.figures == null ? current : { ...current, figures: applySample(current.figures, patch) });
      return true;
    }
    try {
      await save.mutateAsync({ patch, kind, field });
      return true;
    } catch {
      return false;
    }
  }, [sampled, save]);

  if (!sampled && preview !== "off") return null;
  if (data.isOverhead || data.figures == null) return null;
  const figures = data.figures;
  const editMinor = editField === "purchase" ? figures.purchaseMinor : editField === "arv" ? figures.arvMinor : figures.valueMinor;
  // Nothing to list: no open loan in the project's currency or any other.
  const loansEmpty = figures.loanMinor === 0n && figures.loanOther.length === 0;
  const rehabCosts = sampled ? (sampleData?.categories ?? []) : (costs.data ?? []);
  const rehabCategories = sampled ? (sampleCategories ?? []) : (categories.data ?? null);

  return (
    <>
      <InvestmentCard
        figures={figures}
        readOnly={readOnly}
        rowRefs={rows}
        onEdit={(field) => {
          setEditField(field);
          setSheet(field);
        }}
        onRehab={() => { setRehabSheet(true); }}
        onLoans={loansEmpty ? undefined : () => { setLoansSheet(true); }}
      />
      {readOnly ? null : (
        <>
          <InvestmentEditSheet
            key={editField}
            field={editField}
            open={sheet === editField}
            onOpenChange={(next) => { setSheet(next ? editField : null); }}
            currency={figures.currency}
            minor={editMinor}
            date={figures.valueDate}
            returnFocusRef={rows[editField]}
            onSave={onSave}
          />
          <RehabSheet
            projectId={projectId}
            open={rehabOpen}
            onOpenChange={setRehabSheet}
            figures={figures}
            costs={rehabCosts}
            categories={rehabCategories}
            loading={!sampled && (costs.isPending || categories.isPending)}
            failed={!sampled && (costs.isError || categories.isError)}
            onRetry={() => {
              if (costs.isError) void costs.refetch();
              if (categories.isError) void categories.refetch();
            }}
            returnFocusRef={rows.rehab}
          />
          <LoansSheet
            open={sheet === "loans"}
            onOpenChange={setLoansSheet}
            figures={figures}
            loans={data.loans}
            returnFocusRef={rows.loans}
          />
        </>
      )}
    </>
  );
}
