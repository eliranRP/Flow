import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-954 (decision 0208). One line's journal entry ("פקודת יומן"), from `get_line_journal`: its
 * legs, whether they balance, and whether an MCP write (Jev) booked it. Read only.
 */

const legSchema = z.object({
  ordinal: z.number().int(),
  account_id: z.string(),
  account_name: z.string(),
  account_type: z.enum(["income", "expense", "asset", "liability"]),
  system: z.boolean(),
  is_bank: z.boolean(),
  in_pnl: z.boolean(),
  /** The leg's own category, live (a kept-out leg on a system account names it too). */
  category_name: z.string().nullable(),
  project_name: z.string().nullable(),
  /** Signed: a debit is positive, a credit negative. */
  amount_minor: z.union([z.number(), z.string()]).transform((value) => BigInt(value)),
});

const journalSchema = z
  .object({
    currency: z.string(),
    legs: z.array(legSchema),
    balanced: z.boolean(),
    booked_by_ai: z.boolean(),
  })
  .nullable();

export type JournalLeg = z.infer<typeof legSchema>;
export type LineJournal = NonNullable<z.infer<typeof journalSchema>>;

export function parseLineJournal(data: unknown): LineJournal | null {
  return journalSchema.parse(data);
}

/** The words for an account type; the bank leg reads בנק. */
export function legTypeLabel(leg: Pick<JournalLeg, "account_type" | "is_bank">): string {
  if (leg.is_bank) return "בנק";
  switch (leg.account_type) {
    case "income":
      return "הכנסה";
    case "expense":
      return "הוצאה";
    case "asset":
      return "נכס";
    case "liability":
      return "התחייבות";
  }
}

/** Hebrew for the ledger's system accounts (decision 0208); a category account keeps its own name. */
const SYSTEM_NAMES: Record<string, string> = {
  "Loan principal": "קרן הלוואה",
  Escrow: "אסקרו",
  Property: "נדל״ן",
  "Transfers in transit": "העברות בדרך",
  "Owner capital": "השקעת בעלים",
  "Security deposit held": "פיקדון שהתקבל",
  Suspense: "חשבון מעבר",
  "VAT control": "מע״מ",
  "Uncategorized income": "הכנסה בלי קטגוריה",
  "Uncategorized expense": "הוצאה בלי קטגוריה",
};

/**
 * A leg's name: the bank account the line moved through; a system account in Hebrew, with the category that
 * posted there ("אסקרו · מסים וביטוח"); or the category.
 */
export function legName(leg: Pick<JournalLeg, "account_name" | "is_bank" | "system" | "category_name">, bankName: string | null): string {
  if (leg.is_bank) return bankName ?? "בנק";
  if (!leg.system) return leg.account_name;
  const account = SYSTEM_NAMES[leg.account_name] ?? leg.account_name;
  return leg.category_name != null && leg.category_name !== account ? `${account} · ${leg.category_name}` : account;
}

/** A leg kept out of profit: neither the bank nor an income or expense account. */
export function legKeptOut(leg: Pick<JournalLeg, "is_bank" | "in_pnl">): boolean {
  return !leg.is_bank && !leg.in_pnl;
}

/** The debits (חובה) and credits (זכות), each in ledger order, and what each side adds up to. */
export function journalSides(legs: readonly JournalLeg[]): { debit: JournalLeg[]; credit: JournalLeg[]; total: bigint } {
  const debit = legs.filter((leg) => leg.amount_minor > 0n);
  const credit = legs.filter((leg) => leg.amount_minor < 0n);
  const total = debit.reduce((sum, leg) => sum + leg.amount_minor, 0n);
  return { debit, credit, total };
}

/** `get_line_journal` for one line. A viewer reads it too. No read in preview or sample. */
export function useLineJournalQuery(transactionId: string, enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    // Under "txn", so every write that refreshes the line refreshes its legs.
    queryKey: ["txn", "journal", preview, transactionId],
    enabled: enabled && preview === "off" && transactionId !== "",
    retry: 1,
    queryFn: async (): Promise<LineJournal | null> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_line_journal", { p_transaction_id: transactionId });
      if (error) throw error;
      return parseLineJournal(data);
    },
  });
}
