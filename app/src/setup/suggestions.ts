import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import type { SetupLender } from "./storage";

/** The get_setup_suggestions read (FLOW-514): project names and lenders from the bank lines. */
export type SetupSuggestions = { projects: string[]; lenders: SetupLender[] };

export const NO_SUGGESTIONS: SetupSuggestions = { projects: [], lenders: [] };

/** Parses the RPC's jsonb. Anything missing or malformed is no suggestion, so the block stays hidden. */
export function parseSuggestions(value: unknown): SetupSuggestions {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return NO_SUGGESTIONS;
  const row = value as Record<string, unknown>;
  const projects = Array.isArray(row.projects)
    ? row.projects.filter((name): name is string => typeof name === "string" && name.trim() !== "").map((name) => name.trim())
    : [];
  const lenders = Array.isArray(row.lenders)
    ? row.lenders.flatMap((item): SetupLender[] => {
      if (item == null || typeof item !== "object") return [];
      const lender = item as Record<string, unknown>;
      const name = typeof lender.name === "string" ? lender.name.trim() : "";
      const monthly = typeof lender.monthly_agorot === "number" && Number.isInteger(lender.monthly_agorot) ? lender.monthly_agorot : null;
      const since = typeof lender.since === "string" && lender.since !== "" ? lender.since : null;
      return name !== "" && monthly != null && since != null ? [{ name, monthly_agorot: monthly, since }] : [];
    })
    : [];
  return { projects, lenders };
}

async function readSuggestions(): Promise<SetupSuggestions> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.rpc !== "function") return NO_SUGGESTIONS;
  const { data, error } = await supabase.rpc("get_setup_suggestions");
  if (error) return NO_SUGGESTIONS;
  return parseSuggestions(data);
}

/** Steps 3 and 4 show the suggestions only with a bank connected (FLOW-514 §3). A failed read shows none. */
export function useSetupSuggestions(companyId: string | null, bankConnected: boolean): SetupSuggestions {
  const query = useQuery({
    queryKey: ["setup-suggestions", companyId],
    enabled: companyId != null && bankConnected,
    queryFn: readSuggestions,
    staleTime: 60_000,
    retry: false,
  });
  return query.data ?? NO_SUGGESTIONS;
}
