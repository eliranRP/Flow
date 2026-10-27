// MCP tools: the descriptions of FLOW-149's ledger tools (decision 0228), create_journal_entry and
// get_account_balances, listed in tools_specs.ts. Split out of it to keep it under the file-size limit.

function spec(name: string, description: string, properties: Record<string, unknown>, write: boolean) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: write
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

export const LEDGER_READ_SPECS = [
  spec("get_account_balances", "The balance-sheet accounts' balances from the ledger legs (FLOW-149, decision 0228), as of as_of (YYYY-MM-DD, default today, by each line's date): balances[] (account_id, account_name, type asset or liability, project_id, project_name, currency, balance_minor: SIGNED, debit positive, credit negative, so an asset reads positive and Accumulated depreciation or a liability negative), every account but the bank, per project and currency, only non-zero; and book_value[] per project and currency (property_minor on Property, accumulated_depreciation_minor on Accumulated depreciation, net_book_value_minor their sum). Any member reads it.", {
    as_of: { type: ["string", "null"] },
  }, false),
];

export const LEDGER_WRITE_SPECS = [
  spec("create_journal_entry", "Book an entry that moves no money (FLOW-149, decision 0228; owner or editor), such as a property's depreciation: a debit to an expense category and a credit to Accumulated depreciation, per project. legs is [{ account_id, amount_minor, project_id? }] from list_accounts, SIGNED (debit positive, credit negative), 2 to 50, summing to 0, with NO bank leg (a journal entry has no bank leg). A leg on a category counted in the P&L is booked with book_line's rules (one such leg makes a whole line of its kind, more a split; project_id files it); the others go on balance-sheet accounts (any asset or liability system account but Suspense and VAT control, or a kept-out category's account, which lands on its posts_to), carried per project. At least one leg must be in the P&L (a journal entry needs a leg in the P&L), and those legs must not net to 0 (a journal entry must change the P&L); one expense leg credited alone is category kind must match the direction. doc_date (YYYY-MM-DD) is the month it counts in, on either basis; currency is 3 letters; description 1 to 120 characters; reference (optional, 1 to 60, e.g. the accounting system's entry number). The entry counts in the P&L of its projects, stays out of every cash view (get_cash_months, get_cash_lines, cash flow), never waits for review, and is fixed: no tool changes its category, project, amount, split or cash flag (journal entry is fixed), and a category it uses cannot be deleted. get_expense names it in journal_entry with its reference; get_line_legs shows its legs (no bank leg); get_account_balances sums Accumulated depreciation per project. Returns id, pnl_minor (its P&L effect, signed), legs and undo_kind journal_entry; undo is kind journal_entry with that id and removes it while it reads as written.", {
    idempotency_key: { type: "string" },
    doc_date: { type: "string" },
    currency: { type: "string" },
    description: { type: "string" },
    reference: { type: ["string", "null"] },
    legs: {
      type: "array",
      items: {
        type: "object",
        properties: { account_id: { type: "string" }, amount_minor: { type: "integer" }, project_id: { type: ["string", "null"] } },
        required: ["account_id", "amount_minor"],
        additionalProperties: false,
      },
    },
  }, true),
];
