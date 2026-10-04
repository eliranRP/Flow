/**
 * Mercury paths the adapter may call. Paths only. GET only.
 * `/credit` is the card-account listing observed on 2026-10-03. It is not in
 * the three generated reference pages. `/categories` is the custom-category
 * list named by the L1b brief. See docs/tech/connector-contract.md.
 */
export const MERCURY_GET_ALLOWLIST = [
  "/accounts",
  "/credit",
  "/categories",
  "/transactions",
  "/transaction/{transactionId}",
] as const;
