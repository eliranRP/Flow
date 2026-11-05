import { getSupabase } from "./lib/supabase";
import { assertNoError } from "./use-write";

/** The app's Supabase client, the one these writes call its RPCs on. */
export type RpcClient = NonNullable<ReturnType<typeof getSupabase>>;

/** The two alerts a party can raise: a late bill (`missing`) or a change on an arrival (`change`). */
export type AlertKind = "missing" | "change";

/** FLOW-447b: the user ignores a late bill (decision 0175). Idempotent per user. */
export async function dismissRecurringAlert(client: RpcClient, alertKey: string, kind: AlertKind = "missing"): Promise<void> {
  assertNoError(await client.rpc("dismiss_recurring_alert", { p_kind: kind, p_key: alertKey }));
}

/** The undo of an ignore: the alert comes back. */
export async function restoreRecurringAlert(client: RpcClient, alertKey: string, kind: AlertKind = "missing"): Promise<void> {
  assertNoError(await client.rpc("undismiss_recurring_alert", { p_kind: kind, p_key: alertKey }));
}

/** FLOW-447c: the answer to a suggested match, "the same party" (true), "not" (false), or taken back (null). */
export type RecurringMatchAnswer = {
  direction: "income" | "expense";
  partyId: string;
  matchPartyId: string;
  same: boolean | null;
};

/** The answer to a suggested match for a late bill (decision 0179). */
export async function answerRecurringMatch(client: RpcClient, answer: RecurringMatchAnswer): Promise<void> {
  assertNoError(
    await client.rpc("answer_recurring_match", {
      p_direction: answer.direction,
      p_party_id: answer.partyId,
      p_match_party_id: answer.matchPartyId,
      // null takes the answer back; the generated type shows the parameter as boolean only.
      p_same: answer.same as boolean,
    }),
  );
}

/** One recurring charge, as the list names it to a write: its party, currency and project. */
export type ChargeTarget = {
  direction: "income" | "expense";
  partyId: string;
  currency: string;
  /** The charge's project (decision 0185), so the write reaches that charge's line; null for a charge with none. */
  projectId: string | null;
};

function supabaseClient(): RpcClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  return supabase;
}

/** The live client, for the charge page's writes. */
export function liveRpcClient(): RpcClient {
  return supabaseClient();
}

/** FLOW-963: a charge's project or category pick, for every payment of the charge, the earlier ones too. */
export type ChargePick = ChargeTarget & { project?: string; category?: string };

/**
 * What a charge pick changed: the payments moved, the ones it left (shared, split, already so), whether the
 * server found the party split by project (the page's address names the charge's project then), and the undo ids.
 */
export type ChargePickResult = { changed: number; skipped: number; split: boolean; undoIds: string[] };

/** Moves every payment of the charge to the picked project or category. */
export async function reassignRecurringCharge(client: RpcClient, pick: ChargePick): Promise<ChargePickResult> {
  const result = await client.rpc("reassign_recurring_charge", {
    p_direction: pick.direction,
    p_party_id: pick.partyId,
    p_currency: pick.currency,
    // The row's project; the server decides whether the party is split. The generated types show uuid only.
    p_charge_project_id: pick.projectId as string,
    p_project_id: (pick.project ?? null) as string,
    p_category_id: (pick.category ?? null) as string,
  });
  assertNoError(result);
  const data = result.data as { changed?: unknown; skipped?: unknown; split?: unknown; undo_ids?: unknown } | null;
  const undoIds = Array.isArray(data?.undo_ids) ? data.undo_ids.filter((id): id is string => typeof id === "string") : [];
  return { changed: Number(data?.changed ?? 0), skipped: Number(data?.skipped ?? 0), split: data?.split === true, undoIds };
}

/** The undo of a charge pick: every payment back as it was. */
export async function undoRecurringChargePick(client: RpcClient, undoIds: readonly string[]): Promise<void> {
  assertNoError(await client.rpc("undo_reassign_recurring_charge", { p_undo_ids: [...undoIds] }));
}
