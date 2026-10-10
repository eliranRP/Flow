import { useRef, type RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { BasisSheet, type BasisChoice } from "../ui/basis-sheet";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite, type WriteFailure } from "../use-write";

export const BASIS_SAVED = "התאריך נשמר";
export const BASIS_FAILED = "התאריך לא נשמר";
export const BASIS_REFUSED = "רק בעל העסק משנה את התאריך.";
export const BASIS_UNDONE = "התאריך הוחזר";

/** Every P&L read counts by the company's basis (0170), the cash Home's months under "dashboard" too. */
const BASIS_KEYS = ["dashboard", "project", "project-category", "project-waiting", "profit-months", "breakdown", "breakdown-lines"];

function basisFailure(error: Error): WriteFailure {
  const code = (error as Error & { code?: string }).code;
  if (code === "42501") return { message: BASIS_REFUSED, retry: false };
  return BASIS_FAILED;
}

/** The P&L's "cash" is the company's "paid"; "invoiced" is "invoice" (decision 0170). */
async function setCompanyBasis(basis: BasisChoice): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  assertNoError(await supabase.rpc("set_cash_basis", { p_basis: basis === "cash" ? "paid" : "invoice" }));
}

type Change = { basis: BasisChoice; previous: BasisChoice };

/**
 * The company's date sheet with its write (FLOW-103). A change applies on tap, closes the sheet
 * and shows an undo toast; ביטול writes the previous basis back. Every P&L read refetches.
 */
export function CompanyBasisSheet({
  open,
  onOpenChange,
  basis,
  blocked,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basis: BasisChoice;
  /** Preview mode toasts and returns true. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const toast = useToast();
  const undo = useWrite<Change>({
    failure: basisFailure,
    success: BASIS_UNDONE,
    keys: BASIS_KEYS,
    run: async ({ previous }) => {
      await setCompanyBasis(previous);
    },
  });
  const closeSheet = useRef<() => void>(() => { onOpenChange(false); });
  const save = useWrite<Change>({
    failure: basisFailure,
    keys: BASIS_KEYS,
    onSuccess: (payload) => {
      closeSheet.current();
      toast.show({
        message: BASIS_SAVED,
        action: "ביטול",
        onAction: () => { undo.mutate(payload); },
      });
    },
    run: async (payload) => {
      await setCompanyBasis(payload.basis);
    },
  });
  return (
    <BasisSheet
      open={open}
      onOpenChange={onOpenChange}
      value={basis}
      saving={save.isPending ? save.variables.basis : null}
      returnFocusRef={returnFocusRef}
      onPick={(next, close) => {
        // An undo in flight still writes; a new pick would race it.
        if (save.isPending || undo.isPending || blocked()) return;
        closeSheet.current = close;
        save.mutate({ basis: next, previous: basis });
      }}
    />
  );
}
