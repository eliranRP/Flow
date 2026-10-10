// MCP tools: the tool descriptions and input schemas each scope lists (toolsFor).
// Split out of tools.ts (FLOW-807). Decision 0080.

import { READ_TOOL_NAMES, SYNC_STATUS_TOOL, WRITE_TOOL_NAMES } from "./tools_schemas.ts";

function toolSpec(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  write = false,
) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: write
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

export function isWriteTool(name: string): boolean {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

function readTools() {
  return [
    toolSpec("list_projects", "Projects and their profit for a period, and groups[] (FLOW-406: each project group's id, name, sort_order, project_count, income, direct, shared and profit, and by_currency, the sum of its projects' rows; every group, an empty one too). Each project has group_id (null when none). Omit both dates for all time. Amounts in *_agorot are ILS only. by_currency gives each currency's P&L in minor units (cents for USD). basis is invoiced or cash (default the company's date choice, set_cash_basis: paid is cash, invoice is invoiced; the app counts the same); the output echoes basis.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("get_project", "One project's P&L, categories, and its 40 newest lines, for all time or for a period (from and to, YYYY-MM-DD, both or neither). With the same dates and basis it matches the list_projects row. id is the project id from list_projects. basis is invoiced or cash (default the company's date choice, like list_projects and get_totals); the output echoes basis. Amounts in *_agorot are ILS only. by_currency and categories_by_currency are in minor units per currency (cents for USD). Expense categories kept out of the P&L are not in categories or the totals; they are listed in excluded_categories_by_currency. Kept-out project income is listed by category in excluded_income_by_currency (positive minor units). A guessed (category_suggested) kept-out category still counts until it is confirmed. Each transaction carries its currency, its line_status (pending or posted) and its full line amount, including pending lines and the whole of a shared line. transactions also lists lines with a split_line part filed to this project; parts_minor is the sum of a split line's parts on this project, signed against the line's own kind: a reversal part counts minus (0 when none is here, null for an unsplit line). kept_out is true when no part of the line counts in this project's P&L (a kept-out category, or the owner took the line out). other_currencies count counts each bank line once. loans lists the loans filed under this project (id, name, currency, balance_minor); it does not change the P&L numbers. investment is in the project's investment currency (currency, default ILS; set_project_investment), in minor units of it: purchase_minor, arv_minor, value_minor and value_date (null until set), rehab_minor (all time, cash basis, in that currency: posted, paid costs filed or shared to the project whose category counts as rehab, see set_category_rehab; loan payment parts, fees included, stay out unless their category is switched on; not limited by from, to or basis), rehab_by_category (rehab_minor by category, largest first: category_id, name, hidden, amount_minor; category_id null for lines with no category; the rows add up to rehab_minor), rehab_other_currencies (the same in other currencies), loan_balance_minor (open loans in that currency filed under the project), loan_balance_other_currencies (open loans in other currencies, not added in), forced_equity_minor (ARV - purchase - rehab) and current_equity_minor (value - loan balance), each null while a figure it needs is missing; forced is also null when rehab_other_currencies has a cost, and current when loan_balance_other_currencies has a loan. A project outside the company is not_found.", {
      id: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      from: { type: "string" },
      to: { type: "string" },
    }),
    toolSpec("get_project_categories", "One project's expense categories month by month, to spot what looks off. id is the project id from list_projects; months is how many complete months to look back (3 to 12, default 6). Returns months (the first day of each complete month, oldest first), this_month and today, and categories[]: id, name, group_name (set_category_group), currency, this_month_minor (so far), months_minor (one per month, 0 when none), months_seen (months with a cost), expected_minor (the median of those months, only when there are at least 3), typical_day, and flag: high (this month is above 1.5 x expected and at least ILS 200 / 50 in other currencies above it), new (a cost of at least ILS 500 / 150 after none in the months), missing (expected, past its typical day, nothing yet) or null. Amounts are positive minor units per currency, by document date, the same parts as get_project's categories (approved lines, split parts and the project's share of shared lines, P&L only). The company currency's rows come first. A project outside the company is not_found.", {
      id: { type: "string" },
      months: { type: "integer" },
    }),
    toolSpec("list_project_groups", "The company's project groups (FLOW-406), in order: id, name, sort_order and project_count. A project is in at most one group (set_project_group); groups don't nest.", {}),
    toolSpec("get_project_group", "One project group's P&L for all time or a period (from and to, YYYY-MM-DD, both or neither): its figures as in list_projects groups[], and projects[], the list_projects rows of its projects with the same dates and basis. id is from list_project_groups. basis is invoiced or cash (default the company's date choice, like list_projects). A group outside the company is not_found.", {
      id: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      from: { type: "string" },
      to: { type: "string" },
    }),
    toolSpec("list_categories", "The company's categories. rehab is the category's rehab switch (true, false, or null for the default) and in_rehab whether it counts as rehab (set_category_rehab). lines is how many lines on the books are in it (whole or by a split part; delete_category sends these back to review), split_lines how many of them have a split part in it, and loan_used whether a loan uses it (delete_category refuses). in_cash says whether the category counts in the cash view (set_category_cash).", {}),
    toolSpec("list_review", "Open review items. id is the review id. transaction_id is the ledger id. meta is the line's bank details (see get_expense). supplier matches part of the supplier's name, or of the customer's (customer_name) on an income line. An invoice and the receipts that pay it are one item: receipts lists them (transaction_id, doc_date, amount_gross, currency), paid is true when they cover the invoice, paid_on is the last receipt's date; approving the invoice files its receipts too.", {
      direction: { type: "string", enum: ["expense", "income"] },
      reason: { type: "string" },
      supplier: { type: "string" },
      query: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_expense", "One ledger row, including its allocations; for a split line, line_split.parts (the parts are what counts: shares left from before the split move to allocations_superseded, and allocations is then empty); and its loan split. loan_split is null, or the parts of a loan payment: by_parts says whether the P&L counts the line by its parts, and then each part's in_pnl says whether that part counts (the principal is kept out). in_pnl says whether the line counts in the P&L, in_pnl_override is its own override (null follows the category), and category_excluded_from_pnl is the category flag; category_suggested is true while the category is only a guess, and a guessed kept-out category still counts. pnl_state is in, out, or mixed: a line split by category with a part kept out, or a loan payment counted by its parts, is mixed. in_cash_override is the line's cash view override (set_line_cash; null follows the category) and cash_state is in, out, or mixed (a line split across categories in and out of the cash view); it describes the switch, not whether the line falls in a given month. meta is the line's bank details: method (card, ach, wire, check, transfer, other, or null when the provider gave none), card_last4 (only the last 4 digits), card_name (the nickname the owner gave that card in the bank, often a property or a purpose: a strong hint for the project and category), memo, account (the bank account's name), counterparty, and bank_description (the bank's original text); a field is null when unknown. transaction_id is the ledger id.", {
      transaction_id: { type: "string" },
    }),
    toolSpec("search_expenses", "Search pending review rows, filed rows, or both (income too). id is the ledger id. meta is the line's bank details (see get_expense). query matches the description, supplier or customer, in any case. Optional filters: from and to (YYYY-MM-DD, by document date, both ends included), direction (income or expense), project_id (the line's project, a share of a shared cost on it, or a split part on it; none for lines on no project), category_id (the line's category, or a split or loan split part in it; none for lines with no category and no parts; a parent category also matches its sub-categories' lines unless category_exact is true), and the amount: amount finds one figure, amount_min and amount_max a range (both ends included; not with amount), each the bank amount without its sign in major units of the line's own currency, so 6245.12 finds a $6,245.12 payment or deposit. filed and all rows, newest first, also have currency, amount_gross (the signed bank amount, in minor units), amount_original, line_status, customer_name, waiting_review, kept_out, split_parts (line split parts, 0 when whole) and loan_matched. pending rows are list_review rows; with a filter they come newest first.", {
      scope: { type: "string", enum: ["pending", "filed", "all"] },
      query: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
      from: { type: "string" },
      to: { type: "string" },
      direction: { type: "string", enum: ["income", "expense"] },
      project_id: { type: "string" },
      category_id: { type: "string" },
      category_exact: { type: "boolean" },
      amount: { type: ["number", "string"] },
      amount_min: { type: ["number", "string"] },
      amount_max: { type: ["number", "string"] },
    }),
    toolSpec("get_totals", "Company totals for a period. Omit both dates for all time. Amounts in *_agorot are ILS only. by_currency gives each currency's P&L in minor units (cents for USD). direct + shared + overhead + unassigned expense = expense. unassigned is income with no project, and cost with no role, a project role and no project, or a shared role and no split. groups[] is as in list_projects (FLOW-406). basis is invoiced or cash (default the company's date choice, set_cash_basis: paid is cash, invoice is invoiced; the app counts the same); the output echoes basis.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("list_loans", "Loans in the company with current principal balance, in the saved order (by name until reorder_loans changes it; a loan added since goes last). flagged_parts counts loan parts waiting for review (they do not lower the balance) and flagged_transaction_ids names their lines, both leaving out removed or void lines. payment_minor is the monthly payment (for interest_only when its months are the term: interest plus escrow; the principal is due in the last schedule row). project_id and project_name show the project a loan is filed under, or null. status is open, paid_off or closed, and closed_on is the day it ended (null while open). include_closed false lists open loans only (default true). interest_category_id, escrow_category_id and principal_category_id (with *_name) are the loan's own categories for its payment parts, or null for the defaults. fees_category_id (with fees_category_name) is the category for a payment's fees part, or null when the loan names none (then each attach with fees must name one). kind is amortizing, interest_only (with interest_only_months), balloon (with amortization_months) or demand (term_months and payment_minor null); rates lists the loan's rate changes (id, effective_date, annual_rate_ppm), oldest first; accrued_interest_minor is what an open demand loan owes in interest today (accrued_as_of, UTC): interest earlier payments left unpaid plus what accrued since the last payment or the start, daily on actual/365, as get_loan_schedule's accrued.interest_minor; null for other kinds (their interest is in the schedule rows), for a closed loan, and when its payments could not be read.", {
      include_closed: { type: "boolean" },
    }),
    toolSpec("get_loan_schedule", "Amortization rows for one loan (from and limit page them; kind says which kind it is). Interest uses the rate in force on each row's date (set_loan_rate); a rate change recasts the payment over the months left (for an amortizing loan whose payment is below the term annuity, over the months left in the amortization period that payment implies, so the balloon stays at the term). An interest_only loan's first interest_only_months rows pay interest and escrow only; a balloon loan's last row pays the rest of the balance. A demand loan has nothing scheduled ahead: rows are the payments attached so far (oldest first, with the balance after each), and accrued is the interest due on as_of (YYYY-MM-DD, default today): carried (interest earlier payments left unpaid, simple interest) plus what accrued from the last one (or the start), daily on actual/365, with since, days, carried, interest and balance.", {
      loan_id: { type: "string" },
      from: { type: "integer" },
      limit: { type: "integer" },
      as_of: { type: "string" },
    }),
    syncStatusSpec(),
    toolSpec("get_breakdown", "Income or expenses for a period, grouped by category, project, or payer (supplier or customer). Omit both dates for all time. basis is invoiced or cash (default the company's date choice, like get_totals); the output echoes basis. Without group: totals[], groups[] ({key, name, currency, amount_minor, count, shared}), excluded[] (kept-out categories, not in the totals), review_count. totals match get_totals. Under project, key is a project id, overhead, or unassigned; shared marks a project holding a share of a shared cost. A null name means no category, payer, or project. With group (a key from groups) and currency (default the company currency): that group's lines, newest first, in rows[] with has_more. excluded true lists the kept-out lines instead. amount_minor is in minor units (agorot, cents), positive for income and for a normal expense. A loan payment with a valid split counts by part. level parent (with group_by category, FLOW-406) folds each sub-category into its parent: key is the parent's id and its lines are its own and its sub-categories'; the default level category keeps one group per category.", {
      direction: { type: "string", enum: ["income", "expense"] },
      from: { type: "string" },
      to: { type: "string" },
      group_by: { type: "string", enum: ["category", "project", "payer"] },
      level: { type: "string", enum: ["category", "parent"] },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      group: { type: "string" },
      currency: { type: "string" },
      excluded: { type: "boolean" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_jev_status", "The Jev AI tagger for this company: enabled, mode (off, shadow or auto), threshold, daily_call_cap and calls_today (calls per UTC day), last_run_at, lines_without_suggestion (open expense and income lines in review that Jev has not labelled yet), prefilled_today (lines Jev auto filled this UTC day, not undone) and prefilled_open (lines still open in review that hold Jev's auto fill). In auto mode Jev fills a project and category at or above the threshold, but never on a line SQL flags unless Jev scored that flag below 0.5; it never approves a line, and undo_jev_prefill takes a fill back. It runs within about 5 minutes after a bank sync, up to the daily cap.", {}),
    toolSpec("get_jev_accuracy", "How often Jev's suggestions matched what the owner filed, for lines resolved in a period (from and to are YYYY-MM-DD, by the UTC day the review was approved or changed; omit both for all time). lines counts resolved lines that had a Jev suggestion. all_matched counts lines where every compared field matched. project_compared/project_matched and category_compared/category_matched count each field; a shared, overhead or multi-project line is not compared on project, and a line split by category is not compared on category. at_threshold has lines and all_matched for suggestions at or above the company's threshold, which is what auto mode would pre-fill. bands splits by confidence: high from 0.9, medium from 0.7, low below.", {
      from: { type: "string" },
      to: { type: "string" },
    }),
    toolSpec("get_profit_months", "Profit per calendar month, newest first, for the company or one project (project_id from list_projects). from and to are YYYY-MM-DD, both or neither (neither: from the first month with a line to this month); at most 240 months. basis is invoiced or cash (default the company's date choice, like get_totals); the output echoes basis. Each month has month (YYYY-MM), from and to (cut to the range), open (the current month), and by_currency[] (currency, income_minor, expense_minor, profit_minor; ILS first and always present). The company's months add up to get_totals for the range; a project's add up to get_project for the range (income less direct and shared cost). For a project, each month also has overhead_share_agorot, its ILS share of that month's overhead weighted by that month's income on the same basis (null when no project has income that month, 0 when only this one has none), and the output has after_overhead. by_currency[] at the top sums the months.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
      project_id: { type: "string" },
    }),
    toolSpec("get_project_cash_months", "One project's monthly cash view (the project page's תזרים), in get_cash_months' shape: newest first, the current month included. project_id from list_projects; months 1 to 24 (default 4). A line filed or split to the project counts whole (its part); a shared line counts the project's allocation share of its gross, so the project's figures are its own part, never the whole bank amount. profit_minor is the project's profit for the month on the company's basis (income less direct and shared cost, as get_profit_months with project_id), before the overhead share. not_in_profit_minor and not_in_profit_categories are get_cash_months' לא נספר ברווח for the project. not_found for a project of another company or an unknown one.", {
      project_id: { type: "string" },
      months: { type: "integer" },
    }),
    toolSpec("get_project_cash_lines", "The lines behind a get_project_cash_months figure, in get_cash_lines' shape and arguments plus project_id (side not_in_profit included). A shared line's amount_minor is the project's share, and its row has shared true.", {
      project_id: { type: "string" },
      month: { type: "string" },
      side: { type: "string", enum: ["in", "out", "excluded", "not_in_profit"] },
      currency: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_cash_months", "The monthly cash view (תזרים): money that moved in and out per calendar month, newest first, the current month included. months is how many (1 to 24, default 6). year (FLOW-417, instead of months) gives that calendar year's months, newest first: all 12 for a past year, January to this month for this one; a later year is a validation error. Amounts are gross (VAT included), in positive minor units per currency, nothing converted. Returns basis (the company's cash basis: paid counts a line in its payment month, and an open invoice is not cash yet; invoice counts it in its document month; set_cash_basis), base_currency, and months[]: month (YYYY-MM-DD, the first day) and by_currency[] (the base currency first and always present): in_minor, out_minor, net_minor (in less out), profit_minor (the month's P&L net profit on the company's basis, as get_profit_months without a basis), and excluded_count, excluded_in_minor, excluded_out_minor for lines left out of the view (owner's transfers, credit card bill payments, money received from a loan, and lines or categories switched off with set_line_cash or set_category_cash). not_in_profit_minor is net_minor less profit_minor (the cash profit leaves out, so the two add up to the month), and not_in_profit_categories[] (name, amount_minor signed like net, largest first) is the cash in the view that the P&L leaves out (renovation kept out of profit, owner's capital, loan principal); VAT and lines out of the view but in profit are the rest. Loan payments count whole, principal included. Every line counts once: a line split, or a loan payment's parts, by their parts.", {
      months: { type: "integer" },
      year: { type: "integer" },
    }),
    toolSpec("get_cash_years", "The cash view's whole history (FLOW-417): money in and out since the company's first cash month and per calendar year, on the company's cash basis (as get_cash_months), through the end of this month. Returns basis, base_currency, this_month and first_month (YYYY-MM-DD, the first day; first_month is null when no line counts in cash yet), by_currency[] (the total since first_month: currency, in_minor, out_minor, net_minor; the base currency first and always present) and years[] newest first, from first_month's year to this one, empty years included: year and by_currency[] in the same shape. A year's months (get_cash_months with year) add up to its row.", {}),
    toolSpec("get_cash_lines", "The lines behind a get_cash_months figure, newest first. month is YYYY-MM (or a date in it), side is in, out, excluded (left out of the view) or not_in_profit (in the view but left out of the P&L, as get_cash_months not_in_profit_categories counts them), currency defaults to the company's base currency. limit 1 to 100 (default 40) and offset page through rows[]; has_more says more remain. Each row: transaction_id, part (a loan payment has a row per part; a line split's parts on one side are one row), description, supplier_name, project_name, category_name, doc_date, cash_month_date, currency, amount_minor (gross, positive), side, source and kept_out.", {
      month: { type: "string" },
      side: { type: "string", enum: ["in", "out", "excluded", "not_in_profit"] },
      currency: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("match_lines", "Reconcile an outside ledger export against Flow in one read (FLOW-213). rows (1 to 500) are {date (YYYY-MM-DD), amount_minor (a non-zero integer in minor units; the sign is ignored), ref (optional text up to 200 characters, echoed back)}. A row matches a Flow line of the same gross amount without its sign, in currency (default the company's base currency), whose document date or payment date is within window_days (0 to 31, default 5) of the row's date; direction (income or expense) narrows the lines. Removed and void lines never match; pending (waiting for review) lines do. Each row is paired with at most one line and each line with at most one row, closest dates first, then by row order. Returns currency, window_days, direction, from and to (the rows' first and last date), rows[] (index, date, amount_minor, ref, match: the paired line or null, candidate_count, candidates: up to 5 lines, closest first), matched_count, unmatched_rows (indexes of the rows with no pair), unclaimed_count and unclaimed_lines (up to 200 lines dated from to to that no row took, oldest first). A line has transaction_id, doc_date, cash_date, amount_minor (the signed gross: income positive, expense negative), currency, direction, line_status, party (supplier or customer), description, project_name (null for a shared or split line), pnl_role, category_name, and day_diff on a match or candidate. Read only.", {
      rows: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: {
          type: "object",
          properties: { date: { type: "string" }, amount_minor: { type: "integer" }, ref: { type: "string" } },
          required: ["date", "amount_minor"],
          additionalProperties: false,
        },
      },
      window_days: { type: "integer", minimum: 0, maximum: 31 },
      direction: { type: "string", enum: ["income", "expense"] },
      currency: { type: "string" },
    }),
    toolSpec("get_anomalies", "Flags on the open review lines (newest 500), found in SQL: duplicate (another posted line of the same supplier or customer, document kind, gross amount and currency, within 7 days, not an invoice and its own receipt; other_transaction_id, other_doc_date), amount_spike (at least 3 times the median of that supplier's or customer's last 12 lines in the year before, and at least 100.00 more; typical_amount_minor, ratio), new_party_large (the first line of a supplier or customer, at or above the company's 90th percentile posted line over the year up to the newest open line; company_p90_minor). Each item has transaction_id, kind and jev_score (0 to 1: how likely Jev thinks the flag is a real problem, scored in the same call that labelled the line; null when Jev did not score it). A flag is a reason to look, not an error; the owner decides.", {}),
    toolSpec("get_jev_suggestions", "Jev's suggestions on the open review lines (newest 500 that have one): transaction_id, direction (expense or income), project_id and project_name, category_id and category_name (null when Jev did not answer), no_project (true when Jev answered no project: overhead, or not one project), confidence, reason, party_filings and matching_filings, anomaly_score (Jev's score of an anomaly flag on that line, or null), and prefilled (true when Jev auto filled this line and it was not undone; undo_jev_prefill takes it back). reason comes from SQL: same_as_last (the suggestion equals how the owner filed this supplier or customer last time), usual_for_party (it equals at least 2 of the last 5 filed lines), new_party (nothing filed yet for that party), model_only (none of these). Jev only suggests; it never approves a line, and assign_expense or assign_expenses is still how a line is filed.", {}),
    toolSpec("get_missing_bills", "Recurring suppliers and customers whose due month has come with no line yet, after their usual day plus 5 days in the due month (Israel time; on the month's last day when that falls later). Monthly ones (a line in at least 3 of the last 6 complete months and in one of the last 2) are due every month; a pace of every 2 months, quarter or year (set_line_pace, or detected) is due one pace after the last bill. A party the owner marked recurring (set_line_recurring) counts too, and one marked not recurring never does. Alerts the token's user dismissed in the app are left out. Each has direction, party_id, party_name, supplier_id and supplier_name (null for income), currency, typical_amount_minor (median net per bill, negative for expenses), typical_day, due_month, expected_by, months_seen, last_doc_date, last_amount_minor, project_id, project_name, category_id, category_name, source (auto: found by the rule; user: marked by the owner), pace, pace_source and alert_key.", {}),
    toolSpec("get_expected_months", "Expected income and expense per month from recurring suppliers and customers (median monthly net), for this month and the next ones. months is 1 to 12 (default 3). This month (open: true) counts only the recurring ones not seen yet this month. project_id limits it to parties whose usual project is that one. Output: today, project_id, months[] (month YYYY-MM, open, by_currency[] with currency, income_minor, expense_minor; expenses are negative) and recurring[] (direction, party_id, name, currency, typical_amount_minor, typical_day, months_seen, seen_this_month, project_id, category_id, source: auto or user, pace, next_due_month). A party counts in its due months only, every pace months from its next due month. A projection from past months, not booked lines.", {
      months: { type: "integer", minimum: 1, maximum: 12 },
      project_id: { type: "string" },
    }),
    toolSpec("get_recurring_changes", "Recurring suppliers and customers whose lines this month so far differ from their usual amount by 20% or more, either way, less what the token's user dismissed in the app. Each has direction, party_id, party_name, supplier_id and supplier_name (null for income), currency, amount_minor (this month's net so far, negative for expenses), typical_amount_minor, change_percent (signed, rounded: 38 is 38% more than usual), changed, typical_day, transaction_id (the month's latest line), project_id, project_name, category_id, category_name, source (auto or user), pace and alert_key. Largest change first.", {}),
    toolSpec("get_line_recurring", "Whether a line's supplier or customer counts as recurring: transaction_id, party (direction, id, name, currency; null when the line has neither), recurring (what counts), override (the owner's switch from set_line_recurring, or null when the rule decides), detected (what the rule alone says), typical_day and typical_amount_minor (null when not recurring), pace (what counts), pace_override (set_line_pace), detected_pace and next_due_month (YYYY-MM).", {
      transaction_id: { type: "string" },
    }),
    toolSpec("get_line_charges", "A line's charges from the same supplier (expense) or customer (income) in its currency, as the app's \"לעומת הרגיל\" sheet shows them: transaction_id, party (direction, id, name, currency; null when the line has neither), month (YYYY-MM, the line's), month_amount_minor (the party's total that month), typical_amount_minor (the recurring rule's usual amount when the party recurs, else the median of its earlier complete months, at least 2 of the last 6; null otherwise), typical_source (recurring or earlier_months), change_percent (signed, rounded, by size: 92 is 92% more than usual), others (its other charges in the last 24 months), months[] (the 6 months up to the line's, oldest first: month, amount_minor) and charges[] (the 12 newest: id, doc_date, amount_minor, pending). Expenses are negative.", {
      transaction_id: { type: "string" },
    }),
    toolSpec("get_recurring_this_month", "Every recurring supplier and customer seen this month (the app's הגיעו החודש), as get_recurring_changes rows without the 20% filter or the dismissals: direction, party_id, party_name, currency, amount_minor, typical_amount_minor, change_percent, changed (true at 20% or more either way), typical_day, transaction_id, project and category, source and pace. Expenses first, then by name.", {}),
    toolSpec("list_unpaid", "Open SUMIT invoices (an amount still open after linked receipts and credit notes), oldest first, as the Unpaid screen lists them: customer invoices (direction income, positive) and supplier invoices (direction expense, negative). Each has id (the transaction id), description, doc_date, currency, direction, project_name, customer_name, open_gross_minor, open_net_minor, and marked_paid_at: when the owner marked it paid while SUMIT has no receipt yet (null when not marked; set_invoice_paid), and document_url: the SUMIT document link on pay.sumit.co.il (null until a sync reads it). A marked one stays listed until a sync closes it. totals[] per currency and direction: open_gross_minor sums the rows not marked, marked_gross_minor the marked ones.", {}),
    toolSpec("list_team", "The company's team: members (the owner first, then editors and viewers, each with user_id, name from their Google profile or else the email, email, role owner, editor or viewer, and you for the token's own user), role (this user's), can_manage (true for the owner), and for the owner the pending invites (id, email, role, created_at).", {}),
  ];
}

function syncStatusSpec() {
  return toolSpec("get_sync_status", "State of a sync_bank job: running, done, or failed. job_id is from sync_bank. When done it has added, duplicates (lines already stored, skipped), removed, and newest_date. When failed it has error.", {
    job_id: { type: "string" },
  });
}

/** get_sync_status is allowed with read or write scope. Other tools need their own scope. */
export function scopeAllows(name: string, scope: string[]): boolean {
  if (name === SYNC_STATUS_TOOL) return scope.includes("read") || scope.includes("write");
  if ((WRITE_TOOL_NAMES as readonly string[]).includes(name)) return scope.includes("write");
  if ((READ_TOOL_NAMES as readonly string[]).includes(name)) return scope.includes("read");
  return false;
}

const SHARES_SPEC = {
  type: "array",
  items: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      share: { type: "integer" },
      amount_minor: { type: "integer" },
    },
    required: ["project_id"],
    additionalProperties: false,
  },
};

const LINE_PARTS_SPEC = {
  type: "array",
  items: {
    type: "object",
    properties: {
      category_id: { type: "string" },
      project_id: { type: ["string", "null"] },
      amount_minor: { type: "integer" },
      percent: { type: "number" },
      rest: { type: "boolean", enum: [true] },
    },
    additionalProperties: false,
  },
};

function writeTools() {
  return [
    toolSpec("assign_expense", "Assign one expense or income line to a project and category. An open review is closed. A line needs a project unless its category is an income category kept out of the P&L; then project_id can be left out or null. The category kind decides the P&L side, so an outflow under an income category is a reversal (negative income) and an inflow under an expense category is a reversal (negative expense). An income-kind category needs a project, also on an outflow.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      project_id: { type: ["string", "null"] },
      category_id: { type: "string" },
      remember: { type: "boolean" },
    }, true),
    toolSpec("assign_expense_split", "Split one expense across projects. Each share is a whole percent (share; shares sum to 100) or an exact amount in cents (amount_minor; all shares then give amount_minor and sum to the line exactly: parts must sum to the line, parts exceed the line). Optional category_id sets the category like assign_expense.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      category_id: { type: "string" },
      shares: SHARES_SPEC,
    }, true),
    toolSpec("assign_expenses", "Assign up to 200 expenses in one write. Partial success is allowed. A row with shares[] splits that expense like assign_expense_split. A row with only transaction_id and parts[] runs split_line on that line (same parts; parts [] clears the split); its undo_kind is line_split. remember needs project_id on the same row. undo_batch with the returned batch_key undoes the rows that succeeded.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transaction_id: { type: "string" },
            project_id: { type: "string" },
            category_id: { type: "string" },
            remember: { type: "boolean" },
            shares: SHARES_SPEC,
            parts: LINE_PARTS_SPEC,
          },
          required: ["transaction_id"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("set_expense_category", "Set one expense category. Shares stay. An open review is closed. A category of the other kind is a reversal: an outflow under an income category is negative income, an inflow under an expense category is negative expense.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      category_id: { type: "string" },
    }, true),
    toolSpec("create_project", "Create a project in the owner's company.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      status: { type: "string", enum: ["active", "finished"] },
    }, true),
    toolSpec("create_category", "Create a category in the owner's company. parent_id (optional) puts it under a parent category of the same kind, as a sub-category (one level; not a loan category).", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: ["expense", "income"] },
      parent_id: { type: ["string", "null"] },
    }, true),
    toolSpec("create_projects", "Create up to 100 projects in one write, for a company setup. Partial success is allowed: each row returns ok with its id, or a code; a name that is already taken returns existing_id. undo_batch with the returned batch_key removes the rows that were created.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["active", "finished"] },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("create_categories", "Create up to 100 categories in one write, for a company setup. Partial success is allowed: each row returns ok with its id, or a code; a name already taken for that kind returns existing_id. undo_batch with the returned batch_key removes the rows that were created.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["expense", "income"] },
            parent_id: { type: ["string", "null"] },
          },
          required: ["name", "kind"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("sync_bank", "Start a pull of the latest Mercury bank lines for this company. Returns job_id and state at once; poll get_sync_status with job_id until state is done or failed. The same idempotency_key returns the same job.", {
      idempotency_key: { type: "string" },
    }, true),
    toolSpec("hide_category", "Hide a category. Undo restores the prior hidden flag. Hiding it again while this user's earlier hide can still be undone keeps that one undo.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
    }, true),
    toolSpec("set_category_pnl", "Count a category in the P&L or keep it out. Undo restores the prior setting.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
      excluded: { type: "boolean" },
    }, true),
    toolSpec("set_overhead_project", "Mark one project as the company's overhead project, so cost filed to it counts as overhead, not direct. project_id null clears it. Undo is kind overhead_project with the company id.", {
      idempotency_key: { type: "string" },
      project_id: { type: ["string", "null"] },
    }, true),
    toolSpec("rename_company", "Rename this company. 2 to 100 characters (code points) after trimming, with no control character. Undo restores the prior name.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
    }, true),
    toolSpec("invite_member", "Invite someone to this company by email (owner only), as Settings → צוות → הזמנה does. role is viewer (read only, the default) or editor (can file, split and change lines, but not the team, the company's name or currency, connectors or Jev settings). No email is sent: they see the invite after signing in with Google with that email, and join or decline it. Inviting an email with a pending invite again changes its role and returns existing true (no undo). The owner's own email or a member's is refused (already a member). Returns id, email (lower case), role, status, existing and undo_kind; undo is kind invite with the invite id and cancels it while it is still pending.", {
      idempotency_key: { type: "string" },
      email: { type: "string" },
      role: { type: "string", enum: ["editor", "viewer"] },
    }, true),
    toolSpec("set_member_role", "Change a member's role (owner only): editor or viewer. member_id is the member's user_id from list_team. Returns user_id, role, prior_role and undo_kind; undo is kind member_role with the user id, a conflict once the role changed again.", {
      idempotency_key: { type: "string" },
      member_id: { type: "string" },
      role: { type: "string", enum: ["editor", "viewer"] },
    }, true),
    toolSpec("remove_member", "Remove a member from this company (owner only); they lose access at once. member_id is the member's user_id from list_team; the owner is not a member. Returns user_id, prior_role and undo_kind; undo is kind member_remove with the user id and adds them back with that role.", {
      idempotency_key: { type: "string" },
      member_id: { type: "string" },
    }, true),
    toolSpec("add_loan", "Create a loan with a computed level payment unless payment is set. project_id (optional) files the loan under a project of this company; another company's project is refused. kind (default amortizing): interest_only needs interest_only_months (1 to term_months; those months pay interest only, then it amortizes over the months left, and when they equal the term the principal is due in the last month); balloon needs amortization_months (term_months to 600; the payment is the annuity over them and the rest is due at the term); demand takes no term_months, payment or escrow (interest accrues daily on actual/365 between payments; a 0% rate is allowed).", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      principal: { type: "string" },
      annual_rate_percent: { type: "number" },
      term_months: { type: "integer" },
      start_date: { type: "string" },
      payment: { type: "string" },
      escrow: { type: "string" },
      currency: { type: "string" },
      project_id: { type: "string" },
      kind: { type: "string", enum: ["amortizing", "interest_only", "balloon", "demand"] },
      interest_only_months: { type: "integer" },
      amortization_months: { type: "integer" },
    }, true),
    toolSpec("update_loan", "Patch loan terms. Currency cannot change. project_id files the loan under a project; null clears it; leaving it out keeps it. Payments already attached stay on the project they were filed under. status paid_off or closed needs closed_on (YYYY-MM-DD); a closed loan takes only payments dated on or before it, and closing before a payment already attached is refused (payments after closed_on). status open reopens the loan and clears closed_on. A loan that is not open returns balance_left, the principal Flow never saw paid. interest_category_id, escrow_category_id and principal_category_id file that part of later attached payments under a category of this company (null goes back to the default): interest and escrow take any expense category, counted in the P&L or kept out (a kept-out one keeps that part out of profit, such as a hard-money loan's interest carried as a project cost), principal needs one kept out, and a built-in loan category takes only its own part (category does not fit the loan part). fees_category_id files the fees part of later payments when the attach names none: any expense category, counted in the P&L or kept out, that is not a built-in loan category, or the built-in interest one (category does not fit the loan part); null clears it, and there is no default. Payments already attached keep their categories. kind changes the loan's kind (interest_only needs interest_only_months, balloon amortization_months; demand clears the term, payment and escrow; another kind from demand needs term_months and payment); interest_only_months and amortization_months alone change that field. Undo restores the previous project, status, closed_on, categories and kind.", {
      idempotency_key: { type: "string" },
      loan_id: { type: "string" },
      name: { type: "string" },
      principal: { type: "string" },
      annual_rate_percent: { type: "number" },
      term_months: { type: "integer" },
      start_date: { type: "string" },
      payment: { type: "string" },
      escrow: { type: "string" },
      project_id: { type: ["string", "null"] },
      status: { type: "string", enum: ["open", "paid_off", "closed"] },
      closed_on: { type: ["string", "null"] },
      interest_category_id: { type: ["string", "null"] },
      escrow_category_id: { type: ["string", "null"] },
      principal_category_id: { type: ["string", "null"] },
      fees_category_id: { type: ["string", "null"] },
      kind: { type: "string", enum: ["amortizing", "interest_only", "balloon", "demand"] },
      interest_only_months: { type: "integer" },
      amortization_months: { type: "integer" },
    }, true),
    toolSpec("attach_loan_payment", "Split one expense line across interest, escrow, and principal, plus an optional fees part. Interest, escrow and principal go under the loan's own category for that part or the default. Fees have no default: they go under this call's fees_category_id (allowed only with fees), else the loan's fees_category_id, else the attach is refused (fees category required). A fees category is any expense category, in or out of the P&L, that is not a built-in loan category or is the built-in interest one (category does not fit the loan part; category not found for another company's). By default the parts follow the schedule row for the line's date: principal takes what is left over, and a shortfall comes out of principal, then escrow, then interest. installments (1 to 12) makes the payment cover that many schedule rows from the first one not yet paid (the first row whose scheduled interest plus principal through it is more than the interest plus principal already attached, pending lines included), using their sums (not enough schedule rows when they run past the schedule). A demand loan has no rows: interest is the balance times the rate for the days since the last attached payment (or the start), on actual/365, rounded half to even, plus interest earlier payments left unpaid (carried, simple interest), and the rest is principal; installments are refused (a demand loan has no schedule rows), and so are a line dated before the loan start (payment before the loan start) and one dated before a payment already attached (a later payment is already attached; a replay of the same attach is not refused). fees (an amount above zero) comes off the line first, then the rest splits as usual (fees exceed the line when the line is smaller). parts {interest, escrow, principal, fees?} gives the exact amounts, used as given; they must add up to the line exactly (parts don't add up), fees must be above zero, and parts cannot be combined with installments or fees. Amounts take at most two decimals. The schedule figures are still kept for comparison (0 when no row fits the date). Principal above the loan balance is refused (loan balance exceeded). The response lists each part, the fees part too when there is one. When the loan has a project and the line has no project, no shares and no role, the line is filed as a direct cost on that project, so interest and escrow count there and principal is kept out of the P&L (project_inherited true). Otherwise the line is left as it is and project_inherited_reason says why (a guessed category is not filed: confirm it with assign_expense; if filing fails the parts stay attached and the reason is project not set). A paid-off or closed loan takes only lines dated on or before its closed_on (loan closed). Undo of loan_split restores the line's previous project when nobody changed it since.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      loan_id: { type: "string" },
      installments: { type: "integer" },
      fees: { type: "string" },
      parts: {
        type: "object",
        properties: {
          interest: { type: "string" },
          escrow: { type: "string" },
          principal: { type: "string" },
          fees: { type: "string" },
        },
        required: ["interest", "escrow", "principal"],
        additionalProperties: false,
      },
      fees_category_id: { type: "string" },
    }, true),
    toolSpec("set_loan_rate", "Set a loan's rate from effective_date (YYYY-MM-DD) on: annual_rate_percent (0 to 100, up to 4 decimals) is the nominal rate, entered by hand when an index such as prime changes; null removes that date's rate row (rate not found when there is none). A date before the loan's start_date is refused (rate before the loan start). The rate in force on a schedule row's date, or on each day of a demand loan's interest, is the latest row on or before it, else the loan's own rate. A change recasts the payment over the months left; payments already attached keep their parts. Returns the rate row id; undo is kind loan_rate with that id and puts the row back as it was.", {
      idempotency_key: { type: "string" },
      loan_id: { type: "string" },
      effective_date: { type: "string" },
      annual_rate_percent: { type: ["number", "string", "null"] },
    }, true),
    toolSpec("set_loan_index", "Link a loan's rate to an index (FLOW-137): rate_index il_prime (the Bank of Israel prime rate) and margin_percent, the loan's margin over it (-100 to 100, up to 4 decimals; 0.75 for prime + 0.75%). Both null unlink the loan. Linking writes no rate by itself: set_index_rate does, from a date. Returns loan_id, rate_index, rate_margin_ppm, previous (the link before) and undo_kind; undo is kind loan_index with the loan id, a conflict once the link changed again. list_loans shows rate_index and rate_margin_ppm.", {
      idempotency_key: { type: "string" },
      loan_id: { type: "string" },
      rate_index: { type: ["string", "null"], enum: ["il_prime", null] },
      margin_percent: { type: ["number", "string", "null"] },
    }, true),
    toolSpec("set_index_rate", "Record a new index rate from effective_date (YYYY-MM-DD) on, for example when the Bank of Israel moves prime: every loan linked to rate_index (set_loan_index) gets a rate row on that date at annual_rate_percent (0 to 100, up to 4 decimals) plus its margin, kept between 0% and 100%, as set_loan_rate would write it (a row already on that date is replaced). A loan that starts after the date, or was paid off or closed before it, is skipped and listed in skipped. Refused when no loan is linked (no loan linked to this index) or every linked loan is skipped (no linked loan is open on this date). Returns id (the write), loans (loan_id, name, rate_id, annual_rate_ppm, previous_rate_ppm), skipped and undo_kind; undo is kind index_rate with that id and puts every row back as it was, all or nothing: a conflict when any of them changed since.", {
      idempotency_key: { type: "string" },
      rate_index: { type: "string", enum: ["il_prime"] },
      effective_date: { type: "string" },
      annual_rate_percent: { type: ["number", "string"] },
    }, true),
    toolSpec("split_line", "Split one bank line into parts, each with its own category and optional project, and exactly one of: amount_minor (exact cents), percent (of the whole line, above 0 up to 100, at most 4 decimals), or rest: true (whatever the other parts leave; at most one; without category_id it keeps the line's own category). Percent parts are rounded together so they hit the line to the cent; a rest with nothing left is dropped. Without a rest part the parts must sum to the line. A part without project_id keeps the line's project. A part whose category is the other kind (an expense category on a refund inflow, an income category on an outflow) is a reversal and needs project_id, unless its category is kept out of the P&L and the line is not put back in it. A part without project_id and one naming the line's project, with the same category, are the same pair (refused). Returns the stored parts in cents. parts [] clears the split. When the bank changes a split line's amount, it counts whole and list_review shows it with reason split_mismatch; that review does not block split_line, and new parts or parts [] close it. Undo is kind line_split with the transaction id.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      parts: LINE_PARTS_SPEC,
    }, true),
    toolSpec("set_line_pnl", "Take one line out of the P&L (in_pnl false), count it although its category is kept out (in_pnl true), or follow its category again (in_pnl null). Covers every part of a split line. A loan line is refused. in_pnl true is refused (a reversal part needs a project) while a split part of the other kind in a kept-out category has no project. Returns the line's in_pnl. Undo is kind line_pnl with the transaction id.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      in_pnl: { type: ["boolean", "null"] },
    }, true),
    toolSpec("set_lines_pnl", "set_line_pnl for up to 200 lines in one write. Partial success is allowed. undo_batch with the returned batch_key undoes the rows that succeeded.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transaction_id: { type: "string" },
            in_pnl: { type: ["boolean", "null"] },
          },
          required: ["transaction_id", "in_pnl"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("set_invoice_paid", "Mark one open invoice from list_unpaid as paid (paid true) while SUMIT has no receipt for it yet, or clear the mark (paid false). A marked document leaves the unpaid total but stays listed with marked_paid_at until a sync closes it; marking again keeps the first time. A line list_unpaid does not list is refused (invoice not found). Totals and the P&L do not change. Undo is kind invoice_paid with the transaction id.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      paid: { type: "boolean" },
    }, true),
    toolSpec("detach_loan_payment", "Take one line off the loan it was attached to (attach_loan_payment, or matched in the app): its interest, escrow, principal and fees parts are removed, so the line counts whole under its own category again and the loan balance no longer counts its principal. The line keeps its project and category (undo of loan_split gives back a project the attach filed, but only before the detach or after undoing it). A line with no loan split is refused (line has no loan split). Returns the loan_id and the parts taken off, in cents. Undo is kind loan_detach with the transaction id: it puts the same parts back, and is a conflict when the line was matched again, the parts no longer fit (the line or the loan changed), or a demand loan has a later payment matched since.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
    }, true),
    toolSpec("delete_loan", "Delete a loan with its rate rows and the split parts of every payment matched to it: those payments count whole again under their own categories, and the loan's principal no longer counts. Returns the loan's name and payments (how many lines were unmatched). Undo is kind loan_delete with the loan id: it puts back the loan, its rates and its parts, and is a conflict when a payment was removed, matched again or changed since, or not_found when the owner already restored it in the app.", {
      idempotency_key: { type: "string" },
      loan_id: { type: "string" },
    }, true),
    toolSpec("reorder_loans", "Save the order of the loans list: loan_ids names every loan of the company once (open and closed; list_loans gives them), first to last. A list that leaves one out, names one twice or names another company's loan is validation. list_loans returns loans in this order; a loan added since goes last. Undo is kind loan_order with the id this returns (the company id): it puts back the order before, and is a conflict when the order changed or a loan was added or deleted since.", {
      idempotency_key: { type: "string" },
      loan_ids: { type: "array", items: { type: "string" } },
    }, true),
    toolSpec("set_project_investment", "Set a project's investment figures: currency (ISO code like USD or ILS, default ILS: the currency of the figures, rehab and equity; it cannot be cleared), purchase_minor (what it cost to buy), arv_minor (the after-repair value), value_minor (what it is worth today), all in minor units of that currency (cents for USD), and value_date (YYYY-MM-DD, when that value was estimated). Name at least one; a key left out keeps its figure and null clears it. Amounts are whole minor units, 0 or more. Changing the currency does not convert the figures. get_project returns them in investment with rehab and equity. Returns the currency and figures after. Undo is kind project_investment with the project id: it puts back the currency and figures before, and is a conflict when they changed since. Another company's project is refused (project not found).", {
      idempotency_key: { type: "string" },
      project_id: { type: "string" },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      purchase_minor: { type: ["integer", "null"] },
      arv_minor: { type: ["integer", "null"] },
      value_minor: { type: ["integer", "null"] },
      value_date: { type: ["string", "null"] },
    }, true),
    toolSpec("set_category_rehab", "Count a category as rehab on projects (rehab true), leave it out (false), or follow the default (null). By default every category counts but those kept out of the P&L and the loan parts (interest, escrow, principal, and a payment's fees part in any category unless that category is switched on). Switching on the principal category counts repayments, while the loan is already in current equity. rehab is get_project's investment.rehab_minor. Returns rehab and in_rehab (what the category comes to). Undo is kind category_rehab with the category id: it puts back the setting before, and is a conflict when it changed since.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
      rehab: { type: ["boolean", "null"] },
    }, true),
    toolSpec("delete_category", "Delete a category, even one with lines. Its lines lose the category and go back to review (לאישור) with none; a line split by category loses its whole split; suppliers forget it as their remembered category. Refused for a loan part category (loan category is fixed) and while a loan or a loan payment part uses it (a loan uses this category). Returns name and lines (how many lines on the books went back to review). Undo is kind category_delete with the category id: it puts the category back with its lines, splits and remembered suppliers, and is a conflict once one of those lines has a category or a split again, or the name is taken again.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
    }, true),
    toolSpec("move_category_lines", "Move every line of one category to another of the same kind, without hiding the source (merge_category hides it). Split parts, loan payment parts, loan part categories and remembered supplier categories move too. Refused when the target is the same category, hidden, of another kind, when a split line has parts in both, or when a loan part cannot take the target. Returns from, into and lines (lines on the books moved). Undo is kind category_move with the source category id: it moves exactly those back, and is a conflict once any of them was moved or re-tagged since.", {
      idempotency_key: { type: "string" },
      from_category_id: { type: "string" },
      into_category_id: { type: "string" },
    }, true),
    toolSpec("set_company_currency", "Set the company's base currency (owner only), a three-letter code such as ILS or USD. Nothing is converted: the base currency's row leads every by_currency list, it is the default for a new loan, a new project's investment and get_breakdown, and the *_minor twins of the ILS-only figures (get_home net_profit_minor, prev_* per currency, overhead_share_minor) are in it. Returns id, base_currency and prior. Undo is kind company_currency with the company id, a conflict once the currency was changed again.", {
      idempotency_key: { type: "string" },
      currency: { type: "string" },
    }, true),
    toolSpec("rename_category", "Rename a category (owner only), for example to Hebrew. name is 2 to 120 letters, trimmed, and must not be another category's of the same kind. The id stays, so its lines, splits, loans, remembered suppliers and flags stay; loan categories can be renamed (match them by loan_part). Returns category_id, name, prior (the old name) and undo_kind. Refused: category already exists, category name is too short, category name is too long, category not found. Undo is kind category_name with the category id, a conflict once it was renamed again or while another category has the old name.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
      name: { type: "string" },
    }, true),
    toolSpec("set_category_parent", "Put a category under a parent category (owner only), as a sub-category: one level, the same kind, and never a loan category; a parent keeps its own lines. null takes it out. Refusals: category_parent_nested (the parent has a parent, or the category has sub-categories), category_parent_kind, category_parent_loan_part. Returns category_id, parent_id, prior and undo_kind. Undo is kind category_parent with the category id, a conflict once the parent was changed again.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
      parent_id: { type: ["string", "null"] },
    }, true),
    toolSpec("set_category_group", "Older form of set_category_parent (FLOW-406): puts a category under the parent category with this name, making that parent when none has it (owner only); null or blank takes it out. Up to 40 letters, trimmed. Returns category_id, group_name, prior and undo_kind. Undo is kind category_group with the category id, a conflict once the group was changed again.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
      group_name: { type: ["string", "null"] },
    }, true),
    toolSpec("create_project_group", "Create a project group (owner only), 2 to 120 letters, a name the company doesn't use for another group. Returns id, name and undo_kind. Undo is kind project_group with the group id; it deletes the group while it holds no project, a conflict otherwise.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
    }, true),
    toolSpec("set_project_group", "Put a project in a group (owner only), or take it out with group_id null. A project is in one group at most; moving it to another takes it out of the first. Company totals don't change. Returns project_id, group_id, prior and undo_kind. Undo is kind project_group_member with the project id, a conflict once its group was changed again.", {
      idempotency_key: { type: "string" },
      project_id: { type: "string" },
      group_id: { type: ["string", "null"] },
    }, true),
    toolSpec("set_jev_mode", "Turn the Jev AI tagger on or off and choose its mode, as Settings → תיוג חכם does (members who can write, not a viewer). enabled is the switch; mode is shadow (suggestions only), auto (Jev fills a project and category at or above the threshold; the owner still approves every line, and undo_jev_prefill takes a fill back) or off; threshold is 0.50 to 1 (the app offers 0.80, 0.85, 0.90 and 0.95). A mode or threshold left out keeps the stored one (shadow and 0.90 at first). Returns id (the company), enabled, mode, threshold, prior (the values before, or null when Jev was never set) and undo_kind. Undo is kind jev_mode with the company id: it puts the values before back, a conflict once they changed again. get_jev_status reads the current values.", {
      idempotency_key: { type: "string" },
      enabled: { type: "boolean" },
      mode: { type: "string", enum: ["off", "shadow", "auto"] },
      threshold: { type: "number" },
    }, true),
    toolSpec("set_category_cash", "Count a category in the cash view (get_cash_months) or keep it out. in_cash false leaves its lines out of the view, unless a line's own set_line_cash keeps it in; a line whose category is only a guess still counts. Separate from the P&L switch (set_category_pnl). Returns id, in_cash and undo_kind; undo is kind category_cash with the category id, a conflict once the flag was changed again.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
      in_cash: { type: "boolean" },
    }, true),
    toolSpec("set_line_cash", "Take one line out of the cash view (in_cash false), keep it in although its category is out (in_cash true), or follow its category again (in_cash null). Covers every part of a split line or a loan payment. Separate from the P&L switch (set_line_pnl). Returns id, in_cash_override, cash_state (in, out or mixed) and undo_kind; undo is kind line_cash with the transaction id, a conflict once the line's switch was changed again.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      in_cash: { type: ["boolean", "null"] },
    }, true),
    toolSpec("set_lines_cash", "set_line_cash for up to 200 lines in one write. Partial success is allowed. undo_batch with the returned batch_key undoes the rows that succeeded.", {
      idempotency_key: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transaction_id: { type: "string" },
            in_cash: { type: ["boolean", "null"] },
          },
          required: ["transaction_id", "in_cash"],
          additionalProperties: false,
        },
      },
    }, true),
    toolSpec("set_cash_basis", "Set the month the cash view counts a line in (owner only): paid (the default) is the payment date, and an open invoice is not cash yet; invoice is the document date, open invoices included. It is the company's one date choice: the P&L tools called without a basis follow it too (paid as cash, invoice as invoiced), as the app does. Returns basis, prior_basis and undo_kind; undo is kind cash_basis with the company id (id in the result), a conflict once the basis was changed again.", {
      idempotency_key: { type: "string" },
      basis: { type: "string", enum: ["paid", "invoice"] },
    }, true),
    toolSpec("set_line_recurring", "Mark a line's supplier (or customer) recurring (true) or not (false) in that line's currency, or leave it to the automatic rule again (null). The switch wins over the rule in get_missing_bills, get_recurring_changes and get_expected_months, and covers every line of that party in that currency. A line with no supplier or customer is refused. Returns the state as get_line_recurring, plus id and undo_kind; undo is kind line_recurring with the transaction id, a conflict once the switch was changed again.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      recurring: { type: ["boolean", "null"] },
    }, true),
    toolSpec("set_line_pace", "Set how often a line's supplier (or customer) recurs in that line's currency: month, 2months, quarter or year; null goes back to the detected pace. Late bills (get_missing_bills) and expected months follow it. It does not make a party recurring; set_line_recurring does. Returns the state as get_line_recurring, plus id and undo_kind; undo is kind line_pace with the transaction id, a conflict once the pace was changed again.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      pace: { type: ["string", "null"], enum: ["month", "2months", "quarter", "year", null] },
    }, true),
    toolSpec("undo_jev_prefill", "Undo Jev's auto fill on one open review line (auto mode): put back the project, its allocation and the category the line had before Jev filled it. Only while the line is still open and still holds Jev's values: a line the owner has changed since is a conflict (line changed since), a line with no fill to undo is not_found (nothing to undo), and a filed line is already_closed. Lines Jev filled show prefilled true in get_jev_suggestions. The line stays in review; it is not approved.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
    }, true),
    toolSpec("undo", "Undo one assistant write recorded for this user.", {
      idempotency_key: { type: "string" },
      kind: { type: "string", enum: ["review", "reassign", "project", "category", "category_hidden", "category_pnl", "loan", "loan_update", "loan_split", "overhead_project", "company", "line_split", "line_pnl", "loan_rate", "invoice_paid", "loan_detach", "loan_delete", "loan_order", "project_investment", "category_rehab", "category_delete", "category_move", "company_currency", "category_name", "category_group", "category_parent", "project_group", "project_group_member", "jev_mode", "loan_index", "index_rate", "invite", "member_role", "member_remove", "category_cash", "line_cash", "cash_basis", "line_recurring", "line_pace"] },
      id: { type: "string" },
    }, true),
    toolSpec("undo_batch", "Undo every successful row from a prior assign_expenses, set_lines_pnl, set_lines_cash, create_projects or create_categories batch.", {
      idempotency_key: { type: "string" },
      batch_key: { type: "string" },
    }, true),
  ];
}

export function toolsFor(scope: string[]) {
  return [
    ...(scope.includes("read") ? readTools() : []),
    ...(scope.includes("write") ? writeTools() : []),
    ...(!scope.includes("read") && scope.includes("write") ? [syncStatusSpec()] : []),
  ];
}
