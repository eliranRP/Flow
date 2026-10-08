import { useRef, type RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { CurrencySheet, type CurrencyChoice } from "../ui/currency-sheet";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite, type WriteFailure } from "../use-write";

export const CURRENCY_SAVED = "מטבע העסק נשמר";
export const CURRENCY_FAILED = "מטבע העסק לא נשמר";
export const CURRENCY_REFUSED = "אין הרשאה לשנות את מטבע העסק.";
export const CURRENCY_UNDONE = "מטבע העסק הוחזר";

/** Everything that reads the company currency: its order, the empty row, the loan default. */
const CURRENCY_KEYS = ["company-currency", "loan-currency", "dashboard", "project", "profit-months", "breakdown"];

function currencyFailure(error: Error): WriteFailure {
  const code = (error as Error & { code?: string }).code;
  if (code === "42501") return { message: CURRENCY_REFUSED, retry: false };
  return CURRENCY_FAILED;
}

async function setCompanyCurrency(currency: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  assertNoError(await supabase.rpc("set_company_currency", { p_currency: currency }));
}

type Change = { currency: CurrencyChoice; previous: string };

/**
 * The company currency sheet with its write (FLOW-504, decision 0147). A change applies on tap,
 * closes the sheet and shows an undo toast; ביטול writes the previous currency back.
 */
export function CompanyCurrencySheet({
  open,
  onOpenChange,
  currency,
  blocked,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** Preview mode toasts and returns true. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const toast = useToast();
  const undo = useWrite<Change>({
    failure: currencyFailure,
    success: CURRENCY_UNDONE,
    keys: CURRENCY_KEYS,
    run: async ({ previous }) => {
      await setCompanyCurrency(previous);
    },
  });
  const saved = useRef<Change | null>(null);
  const save = useWrite<Change>({
    failure: currencyFailure,
    keys: CURRENCY_KEYS,
    // Also runs after a retry from the failure toast, so it reads the last payload.
    onSuccess: () => {
      const payload = saved.current;
      if (payload == null) return;
      onOpenChange(false);
      toast.show({
        message: CURRENCY_SAVED,
        action: "ביטול",
        onAction: () => { undo.mutate(payload); },
      });
    },
    run: async (payload) => {
      saved.current = payload;
      await setCompanyCurrency(payload.currency);
    },
  });
  return (
    <CurrencySheet
      open={open}
      onOpenChange={onOpenChange}
      value={currency}
      saving={save.isPending ? (saved.current?.currency ?? null) : null}
      returnFocusRef={returnFocusRef}
      onPick={(next) => {
        if (save.isPending || blocked()) return;
        save.mutate({ currency: next, previous: currency });
      }}
    />
  );
}
