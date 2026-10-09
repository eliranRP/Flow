import { useEffect, useId, useState, type ReactNode } from "react";
import { LOAN_TERM_MONTHS_MAX, type LoanKind, type LoanSplitPart, type LoanStatus } from "@flow/shared";
import { Button } from "../ui/button";
import { formatDisplay, israelToday } from "../ui/date-math";
import { DateSheet } from "../ui/date-sheet";
import { CalendarIcon } from "../ui/icons";
import { PercentField } from "../ui/money-field";
import { RadioRow } from "../ui/radio-row";
import { SearchField } from "../ui/search-field";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { LOAN_KIND_LABEL, LOAN_PART_LABEL, LOAN_STATUS_LABEL } from "./loan-copy";
import {
  LOAN_KIND_DESCRIPTION,
  FEES_NONE_DESC,
  kindMonthsDefault,
  kindPatch,
  partCategoryOptions,
  partDefaultLabel,
  rateInput,
  ratePpmOfInput,
  type LoanCategory,
  type LoanDetail,
  type LoanRateRow,
} from "./loan-detail-data";
import { formatLoanMoney } from "./loan-form";
import type { LoanPatch, LoanRateWrite } from "./loan-detail-store";

/**
 * A sheet's save: null when it saved, else the Hebrew to show inside the sheet. An empty string
 * is a failure the page already told in a toast (with ניסיון חוזר): the sheet stays open with
 * its values.
 */
export type SheetSave<T> = (value: T) => Promise<string | null>;

/** More rows than this get a search field (guide §7.12). */
const SEARCH_FROM = 8;

/**
 * מצב: פתוחה saves on tap; נפרעה and נסגרה open the date sheet, whose floor is the last attached
 * payment (plan §3.2). A refusal (loan_payments_after_close) stays in the date sheet.
 */
export function LoanStatusSheet({
  loan,
  open,
  onOpenChange,
  lastPayment,
  defaultDate,
  onSave,
  returnFocusRef,
}: {
  loan: Pick<LoanDetail, "name" | "status" | "closedOn">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The last attached payment's date: no close date before it. */
  lastPayment: string | null;
  defaultDate: string;
  onSave: SheetSave<{ status: LoanStatus; closedOn: string | null }>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [saving, setSaving] = useState<LoanStatus | null>(null);
  const [dateFor, setDateFor] = useState<Exclude<LoanStatus, "open"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const statuses: LoanStatus[] = ["open", "paid_off", "closed"];
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && saving != null) return;
          onOpenChange(next);
        }}
        title="מצב"
        hint={loan.name}
        returnFocusRef={returnFocusRef}
        panelClassName="ui-sheet-fit"
      >
        <div role="radiogroup" aria-label="מצב">
          {statuses.map((status) => (
            <RadioRow
              key={status}
              layout="picker"
              label={LOAN_STATUS_LABEL[status]}
              selected={loan.status === status}
              busy={saving === status}
              disabled={saving != null && saving !== status}
              onSelect={() => {
                if (saving != null) return;
                if (status === "open") {
                  if (loan.status === "open") {
                    onOpenChange(false);
                    return;
                  }
                  setSaving("open");
                  void onSave({ status: "open", closedOn: null }).then((failed) => {
                    setSaving(null);
                    if (failed == null) onOpenChange(false);
                  });
                  return;
                }
                setError(null);
                setDateFor(status);
              }}
            />
          ))}
        </div>
      </Sheet>
      <DateSheet
        open={open && dateFor != null}
        onOpenChange={(next) => {
          if (next) return;
          setDateFor(null);
          setError(null);
        }}
        title={dateFor === "closed" ? "תאריך סגירה" : "תאריך פירעון"}
        value={loan.status === dateFor && loan.closedOn != null ? loan.closedOn : defaultDate}
        min={lastPayment}
        shortcuts={false}
        applyLabel="החלה"
        busy={saving != null}
        error={error}
        reason={lastPayment == null ? undefined : (
          <>
            התשלום האחרון שויך ב־<bdi className="ui-num" dir="ltr">{formatDisplay(lastPayment)}</bdi>. אי אפשר לבחור יום לפניו.
          </>
        )}
        onApply={() => undefined}
        onApplyResult={async (iso) => {
          if (dateFor == null) return true;
          setSaving(dateFor);
          setError(null);
          const failed = await onSave({ status: dateFor, closedOn: iso });
          setSaving(null);
          if (failed != null) {
            setError(failed === "" ? null : failed);
            return false;
          }
          // Closing the status sheet pops the date sheet above it too (useSheetHistory).
          onOpenChange(false);
          return false;
        }}
      />
    </>
  );
}

/**
 * One part's category (plan §3.2): the keyed default (fees: no fixed category) first, then the
 * categories private.loan_part_category_ok allows. A tap saves (0075).
 */
export function LoanPartSheet({
  part,
  loan,
  categories,
  open,
  onOpenChange,
  onSave,
  returnFocusRef,
}: {
  part: LoanSplitPart | null;
  loan: Pick<LoanDetail, "categoryIds">;
  categories: readonly LoanCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: SheetSave<{ part: LoanSplitPart; categoryId: string | null }>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [saving, setSaving] = useState<{ id: string | null } | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setQuery("");
      setError(null);
    }
  }, [open, part]);
  if (part == null) return null;
  const current = loan.categoryIds[part];
  const options = partCategoryOptions(categories, part, current);
  const needle = query.trim();
  const searchable = options.length >= SEARCH_FROM;
  const shown = searchable && needle !== "" ? options.filter((row) => row.name.includes(needle)) : options;
  const choose = (id: string | null) => {
    if (saving != null) return;
    if (id === current) {
      onOpenChange(false);
      return;
    }
    setSaving({ id });
    setError(null);
    void onSave({ part, categoryId: id }).then((failed) => {
      setSaving(null);
      if (failed == null) onOpenChange(false);
      else setError(failed === "" ? null : failed);
    });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        onOpenChange(next);
      }}
      title={LOAN_PART_LABEL[part]}
      hint="תשלומים שכבר שויכו נשארים בקטגוריה שלהם."
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-fit"
    >
      <div className="ui-change-picker">
        {searchable ? (
          <SearchField label="חיפוש קטגוריה" value={query} onChange={setQuery} placeholder="חיפוש קטגוריה" autoFocus={false} />
        ) : null}
        <div role="radiogroup" aria-label={LOAN_PART_LABEL[part]}>
          <RadioRow
            layout="picker"
            label={partDefaultLabel(categories, part)}
            description={part === "fees" ? FEES_NONE_DESC : undefined}
            selected={current == null}
            busy={saving != null && saving.id == null}
            disabled={saving != null && saving.id != null}
            onSelect={() => { choose(null); }}
          />
          {shown.map((row) => (
            <RadioRow
              key={row.id}
              layout="picker"
              label={row.name}
              description={part === "fees" && row.excludedFromPnl ? "מחוץ לרווח והפסד" : undefined}
              selected={row.id === current}
              busy={saving?.id === row.id}
              disabled={saving != null && saving.id !== row.id}
              onSelect={() => { choose(row.id); }}
            />
          ))}
        </div>
        {searchable && needle !== "" && shown.length === 0 ? <p className="t-hint">לא נמצאה קטגוריה בשם הזה</p> : null}
        {error ? <p className="ui-field-message ui-loan-sheet-error" role="alert">{error}</p> : null}
      </div>
    </Sheet>
  );
}

/**
 * קביעת ריבית / שינוי ריבית (plan §3.2): a date from the loan's start and a percent with up to
 * 4 decimals (0 allowed). An existing row adds "הסרת השינוי".
 */
export function LoanRateSheet({
  loan,
  rate,
  open,
  onOpenChange,
  onSave,
  onRemove,
  returnFocusRef,
}: {
  loan: Pick<LoanDetail, "name" | "startDate" | "annualRatePpm" | "currency">;
  /** The row being changed; null adds one. */
  rate: LoanRateRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: SheetSave<LoanRateWrite>;
  onRemove: SheetSave<LoanRateRow>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const dateLabelId = useId();
  const dateValueId = useId();
  const today = israelToday();
  const start = loan.startDate;
  const initialDate = rate?.effectiveDate ?? (today < start ? start : today);
  const [date, setDate] = useState(initialDate);
  const [percent, setPercent] = useState(rate ? rateInput(rate.annualRatePpm) : "");
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<{ field: "date" | "rate" | "form"; text: string } | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDate(rate?.effectiveDate ?? (today < start ? start : today));
    setPercent(rate ? rateInput(rate.annualRatePpm) : "");
    setError(null);
    setChecked(false);
  }, [open, rate, start, today]);
  const ppm = ratePpmOfInput(percent);
  const dateBefore = date < start;
  const rateError = checked && ppm == null ? (percent.trim().startsWith("-") ? "הריבית שלילית." : percent.trim() === "" ? "חסרה ריבית." : "הריבית היא עד 100%.") : undefined;
  const dateError = dateBefore ? `התאריך לפני תחילת ההלוואה (${formatDisplay(start)}).` : error?.field === "date" ? error.text : undefined;
  async function save() {
    setChecked(true);
    if (busy != null || ppm == null || dateBefore) return;
    setBusy("save");
    setError(null);
    const failed = await onSave({ ...(rate ? { id: rate.id } : {}), effectiveDate: date, annualRatePpm: ppm });
    setBusy(null);
    if (failed == null) onOpenChange(false);
    else if (failed !== "") setError({ field: failed.includes("תחילת ההלוואה") ? "date" : "form", text: failed });
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy != null) return;
        onOpenChange(next);
      }}
      title={rate ? "שינוי ריבית" : "קביעת ריבית"}
      hint={loan.name}
      returnFocusRef={returnFocusRef}
    >
      <form
        className="ui-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className={dateError ? "ui-field ui-field-error" : "ui-field"}>
          <span id={dateLabelId} className="ui-field-label">מתאריך</span>
          <button
            type="button"
            className="ui-field-control ui-date-field"
            aria-labelledby={`${dateLabelId} ${dateValueId}`}
            aria-haspopup="dialog"
            disabled={busy != null}
            onClick={() => { setDateOpen(true); }}
          >
            <bdi id={dateValueId} className="ui-num" dir="ltr">{formatDisplay(date)}</bdi>
            <CalendarIcon size={20} />
          </button>
          <span className="ui-field-message ui-field-message-slot" role={dateError ? "alert" : undefined}>{dateError ?? ""}</span>
        </div>
        <PercentField
          label="ריבית שנתית"
          value={percent}
          decimals={4}
          keepMinus
          reserveMessage
          enterKeyHint="done"
          disabled={busy != null}
          error={rateError}
          onValueChange={setPercent}
        />
        <p className="t-hint">מהתאריך הזה החישוב לפי הריבית החדשה. תשלומים שכבר שויכו לא משתנים.</p>
        {error?.field === "form" ? <p className="ui-field-message ui-loan-sheet-error" role="alert">{error.text}</p> : null}
        <Button type="submit" full busy={busy === "save"} disabled={busy === "remove"}>שמירה</Button>
        {rate ? (
          <div className="ui-loan-sheet-quiet">
            <TextLink
              tone="quiet"
              chevron={false}
              className="ui-text-link-bad"
              busy={busy === "remove"}
              disabled={busy === "save"}
              onClick={() => {
                if (busy != null) return;
                setBusy("remove");
                setError(null);
                void onRemove(rate).then((failed) => {
                  setBusy(null);
                  if (failed == null) onOpenChange(false);
                  else if (failed !== "") setError({ field: "form", text: failed });
                });
              }}
            >
              הסרת השינוי
            </TextLink>
          </div>
        ) : null}
      </form>
      <DateSheet
        open={dateOpen}
        onOpenChange={setDateOpen}
        title="מתאריך"
        value={date}
        min={start}
        allowFuture
        shortcuts={false}
        onApply={(iso) => {
          setDate(iso);
          setError(null);
        }}
      />
    </Sheet>
  );
}

/**
 * סוג (plan §3.2): a multi-field form, so it has שמירה. Each kind has a one-line description;
 * interest-only and balloon add their months. A demand loan has no term to come back to, so
 * the other kinds are off for it.
 */
export function LoanKindSheet({
  loan,
  open,
  onOpenChange,
  onSave,
  returnFocusRef,
}: {
  loan: LoanDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: SheetSave<LoanPatch>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [kind, setKind] = useState<LoanKind>(loan.kind);
  const [months, setMonths] = useState(kindMonthsDefault(loan, loan.kind));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKind(loan.kind);
    setMonths(kindMonthsDefault(loan, loan.kind));
    setError(null);
    setChecked(false);
  }, [open, loan]);
  const result = kindPatch(loan, { kind, months });
  const term = loan.termMonths ?? 0;
  const monthsLabel = kind === "interest_only" ? "חודשי ריבית בלבד" : "פריסה לחישוב התשלום (חודשים)";
  const monthsHint = kind === "interest_only" ? `בין 1 ל־${String(term)}` : `בין ${String(term)} ל־${String(LOAN_TERM_MONTHS_MAX)}`;
  const monthsError = checked && !result.ok && result.error === "months" ? monthsHint : undefined;
  const preview: ReactNode = result.ok && result.patch.payment_minor != null && kind !== loan.kind
    ? <>תשלום חודשי <bdi className="ui-num" dir="ltr">{formatLoanMoney(BigInt(result.patch.payment_minor), loan.currency)}</bdi></>
    : null;
  async function save() {
    setChecked(true);
    if (busy || !result.ok) return;
    if (kind === loan.kind && (kind === "amortizing" || kind === "demand" || months === kindMonthsDefault(loan, kind))) {
      onOpenChange(false);
      return;
    }
    const patch = result.patch;
    setBusy(true);
    setError(null);
    const failed = await onSave({
      kind: patch.kind,
      interestOnlyMonths: patch.interest_only_months,
      amortizationMonths: patch.amortization_months,
      termMonths: patch.term_months,
      paymentMinor: patch.payment_minor == null ? null : BigInt(patch.payment_minor),
      escrowMinor: BigInt(patch.escrow_minor),
    });
    setBusy(false);
    if (failed == null) onOpenChange(false);
    else setError(failed === "" ? null : failed);
  }
  const kinds: LoanKind[] = ["amortizing", "interest_only", "balloon", "demand"];
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title="סוג ההלוואה"
      hint={loan.name}
      returnFocusRef={returnFocusRef}
    >
      <form
        className="ui-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div role="radiogroup" aria-label="סוג ההלוואה">
          {kinds.map((option) => (
            <RadioRow
              key={option}
              label={LOAN_KIND_LABEL[option]}
              description={LOAN_KIND_DESCRIPTION[option]}
              disabledReason={loan.kind === "demand" && option !== "demand" ? "להלוואה לפי דרישה אין תקופה" : undefined}
              disabled={busy}
              selected={kind === option}
              onSelect={() => {
                setKind(option);
                setMonths(kindMonthsDefault(loan, option));
                setChecked(false);
                setError(null);
              }}
            />
          ))}
        </div>
        {kind === "interest_only" || kind === "balloon" ? (
          <TextField
            label={monthsLabel}
            value={months}
            dir="ltr"
            inputMode="numeric"
            numeric
            reserveMessage
            disabled={busy}
            error={monthsError}
            onChange={(event) => { setMonths(event.target.value.replace(/\D/g, "").slice(0, 3)); }}
          />
        ) : null}
        {kind === "demand" && loan.kind !== "demand" ? (
          <p className="t-hint ui-loan-caution">לפי דרישה: בלי תקופה, בלי תשלום קבוע ובלי מסים וביטוח.</p>
        ) : null}
        {preview ? <p aria-live="polite">{preview}</p> : null}
        <p className="t-hint">תשלומים שכבר שויכו לא משתנים.</p>
        {error ? <p className="ui-field-message ui-loan-sheet-error" role="alert">{error}</p> : null}
        <Button type="submit" full busy={busy}>שמירה</Button>
      </form>
    </Sheet>
  );
}
