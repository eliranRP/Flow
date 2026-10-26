import { useEffect, useId, useState, type ReactNode } from "react";
import type { LoanStatus } from "@flow/shared";
import { Button } from "../ui/button";
import { formatDisplay } from "../ui/date-math";
import { DateSheet } from "../ui/date-sheet";
import { CalendarIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { LOAN_CLOSE_REASON, LOAN_CLOSE_REASON_HINT, loanCloseLine, type LoanCloseReason } from "./loan-copy";
import type { SheetSave } from "./loan-detail-sheets";

/**
 * FLOW-962 (board Loan close): סגירת ההלוואה, for a loan that ends before its term. Why it closed
 * (נפרעה במלואה is paid_off, מימון מחדש is closed), the day (from the last attached payment on), and
 * one line on what follows. The loan still closes by itself when its balance reaches 0.
 */
export function LoanCloseSheet({
  loanName,
  open,
  onOpenChange,
  lastPayment,
  defaultDate,
  today,
  nextDue,
  onSave,
  returnFocusRef,
}: {
  loanName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The last attached payment's date: no close date before it. */
  lastPayment: string | null;
  defaultDate: string;
  today: string;
  /** The next scheduled payment, which leaves the forecast. Null when none is due. */
  nextDue: string | null;
  onSave: SheetSave<{ status: Exclude<LoanStatus, "open">; closedOn: string }>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [reason, setReason] = useState<LoanCloseReason>("paid_off");
  const [date, setDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setReason("paid_off");
    setDate(defaultDate);
    setError(null);
  }, [open, defaultDate]);
  const reasons: LoanCloseReason[] = ["paid_off", "closed"];
  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const failed = await onSave({ status: reason, closedOn: date });
    setSaving(false);
    if (failed == null) onOpenChange(false);
    else if (failed !== "") setError(failed);
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title={`סגירת ${loanName}`}
      returnFocusRef={returnFocusRef}
    >
      <div className="ui-stack ui-loan-close">
        <p className="ui-loan-sheet-head" id="loan-close-why">למה נסגרת?</p>
        <div role="radiogroup" aria-labelledby="loan-close-why">
          {reasons.map((item) => (
            <ListRow control="radio"
              key={item}
              layout="picker"
              title={LOAN_CLOSE_REASON[item]}
              description={LOAN_CLOSE_REASON_HINT[item]}
              selected={reason === item}
              disabled={saving}
              onSelect={() => { setReason(item); }}
            />
          ))}
        </div>
        <LoanDateField
          label="תאריך הסגירה"
          value={date}
          min={lastPayment}
          max={today}
          disabled={saving}
          error={error ?? undefined}
          reason={lastPayment == null ? undefined : (
            <>
              התשלום האחרון שויך ב־<bdi className="ui-num" dir="ltr">{formatDisplay(lastPayment)}</bdi>. אי אפשר לבחור יום לפניו.
            </>
          )}
          onChange={(iso) => {
            setDate(iso);
            setError(null);
          }}
        />
        <p className="ui-loan-sheet-line">{loanCloseLine(reason, nextDue)}</p>
        <Button full busy={saving} onClick={() => { void save(); }}>סגירת ההלוואה</Button>
      </div>
    </Sheet>
  );
}

/** A date as a field that opens the date sheet: the label, DD/MM/YYYY and a calendar mark, with its message line. */
export function LoanDateField({
  label,
  value,
  min,
  max,
  allowFuture = false,
  disabled,
  error,
  reason,
  onChange,
}: {
  label: string;
  value: string;
  min?: string | null;
  max?: string | null;
  allowFuture?: boolean;
  disabled?: boolean;
  error?: string;
  /** Under the date sheet's title: why some days are off. */
  reason?: ReactNode;
  onChange: (iso: string) => void;
}) {
  const labelId = useId();
  const valueId = useId();
  const [dateOpen, setDateOpen] = useState(false);
  return (
    <div className={error ? "ui-field ui-field-error" : "ui-field"}>
      <span id={labelId} className="ui-field-label">{label}</span>
      <button
        type="button"
        className="ui-field-control ui-date-field"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => { setDateOpen(true); }}
      >
        <bdi id={valueId} className="ui-num" dir="ltr">{formatDisplay(value)}</bdi>
        <CalendarIcon size={20} />
      </button>
      <span className="ui-field-message ui-field-message-slot" role={error ? "alert" : undefined}>{error ?? ""}</span>
      <DateSheet
        open={dateOpen}
        onOpenChange={setDateOpen}
        title={label}
        value={value}
        min={min ?? undefined}
        max={max ?? undefined}
        allowFuture={allowFuture}
        shortcuts={false}
        reason={reason}
        onApply={onChange}
      />
    </div>
  );
}
