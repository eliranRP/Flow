import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flow/shared";
import { assertNoError } from "../use-write";

/** The company's loan balances, by loan id. A loan with no row yet has none here. */
export async function readLoanBalances(supabase: SupabaseClient<Database>, companyId: string) {
  const balances = await supabase.from("loan_balances").select("loan_id, balance_minor, flagged_parts, currency").eq("company_id", companyId);
  assertNoError(balances);
  return new Map((balances.data ?? []).map((row) => [row.loan_id, row]));
}

/** The company's project names, by project id: read beside the loans, not after them, for the projects they sit on. */
export async function readProjectNames(supabase: SupabaseClient<Database>, companyId: string) {
  const projects = await supabase.from("projects").select("id, name").eq("company_id", companyId);
  assertNoError(projects);
  return new Map((projects.data ?? []).map((project) => [project.id, project.name]));
}
