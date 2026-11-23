import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flow/shared";
import { assertNoError } from "../use-write";

/** The company's loan balances, by loan id. A loan with no row yet has none here. */
export async function readLoanBalances(supabase: SupabaseClient<Database>, companyId: string) {
  const balances = await supabase.from("loan_balances").select("loan_id, balance_minor, flagged_parts, last_paid_on").eq("company_id", companyId);
  assertNoError(balances);
  return new Map((balances.data ?? []).map((row) => [row.loan_id, row]));
}

/**
 * FLOW-1264: per open loan, the date of its latest bank line not split to any loan yet whose amount is within 2% of
 * the loan's payment (the last 75 days), by loan id. The late check counts it as the loan's payment.
 */
export async function readUnsplitPayments(supabase: SupabaseClient<Database>, companyId: string) {
  const lines = await supabase.from("loan_unsplit_payments").select("loan_id, last_on").eq("company_id", companyId);
  assertNoError(lines);
  return new Map((lines.data ?? []).map((row) => [row.loan_id, row.last_on]));
}

/** The company's project names, by project id: read beside the loans, not after them, for the projects they sit on. */
export async function readProjectNames(supabase: SupabaseClient<Database>, companyId: string) {
  const projects = await supabase.from("projects").select("id, name").eq("company_id", companyId);
  assertNoError(projects);
  return new Map((projects.data ?? []).map((project) => [project.id, project.name]));
}
