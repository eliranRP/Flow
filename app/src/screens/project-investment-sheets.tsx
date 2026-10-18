import { parseDecimalHalfEven } from "@flow/shared";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePreviewSearch } from "../preview";
import { Amount } from "../ui/amount";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { DateSheet } from "../ui/date-sheet";
import { formatDisplay, israelToday } from "../ui/date-math";
import { HoldLine } from "../ui/hold-line";
import { CalendarIcon } from "../ui/icons";
import { INVESTMENT_LABELS, currencyWord, type InvestmentField, type InvestmentFigures, type MinorInCurrency } from "../ui/investment-card";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
import { Sheet } from "../ui/sheet";
import { categoryHref } from "./project-category-screen";
import {
  REHAB_TOTAL_ONLY,
  rehabBreakdown,
  type CategoryAmount,
  type RehabCategory,
  type RehabLine,
} from "./project-investment-data";

/* ------------------------------------------------------------------------------------------------
 * The rehab sheet (board InvestRehab): the total, then one row per counted category with its share.
 * ---------------------------------------------------------------------------------------------- */

function OtherLines({ list, note }: { list: readonly MinorInCurrency[]; note: string }) {
  if (list.length === 0) return null;
  return (
    <>
      {list.map((item) => (
        <p key={item.currency} className="ui-pinv-other">
          {"ועוד "}
          <Amount agorot={item.minor} currency={item.currency} />
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

/** A category's share of the rehab total, 0 to 100, for its thin bar. */
function sharePercent(minor: bigint, total: bigint): number {
  if (total <= 0n || minor <= 0n) return 0;
  return Math.min(100, Number((minor * 10_000n) / total) / 100);
}

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
  // Back from the lines returns here (the investment screen), not to the project.
  const location = useLocation();
  const backState: CategoryBackState = { back: `${location.pathname}${location.search}` };
  // Every category row, counted or left out, opens its lines (FLOW-404); a line with no category has none.
  const linesHref = (line: RehabLine) =>
    line.id == null ? undefined : categoryHref(projectId, line.id, figures.currency, rehabLinesSearch(search));
  const breakdown = categories == null ? null : rehabBreakdown(costs, categories, figures.currency, figures.rehabMinor);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="שיפוץ עד היום"
      aside={<span className="ui-pinv-sheet-total"><Amount agorot={figures.rehabMinor} currency={figures.currency} /></span>}
      closeButton={false}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-wide ui-sheet-g10 ui-pinv-rehab"
    >
      <p className="ui-pinv-help">כל הוצאות הפרויקט, חוץ מחלקי הלוואה</p>
      <OtherLines list={figures.rehabOther} note="לא נכנס להשבחה הצפויה" />
      {loading ? (
        <List className="ui-pinv-rows">
          <p className="sr-only" role="status">טוען…</p>
          <ListRow variant="skeleton" />
          <ListRow variant="skeleton" />
          <ListRow variant="skeleton" />
        </List>
      ) : failed || breakdown == null ? (
        <div className="ui-pinv-retry">
          <p className="ui-pinv-help" role="status">לא הצלחנו לטעון את הפירוט.</p>
          <Button variant="link" aria-label="ניסיון חוזר: פירוט השיפוץ" onClick={onRetry}>ניסיון חוזר</Button>
        </div>
      ) : !breakdown.addsUp ? (
        <p className="ui-pinv-help">{REHAB_TOTAL_ONLY}</p>
      ) : (
        <>
          {breakdown.counted.length === 0 ? (
            <p className="ui-pinv-help">אין עדיין עלויות שנספרות בשיפוץ.</p>
          ) : (
            <ul className="ui-pinv-rehab-list">
              {breakdown.counted.map((line) => {
                const href = linesHref(line);
                return (
                  <li key={line.key}>
                    <RehabLineRow line={line} currency={figures.currency} href={href} state={backState}>
                      <span className="ui-pinv-share" aria-hidden="true">
                        <span style={{ inlineSize: `${String(sharePercent(line.minor, figures.rehabMinor))}%` }} />
                      </span>
                    </RehabLineRow>
                  </li>
                );
              })}
            </ul>
          )}
          {breakdown.left.length > 0 ? (
            <ul className="ui-pinv-left-list">
              {breakdown.left.map((line) => (
                <li key={line.key}>
                  <RehabLineRow line={line} currency={figures.currency} href={linesHref(line)} state={backState} left />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <Button variant="link" to={`/settings/categories${search}`} className="ui-pinv-settings-link">
        מה נספר בשיפוץ? בהגדרות הקטגוריות
      </Button>
    </Sheet>
  );
}

function RehabLineRow({
  line,
  currency,
  href,
  state,
  left = false,
  children,
}: {
  line: RehabLine;
  currency: string;
  href: string | undefined;
  state: CategoryBackState;
  left?: boolean;
  children?: ReactNode;
}) {
  const label = left ? `${line.name} · ${line.reason ?? "לא נספרים בשיפוץ"}` : line.name;
  const body = (
    <>
      <span className="ui-pinv-rehab-line">
        <span>{label}</span>
        <bdi dir="ltr" className="ui-num"><Amount agorot={line.minor} currency={currency} /></bdi>
      </span>
      {children}
    </>
  );
  return href == null ? <div className="ui-pinv-rehab-row">{body}</div> : (
    <Link to={href} state={state} className="ui-pinv-rehab-row">{body}</Link>
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

/** What each figure is, in one line under its name (the board's edit sheet). */
const FIELD_HELP: Record<InvestmentField, string> = {
  purchase: "המחיר ששולם על הנכס. לא כולל עלויות סגירה שכבר נרשמו כהוצאה.",
  arv: "כמה הנכס יהיה שווה כשהשיפוץ יסתיים. משמש לחישוב ההשבחה הצפויה.",
  value: "הערכה של שווי הנכס היום, למשל משמאות או מעסקאות דומות.",
};

export const EMPTY_HOLD = "הסכום ריק. כדי למחוק אותו, הקישו מחיקה.";

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
  minor: baseMinor,
  date: baseDate,
  onSave,
  returnFocusRef,
}: {
  field: InvestmentField;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      panelClassName="ui-sheet-wide ui-sheet-g14 ui-pinv-edit"
      onBeforeClose={guard}
      closeButton={false}
      action={(
        <div className="ui-pinv-actions">
          <Button full busy={busy} onClick={() => { void submit(); }}>
            שמירה
          </Button>
          {canClear ? (
            <Button variant="danger-link" disabled={busy} onClick={() => { void clear(); }}>
              מחיקה
            </Button>
          ) : null}
        </div>
      )}
    >
      <p className="ui-pinv-help">{FIELD_HELP[field]}</p>
      <MoneyField
        label="סכום"
        value={raw}
        prefix=""
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

