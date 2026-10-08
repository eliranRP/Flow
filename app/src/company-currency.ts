import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";

/**
 * The stored company currency, `companies.base_currency` (0147), through the same RPC the MCP
 * loan default reads. A failed or odd read stays ILS.
 */
export async function readCompanyCurrency(): Promise<string> {
  return readStoredCurrency().catch(() => "ILS");
}

/** The same read, failing loudly, so Settings can tell a failure from a shekel company. */
async function readStoredCurrency(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const { data, error } = await supabase.rpc("mcp_company_loan_currency");
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !/^[A-Z]{3}$/.test(data)) throw new Error("validation");
  return data;
}

/**
 * The company's books currency (0147). An empty period has no currency of its own, so its zero
 * figures use this one: a USD company sees $0, not ₪0. Preview and a failed read stay ILS.
 */
export function useCompanyCurrency(): string {
  return useCompanyCurrencyQuery().data ?? "ILS";
}

/** The read itself, for Settings: its row waits for the stored value before it offers a change. */
export function useCompanyCurrencyQuery(enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["company-currency", preview],
    enabled: enabled && preview === "off",
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: readStoredCurrency,
  });
}
