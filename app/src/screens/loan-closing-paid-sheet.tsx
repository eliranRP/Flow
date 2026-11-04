import { parseDecimalHalfEven } from "@flow/shared";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { MoneyField } from "../ui/money-field";
import { Sheet } from "../ui/sheet";
import type { LoanDetail } from "./loan-detail-data";
import type { SheetSave } from "./loan-detail-sheets";
import { LOAN_CURRENCY_MARK, formatLoanMoney, minorToInput } from "./loan-form";

/**
 * FLOW-466 (decision 0250): what the loan paid at closing, from the settlement statement. A loan
 * paid out at closing adds this to the project's purchase price; empty is the whole principal (a
 * hard-money loan's renovation holdback is then counted in the price too). FLOW-472: the empty
 * field shows the principal as its placeholder, and the range is checked when the field loses focus.
 */

export const CLOSING_PAID_LABEL = "סכום ששולם בסגירה";
export const CLOSING_PAID_HINT = "מהטופס של הסגירה. ריק = כל ההלוואה";
export const CLOSING_PAID_WHOLE = "כל ההלוואה";

type Loan = Pick<LoanDetail, "principalMinor" | "closingPaidMinor" | "currency">;

/**
 * FLOW-473 (decision 0253): the row shows on a project's loan paid out at closing (Sub2), and on any
 * project loan that has an amount stored, so a value set before stays visible and can be cleared.
 */
export function showsClosingPaid(loan: Pick<LoanDetail, "projectId" | "closingPaidMinor">, paidAtClosing: boolean): boolean {
  return loan.projectId != null && (paidAtClosing || loan.closingPaidMinor != null);
}

/** The row's value: the amount, or "כל ההלוואה · $210,000" when none is set. */
export function closingPaidValue(loan: Loan): string {
  if (loan.closingPaidMinor == null) return `${CLOSING_PAID_WHOLE} · ${formatLoanMoney(loan.principalMinor, loan.currency)}`;
  return formatLoanMoney(loan.closingPaidMinor, loan.currency);
}

/** The empty field's placeholder: the principal without the currency mark, which is the field's prefix ("210,000"). */
export function closingPaidPlaceholder(loan: Loan): string {
  return formatLoanMoney(loan.principalMinor, loan.currency).replace(LOAN_CURRENCY_MARK[loan.currency], "");
}

/** "הסכום צריך להיות בין 0 ל־$210,000.": the field's own line, and the server's validation refusal. */
export function closingPaidRange(loan: Loan): string {
  return `הסכום צריך להיות בין 0 ל־${formatLoanMoney(loan.principalMinor, loan.currency)}.`;
}

/** What the field holds, as the RPC takes it: null when empty, else agorot/cents within the principal. */
export function closingPaidDraft(raw: string, loan: Loan): { ok: true; minor: bigint | null } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(/[\s,]/g, "");
  if (trimmed === "") return { ok: true, minor: null };
  let minor: bigint;
  try {
    minor = parseDecimalHalfEven(trimmed, 2);
  } catch {
    return { ok: false, message: closingPaidRange(loan) };
  }
  if (minor < 0n || minor > loan.principalMinor) return { ok: false, message: closingPaidRange(loan) };
  return { ok: true, minor };
}

/** The sheet's line for a server refusal that belongs in it (validation, 22023); null sends the rest to a toast. */
export function closingPaidRefusal(error: Error, loan: Loan): string | null {
  const code = (error as { code?: string }).code;
  return code === "22023" || error.message === "validation" ? closingPaidRange(loan) : null;
}

/** The toast after a save. */
export function closingPaidToast(minor: bigint | null, loan: Loan): string {
  return `${CLOSING_PAID_LABEL} · ${minor == null ? CLOSING_PAID_WHOLE : formatLoanMoney(minor, loan.currency)}`;
}

export function LoanClosingPaidSheet({
  loan,
  open,
  onOpenChange,
  onSave,
  returnFocusRef,
}: {
  loan: Loan & Pick<LoanDetail, "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: SheetSave<bigint | null>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setRaw(loan.closingPaidMinor == null ? "" : minorToInput(loan.closingPaidMinor));
    setError(null);
  }, [open, loan.closingPaidMinor]);

  async function submit() {
    if (busy) return;
    const draft = closingPaidDraft(raw, loan);
    if (!draft.ok) {
      setError(draft.message);
      return;
    }
    if (draft.minor === loan.closingPaidMinor) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setError(null);
    const failed = await onSave(draft.minor);
    setBusy(false);
    if (failed == null) onOpenChange(false);
    else setError(failed === "" ? null : failed);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title={CLOSING_PAID_LABEL}
      hint={loan.name}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-fit"
    >
      <form
        className="ui-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <MoneyField
          label="סכום"
          value={raw}
          prefix={LOAN_CURRENCY_MARK[loan.currency]}
          disabled={busy}
          enterKeyHint="done"
          reserveMessage
          placeholder={closingPaidPlaceholder(loan)}
          hint={CLOSING_PAID_HINT}
          error={error ?? undefined}
          onBlur={() => {
            // forms-and-requests § 4: a wrong amount says so when the field is left, not only on שמירה.
            const draft = closingPaidDraft(raw, loan);
            if (!draft.ok) setError(draft.message);
          }}
          onValueChange={(next) => {
            setRaw(next);
            setError(null);
          }}
        />
        <Button type="submit" full busy={busy}>שמירה</Button>
      </form>
    </Sheet>
  );
}
