import { useId, type ReactNode, type Ref } from "react";
import { ChevronIcon } from "../ui/icons";
import type { LoanCurrency } from "./loan-form";

/** The new-loan sheet's block captions (board: 15/500, secondary). */
export function LoanSectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={className ? `ui-loan-section-title ${className}` : "ui-loan-section-title"}>{children}</p>;
}

/** A 52px pick row (פרויקט, סוג): a label over the value, and the back chevron at the end. Opens a picker view in the sheet. */
export function LoanPickRow({
  label,
  value,
  empty = false,
  buttonRef,
  disabled = false,
  onOpen,
}: {
  label: string;
  value: string;
  empty?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const labelId = useId();
  const valueId = useId();
  return (
    <button
      type="button"
      ref={buttonRef}
      className="ui-loan-pick"
      aria-haspopup="dialog"
      aria-labelledby={`${labelId} ${valueId}`}
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="ui-loan-pick-text">
        <span id={labelId} className="ui-loan-pick-label">{label}</span>
        <span id={valueId} className="ui-loan-pick-value" data-empty={empty ? "true" : "false"} data-clip-ok="">{value}</span>
      </span>
      <ChevronIcon size={18} />
    </button>
  );
}

const CURRENCY_OPTIONS: Array<{ value: LoanCurrency; label: string }> = [
  { value: "ILS", label: "₪" },
  { value: "USD", label: "$" },
];

/** The $ / ₪ switch inside the amount field (board: radiogroup at the field's end, 36px segments). */
export function LoanCurrencySwitch({ value, disabled, onChange }: { value: LoanCurrency; disabled: boolean; onChange: (next: LoanCurrency) => void }) {
  return (
    <span role="radiogroup" aria-label="מטבע" className="ui-loan-currency">
      {CURRENCY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="ui-loan-currency-btn"
          disabled={disabled}
          onClick={() => { onChange(option.value); }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/**
 * The live payment card (board: accent tint, 16px radius). Row 1 is the payment and its total,
 * row 2 the split, row 3 the last due date and שינוי. `children` is the override field, under row 3.
 */
export function LoanPaymentCard({
  label,
  total,
  split,
  until,
  note,
  expanded,
  controls,
  disabled,
  changeable = true,
  onToggle,
  children,
}: {
  label: string;
  total: string;
  split: string;
  until: string;
  /** The final-payment caution line: one more line in the card. */
  note?: { text: string; caution: boolean } | null;
  expanded: boolean;
  controls: string;
  disabled: boolean;
  /** A demand loan has no payment to override: no שינוי. */
  changeable?: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="ui-loan-pay">
      <div aria-live="polite" className="ui-loan-pay-live">
        <div className="ui-loan-pay-head">
          <span className="ui-loan-pay-label">{label}</span>
          <bdi className="ui-loan-pay-total ui-num" dir="ltr">{total}</bdi>
        </div>
        {split ? <span className="ui-loan-pay-split">{split}</span> : null}
        {note ? <span className={note.caution ? "ui-loan-pay-split ui-loan-caution" : "ui-loan-pay-split"}>{note.text}</span> : null}
      </div>
      <div className="ui-loan-pay-foot">
        <span className="ui-loan-pay-split">{until}</span>
        {changeable ? (
          <button type="button" className="ui-loan-pay-change" aria-expanded={expanded} aria-controls={controls} disabled={disabled} onClick={onToggle}>
            שינוי
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}
