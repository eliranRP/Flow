import type { ConnectorCapabilities } from "../types.ts";

/** Env name of the Mercury key-encryption key. The value is never in the repo. */
export const MERCURY_KEK_REF = "MERCURY_KEK";

export const MERCURY_SYNC_FUNCTION = "mercury-sync";

export const MERCURY_CAPABILITIES: ConnectorCapabilities = {
  listing: "window",
  removal: "status",
  currencies: ["USD"],
  hasPending: true,
};

/** Skip reasons this adapter returns. The core does not list them. */
export const MERCURY_SKIP_REASONS = [
  "own_account_transfer",
  "internal_transfer",
  "treasury_transfer",
  "not_own_account",
  "void_status",
  "unknown_status",
  "not_a_line",
  "non_usd",
  "refused_amount",
  "treasury_activity",
  "dividend_reinvestment",
  "treasury_cancel",
] as const;
export type MercurySkipReason = (typeof MERCURY_SKIP_REASONS)[number];

/**
 * Days a later sync re-reads before the previous sync.
 * postedAt lags createdAt (13 of 45 lines on the day the contract was
 * written, and 22 of the 70 imported lines in the 2026-10-04 fixtures).
 * Thirty days covers a late post, a weekend, and a statement lag without
 * downloading the whole history on every run.
 */
export const MERCURY_POSTED_LOOKBACK_DAYS = 30;

/**
 * Days a pending line may stay missing before GET /transaction/{id}
 * may void it. Ten days covers a weekend, a holiday, and a slow card
 * post. A shorter window would drop a charge that is still settling.
 * A 404 on that GET is the void. A live transaction is an update.
 */
export const MERCURY_PENDING_VOID_DAYS = 10;

/** Lines per GET /transactions page. The recorded fixtures use 50. */
export const MERCURY_PAGE_LIMIT = 100;

/**
 * Pages in one run. Twenty pages is 2,000 lines. A window that exceeds
 * this returns the lines already fetched and a resume cursor. A repeated
 * nextPage is a loop: that run stops and does not resume.
 */
export const MERCURY_PAGE_CAP = 20;
