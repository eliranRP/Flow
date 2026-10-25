/**
 * Mercury paths the adapter may call. Paths only. GET only.
 * `/credit` is the card-account listing observed on 2026-10-03. It is not in
 * the three generated reference pages. `/treasury` is the treasury-account
 * listing from the Mercury reference.
 * `/treasury/{treasuryId}/transactions` is the treasury ledger. Yield and
 * dividends are read from that GET. `/categories` is the custom-category
 * list named by the L1b brief. `/cards` lists the cards with the nickname the
 * owner gave each one (FLOW-707). See docs/tech/connector-contract.md.
 */
export const MERCURY_GET_ALLOWLIST = [
  "/accounts",
  "/credit",
  "/treasury",
  "/treasury/{treasuryId}/transactions",
  "/categories",
  "/cards",
  "/transactions",
  "/transaction/{transactionId}",
] as const;

/**
 * FLOW-957: the one write. PATCH /transaction/{transactionId} with `{ note }` sends a note edited in
 * Flow back to Mercury. It needs a key with Mercury's updateTransactions scope; a read-only key is
 * answered 403, which keeps the edit in Flow and never marks the connection.
 */
export const MERCURY_PATCH_ALLOWLIST = ["/transaction/{transactionId}"] as const;
