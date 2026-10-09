import { getSupabase } from "./lib/supabase";
import { assertNoError } from "./use-write";
import { isRecord } from "./edge";

/** FLOW-505: the connector's sync skips lines dated before `from`; null imports from the start. */
export async function saveImportFrom(provider: "sumit" | "mercury", from: string | null): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  // set_import_from(p_provider, p_from date) takes null (מההתחלה); the generated types never mark RPC args nullable.
  const args = { p_provider: provider, p_from: from } as { p_provider: typeof provider; p_from: string };
  assertNoError(await supabase.rpc("set_import_from", args));
}

/** The connection stands; only the date was not saved. */
export const IMPORT_FROM_FAILED = (name: string) => `${name} מחובר, אבל תאריך הייבוא לא נשמר.`;

/**
 * The connect edge functions save the date themselves and say whether it
 * stuck, so the first sync already honours it. An older function that never
 * reports it gets the date saved from here instead.
 */
export async function importFromAfterConnect(
  provider: "sumit" | "mercury",
  from: string | null | undefined,
  response: unknown,
): Promise<boolean> {
  if (from === undefined) return true;
  const saved = isRecord(response) ? response.import_from_saved : undefined;
  if (typeof saved === "boolean") return saved;
  return saveImportFrom(provider, from).then(() => true, () => false);
}
