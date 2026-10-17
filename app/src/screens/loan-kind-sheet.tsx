import { useEffect, useState } from "react";
import { LOAN_TERM_MONTHS_MAX, type LoanKind } from "@flow/shared";
import { Button } from "../ui/button";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { LOAN_KIND_LABEL } from "./loan-copy";
import { LOAN_KIND_DESCRIPTION, kindMonthsDefault, kindPatch, type LoanDetail } from "./loan-detail-data";
import type { SheetSave } from "./loan-detail-sheets";
import { formatLoanMoney } from "./loan-form";
import type { LoanPatch } from "./loan-detail-store";

const KINDS: LoanKind[] = ["amortizing", "interest_only", "balloon", "demand"];

/**
 * סוג, the board's pick list (FLOW-139d). Regular and demand save on the tap. Interest-only and
 * balloon need their months, so they open a months step in the same sheet with its own שמירה.
 * A demand loan has no term to come back to, so the other kinds are off for it.
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
  // The months step shows once an interest-only or balloon kind is picked (or the stored one is tapped again).
  const [stepOpen, setStepOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKind(loan.kind);
    setMonths(kindMonthsDefault(loan, loan.kind));
    setStepOpen(false);
    setError(null);
    setChecked(false);
  }, [open, loan]);
  const result = kindPatch(loan, { kind, months });
  const term = loan.termMonths ?? 0;
  const monthsHint = kind === "interest_only" ? `בין 1 ל־${String(term)}` : `בין ${String(term)} ל־${String(LOAN_TERM_MONTHS_MAX)}`;
  const monthsError = checked && !result.ok && result.error === "months" ? monthsHint : undefined;
  const preview = result.ok && result.patch.payment_minor != null && kind !== loan.kind
    ? <>תשלום חודשי <bdi className="ui-num" dir="ltr">{formatLoanMoney(BigInt(result.patch.payment_minor), loan.currency)}</bdi></>
    : null;

  async function commit(nextKind: LoanKind, nextMonths: string) {
    setChecked(true);
    if (busy) return;
    const next = kindPatch(loan, { kind: nextKind, months: nextMonths });
    if (!next.ok) return;
    if (nextKind === loan.kind && (nextKind === "amortizing" || nextKind === "demand" || nextMonths === kindMonthsDefault(loan, nextKind))) {
      onOpenChange(false);
      return;
    }
    const patch = next.patch;
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

  function pick(option: LoanKind) {
    if (busy) return;
    setChecked(false);
    setError(null);
    if (option === "amortizing" || option === "demand") {
      setKind(option);
      setMonths("");
      setStepOpen(false);
      void commit(option, "");
      return;
    }
    if (option !== kind) {
      setKind(option);
      setMonths(kindMonthsDefault(loan, option));
    }
    setStepOpen(true);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title="סוג ההלוואה"
      panelClassName="ui-sheet-choice ui-sheet-g8 ui-sheet-wide ui-loan-kind"
      returnFocusRef={returnFocusRef}
    >
      <div role="radiogroup" aria-label="סוג ההלוואה" className="ui-choice-sheet ui-loan-kinds">
        {KINDS.map((option) => (
          <RadioRow
            key={option}
            label={LOAN_KIND_LABEL[option]}
            description={LOAN_KIND_DESCRIPTION[option]}
            disabledReason={loan.kind === "demand" && option !== "demand" ? "להלוואה לפי דרישה אין תקופה" : undefined}
            disabled={busy}
            selected={kind === option}
            onSelect={() => { pick(option); }}
          />
        ))}
      </div>
      {stepOpen ? (
        <form
          className="ui-stack ui-loan-kind-step"
          onSubmit={(event) => {
            event.preventDefault();
            void commit(kind, months);
          }}
        >
          <TextField
            label={kind === "interest_only" ? "חודשי ריבית בלבד" : "פריסה לחישוב התשלום (חודשים)"}
            value={months}
            dir="ltr"
            inputMode="numeric"
            numeric
            reserveMessage
            disabled={busy}
            hint={kind === "interest_only" ? "אחריהם הקרן נפרסת על שאר התקופה" : "היתרה בסוף התקופה תשולם בתשלום אחד"}
            error={monthsError}
            onChange={(event) => { setMonths(event.target.value.replace(/\D/g, "").slice(0, 3)); }}
          />
          {preview ? <p aria-live="polite">{preview}</p> : null}
          <p className="t-hint">תשלומים שכבר שויכו לא משתנים.</p>
          {error ? <p className="ui-field-message ui-loan-sheet-error" role="alert">{error}</p> : null}
          <Button type="submit" full busy={busy}>שמירה</Button>
        </form>
      ) : null}
      {error && !stepOpen ? <p className="ui-field-message ui-loan-sheet-error" role="alert">{error}</p> : null}
    </Sheet>
  );
}
