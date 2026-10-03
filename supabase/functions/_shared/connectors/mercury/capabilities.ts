import type { ConnectorCapabilities } from "../types.ts";

/** Env name of the Mercury key-encryption key. The value is never in the repo. */
export const MERCURY_KEK_REF = "MERCURY_KEK";

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
  "not_a_line",
] as const;
export type MercurySkipReason = (typeof MERCURY_SKIP_REASONS)[number];

/**
 * How long a pending line may stay missing from the lookback before a
 * GET by id voids it. L2b picks the integer. L0 only names the constant.
 */
export const MERCURY_PENDING_VOID_DAYS = "MERCURY_PENDING_VOID_DAYS";
