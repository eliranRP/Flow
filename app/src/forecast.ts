import { formatAmountText, type ExpectedMonths, type MissingBill, type PaymentRecurring, type RecurringChange } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * Jev missing bills and expected months (FLOW-403, plan option A, decision 0131). Every figure
 * and date is the server's; the app never sums a total of its own.
 */

/** The project page shows this many months, the open one first (plan default 1). */

export function abs(minor: bigint): bigint {
  return minor < 0n ? -minor : minor;
}

/** The party's name: a customer's on income (decision 0175), else the supplier's. */
export function partyName(row: { party_name?: string | null; supplier_name: string }): string {
  // An empty party name falls back to the supplier's, then to ללא שם.
  const name = row.party_name != null && row.party_name !== "" ? row.party_name : row.supplier_name;
  return name === "" ? "ללא שם" : name;
}

/** The Home pending card's late rows: a count, never a total (plan default 3). Income reads תנועות. */
export function missingBillsTitle(count: number, income = false): string {
  if (income) return count === 1 ? "תנועה קבועה אחת לא הגיעה" : `${String(count)} תנועות קבועות לא הגיעו`;
  return count === 1 ? "חשבון אחד לא הגיע" : `${String(count)} חשבונות לא הגיעו`;
}

/** FLOW-415 (b-2): Home counts late bills and late income on their own rows. */
export function lateCounts(rows: readonly Pick<MissingBill, "direction">[]): { expense: number; income: number } {
  const income = rows.filter((row) => row.direction === "income").length;
  return { expense: rows.length - income, income };
}

export type ChargeChangeView = {
  id: string;
  /** "חשמל עלה" or "חשמל ירד" (the board words no percent; the row's hint carries the amounts). */
  title: string;
  /** A drop draws the down arrow. */
  down: boolean;
  /** "₪2,550" and "₪1,850", unsigned. */
  now: string;
  usual: string;
  /** The payment's page. */
  href: string;
};

/**
 * FLOW-415 (layout A): Home's rows for the recurring charges this month that are 20% or more off
 * their usual amount (`recurring_changes`). The server picks them and computes the percent; the app
 * only words it. No category falls back to the party's name.
 */
export function chargeChangeViews(rows: readonly RecurringChange[], search: string): ChargeChangeView[] {
  return rows.map((row) => {
    const name = row.category_name != null && row.category_name !== "" ? row.category_name : partyName(row);
    const percent = row.change_percent;
    return {
      id: row.transaction_id,
      title: `${name} ${percent < 0 ? "ירד" : "עלה"}`,
      down: percent < 0,
      now: formatAmountText(abs(row.amount_minor), row.currency),
      usual: formatAmountText(abs(row.typical_amount_minor), row.currency),
      href: `/transactions/${row.transaction_id}${search}`,
    };
  });
}

export function useMissingBillsQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["missing-bills", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<MissingBill[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("missing_bills", {});
      if (error) throw error;
      return (await loadReadSchemas()).missingBillsSchema.parse(data);
    },
  });
}

/** FLOW-415: Home's big changes. A failed read just hides the rows. */
export function useRecurringChangesQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["recurring-changes", preview],
    enabled: active && preview === "off",
    queryFn: async (): Promise<RecurringChange[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("recurring_changes", {});
      if (error) throw error;
      return (await loadReadSchemas()).recurringChangesSchema.parse(data);
    },
  });
}

/**
 * FLOW-441: one project's big changes, each measured on the project's own share of the payer's
 * lines (split parts counted), opening a line that is the project's. Under Home's key, so a hide
 * refreshes both. A failed read just hides the rows.
 */
export function useProjectRecurringChangesQuery(projectId: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["recurring-changes", preview, "project", projectId],
    enabled: active && preview === "off" && projectId !== "",
    queryFn: async (): Promise<RecurringChange[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("project_recurring_changes", { p_project: projectId });
      if (error) throw error;
      // Null: the project is not this company's.
      return data == null ? [] : (await loadReadSchemas()).recurringChangesSchema.parse(data);
    },
  });
}

/** FLOW-415: one payment's recurring switch. */
export function usePaymentRecurringQuery(transactionId: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["payment-recurring", preview, transactionId],
    enabled: active && preview === "off" && transactionId !== "",
    queryFn: async (): Promise<PaymentRecurring> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("payment_recurring", { p_id: transactionId });
      if (error) throw error;
      return (await loadReadSchemas()).paymentRecurringSchema.parse(data);
    },
  });
}

/**
 * FLOW-364: the company's open month (this month, still to come) with no project. Home's forecast
 * row reads its recurring money still due, and the server sums it.
 */
export function useCompanyExpectedQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["expected-months", preview, "company", 1],
    enabled: active && preview === "off",
    queryFn: async (): Promise<ExpectedMonths> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("expected_months", { p_months: 1 });
      if (error) throw error;
      return (await loadReadSchemas()).expectedMonthsSchema.parse(data);
    },
  });
}

/**
 * The open month's recurring money still due in one currency, as two positive amounts (0 when none).
 * The server sends an expense as a negative figure (recurring_pace.sql); forecastMinor takes it off.
 */
export function openMonthDue(data: ExpectedMonths | null | undefined, currency: string): { income: bigint; expense: bigint } {
  const row = data?.months.find((month) => month.open)?.by_currency.find((figure) => figure.currency === currency);
  const expense = row?.expense_minor ?? 0n;
  return { income: row?.income_minor ?? 0n, expense: expense < 0n ? -expense : expense };
}
