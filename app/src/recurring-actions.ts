import { getSupabase } from "./lib/supabase";
import { assertNoError } from "./use-write";

/** The app's Supabase client, the one these writes call its RPCs on. */
export type RpcClient = NonNullable<ReturnType<typeof getSupabase>>;

/** FLOW-447b: the user ignores a late bill (decision 0175). Idempotent per user. */
export async function dismissRecurringAlert(client: RpcClient, alertKey: string): Promise<void> {
  assertNoError(await client.rpc("dismiss_recurring_alert", { p_kind: "missing", p_key: alertKey }));
}

/** The undo of an ignore: the alert comes back. */
export async function restoreRecurringAlert(client: RpcClient, alertKey: string): Promise<void> {
  assertNoError(await client.rpc("undismiss_recurring_alert", { p_kind: "missing", p_key: alertKey }));
}

/** The writes the list makes, as the screen calls them. */
export type RecurringWrites = {
  dismiss: (alertKey: string) => Promise<void>;
  restore: (alertKey: string) => Promise<void>;
};

function supabaseClient(): RpcClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  return supabase;
}

/** The live writes: the RPCs of the signed-in company, through the app's Supabase client. */
export const liveRecurringWrites: RecurringWrites = {
  dismiss: (alertKey) => dismissRecurringAlert(supabaseClient(), alertKey),
  restore: (alertKey) => restoreRecurringAlert(supabaseClient(), alertKey),
};
