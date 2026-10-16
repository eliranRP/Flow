import { useState } from "react";
import { getSupabase } from "../lib/supabase";
import { Sheet } from "../ui/sheet";
import { LoanSaveButton, LoanSetupForm } from "../screens/loan-setup";
import type { LoanCurrency } from "../screens/loan-form";
import { SETUP_ERROR_RETRY } from "./copy";

/**
 * FLOW-514 step 4 "+ הלוואה אחרת": where a new loan starts. Stand-in until FLOW-139: it opens today's
 * loan form in a sheet (NewLoanSheet). FLOW-139 swaps this for its sheet; saving returns to step 4.
 */
export function openNewLoan(open: () => void): void {
  open();
}

/** The stand-in sheet: today's LoanSetupForm, saved as a loans row for this company. */
export function NewLoanSheet({
  open,
  onOpenChange,
  companyId,
  currency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
  currency: LoanCurrency;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const formId = "setup-create-loan";
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="הלוואה אחרת" busy={busy}>
      <LoanSetupForm
        companyCurrency={currency}
        busy={busy}
        formId={formId}
        saveInFoot
        onSave={(row) => {
          if (busy || companyId == null) return;
          setBusy(true);
          setFailed(false);
          void (async () => {
            try {
              const supabase = getSupabase();
              if (!supabase) throw new Error("supabase");
              const { error } = await supabase.from("loans").insert({ ...row, company_id: companyId }).select("id").single();
              if (error) throw new Error(error.message);
              onSaved();
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
      {failed ? <p className="t-hint ui-setup-error" role="alert">{SETUP_ERROR_RETRY}</p> : null}
      <LoanSaveButton formId={formId} busy={busy} />
    </Sheet>
  );
}
