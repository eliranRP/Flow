import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";

/** FLOW-1166: the label of the business page's read-only row; its value is the date as dd/mm/yyyy. */
export const BOOKS_CLOSED_LABEL = "הספרים סגורים עד";

/**
 * `companies.books_closed_through` of the company on screen (decision 0266, part 2a): null when the books are
 * open. A member reads it (the companies select policy); setting it stays with the assistant
 * (set_books_closed_through), so the app never writes it.
 */
export async function readBooksClosedThrough(companyId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const { data, error } = await supabase.from("companies").select("books_closed_through").eq("id", companyId).maybeSingle();
  if (error) throw new Error(error.message);
  const value: unknown = (data as { books_closed_through?: unknown } | null)?.books_closed_through;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** The read for the business page. A failed read shows no row, as an open book does. */
export function useBooksClosedThrough(companyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["books-closed", companyId],
    enabled: enabled && companyId != null,
    staleTime: 60_000,
    retry: false,
    queryFn: () => readBooksClosedThrough(companyId ?? ""),
  });
}
