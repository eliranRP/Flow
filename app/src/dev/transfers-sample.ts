import type { TransferMatch } from "../transfer-matches";

/**
 * FLOW-941: two suggested transfers between two Mercury connections, for the dev route, the stories and the
 * e2e spec. Invented organisations, accounts and amounts only.
 */
export function transfersSample(): TransferMatch[] {
  return [
    {
      out: {
        transaction_id: "e2e-xfer-out-1", doc_date: "2026-10-14", amount_minor: 1_250_000n, currency: "USD",
        description: "Transfer to Cedar Lane", party: "Cedar Lane Holdings LLC", slot: 1,
        org_label: "Birch Row Builders LLC", account_name: "Operations", account_last4: "4821",
      },
      in: {
        transaction_id: "e2e-xfer-in-1", doc_date: "2026-10-15", amount_minor: 1_250_000n, currency: "USD",
        description: "From Birch Row", party: null, slot: 2,
        org_label: "Cedar Lane Holdings LLC", account_name: "Main", account_last4: "9034",
      },
      day_diff: 1,
      name_hint: true,
    },
    {
      out: {
        transaction_id: "e2e-xfer-out-2", doc_date: "2026-10-03", amount_minor: 48_000n, currency: "USD",
        description: "Online payment", party: null, slot: 2,
        org_label: "Cedar Lane Holdings LLC", account_name: "Main", account_last4: "9034",
      },
      in: {
        transaction_id: "e2e-xfer-in-2", doc_date: "2026-10-03", amount_minor: 48_000n, currency: "USD",
        description: "Deposit", party: null, slot: 1,
        org_label: "Birch Row Builders LLC", account_name: "Reserve", account_last4: "1170",
      },
      day_diff: 0,
      name_hint: false,
    },
  ];
}
