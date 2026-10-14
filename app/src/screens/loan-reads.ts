import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flow/shared";
import { assertNoError } from "../use-write";

/** The company's loan balances, by loan id. A loan with no row yet has none here. */
export async function readLoanBalances(supabase: SupabaseClient<Database>, companyId: string) {
  const balances = await supabase.from("loan_balances").select("loan_id, balance_minor, flagged_parts, currency").eq("company_id", companyId);
  assertNoError(balances);
  return new Map((balances.data ?? []).map((row) => [row.loan_id, row]));
}

/** The names of the projects these loans sit on, by project id. */
export async function readProjectNames(supabase: SupabaseClient<Database>, loans: ReadonlyArray<{ project_id: string | null }>) {
  const projectIds = [...new Set(loans.flatMap((loan) => (loan.project_id == null ? [] : [loan.project_id])))];
  const projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const projects = await supabase.from("projects").select("id, name").in("id", projectIds);
    assertNoError(projects);
    for (const project of projects.data ?? []) projectNames.set(project.id, project.name);
  }
  return projectNames;
}
