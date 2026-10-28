// MCP tools: the descriptions of FLOW-155's prepaid schedule tools and FLOW-156's books-closed date,
// merged into the ledger specs (tools_ledger_specs.ts), listed in tools_specs.ts.

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

// The rules every prepaid tool shares, so each description stands alone.
const RULES =
  "Rules: a posted month is a normal journal entry (Prepaid, an asset account, to the expense category, on the project) and moves no cash, so no cash view or bank total changes; planned months are not on the books and show in no report; a daily job posts every month that is due and a re-run posts nothing; a start month in the past backfills the months already due with their original dates; the books-closed date (set_books_closed_through) blocks adding, changing or removing a posted month on or before it (the books are closed through YYYY-MM-DD).";

export const PREPAID_READ_SPECS = [
  spec("list_prepaid_schedules", `The company's prepaid amortization schedules (FLOW-155; any member reads it), newest first: books_closed_through (YYYY-MM-DD or null) and schedules[] with schedule_id, transaction_id (the payment line), description, project_id and project_name, expense_category_id and expense_category_name, currency, total_minor, posted_minor (on the books so far), refunded_minor, remaining_minor, months, months_posted, next_date (the next planned month, null when none) and status (active, completed or ended). status (optional) keeps one status. ${RULES}`, {
    status: { type: ["string", "null"], enum: ["active", "completed", "ended", null] },
  }, false),
  spec("get_prepaid_schedule", `One prepaid schedule with every row (FLOW-155; any member reads it): the schedule fields as list_prepaid_schedules gives them, rows[] (seq, due_date, amount_minor, kind amortization or end_expense, status posted or planned, entry_id: the journal entry once posted, else null) and refunds[] (transaction_id, amount_minor). id is the schedule_id. Another company's or an unknown schedule is not_found. ${RULES}`, {
    id: { type: "string" },
  }, false),
];

export const PREPAID_WRITE_SPECS = [
  spec("create_prepaid_schedule", `Spread a payment over months as expense (FLOW-155; owner or editor): a cost paid in one go, such as a year of insurance, is held on the Prepaid expenses asset account and moved to expense_category_id month by month. transaction_id is the payment line (a posted expense line, not a journal entry, not already in a schedule); amount_minor (optional, a positive integer in minor units, at most the line; default the whole line: a smaller amount splits the line, the rest keeps its category); expense_category_id is an expense category counted in the P&L; project_id (optional) is the project the expense lands on; start_month is YYYY-MM (a real month); months is 1 to 120; day_of_month (optional, 1 to 28, default the line's day) is the day each month is dated; prepaid_account_id (optional) is an asset account from list_accounts, default the account named Prepaid expenses (made if missing); description (optional, up to 120). The total is split evenly, rounded to the minor unit, and the last month takes the rest. Refused: a line that is not found, not an expense, not posted, a journal entry or already in a schedule, a line already split, an amount above the line, and a month due on or before the books-closed date. A past start posts the months already due at once. ${RULES} Returns schedule_id, prepaid_account_id, prepaid_category_id, total_minor, rows[], posted_count, remaining_minor and undo_kind prepaid_create; undo is kind prepaid_create with the schedule id and removes the schedule, its entries and puts the line back while it reads as written.`, {
    idempotency_key: { type: "string" },
    transaction_id: { type: "string" },
    expense_category_id: { type: "string" },
    project_id: { type: ["string", "null"] },
    start_month: { type: "string" },
    months: { type: "integer", minimum: 1, maximum: 120 },
    amount_minor: { type: ["integer", "null"], minimum: 1 },
    day_of_month: { type: ["integer", "null"], minimum: 1, maximum: 28 },
    prepaid_account_id: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
  }, true),
  spec("attach_prepaid_refund", `Record a refund of a prepaid cost (FLOW-155; owner or editor): transaction_id is the refund line (a posted income line), filed to the schedule's prepaid category (whole, or split when amount_minor is less than the line). amount_minor (optional, positive, minor units) is at most remaining_minor; default the whole line. The months not yet posted are spread again over the months left, so the planned rows add up to what remains. Posted months stay. Refused: a line that is not income or not posted, an amount above what remains, a schedule that is ended or completed, and a posted month on or before the books-closed date. ${RULES} Returns the schedule, rows[] and undo_kind prepaid_refund; undo is kind prepaid_refund with the schedule id and puts the line and the planned rows back while it reads as written.`, {
    idempotency_key: { type: "string" },
    schedule_id: { type: "string" },
    transaction_id: { type: "string" },
    amount_minor: { type: ["integer", "null"], minimum: 1 },
  }, true),
  spec("update_prepaid_schedule", `Change the months still to come of a prepaid schedule (FLOW-155; owner or editor). Give at least one of months (the new total number of months, 1 to 120, more than the months already posted: the planned rows are spread again over the rest), expense_category_id (an expense category counted in the P&L) and project_id. Only planned rows change; posted months keep their category and project. Refused: months not above the posted count, a schedule that is ended or completed. ${RULES} Returns the schedule, rows[] and undo_kind prepaid_update; undo is kind prepaid_update with the schedule id and puts the old plan back while it reads as written.`, {
    idempotency_key: { type: "string" },
    schedule_id: { type: "string" },
    months: { type: "integer", minimum: 1, maximum: 120 },
    expense_category_id: { type: "string" },
    project_id: { type: "string" },
  }, true),
  spec("end_prepaid_schedule", `Stop a prepaid schedule early (FLOW-155; owner or editor), e.g. a policy cancelled: the planned rows from from_month (YYYY-MM) on are dropped. remaining is expense (one last row in from_month, on the schedule's day, takes everything left and is posted at once if due) or keep (what is left stays on the Prepaid account as an asset, for example a refund still to come). The schedule becomes ended. Refused: a schedule already ended or completed, a from_month before the last posted month, and a posted row on or before the books-closed date. ${RULES} Returns the schedule, rows[] and undo_kind prepaid_end; undo is kind prepaid_end with the schedule id and restores the planned rows while it reads as written.`, {
    idempotency_key: { type: "string" },
    schedule_id: { type: "string" },
    from_month: { type: "string" },
    remaining: { type: "string", enum: ["expense", "keep"] },
  }, true),
  spec("delete_prepaid_schedule", `Delete a prepaid schedule (FLOW-155; owner or editor): every posted entry is removed as a journal entry undo does, the planned rows go, and the payment line and the refund lines get their category and split back as they were before. Refused when a posted month is dated on or before the books-closed date (the books are closed through YYYY-MM-DD). ${RULES} Returns schedule_id, the number of entries removed and undo_kind prepaid_delete; undo is kind prepaid_delete with the schedule id and creates it again while it reads as written.`, {
    idempotency_key: { type: "string" },
    schedule_id: { type: "string" },
  }, true),
  spec("set_books_closed_through", `Set the books-closed date (FLOW-156; OWNER only): date is YYYY-MM-DD, or null to open the books again. Prepaid writes then refuse to add, change or remove a posted month dated on or before it (the books are closed through YYYY-MM-DD). It cannot be after today. Refused: closing past a prepaid month that is due and not yet posted (post the due prepaid rows first). It is shown in list_prepaid_schedules and get_started. Returns books_closed_through, previous and undo_kind books_closed; undo is kind books_closed with the company id and puts the previous date back while it reads as written.`, {
    idempotency_key: { type: "string" },
    date: { type: ["string", "null"] },
  }, true),
];
