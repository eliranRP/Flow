import { useEffect, useId, useState, type ReactNode } from "react";
import type { LoanStatus } from "@flow/shared";
import { Button } from "../ui/button";
import { formatDisplay } from "../ui/date-math";
import { DateSheet } from "../ui/date-sheet";
import { CalendarIcon, ChevronIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { LOAN_CLOSE_REASON, LOAN_CLOSE_REASON_HINT, loanCloseLine, type LoanCloseReason } from "./loan-copy";
import type { SheetSave } from "./loan-detail-sheets";

/** Another loan of the company, as the link picker lists it. */
export type LoanLinkChoice = { id: string; name: string };

/** ההלוואה החדשה: בלי קישור first, then the company's other loans. A tap picks. */
export function LoanLinkPicker({ choices, selectedId, disabled = false, onSelect }: {
  choices: readonly LoanLinkChoice[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div role="radiogroup" aria-label="ההלוואה החדשה">
      <ListRow control="radio" layout="picker" title="בלי קישור" selected={selectedId == null} disabled={disabled} onSelect={() => { onSelect(null); }} />
      {choices.map((choice) => (
        <ListRow control="radio"
          key={choice.id}
          layout="picker"
          title={choice.name}
          selected={selectedId === choice.id}
          disabled={disabled}
          onSelect={() => { onSelect(choice.id); }}
        />
      ))}
      {choices.length === 0 ? <p className="ui-loan-sheet-line">אין עוד הלוואות. אפשר להוסיף את החדשה ברשימת ההלוואות ולקשר אותה מכאן אחר כך.</p> : null}
    </div>
  );
}

/**
 * FLOW-962 (board Loan close): סגירת ההלוואה, for a loan that ends before its term. Why it closed
 * (נפרעה במלואה is paid_off, מימון מחדש is closed), the day (from the last attached payment on), for a
 * refinance the new loan if it is in Flow (the picker takes the sheet's place, one sheet at a time),
 * and one line on what follows.
 */
export function LoanCloseSheet({
  loanName,
  open,
  onOpenChange,
  lastPayment,
  defaultDate,
  today,
  nextDue,
  linkChoices,
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
  /** The company's other loans, for a refinance's link. */
  linkChoices: readonly LoanLinkChoice[];
  onSave: SheetSave<{ status: Exclude<LoanStatus, "open">; closedOn: string; refinancedIntoId: string | null }>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [reason, setReason] = useState<LoanCloseReason>("paid_off");
  const [date, setDate] = useState(defaultDate);
  const [link, setLink] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setReason("paid_off");
    setDate(defaultDate);
    setLink(null);
    setPicking(false);
    setError(null);
  }, [open, defaultDate]);
  const reasons: LoanCloseReason[] = ["paid_off", "closed"];
  const linkName = link == null ? null : (linkChoices.find((choice) => choice.id === link)?.name ?? null);
  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const failed = await onSave({ status: reason, closedOn: date, refinancedIntoId: reason === "closed" ? link : null });
    setSaving(false);
    if (failed == null) onOpenChange(false);
    else if (failed !== "") setError(failed);
  }
  if (picking) {
    return (
      <Sheet open={open} onOpenChange={(next) => { if (!next) setPicking(false); }} title="ההלוואה החדשה" returnFocusRef={returnFocusRef} panelClassName="ui-sheet-fit">
        <LoanLinkPicker choices={linkChoices} selectedId={link} onSelect={(id) => { setLink(id); setPicking(false); }} />
      </Sheet>
    );
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
          // Never after today. A payment dated after today leaves no floor here; the save says why.
          min={lastPayment != null && lastPayment <= today ? lastPayment : null}
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
        {reason === "closed" ? (
          <button type="button" className="ui-field-control ui-loan-link-field" disabled={saving} onClick={() => { setPicking(true); }}>
            <span className="ui-loan-link-text">
              <span className="ui-field-label">ההלוואה החדשה · לא חובה</span>
              <span>{linkName ?? "בלי קישור"}</span>
            </span>
            <ChevronIcon size={18} />
          </button>
        ) : null}
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
