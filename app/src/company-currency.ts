import { useQuery } from "@tanstack/react-query";
import { useHomePreview } from "./preview";
import { readCompanyLoanCurrency } from "./screens/loan-form";

/**
 * The company's books currency, read from its open lines (USD when every line is USD, else ILS).
 * An empty period has no currency of its own, so its zero figures use this one: a USD company sees
 * $0, not ₪0. Preview and a failed read stay ILS.
 */
export function useCompanyCurrency(): string {
  const preview = useHomePreview();
  const query = useQuery({
    queryKey: ["company-currency", preview],
    enabled: preview === "off",
    staleTime: 10 * 60_000,
    queryFn: readCompanyLoanCurrency,
  });
  return query.data ?? "ILS";
}
