import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";

/**
 * The stored company currency, `companies.base_currency` (0147), through the same RPC the MCP
 * loan default reads. A failed or odd read stays ILS.
 */
export async function readCompanyCurrency(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) return "ILS";
  const { data, error } = await supabase.rpc("mcp_company_loan_currency");
  if (error || typeof data !== "string" || !/^[A-Z]{3}$/.test(data)) return "ILS";
  return data;
}

/**
 * The company's books currency (0147). An empty period has no currency of its own, so its zero
 * figures use this one: a USD company sees $0, not ₪0. Preview and a failed read stay ILS.
 */
export function useCompanyCurrency(): string {
  const preview = useHomePreview();
  const query = useQuery({
    queryKey: ["company-currency", preview],
    enabled: preview === "off",
    staleTime: 10 * 60_000,
    queryFn: readCompanyCurrency,
  });
  return query.data ?? "ILS";
}
