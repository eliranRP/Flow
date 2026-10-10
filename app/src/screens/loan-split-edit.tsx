import { useQuery } from "@tanstack/react-query";
import type { RefObject } from "react";
import { useWrite } from "../use-write";
import { LOAN_WRITE_KEYS, loanSaveFailureText, useLoanMatchContext, type LoanChoice, type StoredSplit } from "./loan-match-api";
import { LoanSplitEditor, type LoanSplitSave } from "./loan-split-editor";

/**
 * FLOW-106 §3.4: "עריכת הפיצול" on a matched line opens the split editor on its stored parts, in
 * סכומים מדויקים, for the loan it is matched to. The save is one save_loan_split, as the parts
 * sheet's; a new fees category can be kept on the loan.
 */
export function MatchedSplitEditor({
  open,
  onOpenChange,
  transactionId,
  docDate,
  loan,
  stored,
  readOnly,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  docDate: string;
  /** The loan the line is matched to, from the match read. */
  loan: LoanChoice;
  /** The parts sheet's read of the stored parts. */
  stored: StoredSplit;
  readOnly: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { api } = useLoanMatchContext();
  const categories = useQuery({
    queryKey: ["categories", "loan-parts"],
    enabled: open && api.readCategories != null,
    retry: false,
    queryFn: () => (api.readCategories ?? (() => Promise.resolve([])))(),
  });
  const save = useWrite<LoanSplitSave>({
    failure: (error) => loanSaveFailureText(error),
    success: "הפיצול נשמר",
    keys: [...LOAN_WRITE_KEYS, "categories"],
    onSuccess: () => { onOpenChange(false); },
    run: async ({ loanId: saveLoanId, parts, keepFeesCategoryId }) => {
      if (readOnly) throw new Error("preview");
      if (keepFeesCategoryId != null) await api.setFeesCategory?.(saveLoanId, keepFeesCategoryId);
      await api.save(transactionId, saveLoanId, parts);
    },
  });
  return (
    <LoanSplitEditor
      open={open}
      onOpenChange={onOpenChange}
      loans={[loan]}
      payments={{}}
      line={{ transactionId, docDate, lineMinor: stored.lineMinor, currency: stored.loanCurrency ?? stored.currency }}
      categories={categories.data}
      saving={save.isPending}
      edit={{ parts: stored.parts }}
      returnFocusRef={returnFocusRef}
      onSave={(next) => {
        if (!save.isPending) save.mutate(next);
      }}
    />
  );
}
