import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonReader(value: unknown): value is { json: () => Promise<unknown> } {
  return isRecord(value) && typeof value.json === "function";
}

/** Same code extraction as the Settings connect. A plain error stays connect_failed. */
async function edgeErrorCode(error: unknown): Promise<string> {
  if (!(error instanceof FunctionsHttpError)) return "connect_failed";
  const context: unknown = Reflect.get(error, "context");
  if (!isJsonReader(context)) return "connect_failed";
  try {
    const payload: unknown = await context.json();
    if (isRecord(payload) && typeof payload.error === "string") return payload.error;
  } catch {
    return "connect_failed";
  }
  return "connect_failed";
}

/** Connects SUMIT. The caller keeps the company number and the key across a failure. */
export async function connectSumit(companyNumber: string, apiKey: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<unknown>("sumit-connect", {
    body: { companyId: Number(companyNumber), apiKey },
  });
  if (response.error) throw new Error(await edgeErrorCode(response.error));
}
