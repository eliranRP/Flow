// FLOW-369: the add sheet's reads and writes. The app's own RPCs (not MCP): the session has no MCP
// token. The MCP tools write the same rows (create_manual_entry, attach_document).
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { parseDisplayDate, type BankMatch, type AttachedDocument, type EntryDraft, type EntryKind, entryRpcArgs, parseAmountMinor, payeeProblem } from "./add-entry";
import { useHomePreview } from "./preview";
import { assertNoError } from "./use-write";

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  return supabase;
}

/** A manual line (cash or cheque). Returns its id. */
export async function saveManualLine(draft: EntryDraft, kind: EntryKind): Promise<string> {
  // The generated types type nullable uuid and text arguments as required (repo precedent: null as unknown as string).
  const args = entryRpcArgs(draft, kind) as unknown as { p_direction: string; p_amount_minor: number; p_doc_date: string; p_payee: string; p_project_id: string; p_category_id: string; p_method: string; p_cheque_number: string };
  const result = await client().rpc("create_manual_line", args);
  assertNoError(result);
  if (typeof result.data !== "string") throw new Error("supabase");
  return result.data;
}

/** One document on a line: its metadata, the file itself is not stored (FLOW-306). */
export async function attachDocument(transactionId: string, document: AttachedDocument): Promise<void> {
  const { name, mime, bytes, sha256 } = document;
  assertNoError(await client().rpc("attach_line_document", { p_transaction_id: transactionId, p_document: { name, mime, bytes, sha256 } }));
}

export async function undoAttach(transactionId: string, sha256: string): Promise<void> {
  assertNoError(await client().rpc("detach_line_document", { p_transaction_id: transactionId, p_sha256: sha256 }));
}

export async function undoManualLine(transactionId: string): Promise<void> {
  assertNoError(await client().rpc("delete_transaction", { p_id: transactionId }));
}

export async function createProjectNamed(name: string): Promise<string> {
  const result = await client().rpc("upsert_project", { p_name: name, p_status: "active" });
  assertNoError(result);
  if (typeof result.data !== "string") throw new Error("supabase");
  return result.data;
}

export async function createCategoryNamed(name: string, kind: "expense" | "income"): Promise<string> {
  const result = await client().rpc("create_category", { p_name: name, p_kind: kind });
  assertNoError(result);
  if (typeof result.data !== "string") throw new Error("supabase");
  return result.data;
}

/**
 * The bank line a receipt matches: payee, amount and a date within three days. Read only once the
 * amount, the day and the payee are all there; off on the preview route.
 */
export function useReceiptMatch(draft: EntryDraft, enabled: boolean) {
  const preview = useHomePreview();
  const amount = parseAmountMinor(draft.amount);
  const day = parseDisplayDate(draft.date);
  const payeeOk = payeeProblem(draft.payee) == null;
  const on = enabled && preview === "off" && amount != null && day != null && payeeOk;
  return useQuery({
    queryKey: ["receipt-match", amount, day, draft.payee.trim()],
    enabled: on,
    queryFn: async (): Promise<BankMatch | null> => {
      const result = await client().rpc("receipt_match", {
        p_amount_minor: amount ?? 0,
        p_doc_date: day ?? "",
        p_payee: draft.payee.trim(),
      });
      assertNoError(result);
      const rows = (result.data ?? []) as BankMatch[];
      return rows[0] ?? null;
    },
  });
}
