import { getSupabase } from "./lib/supabase";
import { assertNoError } from "./use-write";

/** FLOW-505: the connector's sync skips lines dated before `from`; null imports from the start. */
export async function saveImportFrom(provider: "sumit" | "mercury", from: string | null): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  // The generated type misses that p_from takes null (מההתחלה).
  assertNoError(await supabase.rpc("set_import_from", { p_provider: provider, p_from: from as string }));
}

/** The connection stands; only the date was not saved. */
export const IMPORT_FROM_FAILED = (name: string) => `${name} מחובר, אבל תאריך הייבוא לא נשמר.`;
