import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { type HomePreview, useHomePreview } from "./preview";
import { saveCompanyCurrency, savedCompanyCurrency } from "./project-cache";

/**
 * The stored company currency, `companies.base_currency` (0147), through the same RPC the MCP
 * loan default reads. A failed or odd read stays ILS.
 */
export async function readCompanyCurrency(): Promise<string> {
  return readStoredCurrency().catch(() => "ILS");
}

/** The same read, failing loudly, so Settings and the forecast can tell a failure from a shekel company. */
export async function readStoredCurrency(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const { data, error } = await supabase.rpc("mcp_company_loan_currency");
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !/^[A-Z]{3}$/.test(data)) throw new Error("validation");
  saveCompanyCurrency(data);
  return data;
}

/**
 * The company's books currency (0147). An empty period has no currency of its own, so its zero
 * figures use this one: a USD company sees $0, not ₪0. Preview and a failed read stay ILS.
 */
export function useCompanyCurrency(): string {
  return useCompanyCurrencyQuery().data ?? "ILS";
}

/** The query's key and read, shared with the month forecast (FLOW-1253) so a cold Home sends one request. */
export function companyCurrencyQueryOptions(preview: HomePreview) {
  return {
    queryKey: ["company-currency", preview] as const,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: readStoredCurrency,
  };
}

/** The read itself, for Settings: its row waits for the stored value before it offers a change. */
export function useCompanyCurrencyQuery(enabled = true) {
  const preview = useHomePreview();
  // Read from storage only when the query is created, once for the value and its date.
  let stored: { value: ReturnType<typeof savedCompanyCurrency> } | null = null;
  const saved = () => {
    stored ??= { value: preview === "off" ? savedCompanyCurrency() : null };
    return stored.value;
  };
  return useQuery({
    ...companyCurrencyQueryOptions(preview),
    enabled: enabled && preview === "off",
    // FLOW-804: the last read saved on the phone, dated, so a new visit's first screen has it at
    // once and reads it again behind the page.
    initialData: () => saved()?.value,
    initialDataUpdatedAt: () => saved()?.at,
  });
}
