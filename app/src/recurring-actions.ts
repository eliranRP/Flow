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

/** One recurring charge, as the list names it to a write: its party, currency and (when split) project. */
export type ChargeTarget = {
  direction: "income" | "expense";
  partyId: string;
  currency: string;
  /** The charge's project when its party is split by project (decision 0185); null otherwise. */
  projectId: string | null;
};

/** The writes the list makes, as the screen calls them. */
export type RecurringWrites = {
  dismiss: (alertKey: string) => Promise<void>;
  restore: (alertKey: string) => Promise<void>;
  /**
   * The ask's "הסתיים": the charge's party is no longer recurring (decision 0172), through its newest
   * line. Returns the undo, which hands the choice back to the rule.
   */
  end: (target: ChargeTarget) => Promise<() => Promise<void>>;
};

/** "הסתיים" on the live client: the newest line of the charge, then its party's switch off. */
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
  assertNoError(await client.rpc("set_payment_recurring", { p_id: id, p_recurring: false }));
  return async () => {
    // null hands the choice back to the rule; the generated type shows the parameter as boolean only.
    assertNoError(await client.rpc("set_payment_recurring", { p_id: id, p_recurring: null as unknown as boolean }));
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
