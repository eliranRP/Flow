/**
 * FLOW-505: "ייבוא מ" travels with the connect call, so the first sync tick
 * after connecting already skips lines before the cutoff.
 */

/** Undefined leaves the stored date alone; null imports from the start. */
export type ImportFrom = string | null | undefined;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads `importFrom` from a connect body. Returns false when it is not a YYYY-MM-DD date, null or absent. */
export function parseImportFrom(raw: unknown): ImportFrom | false {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw !== "string" || !ISO_DATE.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : false;
}

type RpcClient = {
  rpc(name: "set_import_from", args: { p_provider: string; p_from: string | null }): PromiseLike<{ error: unknown }>;
};

/**
 * Saves the date through set_import_from as the signed-in user, so its
 * future-date and company checks and Mercury's cursor reset still apply.
 * Returns undefined when there was nothing to save, else whether it saved.
 */
export async function saveImportFrom(client: RpcClient, provider: "sumit" | "mercury", from: ImportFrom): Promise<boolean | undefined> {
  if (from === undefined) return undefined;
  try {
    const saved = await client.rpc("set_import_from", { p_provider: provider, p_from: from });
    return !saved.error;
  } catch {
    return false;
  }
}
