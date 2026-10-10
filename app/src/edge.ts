import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSupabase } from "./lib/supabase";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isJsonReader(value: unknown): value is { json: () => Promise<unknown> } {
  return isRecord(value) && typeof value.json === "function";
}

export async function edgeErrorCode(error: unknown): Promise<string> {
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

export async function invokeEdge(
  name: "sumit-connect" | "sumit-sync" | "mercury-connect" | "mercury-sync" | "invite-email",
  body: Record<string, unknown>,
): Promise<unknown> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<unknown>(name, { body });
  if (response.error) throw new Error(await edgeErrorCode(response.error));
  return response.data;
}
