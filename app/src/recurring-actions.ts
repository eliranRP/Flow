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

/** The writes the list makes, as the screen calls them. */
export type RecurringWrites = {
  dismiss: (alertKey: string) => Promise<void>;
  restore: (alertKey: string) => Promise<void>;
  /**
   * The ask's "הסתיים": the charge is no longer recurring (decisions 0172, 0188), through its newest
   * line. Returns the undo, which writes back the switch the charge had before.
   */
  end: (target: ChargeTarget) => Promise<() => Promise<void>>;
};

/** The owner's switch before a write, as `set_payment_recurring` returns it: true, false, or null (the rule decided). */
function priorOverride(data: unknown): boolean | null {
  if (data == null || typeof data !== "object" || !("prior_override" in data)) return null;
  return typeof data.prior_override === "boolean" ? data.prior_override : null;
}

/** "הסתיים" on the live client: the newest line of the charge, then its switch off. The undo writes the prior switch back. */
export async function endRecurringCharge(client: RpcClient, target: ChargeTarget): Promise<() => Promise<void>> {
  const line = await client.rpc("recurring_party_line", {
    p_direction: target.direction,
    p_party_id: target.partyId,
    p_currency: target.currency,
    ...(target.projectId == null ? {} : { p_project_id: target.projectId }),
  });
  assertNoError(line);
  const id = typeof line.data === "string" ? line.data : null;
  if (id == null) throw new Error("no line");
  // The charge's project, so a charge fed only by another property's split transfer is the one written (decision 0189).
  const project = target.projectId == null ? {} : { p_project_id: target.projectId };
  const set = await client.rpc("set_payment_recurring", { p_id: id, p_recurring: false, ...project });
  assertNoError(set);
  const prior = priorOverride(set.data);
  return async () => {
    // null hands the choice back to the rule; the generated type shows the parameter as boolean only.
    assertNoError(await client.rpc("set_payment_recurring", { p_id: id, p_recurring: prior as boolean, ...project }));
  };
}

function supabaseClient(): RpcClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  return supabase;
}

/** The live writes: the RPCs of the signed-in company, through the app's Supabase client. */
export const liveRecurringWrites: RecurringWrites = {
  dismiss: (alertKey) => dismissRecurringAlert(supabaseClient(), alertKey),
  restore: (alertKey) => restoreRecurringAlert(supabaseClient(), alertKey),
  end: (target) => endRecurringCharge(supabaseClient(), target),
};

/** The live client, for the charge page's writes. */
export function liveRpcClient(): RpcClient {
  return supabaseClient();
}
