/**
 * Every read whose answer the books decide: a bank or SUMIT sync, another device, or an agent
 * can change it. Reads stay fresh for 30 minutes (query-client.ts), so a finished sync
 * (use-sync-settled.ts) and a focus return (books-focus.tsx, decision 0080) refetch all of
 * these on screen and mark the rest stale. ledger-keys.test.ts fails when a read's key is in
 * neither this list nor its short list of account reads (companies, team, settings, setup run).
 */
export const LEDGER_KEYS = [
  "dashboard",
  "review",
  "review-anomalies",
  "unpaid",
  "filed-today",
  "categories",
  "sumit",
  "mercury",
  "project",
  "project-category",
  "project-waiting",
  "projects-cash",
  "profit-months",
  "project-forecast-edits",
  "txn",
  // FLOW-957: a Mercury sync brings notes and attachments into the thread.
  "txn-thread",
  "txn-thread-counts",
  "line-meta",
  "line-split",
  "line-split-loan",
  "loan-split",
  "breakdown",
  "breakdown-lines",
  // FLOW-161: the reports' balance sheet (the P&L statement sits under "dashboard").
  "balance-sheet",
  "month-forecast",
  "missing-bills",
  "expected-months",
  "recurring-changes",
  "transfer-matches",
  "transfer-match-count",
  "recurring-schedule",
  "payment-recurring",
  "party-charges",
  "party-line",
  "loans",
  "loan-currency",
  "company-currency",
  "company-overhead",
  "search",
  "receipt-match",
  "jev-connector",
  "jev-review",
  "jev-review-queue",
  "setup-suggestions",
  "setup-review-resolved",
  // FLOW-955: Jev's bookings waiting in לאישור, and the accounts the composer can book on.
  "jev-bookings",
  "composer-accounts",
] as const;
