/** Backoff and SUMIT status classification. No Deno globals, so Vitest can import it. */

export const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

/** Attempt 0 and 1 wait 5 minutes. Attempt 5 and above wait 24 hours. */
export function backoffDelay(attempts: number): number {
  const index = Math.min(BACKOFF_MS.length, Math.max(1, attempts)) - 1;
  return BACKOFF_MS[index] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 24 * 60 * 60_000;
}

const BILLING = /obligo|billing|quota|rate limit|too many|throttle|actionsbilling|מכסה|חריג/i;
const CREDENTIAL = /api\s*key|apikey|company\s*id|companyid|unauthorized|unauthorised|credential|authentication|permission|forbidden|invalid key|wrong company|מפתח|מזהה/i;

/**
 * Billing and limit messages stay on the backoff clock.
 * A bad key or company id stops until the owner reconnects.
 * An unrecognised Status other than 0 stays a temporary rejection.
 */
export function classifySumitStatus(message: string): "sumit_auth" | "sumit_rejected" {
  if (BILLING.test(message)) return "sumit_rejected";
  if (CREDENTIAL.test(message)) return "sumit_auth";
  return "sumit_rejected";
}

export function sumitBodyCode(record: { Status?: unknown; UserErrorMessage?: unknown }): "ok" | "sumit_auth" | "sumit_rejected" {
  if (record.Status === 0) return "ok";
  const userMessage = typeof record.UserErrorMessage === "string" ? record.UserErrorMessage : "";
  return classifySumitStatus(userMessage);
}

/** What a SUMIT body does to the ledger. A rejection does not write documents. */
export function rejectionPlan(record: { Status?: unknown; UserErrorMessage?: unknown }): {
  wroteLedger: boolean;
  code: "ok" | "sumit_auth" | "sumit_rejected";
  attempts: number | null;
  delayMs: number | null;
} {
  const code = sumitBodyCode(record);
  if (code === "ok") return { wroteLedger: true, code, attempts: null, delayMs: null };
  if (code === "sumit_auth") return { wroteLedger: false, code, attempts: null, delayMs: null };
  return { wroteLedger: false, code, attempts: 1, delayMs: backoffDelay(1) };
}

export async function readSumitBody(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
): Promise<{ Status?: unknown; UserErrorMessage?: unknown }> {
  const response = await fetchImpl(url, { method: "POST" });
  return (await response.json()) as { Status?: unknown; UserErrorMessage?: unknown };
}
