/**
 * Mercury paths the adapter may call. Paths only. GET only.
 * `/credit` is the card-account listing observed on 2026-10-03. It is not in
 * the three generated reference pages. `/treasury` is the treasury-account
 * listing from the Mercury reference.
 * `/treasury/{treasuryId}/transactions` is the treasury ledger. Yield and
 * dividends are read from that GET. `/categories` is the custom-category
 * list named by the L1b brief. See docs/tech/connector-contract.md.
 */
export const MERCURY_GET_ALLOWLIST = [
  "/accounts",
  "/credit",
  "/treasury",
  "/treasury/{treasuryId}/transactions",
  "/categories",
  "/transactions",
  "/transaction/{transactionId}",
] as const;
