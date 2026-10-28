// MCP get_started: the server instructions, the tool groups and the workflows (FLOW-217).
// The groups name every tool once; tools_guide_test.ts keeps them in step with the tool lists.

export const SERVER_INSTRUCTIONS =
  "Flow is bookkeeping for a property company: bank lines, projects, a P&L, and a double-entry ledger " +
  "(balanced legs on accounts) with a balance sheet. Call get_started first: it maps every tool you may " +
  "call, grouped, with the common workflows step by step.\n" +
  "Rules: (1) every write takes an idempotency_key; (2) every write returns an undo_kind, and undo or " +
  "undo_batch takes it back; (3) amounts are integer minor units (cents or agorot) unless a tool says " +
  "otherwise; (4) ids come from the list_* tools, never guess them.";

export const RULES: string[] = [
  "Every write takes an idempotency_key; repeating a call with the same key does not write twice.",
  "Every write returns an undo_kind; undo (kind + id) takes one write back, undo_batch takes back a batch.",
  "Amounts are integer minor units (cents, agorot) unless a tool says otherwise.",
  "Ids (projects, categories, accounts, lines) come from the list_* and get_* tools.",
];

export type GuideGroup = { id: string; title: string; summary: string; tools: string[] };
export type GuideWorkflow = { id: string; title: string; steps: string[] };

export const TOOL_GROUPS: GuideGroup[] = [
  { id: "start", title: "Start", summary: "The map of the tools.", tools: ["get_started"] },
  {
    id: "company", title: "Company and team", summary: "The company, its currency and who can use it.",
    tools: ["rename_company", "set_company_currency", "get_setup_suggestions", "list_team", "invite_member", "set_member_role", "remove_member"],
  },
  {
    id: "projects", title: "Projects and groups", summary: "Properties or jobs that income and costs belong to, and groups of them.",
    tools: [
      "list_projects", "get_project", "get_project_categories", "list_project_groups", "get_project_group",
      "create_project", "create_projects", "update_project", "delete_project", "create_project_group",
      "set_project_group", "set_project_investment", "set_overhead_project",
    ],
  },
  {
    id: "categories", title: "Categories", summary: "What a line is for; each category can be in or out of the P&L.",
    tools: [
      "list_categories", "create_category", "create_categories", "rename_category", "hide_category",
      "delete_category", "set_category_pnl", "set_category_group", "set_category_parent", "set_category_rehab",
      "move_category_lines", "remember_supplier_category",
    ],
  },
  {
    id: "lines", title: "Lines and review", summary: "Bank lines: find them, review the open ones, file them under a project and category, split them.",
    tools: [
      "list_review", "get_expense", "search_expenses", "match_lines", "get_anomalies", "assign_expense",
      "assign_expenses", "assign_expense_split", "set_expense_category", "split_line", "create_manual_entry",
      "set_line_pnl", "set_lines_pnl",
    ],
  },
  {
    id: "ledger", title: "Ledger and accounts", summary: "The chart of accounts and the balanced legs behind each line.",
    tools: [
      "list_accounts", "get_line_legs", "get_account_balances", "book_line", "create_journal_entry",
      "set_category_account", "create_account", "update_account", "archive_account", "restore_account",
      "merge_account", "get_balance_sheet",
    ],
  },
  {
    id: "prepaid", title: "Prepaid costs and closed books", summary: "Spread a cost paid up front over months, and close the books through a date.",
    tools: [
      "create_prepaid_schedule", "list_prepaid_schedules", "get_prepaid_schedule", "attach_prepaid_refund",
      "update_prepaid_schedule", "end_prepaid_schedule", "delete_prepaid_schedule", "set_books_closed_through",
    ],
  },
  {
    id: "reports", title: "P&L and reports", summary: "Profit by period, project and category.",
    tools: ["get_totals", "get_breakdown", "get_profit_months", "get_weekly_summary"],
  },
  {
    id: "cash", title: "Cash basis", summary: "Cash received and paid by month, and which lines count when.",
    tools: [
      "get_cash_months", "get_cash_years", "get_cash_lines", "get_project_cash_months", "get_project_cash_lines",
      "set_cash_basis", "set_category_cash", "set_line_cash", "set_lines_cash",
    ],
  },
  {
    id: "loans", title: "Loans", summary: "Loans, their schedules, rates and the payments attached to them.",
    tools: [
      "list_loans", "get_loan_schedule", "get_loans_paid", "add_loan", "update_loan", "delete_loan", "reorder_loans",
      "attach_loan_payment", "detach_loan_payment", "set_loan_rate", "set_loan_index", "set_loan_refinance",
      "set_index_rate", "set_loan_part_category", "set_loan_category_from",
    ],
  },
  {
    id: "recurring", title: "Recurring and forecast", summary: "Charges that repeat, what is expected, and the forecast.",
    tools: [
      "get_expected_months", "get_recurring_changes", "get_line_recurring", "get_line_charges", "get_recurring_this_month",
      "get_recurring_schedule", "set_line_recurring", "set_line_pace", "set_line_usual_amount", "answer_recurring_match",
      "reassign_recurring_charge", "get_forecast", "set_forecast_item", "reset_forecast", "get_project_forecast_edits",
      "set_project_forecast_edit", "remove_project_forecast_row", "restore_project_forecast_row", "reset_project_forecast",
    ],
  },
  {
    id: "invoices", title: "Invoices and transfers", summary: "Unpaid invoices, missing bills and transfers between bank accounts.",
    tools: [
      "list_unpaid", "get_missing_bills", "set_invoice_paid", "link_invoice_payment", "dismiss_invoice_match",
      "list_transfer_matches", "confirm_transfer_match", "dismiss_transfer_match",
    ],
  },
  {
    id: "bank", title: "Bank sync", summary: "Bank connections and pulling new lines.",
    tools: ["list_bank_connections", "set_bank_accounts", "answer_bank_account", "sync_bank", "get_sync_status"],
  },
  {
    id: "jev", title: "Jev (auto-categorizer)", summary: "The AI tagger that suggests or fills a project and category.",
    tools: ["get_jev_status", "get_jev_accuracy", "get_jev_suggestions", "set_jev_mode", "undo_jev_prefill"],
  },
  {
    id: "notes", title: "Notes and files", summary: "The thread of notes and files on a line.",
    tools: [
      "get_transaction_thread", "add_transaction_note", "edit_transaction_note", "remove_transaction_note",
      "attach_document", "remove_transaction_file",
    ],
  },
  { id: "undo", title: "Undo", summary: "Take a write back.", tools: ["undo", "undo_batch"] },
];

export const WORKFLOWS: GuideWorkflow[] = [
  {
    id: "first_look", title: "First look at a company",
    steps: [
      "list_projects: the projects and their profit.",
      "get_totals: the company's totals for the period.",
      "list_review: the bank lines still waiting to be filed.",
    ],
  },
  {
    id: "file_line", title: "File a bank line",
    steps: [
      "list_review: pick an open line (its transaction id).",
      "list_categories and list_projects: find the category and project ids.",
      "assign_expense (project and category) or set_expense_category (category only).",
      "split_line (or assign_expense_split) when one line covers several parts.",
    ],
  },
  {
    id: "book_line", title: "Book a balanced entry on the ledger",
    steps: [
      "list_accounts: pick the account ids (bookable ones only).",
      "book_line: book the line against the bank account and the account you chose.",
      "get_line_legs: read the legs back; balanced must be true.",
    ],
  },
  {
    id: "journal_entry", title: "A journal entry that moves no money",
    steps: [
      "list_accounts: pick the accounts to debit and credit.",
      "create_journal_entry: the legs must sum to zero.",
      "get_account_balances: check the balances moved as expected.",
    ],
  },
  {
    id: "prepaid_spread", title: "Spread a prepaid cost",
    steps: [
      "list_review or get_expense: find the payment line (a posted expense, not a journal entry).",
      "list_categories and list_projects: pick the expense category and the project the cost lands on.",
      "create_prepaid_schedule: the start month (YYYY-MM), the number of months and, optionally, part of the amount; a past start posts the months already due.",
      "get_prepaid_schedule: read the rows (posted or planned); each posted month is a journal entry Prepaid to expense and moves no cash.",
      "attach_prepaid_refund, update_prepaid_schedule or end_prepaid_schedule when the cost changes; set_books_closed_through (owner) locks posted months.",
    ],
  },
  {
    id: "bind_category", title: "Bind a kept-out category to a balance-sheet account",
    steps: [
      "list_categories: find the kept-out category.",
      "list_accounts: find the asset or liability account.",
      "set_category_account: its lines then land on that account.",
    ],
  },
  {
    id: "read_reports", title: "Read the P&L and the balances",
    steps: [
      "get_totals: income, costs and profit for a period.",
      "get_breakdown: the same by category or project.",
      "get_account_balances: the balance of each ledger account.",
      "get_balance_sheet: assets, liabilities and equity (when listed).",
    ],
  },
  {
    id: "undo_write", title: "Undo a write",
    steps: [
      "Keep the undo_kind and id the write returned.",
      "undo: pass kind (the undo_kind) and id, with a new idempotency_key.",
      "undo_batch: pass the batch_key to take back every row of a batch write.",
    ],
  },
];
