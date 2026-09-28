/** SUMIT status classification. No Deno globals, so Vitest can import it. The wait itself is computed in SQL. */

const BILLING = /obligo|billing|quota|rate limit|too many|throttle|actionsbilling|מכסה|חריג/i;
const CREDENTIAL = /api\s*key|apikey|company\s*id|companyid|unauthorized|unauthorised|credential|authentication|forbidden|invalid key|wrong company|מפתח\s*api|מזהה\s*חברה/i;

/**
 * Billing and limit messages stay on the backoff clock.
 * A bad key or company id stops until the owner reconnects.
 * An unrecognised Status other than 0 stays a temporary rejection.
 * Bare "מזהה" and "permission" are not credential failures.
 */
export function classifySumitStatus(message: string): "sumit_auth" | "sumit_rejected" {
  if (BILLING.test(message)) return "sumit_rejected";
  if (CREDENTIAL.test(message)) return "sumit_auth";
  return "sumit_rejected";
}
