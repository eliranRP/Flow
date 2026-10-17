import type { useQueryClient } from "@tanstack/react-query";
import type { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { SKIP_ALL_COMPANY_NAME } from "./copy";
import { skipAllPatch, type SetupFacts } from "./model";
import { readSetupStore, writeSetupStore } from "./storage";

/**
 * Skip all (the sheet, from any screen): a business "העסק שלי" when there is none (or always, in
 * new-company mode: `openNew` then opens it), every step not done skipped, then Home.
 */
export async function runSkipAll({
  userId,
  facts,
  navigate,
  client,
  openNew,
}: {
  userId: string | null;
  facts: SetupFacts;
  navigate: ReturnType<typeof useNavigate>;
  client: ReturnType<typeof useQueryClient>;
  /** Set in new-company mode: creates a new company even when one exists, then opens it. */
  openNew?: (companyId: string) => Promise<void>;
}): Promise<void> {
  if (userId == null) return;
  let companyId = openNew ? null : facts.companyId;
  if (companyId == null) {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase.rpc("create_company", { p_name: SKIP_ALL_COMPANY_NAME, p_vat_registered: true });
    if (error || typeof data !== "string" || data === "") return;
    companyId = data;
    await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
    if (openNew) await openNew(companyId).catch(() => undefined);
  }
  const at = new Date().toISOString();
  const current = readSetupStore(userId, companyId);
  writeSetupStore(userId, companyId, skipAllPatch(current, { ...facts, companyId }, at));
  void navigate("/", { replace: true });
}
