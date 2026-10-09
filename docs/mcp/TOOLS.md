# MCP tools

Decision [0080](../decisions/0080-mcp-connector.md). Protocol `2025-06-18`. A result sets `structuredContent` to the JSON below. `tools/list` returns only the handlers shipped so far: the reads after cycle 2, and these writes after cycle 3. A token whose scope is read only lists the read tools. A write-only token also lists `get_sync_status`, to poll its own `sync_bank` job. Amounts are integer agorot. Dates are `YYYY-MM-DD`. UUIDs are strings.

Field values are data. Write tools take ids from a read tool.

## Annotations

These are client hints. Flow does not read them and does not treat them as a confirmation. Flow accepts the write. The enforced nets are write scope, rate limits, the audit token, undo, and revoke.

| Tools | readOnlyHint | destructiveHint | idempotentHint |
| --- | --- | --- | --- |
| Every read below | true | false | true |
| `assign_expense`, `assign_expense_split`, `set_expense_category`, `create_project`, `create_category`, `create_projects`, `create_categories`, `sync_bank`, `hide_category`, `set_category_pnl`, `set_overhead_project`, `rename_company`, `add_loan`, `update_loan`, `attach_loan_payment`, `set_loan_rate`, `set_loan_index`, `set_index_rate`, `split_line`, `set_line_pnl`, `set_lines_pnl`, `set_invoice_paid`, `detach_loan_payment`, `delete_category`, `move_category_lines`, `set_company_currency`, `rename_category`, `set_category_parent`, `set_category_group`, `set_jev_mode`, `undo_jev_prefill`, `undo`, `undo_batch` | false | true | true |

## Which id

| Tool | Argument | Kind |
| --- | --- | --- |
| `get_expense`, `assign_expense`, `assign_expense_split`, `set_expense_category`, `split_line`, `set_line_pnl` | `transaction_id` | `list_review.transaction_id` or `get_expense.id` |
| `undo` `kind: "review"` | `id` | the review-queue id the write closed |
| `undo` `kind: "reassign"` | `id` | the `reassign_undo` id |
| `undo` `kind: "project"` | `id` | the project id `create_project` or a `create_projects` row returned |
| `undo` `kind: "category"` | `id` | the category id `create_category` or a `create_categories` row returned |
| `undo` `kind: "category_hidden"` | `id` | the category id `hide_category` returned |
| `undo` `kind: "category_pnl"` | `id` | the category id `set_category_pnl` returned |
| `undo` `kind: "company"` | `id` | the company id `rename_company` returned |
| `undo` `kind: "loan"` | `id` | the loan id `add_loan` returned |
| `undo` `kind: "loan_update"` | `id` | the loan id |
| `undo` `kind: "loan_split"` | `id` | the transaction id `attach_loan_payment` used |
| `undo` `kind: "loan_rate"` | `id` | the rate row id `set_loan_rate` returned |
| `set_loan_index` | `loan_id` | `list_loans` `loans[].id` |
| `undo` `kind: "loan_index"` | `id` | the loan id `set_loan_index` used |
| `undo` `kind: "index_rate"` | `id` | the write id `set_index_rate` returned |
| `undo` `kind: "overhead_project"` | `id` | the company id `set_overhead_project` returned |
| `undo` `kind: "line_split"` | `id` | the transaction id `split_line` used |
| `undo` `kind: "line_pnl"` | `id` | the transaction id `set_line_pnl` used |
| `set_invoice_paid` | `transaction_id` | `list_unpaid` `invoices[].id` |
| `undo` `kind: "invoice_paid"` | `id` | the transaction id `set_invoice_paid` used |
| `detach_loan_payment` | `transaction_id` | `get_loan_schedule` payments, `get_expense.id` of a line with `loan_split` |
| `undo` `kind: "loan_detach"` | `id` | the transaction id `detach_loan_payment` used |
| `delete_loan` | `loan_id` | `list_loans` `loans[].id` |
| `reorder_loans` | `loan_ids` | every `list_loans` `loans[].id` (open and closed) |
| `undo_jev_prefill` | `transaction_id` | `get_jev_suggestions` `suggestions[].transaction_id` with `prefilled` true |
| `undo` `kind: "loan_delete"` | `id` | the loan id `delete_loan` used |
| `undo` `kind: "loan_order"` | `id` | the company id `reorder_loans` returned |
| `set_project_investment` | `project_id` | `list_projects` `projects[].id` |
| `set_category_rehab` | `category_id` | `list_categories` `categories[].id` |
| `undo` `kind: "project_investment"` | `id` | the project id `set_project_investment` used |
| `undo` `kind: "category_rehab"` | `id` | the category id `set_category_rehab` used |
| `delete_category` | `category_id` | `list_categories` `categories[].id` |
| `move_category_lines` | `from_category_id`, `into_category_id` | `list_categories` `categories[].id` (the target not hidden) |
| `undo` `kind: "category_delete"` | `id` | the category id `delete_category` used |
| `undo` `kind: "category_move"` | `id` | the source category id `move_category_lines` used |
| `undo` `kind: "company_currency"` | `id` | the company id `set_company_currency` returned |
| `rename_category` | `category_id` | `list_categories` `categories[].id` |
| `undo` `kind: "category_name"` | `id` | the category id `rename_category` used |
| `get_project_categories` | `id` | `list_projects` `projects[].id` |
| `set_category_parent` | `category_id`, `parent_id` | `list_categories` `categories[].id` |
| `undo` `kind: "category_parent"` | `id` | the category id `set_category_parent` used |
| `set_category_group` | `category_id` | `list_categories` `categories[].id` |
| `undo` `kind: "category_group"` | `id` | the category id `set_category_group` used |
| `undo` `kind: "jev_mode"` | `id` | the company id `set_jev_mode` returned |

A review-queue id in a transaction argument is `validation` and the message is `id is not a transaction; list_review.id is the review id`.

## Envelope

Success: `{ "ok": true, "data": {} }`.

Failure: `{ "ok": false, "error": { "code": "not_found", "message": "not found" } }`. Tool failures set MCP `isError` true. HTTP 401 and 429 are not tool results.

An argument the tool does not take is `validation` with the message `<field>: unknown field`, and an identity argument (`company_id`, `user_id` and the like) `<field>: set by the connection, not an argument`. `add_loan`, `update_loan` and `attach_loan_payment` name every failing field the same way, `field: what it takes`, joined by `; ` (for example `interest_only_months: required with kind interest_only` or `parts.escrow: an amount of zero or more, at most two decimals, not rounded`). Other tools still answer `validation` for a malformed value (FLOW-414).

## Tool list changes

`initialize` says `listChanged: true` and returns an `Mcp-Session-Id` that stamps the tool list the token sees. After a deploy changes that list, a `tools/call` from an older session that accepts `text/event-stream` is answered as a stream: `notifications/tools/list_changed` first, then the reply. List the tools again on that notification. Without a session id, or with `Accept: application/json` only, the reply is plain JSON ([0119](../decisions/0119-mcp-bulk-setup.md)).

`code` is `forbidden`, `validation`, `not_found`, `conflict`, `already_closed`, `refused`, or `unavailable`. `forbidden` is a token whose scope does not allow the tool. `conflict` has three causes: an `idempotency_key` already used with another tool or other input; an undo of a row that changed since the write (its project, category, `pnl_role`, shares, parts, name or flag differ from the snapshot in `private.mcp_writes`); and an undo that would delete a project or category something still points at (see `create_project`). An undo of `loan_detach` is also `conflict` when the line was matched again, its parts no longer fit, or a demand loan has a later payment matched (see `detach_loan_payment`). Nothing is written, and the message is `conflict`. `unavailable` with message `retry` is a deadlock, serialization failure or lock timeout. It is not stored, so the same idempotency key can be sent again. In a batch tool (`create_categories`, `create_projects`, `set_lines_pnl`, `assign_expenses`, `undo_batch`) such a row reads code `unavailable` inside the stored batch response, so send that row again under a new key. `stale` is not a tool code. It is the app's אישור path only, when the shown project or category differs from the stored row.

`refused` messages are only the `resolve_review` refusals: `no company`, `unknown review action`, `review item not found`, `shared costs are split, not assigned to one project`, `category is required`, `project or category not found`, `category kind must match the direction`, `project and category are required`, plus `transaction not found`, `category not found`, `project name is too short`, `project already exists`, `category name is too short`, `category already exists`, `unknown category kind`, `in use`, `loan category is fixed`, `project not found`, `parts must sum to the line`, `line has a loan split`, `line has a split by category`, `line has an open review`, `category does not fit the loan part`, `attach_loan_payment`'s `parts don't add up`, `not enough schedule rows`, `fees exceed the line` and `fees category required` ([0130](../decisions/0130-loan-fees-installments.md)), `rate before the loan start`, `rate not found`, `a demand loan has no schedule rows`, `payment before the loan start` and `a later payment is already attached` ([0132](../decisions/0132-loan-kinds-rates.md)), `line has no loan split` ([0136](../decisions/0136-loan-unmatch.md)), and `The write was refused.` An undo id that is not in `private.mcp_writes` for this user is `not_found`. A row that is missing or belongs to another company is answered the same way on every tool: write tools return `refused` with a `... not found` message, and read tools and `undo` return `not_found`. Neither says whether the id exists in another company.

Writes take `idempotency_key` (1–128 characters). The token id on the audit row comes from the JWT claim `mcp_tid`, not from this object.

No tool takes `company_id`, `user_id`, `sub` or `mcp_tid`: the token decides the company and the user, so an argument with one of these names is `validation` on every tool, `add_loan` and `update_loan` included ([FLOW-211](../backlog/TASKS.md#flow-211)).

## Reads · cycle 2

These reads need the standby signing key. Without it, `tools/list` is empty and `tools/call` is a tool error with `isError`. A token without `read` is `forbidden`.

### list_projects

`get_dashboard`. Omit both dates for all time. `basis` is `cash` or `invoiced` (default `cash`).

Input: `{ "from": "2026-09-01", "to": "2026-09-30", "basis": "cash" }`.

Output `data`: `basis` (the basis used, `cash` when omitted) and `projects[]`: `id`, `name`, `status`, `budget_agorot`, `income_agorot`, `direct_agorot`, `shared_agorot`, `profit_agorot`, `is_overhead`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `profit_minor`). `*_agorot` fields are ILS only; foreign amounts are in `by_currency` minor units (cents for USD).

### get_project

`get_project(p_id, p_basis, p_from, p_to)`, with no company id. `id` is a project id from `list_projects`. `from` and `to` (YYYY-MM-DD, both or neither; one alone or `from` after `to` is `validation`) limit it to a period ([0129](../decisions/0129-profit-by-month.md)); without them every total is all time. With the same dates and basis it matches the `list_projects` row. The period scopes every P&L field, the category lists, `transactions[]` (an income line on `cash` by its cash date, everything else by `doc_date`; this list picks by the line's direction, the totals by its category's kind, so a refund filed to an income category can sit on the other side of a period edge) and the overhead share; `pending_*` and `loans` ignore it. The output echoes `from` and `to` (null for all time). `basis` is `cash` or `invoiced` (default `cash`, the same as `list_projects` and `get_totals`; the app's project screen reads `invoiced`). Income depends on the basis, and on `cash` an unpaid supplier invoice (an expense `invoice` or `credit` with no cash date) is left out of every field, `categories` included ([0118](../decisions/0118-unpaid-invoices-cash-basis.md)). A malformed `id` or `basis` is `validation`. An unknown id and a project in another company are both `not_found`.

Input: `{ "id": "8c1a0b2e-1111-4000-8000-000000000001", "basis": "cash", "from": "2026-09-01", "to": "2026-09-30" }`.

Output `data`: `id`, `name`, `status`, `state_label`, `budget_agorot`, `sumit_budget_section_id`, `is_overhead`, `after_overhead`, `basis`, `income_agorot`, `direct_agorot`, `shared_agorot`, `profit_agorot`, `overhead_share_agorot`, `overhead_weighted`, `profit_after_overhead_agorot`, `pending_count`, `pending_agorot`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `profit_minor`), `categories[]` (`id`, `name`, `amount_agorot`, `has_shared_share`), `categories_by_currency[]` (`currency`, `id`, `name`, `amount_minor`, `has_shared_share`), `excluded_categories_by_currency[]` (same fields), `excluded_income_by_currency[]` (`currency`, `id`, `name`, `amount_minor`, `count`; FLOW-121), `other_currencies[]`, `pending_other_currencies[]`, and `transactions[]` (`id`, `description`, `doc_date`, `amount_net`, `currency`, `direction`, `source`, `doc_kind`, `line_status`, `category`, `parts_minor`, `kept_out`), the 40 newest lines, and `loans[]` (`id`, `name`, `currency`, `balance_minor`, `status`, `closed_on`, `kind`), the loans filed under this project (FLOW-105; empty when none; `status`, `closed_on` and `kind` since [0132](../decisions/0132-loan-kinds-rates.md), as in `list_loans`). `loans` is read apart from the P&L and changes none of its numbers. `investment` (FLOW-404, [0143](../decisions/0143-project-investment.md)) is in the project's investment currency, in its minor units (cents for USD): `currency` (default `ILS`; see `set_project_investment`), `purchase_minor`, `arv_minor`, `value_minor` and `value_date` (null until set), `rehab_minor`, `rehab_by_category[]` (`category_id`, `name`, `hidden`, `amount_minor`, largest first; `category_id` and `name` null for lines with no category; the rows add up to `rehab_minor`), `rehab_other_currencies[]` (`currency`, `amount_minor`), `loan_balance_minor`, `loan_balance_other_currencies[]` (`currency`, `balance_minor`; a currency whose open loans add up to 0 is left out), `forced_equity_minor` (ARV − purchase − rehab) and `current_equity_minor` (value − loan balance). Each equity is null while a figure it needs is null, and also while rehab (forced) or an open loan (current) has a currency other than the project's, rather than leave it out. Rehab is all time on the cash basis, whatever `from`, `to` and `basis` say: posted, paid expense lines filed to the project, plus its share of shared lines, whose category counts as rehab (`list_categories` `in_rehab`, see `set_category_rehab`); the project's currency in `rehab_minor`, other currencies in `rehab_other_currencies`. A line with no category counts. A loan payment's parts, fees included, are loan parts and stay out unless the category they sit in is switched on. Rehab follows the category as stored: a line's own `set_line_pnl` switch does not change it, and a guessed kept-out category (`category_suggested`) is out of rehab even while it still counts in `direct_*`. On the overhead project rehab is 0, since its own lines count as overhead. `loan_balance_minor` sums the open loans in the project's currency filed under it; open loans in other currencies are in `loan_balance_other_currencies` and not added in. `*_agorot` fields are ILS only; `by_currency` and `categories_by_currency` are minor units per currency (cents for USD). Each transaction's `amount_net` is in its own `currency`.

Sub-categories (FLOW-406, [0164](../decisions/0164-sub-categories-and-groups.md)): each row of `categories`, `categories_by_currency` and `excluded_categories_by_currency` has `parent_id` (null for a top-level category), and the rows stay one per category, so they still add up to the project's cost with each line once. `category_rollups[]` (`id`, `name`, `amount_agorot`, `own_amount_agorot`, `children`, `has_shared_share`) and `category_rollups_by_currency[]` (`currency`, `id`, `name`, `amount_minor`, `own_amount_minor`, `children`, `has_shared_share`) add one row per parent with sub-categories in that list: the parent's own row plus its children's rows, with `own_*` the parent's own lines (the "בלי תת-קטגוריה" row) and `children` the number of child rows summed. `excluded_category_rollups_by_currency[]` does the same for `excluded_categories_by_currency`. Each category keeps its own P&L switch, so an in-P&L roll-up sums only the rows that are in the P&L. Roll-up rows come base currency first, then by amount. Don't add a roll-up row to the category rows; it is the same money.

Expense lines in a category with `excluded_from_pnl` (see `set_category_pnl`) are left out of `direct_*`, `shared_*`, `profit_*`, `by_currency`, `categories`, and `categories_by_currency`. They are listed per currency in `excluded_categories_by_currency` (minor units, positive for an expense), so nothing disappears. Income filed to the project that is out of the P&L (a kept-out income category, or a line taken out with `set_line_pnl`) is left out of `income_*` and listed by category in `excluded_income_by_currency`, on the same basis as `income_agorot`, in positive minor units with its line `count`. A line whose category is only a guess (`category_suggested`) counts in the P&L even when that category is kept out, until the category is confirmed; a loan category stays kept out either way ([0114](../decisions/0114-kept-out-guesses.md)). `categories`, `categories_by_currency` and `excluded_categories_by_currency` list only confirmed lines, so a guessed line is in `direct_*` but in none of the category lists until it is confirmed. Uncategorised lines stay in the P&L. `transactions[]` still lists the newest lines whatever their category. Each `count` in `other_currencies[]` and `pending_other_currencies[]` counts only lines in the P&L.

`transactions[]` is the 40 newest lines filed to the project, shared with it, or with a part of a split by category (`split_line`) filed to it, by `doc_date`, then `created_at`, then `id`, all newest first, so the list is the same on every call. It is not the P&L. It includes lines with `line_status` `pending` (unsettled bank lines), which no total counts until they post. Each row carries its `line_status` (`pending` or `posted`), so a pending row can be told apart (FLOW-209). Each row also carries `parts_minor`: for a line split by category, the sum of its parts filed under this project (a part with no project keeps the line's project), in the line's currency, signed against the line's own kind (its category's kind, or its direction when it has no category): a part of that kind counts plus, a reversal part (the other kind) counts minus ([0138](../decisions/0138-line-split-review-followups.md)); `0` when the line is split but none of its parts is on this project (so it is still listed, holding nothing here); `null` when the line has no split by category (FLOW-312). A shared line shows its full `amount_net`, not this project's share; the share is in `shared_*`. A line in a kept-out category is listed too, with `kept_out` true: no part of it counts in this project's P&L (its category is kept out, or the owner took the line out with `set_line_pnl`). A posted line follows the P&L's own rows; a pending line follows its category and override. The app leaves `kept_out` lines out of the project page's month sums.

Mercury income is `invoice_receipt` ([0097](../decisions/0097-mercury-income-invoice-receipt.md)), so it counts the same on both bases and switching `basis` does not change it. On `invoiced`, a Mercury deposit and a SUMIT invoice for the same income both count.

`other_currencies[]` is one row per non-ILS currency: `currency`, `income_minor`, `expense_minor`, `count`. The amounts keep the stored sign. `expense_minor` is negative for normal expenses, and a negative expense (a refund, decision [0103](../decisions/0103-reversals-across-directions.md)) adds a positive amount to it. `income_minor` is positive for normal income, and a negative income line lowers it. `count` counts each bank line once, however many of its rows count here: a split loan payment, a line split by category and a shared line this project has a share of are each one line, as in `get_totals` (FLOW-312; until then it counted once per part). Kept-out categories and lines with `line_status` `pending` (unsettled bank lines) are left out. A posted line that waits for review is counted here and is also in `pending_other_currencies`. `pending_other_currencies[]` covers the non-ILS lines counted in `pending_count` (waiting for review on this project, whatever their `line_status`): `currency`, `expense_minor` (their stored, signed amounts) and `count`.

On the company's overhead project (`is_overhead` true, see `set_overhead_project`), project-filed expense lines count as overhead, so `direct_*` and `categories*` leave them out and `transactions[]` still lists them. Its income and shared shares stay on the project.

### get_project_categories

```json
{ "id": "8c1a0b2e-1111-4000-8000-000000000001", "months": 6 }
```

Read tool, `project_category_months(p_project_id, p_months)`. What each expense category usually costs this project a month, and whether this month looks off ([0149](../decisions/0149-project-category-months.md)). `months` is 3 to 12 (default 6); anything else is `validation`. An unknown project and another company's are `not_found`. It counts what `get_project`'s `categories_by_currency` counts: approved lines filed to the project, split parts filed to it and its share of shared lines, in the P&L only, by `doc_date` (the invoiced basis), with the month in Israel time.

Output `data`: `project_id`, `today`, `this_month` (`YYYY-MM-DD`, the first day of the current month), `months[]` (the first day of each complete month, oldest first) and `categories[]`, one row per category and currency with a cost this month or in those months: `id`, `name`, `group_name`, `currency`, `this_month_minor` (so far), `months_minor[]` (in the order of `months`, 0 when none), `months_seen` (complete months with a positive cost; a refund-only month does not count), `expected_minor` (the median of those months, null when fewer than 3), `typical_day` (the median day of the month its lines fall on in those months, null when none) and `flag`:

- `high`: this month is already above 1.5 × expected and at least ₪200 above it ($50 in other currencies);
- `new`: a cost now after none in those months, of at least ₪500 ($150);
- `missing`: expected is set, today is past `typical_day` and nothing came yet;
- otherwise null.

Rows come base currency first, then by currency, then by this month's cost, highest first. Amounts are positive minor units of the row's currency. A category in a group still has its own row, with `parent_id` (FLOW-406). `parents[]` (`id`, `name`, `currency`, `this_month_minor`, `own_this_month_minor`, `children`, `months_minor[]`) adds one row per parent with sub-categories and currency, its own row and its children's summed month by month, for folding, base currency first. Flags stay per category.

### list_categories

Input `{}`. Output `data.categories[]`: `id`, `name`, `kind`, `hidden`, `is_default`, `excluded_from_pnl`, `loan_part`, `rehab` (the category's rehab switch: `true`, `false`, or null for the default) and `in_rehab` (whether it counts as rehab on a project; see `set_category_rehab`), `lines` (lines on the books in it, whole or by a split part, not removed or void: what `delete_category` sends back to review), `split_lines` (how many of those have a split part in it; delete removes their whole split), `parent_id` (its parent category, see `set_category_parent`; null for a top-level one), `children_count` (how many sub-categories sit under it, hidden ones too), `rollup_lines` (`lines` plus its sub-categories' lines), `group_name` (the parent's name, kept for older clients; null when none) and `loan_used` (a loan or a loan payment part uses it, so `delete_category` refuses). `loan_part` is `interest`, `escrow`, or `principal` on the three loan categories and null on every other category. It stays the same if a loan category is renamed, so match loan categories by `loan_part`, not by name.

### list_review

`list_review()`, then filter. `limit` defaults to 50 and cannot exceed 100. `supplier` matches part of the supplier's name, or of the customer's on an income line.

Input:

```json
{
  "direction": "expense",
  "reason": "missing_project",
  "supplier": "שיש",
  "query": "מלט",
  "from": "2026-09-01",
  "to": "2026-09-30",
  "limit": 50,
  "offset": 0
}
```

Output `data`: `{ "total", "reviews" }`. `id` is the review-queue id. `transaction_id` is the ledger id. `company_id` is the token's company ([FLOW-704](../backlog/TASKS.md#flow-704)). Also `description`, `doc_date`, `doc_kind`, `amount_net`, `vat_agorot`, `direction`, `reason`, `pnl_role`, `share_count`, `project_id`, `category_id`, `project_name`, `category_name`, `category_suggested`, `project_suggested`, `supplier_name`, `customer_name` (an income line's customer, null when none), `meta` (the line's bank details, see [get_expense](#get_expense)), `line_status` (`pending`, `posted`, or `void`; a pending bank line may still change) and `source` (`sumit`, `mercury`, `manual`, or `photo`) ([FLOW-305](../backlog/TASKS.md#flow-305)). `kept_out` is true when the line does not count in the P&L at all (a line split with one part kept out is not) ([0135](../decisions/0135-line-state-in-lists.md)). `search_expenses` with `scope: "pending"` returns the same rows, so it carries these fields too.

Income that already has a project but only a guess of a kept-out category is queued with `reason` `suggested`: the guess counts in the P&L until it is confirmed, and approving it (or `assign_expense` / `set_expense_category`) confirms it ([FLOW-126](../backlog/TASKS.md#flow-126), [0114](../decisions/0114-kept-out-guesses.md)). A guessed loan category is not queued: it is out of the P&L even as a guess ([FLOW-127](../backlog/TASKS.md#flow-127)).

A line split with `split_line` whose amount the bank sync changed is queued with `reason` `split_mismatch`: its parts no longer sum to it, so it counts whole until new parts are sent (see [split_line](#split_line)).

### get_expense

`get_transaction` with the transaction id. A missing row is `not_found`. `review_status` is the line's latest review state; while it is `open`, `review_reason` is its reason and `review_id` its review-queue id (the `id` in `list_review`), else `review_id` is null. Output includes `allocations[]` of `{project_id, project_name, share_bp, amount_net}`. A line split with `split_line` also has `line_split` (see [split_line](#split_line)).

Output also has `loan_split` ([FLOW-107](../backlog/TASKS.md#flow-107)), from `get_loan_split`: `null` when the line has no loan split (and always for income, which skips the read), else `{loan_id, loan_name, needs_review, by_parts, parts[]}` with `parts` in the order interest, escrow, principal, then fees when the payment has a fees part ([0130](../decisions/0130-loan-fees-installments.md)), each `{part, amount_minor, in_pnl}`. `amount_minor` is positive and the parts add up to the line. `by_parts` is true when the P&L counts the line by its parts (three parts, or four with fees, none needs review, no VAT, parts add up), and then `in_pnl` says whether that part counts; the principal is kept out by default. When `by_parts` is false, `in_pnl` is null and the whole line counts under its own category. A failed split read is `refused`, like the row read. Since [0136](../decisions/0136-loan-unmatch.md) `get_transaction` carries `loan_split` itself, so `get_expense` makes no second read.

The row also has `in_pnl` (whether the line counts in the P&L), `in_pnl_override` (`false` out, `true` in, `null` follows the category; see [set_line_pnl](#set_line_pnl)), `category_excluded_from_pnl`, and `pnl_fixed` (a loan line: `set_line_pnl` refuses it) ([FLOW-108](../backlog/TASKS.md#flow-108)). `category_suggested` is true while the category is only a guess; a guessed kept-out category still counts, so `in_pnl` is true until the category is confirmed ([FLOW-121](../backlog/TASKS.md#flow-121)). `pnl_state` is `in`, `out`, or `mixed`: for a line split by category it reads the parts, so a split with one part kept out is `mixed` while `in_pnl` follows the line's own category; a loan payment counted by its parts is `mixed` too (the principal is kept out), and `pnl_fixed` marks it ([0135](../decisions/0135-line-state-in-lists.md)).

Output also has `meta` ([FLOW-304](../backlog/TASKS.md#flow-304)), the line's bank details from `get_line_meta`: `{method, card_last4, memo, account, counterparty, bank_description}`. `method` is `card`, `ach`, `wire`, `check`, `transfer`, `other`, or null when the provider gave none (manual and most SUMIT lines). `card_last4` is exactly the last 4 digits or null. `account` is the bank account's name; no account number is returned. In `memo` and `bank_description` any run of 5 or more digits keeps only its last 4 (`••1234`). Every field is null when unknown. Lines imported before FLOW-304 have only `method` (from the provider's kind), `counterparty` and `bank_description` until the next sync touches them. A failed meta read is `refused`. `list_review` and `search_expenses` rows carry the same `meta`.

### search_expenses

`scope` is `pending` (default), `filed`, or `all`. `pending` filters `list_review`. `filed` and `all` call `public.search_transactions`. `id` on an expense is the transaction id. Each expense also has `meta` (see [get_expense](#get_expense)).

Filters, all optional ([FLOW-323](../backlog/TASKS.md#flow-323), [0140](../decisions/0140-search-filters.md)):
- `from` and `to` (`YYYY-MM-DD`) bound the document date, both ends included.
- `direction` is `income` or `expense`.
- `project_id` matches the line's project, a share of a shared cost on it, or a split part on it. `none` lists lines on no project.
- `category_id` matches the line's category, or a split or loan split part in it. `none` lists lines with no category and no parts. A parent category also matches its sub-categories' lines (FLOW-406); `category_exact: true` matches its own lines only (with an id, not `none`).
- `amount` finds one figure; `amount_min` and `amount_max` a range, both ends included (not together with `amount`). Each is the line's bank amount (gross) without its sign, in major units of the line's own currency: `6245.12` finds a $6,245.12 payment or deposit, and a shekel line of ₪6,245.12 too. A minimum above the maximum, a negative amount, or an `amount` of 0 is `validation` ([FLOW-211](../backlog/TASKS.md#flow-211), [0155](../decisions/0155-review-list-speed-search-amount.md)). `filed` and `all` rows also carry `amount_gross`, the signed bank amount in minor units.

`query` matches the description, the supplier or the customer, in any case. `filed` and `all` rows come newest first. They also carry `currency`, `amount_original`, `line_status`, `customer_name`, `waiting_review`, `kept_out` (as in [0135](../decisions/0135-line-state-in-lists.md)), `split_parts` (the line split's part count, 0 when whole) and `loan_matched`. With a filter or a `query`, `pending` lets `search_transactions` pick the page, and the rows stay `list_review` rows, newest first. Without either, it lists `list_review` as before.

Input: `{ "scope": "all", "query": "מלט", "from": "2026-06-01", "to": "2026-06-30", "project_id": "…", "limit": 50, "offset": 0 }`.

### get_totals

`get_dashboard`, with no company id. Output `data`: `company_id`, `name`, `basis`, `from`, `to`, `income_agorot`, `direct_agorot`, `shared_agorot`, `overhead_agorot`, `expense_agorot`, `unassigned_income_agorot`, `unassigned_expense_agorot`, `overhead_project_id`, `net_profit_agorot`, `excluded_income_agorot`, `excluded_expense_agorot`, `active_projects`, `review_count`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `overhead_minor`, `expense_minor`, `net_profit_minor`, `excluded_income_minor`, `excluded_expense_minor`, `excluded_count`, `count`, `loan_split_fallback_count`, `unassigned_income_minor`, `unassigned_expense_minor`). The buckets add up ([0101](../decisions/0101-unassigned-and-overhead-project.md)): `direct + shared + overhead + unassigned_expense = expense`, and the projects' `profit_minor` minus `overhead` plus `unassigned_income - unassigned_expense` is `net_profit`, within 1 minor unit per shared loan-split part. Unassigned income has no project. Unassigned cost has no `pnl_role`, a project role and no project, or a shared role and no split. Cost filed to the overhead project (see `set_overhead_project`) is in `overhead_*`, not `direct_*`. `*_agorot` fields are ILS only; foreign amounts are in `by_currency` minor units (cents for USD). Excluded lines stay out of the main buckets and appear only in the `excluded_*` fields. A line whose category is only a guess counts in the main buckets even when that category is kept out, and moves to `excluded_*` once the category is confirmed; a guessed loan category stays out ([0114](../decisions/0114-kept-out-guesses.md)). A loan payment with a valid three-part split counts by part: interest and escrow in the totals, the principal in `excluded_expense_*` and `excluded_count`, and the bank line's own category gets nothing. `loan_split_fallback_count` is the number of lines in the period that have a split but count whole, because a part needs review or the line carries VAT. It is 0 when none do. `count` counts lines in the P&L only, so a split line counts once and a kept-out line is in `excluded_count`, not `count`. Before decision [0099](../decisions/0099-categories-outside-pnl.md) `count` included kept-out lines; `count + excluded_count` is the old number (a loan payment that counts by part adds 1 to both). A project's shared share of each part rounds half to even. On `cash`, a supplier invoice or credit note with no cash date (unpaid) is in no field at all, not even `excluded_*` or `count`; on `invoiced` it counts by its document date ([0118](../decisions/0118-unpaid-invoices-cash-basis.md)).

### get_breakdown

`get_breakdown` or `get_breakdown_lines` ([0110](../decisions/0110-home-breakdown.md)). `direction` is `income` or `expense` (required). `group_by` is `category` (default), `project`, or `payer`. `level` is `category` (default) or `parent` (FLOW-406, with `group_by` `category` only): by parent, a sub-category's lines count under its parent, so `key` is the parent's id and its `group` lines are its own and its sub-categories'. `totals` are the same either way, and the output's `group_by` reads `parent`. A line split between two sub-categories of one parent is one row in the parent's lines, with `category_name` null, as for any line split across categories. `basis` defaults to `cash`. Omit both dates for all time; one date alone is `validation`.

Without `group`: output `data` is `direction`, `basis`, `group_by`, `from`, `to`, `totals[]` (`currency`, `amount_minor`, `count`), `groups[]` (`key`, `name`, `currency`, `amount_minor`, `count`, `shared`), `excluded[]` (kept-out lines, not in the totals), and `review_count`. `totals` equal `get_totals`' `income_minor` / `expense_minor`. On `cash`, an unpaid supplier invoice is left out of every row, like `get_totals`. Under `project`, `key` is a project id, `overhead`, or `unassigned`; a shared cost is split by its allocations and the project's row has `shared: true`. A null `name` means no category, payer, or project (key `none` or `unassigned`). Passing `currency`, `limit`, or `offset` here is `validation`.

With `group` (a `key` from `groups`) and `currency` (default `ILS`), or with `excluded: true` (not both): output `data.rows[]` (`transaction_id`, `part`, `description`, `supplier_name`, `project_name`, `category_name`, `doc_date`, `currency`, `amount_minor`, `shared`) newest first, and `has_more`. `limit` defaults to 40, at most 100.

`amount_minor` is positive for income and for a normal expense. A loan payment with a valid split counts by part, so its rows carry `part`.

Input: `{ "direction": "expense", "group_by": "project", "from": "2026-06-01", "to": "2026-06-30" }`.

### get_profit_months

`get_profit_months(p_from, p_to, p_basis, p_project_id)` ([0129](../decisions/0129-profit-by-month.md)). The company's profit per calendar month, or one project's with `project_id` (from `list_projects`). `from` and `to` are YYYY-MM-DD, both or neither; neither runs from the first month with a line to the current month. A range of 240 calendar months or more, one date alone, or `from` after `to` is `validation`. `basis` defaults to `cash`. A project in another company is `not_found`.

Output `data`: `basis`, `from`, `to`, `project_id`, `after_overhead` (project only, else null), `months[]` newest first, and `by_currency[]` (the months summed). Each month: `month` (`YYYY-MM`), `from` and `to` (the month cut to the range), `open` (the current month), `by_currency[]` (`currency`, `income_minor`, `expense_minor`, `profit_minor`; ILS first and always present, other currencies only in months with lines), and for a project `overhead_weighted` and `overhead_share_agorot`: its ILS share of that month's overhead, weighted by that month's project income on the same basis; 0 when the project had no income that month, null when no project had any. Without a project the months add up to `get_totals`' `by_currency` (`income_minor`, `expense_minor`, `net_profit_minor`) for the range; with one, to `get_project`'s `by_currency` for the range (income less direct and shared cost). Per-month overhead shares are rounded per month, so they need not add up to the range's share.

Input: `{ "from": "2026-07-01", "to": "2026-09-30", "basis": "cash", "project_id": "8c1a0b2e-1111-4000-8000-000000000001" }`.

## Writes · cycle 3

An open review is closed by `approve_review_item`. The card leaves לאישור. `remember` defaults to false. `user_assigned` becomes true. There is no second tap in the app.

### assign_expense

Passes the project and category into `approve_review_item` when a review is open. Otherwise `reassign_transaction`. A finished project is allowed, because `reassign_transaction` allows it. `project_id` may be left out (or null) when the category is an income category kept out of the P&L; any other category without a project is `validation` (FLOW-205).

The category kind may differ from the line's direction. The kind decides the P&L side: an outflow under an income category is a reversal and counts as negative income, and an inflow under an expense category counts as negative expense. An income-kind category needs a project unless it is off-P&L, also on an outflow. `direction` and the signed amount stay as stored. Auto-suggested categories, connector syncs, `assign_expense_split`, and loan splits still use the line's own kind. Decision [0103](../decisions/0103-reversals-across-directions.md).

Income works the same way. A filed income line keeps `pnl_role` null and gets no allocation row; the P&L reads its `project_id`, so it shows in that project's `get_project` income and `list_projects` row, and once in the company total (FLOW-109). Expenses get `pnl_role` `project` and one 100% allocation.

```json
{
  "idempotency_key": "assign-20",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "project_id": "8c1a0b2e-1111-4000-8000-000000000001",
  "category_id": "c0ffee00-1111-4000-8000-0000000000a1",
  "remember": false
}
```

Output `data` when a review closed: `{ "undo_kind": "review", "id": "11111111-1111-4000-8000-000000000010", "closed_review": true }`. The id is the review-queue id. `resolve_review` with `approved` does not return a `reassign_undo` id. When no review was open, `undo_kind` is `reassign` and `id` is that undo id.

### assign_expense_split

Splits one expense across 2 to 50 projects. Each `shares[]` row has `project_id` and `share` (whole percent). The shares must sum to 100, projects must be unique, and each project must belong to the company. A finished project and a hidden category are accepted, so a late bill can still land on a sold property. The write calls `public.save_split`. Optional `category_id` sets the category the same way as `assign_expense`. Income lines are `validation`. The idempotency key compares the shares as a set, so the same shares in another order replay the stored response. Undo uses `kind: "reassign"` or `kind: "review"` like `assign_expense`, and a category that was a suggestion before the write is a suggestion again after undo.

```json
{
  "idempotency_key": "split-1",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "category_id": "c0ffee00-1111-4000-8000-0000000000a1",
  "shares": [
    { "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "share": 50 },
    { "project_id": "8c1a0b2e-1111-4000-8000-000000000002", "share": 50 }
  ]
}
```

Output `data`: `{ "undo_kind", "id", "closed_review" }` with the same meaning as `assign_expense`. A line waiting in review as an unsplit shared cost (`unallocated_shared`) is closed by the split itself: `closed_review` is true, `undo_kind` is `reassign`, and undo reopens it.

### set_expense_category

The category changes. The line's project and shares stay. An open review is closed the same way, using the row's current project.

A category of the other kind is a reversal (see `assign_expense`): it counts as negative income on an outflow and negative expense on an inflow. On a line filed to one project the role follows the new kind, as in `assign_expense`; a shared line keeps its shares.

```json
{
  "idempotency_key": "cat-20",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "category_id": "c0ffee00-1111-4000-8000-0000000000a1"
}
```

Output `data` when a review closed: `{ "undo_kind": "review", "id": "11111111-1111-4000-8000-000000000010", "closed_review": true }`. When no review was open, `undo_kind` is `reassign` and `id` is the `reassign_undo` id.

### undo

`kind` `review` calls `reopen_review`. The card returns to לאישור, and a supplier rule this approval wrote is restored. `kind` `reassign` calls `undo_reassign`. Undo accepts only an id stored in `private.mcp_writes` for this user. Anything else is `not_found`. Undo sets `undone_at`. A row that already has `undone_at` is single-use and is `not_found`. If the current project, category, `pnl_role`, or shares differ from that snapshot, the result is `conflict` and the later edit stays. A SUMIT sync that only changes `updated_at` still undoes. Returning the card to the open set makes the visit counter's `n` grow by one, and `h` does not decrease. That growth is intended. A repeated idempotency key returns the stored response.

```json
{ "idempotency_key": "undo-30", "kind": "review", "id": "11111111-1111-4000-8000-000000000010" }
```

## Writes · cycle 4

A project, category or loan name (`create_project`, `create_category`, `create_projects`, `create_categories`, `add_loan`, `update_loan`) with a control character, a line or paragraph separator, an invisible format character (zero-width, bidi marks and controls, BOM, soft hyphen, tag characters) or a blank filler is `validation` with message `name has an invisible or control character`, so a client knows to strip it (a pasted RLM, for example); ZWJ is allowed for emoji (FLOW-205). A no-break or other wide space inside the name is stored as a plain space. The database holds the app to the same rule: a new or renamed project, category or loan with such a character is refused (`23514`), and a name stored before the rule does not block other edits. A SUMIT budget section name, which comes from outside, has such characters dropped instead (the sync and `map_budget_section` do not fail on it).

`create_project` and `create_category` record undo rows. Undo deletes the row only when nothing in the company references it, including a review row, an open reassign undo or an open `split_line` undo that would restore it (FLOW-205). Otherwise undo is `conflict` and the row stays.

### create_project

```json
{ "idempotency_key": "proj-1", "name": "Site Alpha", "status": "active" }
```

`status` is optional (`active` or `finished`). Output `data`: `{ "id", "undo_kind": "project" }`.

### create_category

```json
{ "idempotency_key": "cat-new-1", "name": "Tools", "kind": "expense" }
```

There is no cost-type argument on categories. An optional `parent_id` creates it as a sub-category (FLOW-406); the rules of `set_category_parent` apply, and a broken rule is `refused`. Output `data`: `{ "id", "undo_kind": "category" }`, plus `parent_id` when one was given. A `create_categories` row takes the same `parent_id`; a row that breaks a rule fails alone.

### create_projects and create_categories

For a company setup: up to 100 rows in one write, so a setup of dozens of projects and categories stays inside the write rate limit ([0119](../decisions/0119-mcp-bulk-setup.md)).

```json
{ "idempotency_key": "setup-1", "items": [{ "name": "Site Alpha" }, { "name": "Site Beta", "status": "finished" }] }
```

```json
{ "idempotency_key": "setup-2", "items": [{ "name": "Tools", "kind": "expense" }, { "name": "Rent", "kind": "income" }] }
```

Rows take the same fields as `create_project` and `create_category`. The same name twice in one call (per kind for categories), an empty list, or more than 100 rows is `validation` for the whole call. Each row uses the key `idempotency_key:ordinal`, so the key is 1–124 characters. A bad row does not block good rows.

Output `data`: `{ "batch_key", "ok_count", "error_count", "results" }`. Each result is `{ "name", "ok": true, "id", "undo_kind" }` or `{ "name", "ok": false, "code" }`; category rows add `kind`. A name that is already taken is `refused` and adds `existing_id`, so a rerun of a setup still returns every id. [undo_batch](#undo_batch) with `batch_key` removes the rows that were created; a row that something already uses is `conflict` and stays.

### hide_category

```json
{ "idempotency_key": "hide-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1" }
```

Output `data`: `{ "id", "undo_kind": "category_hidden" }`. Undo restores the prior `hidden` flag. Hiding a category again while this user's earlier hide can still be undone (a second hide, or a re-hide after the app showed it) hides it and keeps that one undo, which restores the flag from before the first hide. Undo of a hide the app already reversed succeeds and changes nothing (FLOW-205).

### set_category_pnl

```json
{ "idempotency_key": "pnl-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "excluded": true }
```

Output `data`: `{ "id", "undo_kind": "category_pnl" }`. Undo restores the prior `excluded_from_pnl` value. `refused` / `loan category is fixed` for the three loan categories (any category with a `loan_part` in `list_categories`, seeded as `ריבית משכנתא`, `מסים וביטוח`, and `תשלומי הלוואה`), whatever their current name. Since [0128](../decisions/0128-loan-part-categories.md) it is also refused for any other category that holds a principal part or that a loan names for principal, when the flip would count it in the P&L. Interest, escrow and fees parts, and a loan's interest, escrow and fees categories, do not hold a category: those parts may sit on either side and follow the flip ([0130](../decisions/0130-loan-fees-installments.md), [0166](../decisions/0166-loan-interest-kept-out.md)). A new category whose English name matches a default kept-out name ([0099](../decisions/0099-categories-outside-pnl.md); case, spaces, punctuation, `&` or `and`, and a plural `s` are ignored, so `Owner distribution` and `CapEx/Rehab` match) starts kept out, and so does a category renamed into one. Other refusals match `category not found` and the usual write envelope.

### set_project_investment

```json
{ "idempotency_key": "inv-1", "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "currency": "USD", "purchase_minor": 25000000, "arv_minor": 40000000, "value_date": null }
```

Sets a project's investment figures: `currency` (an ISO code such as `USD` or `ILS`, default `ILS`; it cannot be cleared, and changing it does not convert the figures), then `purchase_minor`, `arv_minor` (after-repair value) and `value_minor` (worth today), in minor units of that currency, and `value_date` (YYYY-MM-DD). Name at least one; a key left out keeps its figure and `null` clears it. An amount must be a whole number of minor units, 0 or more; anything else, a currency that is not three capital letters, an impossible date, another key or none of the five is `validation`. Output `data`: the currency and figures after, `project_id`, `undo_kind: "project_investment"` and `id`. Undo puts back the currency and figures before, and is `conflict` when any of them changed since. Another company's project is `refused` / `project not found`. `get_project` returns the figures with rehab and equity in `investment` ([0143](../decisions/0143-project-investment.md)).

### set_category_rehab

```json
{ "idempotency_key": "rehab-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "rehab": true }
```

`rehab` is required: `true` counts the category as rehab on projects, `false` leaves it out, `null` follows the default. By default every category counts except those kept out of the P&L (`excluded_from_pnl`) and the loan parts (`loan_part` set), so the purchase and the loan payments stay out. A loan payment's fees part stays out too, even in a category that counts, unless that category is switched on (`true`). Switching on the principal category counts principal repayments as rehab, while the loan they repay is already in `current_equity_minor`. Output `data`: `category_id`, `rehab`, `in_rehab` (what the category comes to), `undo_kind: "category_rehab"` and `id`. Undo puts back the setting before, and is `conflict` when it changed since. Another company's category is `refused` / `category not found` ([0143](../decisions/0143-project-investment.md)).

### delete_category

```json
{ "idempotency_key": "catdel-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1" }
```

Deletes a category, even one with lines. Its lines keep their project, lose the category and go back to לאישור as lines with no category (an open review row with reason `missing_category`, unless one is open already); nothing guesses a new category for them. A line split by category with a part in it loses its whole split. Suppliers forget it as their remembered category. Output `data`: `category_id`, `name`, `lines` (how many lines on the books, not removed and not void, went back to review), `undo_kind: "category_delete"` and `id`. Refused: a loan category (`refused` / `loan category is fixed`), a category a loan or a loan payment part uses (`a loan uses this category`; move those first with `move_category_lines` or `update_loan`), another company's (`category not found`). Undo puts back the category with the same id, its lines, splits and remembered suppliers, and closes the review rows the delete opened; it is `conflict` once one of those lines has a category or a split again or the name is taken again, and `not_found` when the owner already undid it in the app ([0144](../decisions/0144-category-delete-and-move.md)).

### move_category_lines

```json
{ "idempotency_key": "catmove-1", "from_category_id": "c0ffee00-1111-4000-8000-0000000000a1", "into_category_id": "c0ffee00-1111-4000-8000-0000000000a2" }
```

Moves every line of one category to another of the same kind, and with them split parts, loan payment parts, loan part categories and remembered supplier categories. The move hides neither category (`merge_category` in the app is this move plus hiding the source); the source may already be hidden, only the target must be visible. A moved line counts as the owner's choice. Output `data`: `from`, `into`, `lines` (lines on the books moved, a split line once), `undo_kind: "category_move"` and `id` (the source). Refused: the same category (`pick a different category`), a hidden or another company's target (`category not found`), another kind (`categories must be the same kind`), a split line with parts in both (`a split line has both categories`), a loan part the target cannot take (`a loan uses this category for a part the other category cannot take`). Undo, with the source category id, moves exactly those back with their old flags; it is `conflict` once any of them was moved or re-tagged since. A remembered category the owner changed since stays ([0144](../decisions/0144-category-delete-and-move.md)).

### set_company_currency

```json
{ "idempotency_key": "currency-1", "currency": "USD" }
```

Sets the company's base currency (owner only), three capital letters. Nothing is converted. The base currency's row comes first in every `by_currency` list, it is the default for a new loan, a new project's investment currency and `get_breakdown`'s lines, and the base-currency twins of the ILS-only figures are in it: `by_currency[].prev_income_minor`, `prev_expense_minor`, `prev_net_profit_minor` (null without a period), `get_home` `net_profit_minor`, `get_project` `overhead_share_minor` and `get_profit_months` `months[].overhead_share_minor`. Each of those responses carries `base_currency`. Output `data`: `id` (the company), `base_currency`, `prior` and `undo_kind: "company_currency"`. A bad code is `validation`. Undo, with the company id, puts the prior currency back; it is `conflict` once the currency was changed again ([0147](../decisions/0147-company-currency.md)).

### rename_category

```json
{ "idempotency_key": "rename-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "name": "חשמל ומים" }
```

Renames a category (owner only). `name` is trimmed, 2 to 120 letters, and not another category's of the same kind; an income and an expense category may share a name. The id stays, so its lines, split parts, loans, remembered suppliers and flags stay. Loan categories can be renamed; match them by `loan_part`. Output `data`: `category_id`, `name`, `prior` (the old name), `undo_kind: "category_name"` and `id`. Refused: `category already exists`, `category name is too short`, `category name is too long`, `category not found`. Undo, with the category id, puts the old name back; it is `conflict` once the category was renamed again or while another category of the kind has the old name. A renamed `העברות` or `הכנסה אחרת` no longer gets the Mercury import's hint, which matches by name ([0148](../decisions/0148-category-rename.md)).

### set_category_parent

```json
{ "idempotency_key": "parent-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "parent_id": "c0ffee00-1111-4000-8000-0000000000a2" }
```

Puts a category under a parent category of the same company (owner only), or takes it out with `parent_id: null` (FLOW-406, [0164](../decisions/0164-sub-categories-and-groups.md)). There is one level only. Refused: `category_parent_nested` (the parent is itself a sub-category, or the category already has sub-categories), `category_parent_kind` (an income category under an expense one, or the reverse) and `category_parent_loan_part` (a loan category is never a parent or a sub-category). `category not found` and `parent not found` are `not_found`. The category's `group_name` follows the parent's name. A parent with sub-categories can't be deleted or merged away (`category_has_children`). Output `data`: `category_id`, `parent_id`, `prior` (the parent before, or null), `undo_kind: "category_parent"` and `id`. Undo, with the category id, puts the parent before back; it is `conflict` once the parent was changed again or the old parent can no longer take it.

### set_category_group

Older form of `set_category_parent`, kept for older clients: a group name now names a parent category of that name and kind, made when there is none.


```json
{ "idempotency_key": "group-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "group_name": "חשבונות" }
```

Puts a category in a group (owner only), so a screen can fold the group's categories into one row; `null` or a blank name takes it out. The name is trimmed, up to 40 letters, with no invisible or control characters (that is `validation`, `name has an invisible or control character`). Totals, the P&L and reports stay per category. Output `data`: `category_id`, `group_name`, `prior` (the group before, or null), `undo_kind: "category_group"` and `id`. Refused: `category not found`. Undo, with the category id, puts the group before back; it is `conflict` once the group was changed again ([0149](../decisions/0149-project-category-months.md)).

### set_overhead_project

```json
{ "idempotency_key": "oh-1", "project_id": "8c1a0b2e-1111-4000-8000-000000000002" }
```

Marks one project as the company's overhead project. Expense lines filed to it with a project role count as overhead in `get_totals`, `list_projects`, and `get_project`, not as direct cost, and the overhead share of the after-overhead view includes them. `project_id: null` clears it. `project_id` is required. Output `data`: `{ "id", "overhead_project_id", "undo_kind": "overhead_project" }`, where `id` is the company id. Undo restores the prior overhead project, or is `conflict` if it changed since or the prior project was deleted. In `get_project`, the overhead project's `overhead_share_agorot` is 0 and its income is left out of the other projects' weights ([0117](../decisions/0117-overhead-project-weights.md)). A project in another company is `refused` / `project not found`. `list_projects` and `get_project` return `is_overhead`, and `get_totals` returns `overhead_project_id`.

### rename_company

Renames the token's company. The owner only: a viewer or a read token is `forbidden`. There is no company argument, so another company cannot be named. The name is trimmed of all whitespace (the characters JavaScript `trim()` removes, such as tabs, line breaks and no-break spaces) and must be 2 to 100 characters, counted as code points so an emoji counts once, with no control or invisible character (the rule above; `validation` with that message) and wide spaces inside stored as plain ones; otherwise the call is `validation`. The app calls the same rule through `public.rename_company(p_company_id, p_name)`, which refuses any id but the caller's own company, and a direct update of `companies.name` is held to it too (`23514`), so the MCP, the RPC and the table accept and refuse the same names. Each rename and each undo writes one `audit_log` row (`update` on `companies`).

```json
{ "idempotency_key": "rename-1", "name": "Example Holdings" }
```

Output `data`: `{ "id", "name", "prior_name", "undo_kind": "company" }`. Undo with `kind: "company"` and the company id restores `prior_name`. If the current name is not the name this write set, undo is `conflict` and the current name stays.

### sync_bank

```json
{ "idempotency_key": "sync-1" }
```

There is no date range. Mercury sync is cursor-based (`sync_cursor`, `import_from`, lookback). Filtering after fetch would advance the cursor past dropped rows. `sync_bank` takes no dates and does not call `set_import_from`.

`sync_bank` answers at once with `data`: `{ "job_id", "state": "running" }` and the pull keeps running after the response ([0102](../decisions/0102-sync-bank-jobs.md)). The same `idempotency_key` returns the same job (its current state, without a second pull). To retry a failed job, send a new key.

`not_found` / `bank is not connected` means there is no Mercury row in `connector_connections`; no job is started.

Errors from `sync_bank` itself: `validation` for a missing or malformed `idempotency_key`; `forbidden` for a read token or a revoked or expired one, as on every write tool; `conflict` for a key already used with another tool; `not_found` / `bank is not connected`; and `refused` / `The write was refused.` when the job could not be started. A pull that fails after the job starts is not an error here: it is the job's `error` in `get_sync_status`.

### get_sync_status

```json
{ "job_id": "…" }
```

Read tool. Offered to read and write tokens, and it takes the read rate bucket, so polling does not use up writes. Readable by the user who started the job, in the same company; another user's job is `not_found`. A job that finished more than 7 days ago (or never finished, after a day) is dropped when that user starts a new sync and then reads `not_found` ([FLOW-207](../backlog/TASKS.md#flow-207)). A failed job's `error` is one of `unavailable` / `retry`, `unavailable` / `unavailable`, `not_found` / `bank is not connected`, `refused` / `bank key was rejected; reconnect in Settings`, or `refused` / `The bank sync failed.`; anything else is stored as the last.

Output `data`: `{ "job_id", "state", "started_at", "finished_at" }` plus:

- `state: "running"`: nothing else yet.
- `state: "done"`: `added`, `duplicates`, `removed`, `newest_date`. `added` is new lines. `duplicates` counts lines already stored, skipped as new and refreshed in place. `removed` is voided or dropped lines. `newest_date` is the latest `doc_date` among live Mercury transactions, or null.
- `state: "failed"`: `error` `{ code, message }`. `unavailable` / `retry`: another run claimed the connector, the quiet window, or Mercury's rate limit; send `sync_bank` again with a new key. `not_found` / `bank is not connected`. `refused` / `bank key was rejected; reconnect in Settings`. `refused` / `The bank sync failed.`: any other failure, including a result whose shape the finish step rejected. A job still running after 5 minutes reads as `unavailable` / `retry`.

The finish step stores a result only when it is exactly `added`, `duplicates`, `removed` (whole numbers, not negative) and `newest_date` (`YYYY-MM-DD` or null).

### get_jev_status

`mcp_jev_status`, no arguments ([0124](../decisions/0124-jev-after-sync.md)). Read tool. Output `data`: `enabled` (true only when the connector is on and `mode` is `shadow` or `auto`), `mode` (`off` when there is no setting), `threshold`, `daily_call_cap` (calls per UTC day), `calls_today` (used calls plus any open run's reservation), `last_run_at` (the end of the latest run, or its start while it runs; null before the first), `lines_without_suggestion` (open expense and income lines in לאישור with no Jev suggestion for the pinned model, including lines waiting to retry after a failure), `prefilled_today` (lines auto mode filled this UTC day and not undone, including ones approved since) and `prefilled_open` (lines still open in לאישור that hold an auto fill not undone) ([0145](../decisions/0145-jev-auto-mode.md)). Counts only; no line text.

### get_jev_accuracy

`mcp_jev_accuracy`, optional `from` and `to` (`YYYY-MM-DD`, inclusive, by the UTC day the review was approved or changed; omit both for all time; `from` after `to` is `validation`) ([0126](../decisions/0126-jev-outcomes.md)). Read tool. Output `data`: `from`, `to`, `threshold`, `lines` (resolved lines that had a Jev suggestion), `all_matched` (every compared field matched), `project_compared`, `project_matched`, `category_compared`, `category_matched`, `at_threshold` (`lines`, `all_matched` for confidence at or above `threshold`, what auto mode would pre-fill), and `bands[]` (`band` high/medium/low, `min` 0.9/0.7/0, `lines`, `all_matched`). A shared, overhead or multi-project line is not compared on project; a line split by category is not compared on category. An undone approval drops out. Counts only.

### get_anomalies

`mcp_review_anomalies`, no arguments ([0131](../decisions/0131-jev-patterns.md)). Read tool. Output `data.anomalies[]` for the open review lines (newest 500), each with `transaction_id` and `kind`: `duplicate` (`other_transaction_id`, `other_doc_date`: another posted line of the same supplier or customer, document kind, gross amount and currency, within 7 days; not an invoice and its receipt, a cancelled invoice, or two loans' payments), `amount_spike` (`typical_amount_minor`, `ratio`: at least 3 times the median of that party's last 12 lines in the year before, and at least 100.00 more), `new_party_large` (`company_p90_minor`: a party's first line at or above the company's 90th percentile posted line over the year up to the newest open line). Income is compared on invoices only, so a receipt paying several invoices is not a spike. Each flag also has `jev_score` (0 to 1: how likely Jev thinks the flag is a real problem, asked in the same call that labelled the line; null when Jev did not score it) ([0134](../decisions/0134-jev-reasons-income-scores.md)). A flag is a reason to look; it changes nothing.

### get_jev_suggestions

`mcp_jev_suggestions`, no arguments ([0134](../decisions/0134-jev-reasons-income-scores.md), [0139](../decisions/0139-jev-corrections.md)). Read tool. Output `data.suggestions[]` for the open review lines (newest 500) that have a Jev suggestion: `transaction_id`, `direction` (`expense` or `income`), `project_id`, `project_name`, `category_id`, `category_name` (null when Jev did not answer that field), `no_project` (true when Jev answered no project: overhead, or not one project), `confidence`, `reason`, `party_filings`, `matching_filings`, `anomaly_score` (Jev's score of an anomaly flag on the line, or null), `prefilled` (auto mode filled this line and it was not undone, [0145](../decisions/0145-jev-auto-mode.md)). `reason` comes from SQL, from the supplier's or customer's last 5 filed lines of the same direction: `same_as_last` (the answered fields equal the last one), `usual_for_party` (they equal at least 2 of them), `new_party` (none filed yet), `model_only` (none of these). A `no_project` suggestion matches a filed line with no project, filed as shared or overhead, or filed to the company's overhead project. Jev only suggests; filing a line is still `assign_expense` or `assign_expenses`.

### set_jev_mode

```json
{ "idempotency_key": "jev-mode-1", "enabled": true, "mode": "auto", "threshold": 0.9 }
```

Turns the Jev tagger on or off and sets its mode and threshold, as Settings → חיבורים → תיוג חכם does ([FLOW-702](../backlog/TASKS.md#flow-702), [0145](../decisions/0145-jev-auto-mode.md)). Write tool, `mcp_set_jev_mode`, which calls `set_company_integration` for the token's company; a viewer cannot write. `enabled` is required; `mode` is `off`, `shadow` (suggestions only) or `auto` (Jev fills what it is sure of at or above the threshold; every line still waits for approval, and `undo_jev_prefill` takes a fill back); `threshold` is 0.50 to 1 (the app offers 0.80, 0.85, 0.90 and 0.95). A mode or threshold left out keeps the stored one (`shadow` and 0.90 at first). Output `data`: `id` (the company), `enabled`, `mode`, `threshold`, `prior` (the values before, or null when Jev was never set) and `undo_kind: "jev_mode"`. Undo, with the company id, puts the values before back (or removes the setting when there was none); it is `conflict` once they were changed again.

### undo_jev_prefill

```json
{ "idempotency_key": "jev-undo-1", "transaction_id": "<ledger id>" }
```

Takes back Jev's auto fill on one open review line ([FLOW-702](../backlog/TASKS.md#flow-702), [0145](../decisions/0145-jev-auto-mode.md)). Write tool, `mcp_undo_jev_prefill`. It puts back the project, the allocation (expense lines) and the category the line had before the fill, from the `jev_prefills` audit row. The line stays in לאישור; nothing is approved. `not_found` / `nothing to undo` when the line has no fill that is not undone; `conflict` / `line changed since` when the owner assigned the line or confirmed the filled field, or the project, its one allocation or the category no longer hold Jev's values; `already_closed` when the line is no longer open; `not_found` for an unknown line or another company's. Output `data`: `{ "transaction_id", "project_id", "category_id" }`, the values put back.

### get_missing_bills

`missing_bills`, no arguments ([0131](../decisions/0131-jev-patterns.md)). Read tool. Output `data.missing[]`: recurring suppliers (an expense line in at least 3 of the last 6 complete months and one of the last 2) with no expense line yet this month, after their usual day plus 5 days (Israel time; on the month's last day when that falls later). Each has `supplier_id`, `supplier_name`, `currency`, `typical_amount_minor` (median monthly net, negative), `typical_day`, `expected_by`, `months_seen`, `last_doc_date`, `project_id`, `category_id`.

### get_expected_months

`expected_months`, optional `months` (1 to 12, default 3) and `project_id` ([0131](../decisions/0131-jev-patterns.md)). Read tool. Output `data`: `today`, `project_id`, `months[]` (`month` YYYY-MM, `open`, `by_currency[]` with `currency`, `income_minor`, `expense_minor`; expenses negative) and `recurring[]` (`direction`, `party_id`, `name`, `currency`, `typical_amount_minor`, `typical_day`, `months_seen`, `seen_this_month`, `project_id`, `category_id`). This month counts only the recurring parties not seen yet; later months count all of them. With `project_id`, only parties whose usual project it is. A projection from past months, not booked lines.

Jev labels new lines within about 5 minutes of a bank sync, up to `daily_call_cap`. It only suggests a project and category on the review card; it never approves a line ([0084](../decisions/0084-jev-auto-prefill.md)). A line Jev failed on waits 6 hours (a day from the third failure) before it is sent again.

## Loans · cycle 5

Read tools use `mcp_list_loans` and shared schedule math. Writes use the same writer gate as cycle 4. Amounts in tool arguments are major units (decimal strings or numbers); responses include `_minor` integer fields. `annual_rate_percent` is the nominal rate (6.875 means 6.875%).

### list_loans

Input `{ "include_closed": true }` (optional, default `true`; `false` lists open loans only). Loans come in the saved order: by name until `reorder_loans` changes it, and a loan added since goes last ([0142](../decisions/0142-loan-delete-and-order.md)). Output `data.loans[]`: `id`, `name`, `currency`, `principal_minor`, `annual_rate_ppm`, `term_months`, `start_date`, `payment_minor`, `escrow_minor`, `balance_minor`, `flagged_parts`, `flagged_transaction_ids`, `project_id` and `project_name` (null when the loan has no project), `status` (`open`, `paid_off` or `closed`) and `closed_on` (the day it ended, null while open; [0122](../decisions/0122-loan-status.md)), and `interest_category_id`, `escrow_category_id`, `principal_category_id` with their `*_name` (the loan's own category per part, null for the default; [0128](../decisions/0128-loan-part-categories.md)), and `fees_category_id` with `fees_category_name` (the category for a payment's fees part when the attach names none, null when the loan names none; there is no default; [0130](../decisions/0130-loan-fees-installments.md)). `kind` (`amortizing`, `interest_only`, `balloon` or `demand`), `interest_only_months` (set only for `interest_only`), `amortization_months` (set only for `balloon`) and `rates[]` (`id`, `effective_date`, `annual_rate_ppm`, oldest first, `[]` when none; see `set_loan_rate`) ([0132](../decisions/0132-loan-kinds-rates.md)); `rate_index` (`il_prime` or null) and `rate_margin_ppm` (the margin over it, may be negative, null when unlinked; see `set_loan_index`, [0160](../decisions/0160-loan-index-rates.md)); a `demand` loan has `term_months` and `payment_minor` null. `payment_minor` is the monthly payment: on an `interest_only` loan whose `interest_only_months` equal the term it is the interest at the rate in force today (the latest `rates[]` row on or before it, else `annual_rate_ppm`) plus escrow, while the stored payment is the bullet the schedule's last row pays (FLOW-136). `flagged_parts` counts the loan parts waiting for review and `flagged_transaction_ids` lists their lines (sorted, each once, `[]` when none), leaving out lines that were removed or voided (FLOW-114); a flagged part does not lower `balance_minor` until the split is corrected in the app ([0121](../decisions/0121-loan-balance-checks.md)). `accrued_interest_minor` is what an open demand loan owes in interest today (`accrued_as_of`, the UTC day): interest earlier payments left unpaid plus what accrued since the last payment or the start, daily on actual/365, the same figure as `get_loan_schedule`'s `accrued.interest_minor`. It is null for the other kinds, whose interest is in the schedule rows, for a closed loan, and when the loan's payments could not be read ([FLOW-211](../backlog/TASKS.md#flow-211)).

### get_loan_schedule

Input `{ "loan_id", "from": 0, "limit": 12, "as_of" }`. `limit` defaults to 12 and cannot exceed 600. Output `data`: `{ "loan_id", "kind", "from", "limit", "total", "rows" }` where each row has `date`, `payment`, `interest`, `escrow`, `principal`, `balance` (major strings) and matching `*_minor` fields.

Each row's interest uses the rate in force on its date: the latest `set_loan_rate` row on or before it, else the loan's own rate. When that rate differs from the rate the payment was set at, principal-and-interest is recast from that row over the months left to amortize (to the term, or to `amortization_months` for a balloon), so a rate rise never leaves the payment below the interest. An `amortizing` loan whose stored payment is below the term annuity (an implicit balloon, [0088](../decisions/0088-loans.md)) amortizes over the period that payment implies: the smallest number of months from the term on whose annuity is at or below the stored principal-and-interest, at most 600. It is recast over the months left in that period, so the payment moves with the rate and the balloon stays at the term. An `interest_only` loan's first `interest_only_months` rows pay interest and escrow only (when they equal the term, the last row also pays the principal); later rows use the stored payment. A `balloon` loan's row at the term pays the rest of the balance ([0132](../decisions/0132-loan-kinds-rates.md)).

A `demand` loan has nothing scheduled ahead. `rows` are the payments attached on or before `as_of`, oldest first (lines still on the books and not waiting for review, pending lines included), each with the balance after it, and `data.accrued` is `{ "as_of", "since", "days", "carried", "carried_minor", "interest", "interest_minor", "balance", "balance_minor" }`. `interest` is the interest due on `as_of` (`YYYY-MM-DD`, default today in UTC): `carried`, the interest accrued before the last payment that the payments did not pay, plus what accrued from the last payment (or the start) to `as_of`, daily on actual/365 at the rate in force on each day. Each period between payments is summed exactly and rounded half to even once; interest is simple (carried interest earns none). A malformed `as_of` is `validation` on any loan; the other kinds do not use it.

### add_loan

```json
{
  "idempotency_key": "loan-1",
  "name": "Example Bank",
  "principal": "120000.00",
  "annual_rate_percent": 6.875,
  "term_months": 360,
  "start_date": "2026-01-01",
  "escrow": "100.00",
  "currency": "USD"
}
```

Optional `kind` (default `amortizing`; [0132](../decisions/0132-loan-kinds-rates.md)):

- `interest_only` needs `interest_only_months` (1 to `term_months`). Those months pay interest and escrow only; the default `payment` is then the annuity over the months left (over one month when they equal the term, so the principal is due in the last month).
- `balloon` needs `amortization_months` (`term_months` to 600). The default `payment` is the annuity over those months, and the rest of the balance is due at the term.
- `demand` takes no `term_months`, `payment` or `escrow` (each is `validation`). Interest accrues daily between payments (see `attach_loan_payment`); a 0% rate is allowed. The output's `payment` is null and `schedule_preview` is `[]`.

A kind field without its kind (`interest_only_months` on another kind, for example), or a missing `term_months` on a kind that is not `demand`, is `validation`, and the message names the field (`interest_only_months: only with kind interest_only`, `term_months: required unless kind is demand`). Months are whole numbers, not text: `"12"` is `term_months: expected number, received string`. Optional `payment` and `escrow` (default 0). Optional `project_id` files the loan under a project of this company; a project of another company, or an unknown one, is `refused` / `project not found` and nothing is written. Omitted `currency` uses `mcp_company_loan_currency()` (USD only when every one of the newest 1000 open lines is USD, the same lines the app reads; otherwise ILS). Output includes computed `payment`, `schedule_preview` (first three rows), `id`, and `undo_kind`: `"loan"`. Invalid terms return `validation` with a `LoanScheduleError` code (`principal`, `rate`, `term`, `payment`, `escrow`, `start_date`, `payment_below_interest`, `kind`, `interest_only_months`, `amortization_months`, `rate_date`). The database holds the kind fields too (`loans_kind_chk`), so terms that slip past are `refused` / `invalid loan terms`.

### update_loan

Patch fields: `name`, `principal`, `annual_rate_percent`, `term_months`, `start_date`, `payment`, `escrow`. `currency` is rejected. An explicit `null` (other than `project_id`) or an empty patch is `validation`; as in `add_loan` and `attach_loan_payment`, the message names the field and what it takes, such as `escrow: expected a number or text` or `arguments: nothing to change` (FLOW-414). The name is trimmed. A patch that leaves principal-and-interest (`payment` minus `escrow`) below the first month's interest is `refused` / `payment below interest`, and nothing is stored. The same rule holds for a loan saved in the app. A `principal` below the principal already paid (the posted principal parts that count in `list_loans`' balance) is `refused` / `loan balance exceeded`; equal to it saves, with a balance of zero. An undo that would lower the principal that far is refused the same way ([0121](../decisions/0121-loan-balance-checks.md)). `project_id` files the loan under a project, `null` clears it, and leaving it out keeps it; a project of another company is `refused` / `project not found`. Payments already attached stay on the project they were filed under. `status` (`open`, `paid_off`, `closed`) and `closed_on` (`YYYY-MM-DD`, or `null`) mark a loan as ended ([0122](../decisions/0122-loan-status.md)): a loan that is not open needs `closed_on` (`refused` / `closed_on required`), an open one cannot have it (`refused` / `loan is open`), and `status: "open"` alone reopens the loan and clears the date. Closing on a day before a payment that is already attached is `refused` / `payments after closed_on`. Output `{ "id", "project_id", "status", "closed_on", "balance_left", "undo_kind": "loan_update" }`; `balance_left` is the principal Flow never saw paid, set only when the loan is not open. Undo restores the previous project (or none), status and `closed_on`, and is `refused` / `project not found` if that project was deleted since. An edit kept before these fields existed undoes without touching the status. `interest_category_id`, `escrow_category_id` and `principal_category_id` (a category id, or `null` for the default) file that part of payments attached later ([0128](../decisions/0128-loan-part-categories.md), [0166](../decisions/0166-loan-interest-kept-out.md)): interest and escrow take any expense category, counted in the P&L or kept out (a kept-out one keeps that part out of profit, such as a rehab or flip loan's interest carried as a cost), principal needs an expense category kept out, and a built-in loan category takes only its own part; otherwise `refused` / `category does not fit the loan part`. Another company's or an unknown category is `refused` / `category not found`. Payments already attached keep their categories. Undo restores them, and is `refused` / `category not found` if one of them was deleted since, or `category does not fit the loan part` if it no longer fits (a principal category now counted in the P&L). `fees_category_id` (a category id, or `null`) files the fees part of payments attached later when the attach names none ([0130](../decisions/0130-loan-fees-installments.md)): any expense category, counted in the P&L or kept out, that is not a built-in loan category, or the built-in interest one (`ריבית משכנתא`); otherwise `refused` / `category does not fit the loan part`. `null` clears it; there is no default, so a later attach with fees must then name its own. Output and undo carry it like the other three.

`kind`, `interest_only_months` and `amortization_months` change the loan's kind ([0132](../decisions/0132-loan-kinds-rates.md)). `kind: "interest_only"` needs `interest_only_months` and `kind: "balloon"` needs `amortization_months` in the same patch; a change of kind clears the other kind's field. `kind: "demand"` cannot come with `term_months`, `payment` or `escrow` and clears all three (escrow to 0). A loan leaving `demand` needs `term_months` and `payment` in the patch, or it is `refused` / `invalid loan terms`. `interest_only_months` or `amortization_months` alone changes that field on a loan already of that kind; on another kind it is `refused` / `invalid loan terms`. The payment rule above holds for every kind but `demand`. Output carries `kind`, `interest_only_months` and `amortization_months`, and undo restores them (with the term and payment). Payments already attached keep their parts.

### set_loan_rate

```json
{
  "idempotency_key": "rate-1",
  "loan_id": "<loan id>",
  "effective_date": "2027-01-01",
  "annual_rate_percent": 7.5
}
```

From `effective_date` on, the loan's rate is `annual_rate_percent` (0 to 100, at most 4 decimals), entered by hand when an index such as prime changes; Flow fetches no index ([0132](../decisions/0132-loan-kinds-rates.md)). A second call for the same date changes that row, and `annual_rate_percent: null` removes it (`refused` / `rate not found` when there is none). A date before the loan's `start_date` is `refused` / `rate before the loan start`; an unknown loan or another company's is `refused` / `loan not found`. The rate in force on a date is the latest row on or before it, else the loan's own `annual_rate_percent`; `get_loan_schedule` and `attach_loan_payment` use it, and a change recasts the payment from the first row it applies to. Payments already attached keep their parts. Output `data`: `{ "id", "loan_id", "effective_date", "annual_rate_ppm", "previous_rate_ppm", "undo_kind": "loan_rate" }`; `id` is the rate row's id (kept when the row is removed, so undo can put it back) and `previous_rate_ppm` is the row's rate before the call (null when there was none). Undo `kind: "loan_rate"` takes that id and puts the row back as it was (removed, restored with the same id, or its old rate); if the row changed since, it is `conflict`.

### set_loan_index

```json
{
  "idempotency_key": "index-1",
  "loan_id": "<loan id>",
  "rate_index": "il_prime",
  "margin_percent": 0.75
}
```

Links the loan's rate to an index: `il_prime` (the Bank of Israel prime rate) plus `margin_percent` (-100 to 100, at most 4 decimals; negative for prime minus). `rate_index: null` with `margin_percent: null` unlinks it; one without the other is `validation`. Linking writes no rate by itself: `set_index_rate` does, from a date. An unknown loan or another company's is `refused` / `loan not found`. Output `data`: `{ "loan_id", "rate_index", "rate_margin_ppm", "previous": { "rate_index", "rate_margin_ppm" }, "undo_kind": "loan_index" }`. Undo `kind: "loan_index"` with the loan id puts the link before back; once the link changed again it is `conflict` ([0160](../decisions/0160-loan-index-rates.md)).

### set_index_rate

```json
{
  "idempotency_key": "prime-2027-01",
  "rate_index": "il_prime",
  "effective_date": "2027-01-01",
  "annual_rate_percent": 5.5
}
```

Records a new index rate from `effective_date` on, for example when the Bank of Israel moves prime. Every loan linked to `rate_index` gets a rate row on that date at `annual_rate_percent` (0 to 100, at most 4 decimals) plus its margin, kept between 0% and 100%: the same row `set_loan_rate` writes, so a row already on that date is replaced, and `get_loan_schedule`, demand interest and `list_loans` use it the same way. A loan whose `start_date` is after the date is skipped and listed in `skipped` with `reason` `rate before the loan start`, and a loan paid off or closed before the date with `rate after the loan closed`. No linked loan is `refused` / `no loan linked to this index`; when every linked loan is skipped it is `refused` / `no linked loan is open on this date`. Output `data`: `{ "id", "rate_index", "effective_date", "index_rate_ppm", "loans": [{ "loan_id", "name", "rate_id", "annual_rate_ppm", "previous_rate_ppm" }], "skipped": [{ "loan_id", "name", "reason" }], "undo_kind": "index_rate" }`; `id` is the write's id. Undo `kind: "index_rate"` with that id puts every row back as it was (removed, or its old rate), all or nothing: if any of those rows changed since, it is `conflict` and nothing moves ([0160](../decisions/0160-loan-index-rates.md)).

### attach_loan_payment

```json
{
  "idempotency_key": "split-1",
  "transaction_id": "<ledger id>",
  "loan_id": "<loan id>"
}
```

Optional inputs ([0130](../decisions/0130-loan-fees-installments.md)):

- `installments` (integer, 1 to 12): the payment covers that many schedule rows, starting at the first row not yet paid: the first row whose scheduled interest plus principal through it is more than the interest plus principal already attached to the loan (lines still on the books and not waiting for review, pending lines included; this line itself left out). Escrow and fees are not counted. So an interest-only row counts as paid once its interest is, and two attaches before the first line posts do not start on the same row (FLOW-135 N1, [0132](../decisions/0132-loan-kinds-rates.md)). The scheduled interest, escrow and principal are the sums of those rows, and the line splits against them as usual. Rows that run past the schedule are `refused` / `not enough schedule rows`. Without it, the row for the line's `doc_date` is used.
- `fees` (an amount above zero, in the format of the other amounts, at most two decimals or `validation`): taken off the line first; the rest splits as usual and a fourth part `fees` is written. A line smaller than the fees is `refused` / `fees exceed the line`. It can go with `installments`.
- `parts` (`{ "interest", "escrow", "principal", "fees"? }`, amounts of zero or more with at most two decimals (more is `validation`, not rounded), `fees` above zero when given): the exact split, used as given. The parts must add up to the line exactly, or it is `refused` / `parts don't add up`. `parts` cannot be combined with `installments` or `fees` (`validation`). The scheduled figures are still taken from the row for the date, for comparison, and scheduled fees equal the fees; on a date with no schedule row they are 0 and the parts are still accepted (FLOW-135 N3).
- `fees_category_id` (a category id): this payment's fees category. Allowed only when the payment has fees (`fees` or `parts.fees`); otherwise `validation`. It is sent to the database as `category_id` on the fees part, so a replay with the same key matches.

A catch-up payment of $4,000.00, for example (invented figures), is:

```json
{
  "idempotency_key": "split-2",
  "transaction_id": "<ledger id>",
  "loan_id": "<loan id>",
  "parts": { "interest": "0", "escrow": "1200.00", "principal": "1300.00", "fees": "1500.00" },
  "fees_category_id": "<closing-costs category id>"
}
```

Fees have no default category (the owner's decision, 2026-10-08). The fees part goes to the call's `fees_category_id`, else to the loan's (set with `update_loan`); with neither it is `refused` / `fees category required`, checked by the tool before the write and again by the database. A fees category is any expense category, counted in the P&L or kept out, either one with no loan key or the built-in interest one; one that is not is `refused` / `category does not fit the loan part`, and another company's or an unknown one `refused` / `category not found`. Each fees part counts in the P&L or stays out by its category's flag (a kept-out closing-costs category leaves the P&L unchanged), and a fees category may flip sides of the P&L freely. A replay with the same idempotency key rebuilds the same parts: when the line is already split on this loan, the handler reads it (`get_loan_split`) and adds its principal back to the balance, and leaves the line's own parts out of what is already paid, so `installments` start on the same row.

A `demand` loan has no schedule ([0132](../decisions/0132-loan-kinds-rates.md)). Interest is the balance left after the payments already attached times the rate in force on each day (`set_loan_rate`), for the days from the last attached payment (or the start) to the line's `doc_date`, on actual/365, summed exactly and rounded half to even once, plus the interest earlier payments left unpaid (carried forward, simple interest: it earns none). The rest of the line is principal, and a line smaller than the interest pays interest only; what it leaves unpaid is carried to the next payment, which pays it as interest first. Escrow is 0. `fees` and `parts` work as on any loan. Payments counted are those on lines still on the books and not waiting for review, pending lines included. `installments` is `refused` / `a demand loan has no schedule rows`; a line dated before the loan's start is `refused` / `payment before the loan start`; a line dated before a payment already attached is `refused` / `a later payment is already attached` (attach in date order, or undo the later one first). The database repeats both checks under the loan lock, so an attach made in the app at the same moment waits and is checked after it. A line already split on this loan skips that check, so a replay with the same `idempotency_key` returns the stored response (another key is `loan already attached`). Principal above the loan balance is still `loan balance exceeded`, and a closed loan still `loan closed`. `parts[]` in the output lists the fees part too.

The handler loads the line, picks the schedule row for `doc_date`, and splits like the app. The database takes exactly one `interest`, `escrow` and `principal` part, plus at most one `fees` part above zero, each a whole non-negative number of minor units, summing to the line; anything else is `refused` / `invalid loan parts`. Principal that would take the loan balance below zero is `loan balance exceeded`, from the app too. A paid-off or closed loan takes only lines dated on or before its `closed_on`; a later one is `refused` / `loan closed`, from the app too ([0122](../decisions/0122-loan-status.md)). A payment whose bank line was still pending, or was removed, counts once the line posts or comes back; if it would then take the balance below zero, its parts are flagged for review instead (`flagged_parts` and `flagged_transaction_ids` in `list_loans`) and stop counting until the split is corrected ([0121](../decisions/0121-loan-balance-checks.md)). A loan saved before these checks with a payment below the interest makes this tool and `get_loan_schedule` return `refused` / `payment below interest` until the payment is raised. Output includes `parts[]` and `undo_kind`: `"loan_split"`. Undo `kind: "loan_split"` takes the **transaction** id. Once attached, the payment counts by its parts in `get_totals`, `get_project` and `list_project_category`: interest and escrow stay in the P&L under `ריבית משכנתא` and `מסים וביטוח`, and the principal counts under `תשלומי הלוואה`, which is kept out and shows in the excluded totals; a loan that names its own category for a part uses that one instead ([0128](../decisions/0128-loan-part-categories.md); each part counts by its category's flag, so interest in a kept-out category stays out of the P&L ([0166](../decisions/0166-loan-interest-kept-out.md))). The line's own category gets nothing. A split that needs review, or a line that carries VAT, counts whole instead ([0100](../decisions/0100-loan-split-pnl.md)). Deleting the split (undo) removes every part, a fees part too, and puts the whole line back. If the parts were corrected in the app after the attach (a changed amount or category; `scheduled_minor` is not compared), undo is `conflict` and the corrected split stays. An undo of `update_loan` that would bring back a payment below the interest is `refused` / `payment below interest`.

When the loan has a project and the line has no project, no shares and no role (and a category), the line is filed as a direct cost on that project, the same rule `assign_expense` uses, so the parts count there: interest and escrow as direct cost, principal in the excluded totals (FLOW-105, [0105](../decisions/0105-loan-project.md)). Output `project_inherited` (true or false), `project_id` (when inherited) and `project_inherited_reason` when false: `loan has no project`, `line already has a project`, `line has shares`, `line has a role`, `line has no category`, `line category is a guess` (a suggested category is not confirmed by the attach; confirm it with `assign_expense`, which also files the line) or `project not set` (filing the line failed; the parts are still attached). The line is then left exactly as it was. Undo of `loan_split` restores the line's previous project when nothing changed it since, including its role, which is none for a line under an income (reversal) category (`project_restored` true); a line changed after the attach keeps its new project (`project_restored` false).

### detach_loan_payment

```json
{ "idempotency_key": "unmatch-1", "transaction_id": "<ledger id>" }
```

Takes one line off the loan it was attached to, by `attach_loan_payment` or in the app ([FLOW-114](../backlog/TASKS.md#flow-114), [0136](../decisions/0136-loan-unmatch.md)). Its interest, escrow, principal and fees parts are removed: the line counts whole under its own category again, and the loan balance no longer counts its principal. The line keeps its project and category (undo of `loan_split` gives back a project the attach filed, but only before the detach or after the detach is undone; on a detached line it is `conflict`). A line with no loan split is `refused` / `line has no loan split`; an unknown line or another company's is `refused` / `transaction not found`. Write rate limit and idempotency key as for every write.

Output `data`: `{ "transaction_id", "loan_id", "parts": [{ "part", "amount_minor" }], "undo_kind": "loan_detach", "id" }`, parts in the order interest, escrow, principal, fees, in minor units. Undo `kind: "loan_detach"` with the transaction id puts the same parts back (amounts, categories, review flags). It is `conflict` when the line was matched again since, when the parts no longer fit (the line's amount changed, the balance no longer takes the principal, a part's category no longer fits), or when the loan is a demand loan and a later payment of it was matched since (payments go in date order, [0132](../decisions/0132-loan-kinds-rates.md)), and `not_found` when the line or the loan was removed.

### delete_loan

```json
{ "idempotency_key": "delete-loan-1", "loan_id": "<loan id>" }
```

Deletes a loan with its rate rows and the split parts of every payment matched to it ([FLOW-110](../backlog/TASKS.md#flow-110), [0142](../decisions/0142-loan-delete-and-order.md)). Those payments count whole again under their own categories, and the loan's principal no longer counts. An unknown loan or another company's is `refused` / `loan not found`. Output `data`: `{ "loan_id", "name", "payments", "undo_kind": "loan_delete", "id" }`, where `payments` is how many lines were unmatched.

Undo `kind: "loan_delete"` with the loan id puts back the loan, its rates and its parts. It is `conflict` when one of those lines was matched again since, or when the parts no longer fit it. A project or loan category deleted since is left empty on the restored loan. It is `not_found` when the owner already put the loan back in the app.

### reorder_loans

```json
{ "idempotency_key": "order-1", "loan_ids": ["<loan id>", "<loan id>"] }
```

Saves the order of the loans list, first to last. `loan_ids` names every loan of the company once, open and closed. A list that leaves one out, names one twice or names another company's loan is `validation`, so a list read before a loan was added or deleted is refused. Output `data`: `{ "loan_ids", "undo_kind": "loan_order", "id" }`, where `id` is the company id. Undo `kind: "loan_order"` puts back the order before. It is `conflict` when the order changed, or a loan was added or deleted, since.

### undo (loan kinds)

| `kind` | `id` |
| --- | --- |
| `loan` | loan id from `add_loan` |
| `loan_update` | loan id |
| `loan_split` | transaction id |
| `loan_rate` | rate row id from `set_loan_rate` |
| `loan_detach` | transaction id from `detach_loan_payment` |
| `loan_delete` | loan id from `delete_loan` |
| `loan_order` | company id from `reorder_loans` |

Refused messages add `loan not found`, `loan currency mismatch`, `loan already attached`, `loan balance exceeded`, `no schedule row for this date`, `loan categories missing`, `invalid loan terms`, `project not found`, `payment below interest`, `invalid loan parts`, `rate before the loan start`, `rate not found`, `a demand loan has no schedule rows`, `payment before the loan start`, and `a later payment is already attached`.

## Line splits · FLOW-311

### split_line

Splits one bank line into parts, each with its own category, optional project, and an exact amount in minor units of the line's currency (cents for USD, agorot for ILS), a percent of the line, or the rest. Decisions [0104](../decisions/0104-line-split-by-category.md) and [0123](../decisions/0123-line-split-percent-rest-reversal.md).

```json
{
  "idempotency_key": "wire-1",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "parts": [
    { "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "amount_minor": 25000 },
    { "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "project_id": "8c1a0b2e-1111-4000-8000-000000000002", "amount_minor": 292000 }
  ]
}
```

A refund of $100 filed as North rent, with 30% going back against South's repairs, $20 against North's insurance, and the rest staying on the line:

```json
{
  "idempotency_key": "refund-1",
  "transaction_id": "22222222-2222-4000-8000-000000000021",
  "parts": [
    { "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "project_id": "8c1a0b2e-1111-4000-8000-000000000002", "percent": 30 },
    { "category_id": "c0ffee00-1111-4000-8000-0000000000a2", "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "amount_minor": 2000 },
    { "rest": true }
  ]
}
```

- Two to 50 parts. Each gives exactly one of `amount_minor` (a whole number above zero), `percent` (above 0, up to 100, at most 4 decimals, of the whole line) or `rest: true`.
- Percent parts are rounded together so they hit the line to the cent: each takes the floor of its share and the missing cents go to the largest remainders, the first part first on a tie. 50/50 of $100.01 is $50.01 and $50.00.
- At most one part is the rest: it takes what the other parts leave. Without `category_id` it keeps the line's own category; without `project_id` the line's project. A rest with nothing left is dropped.
- Without a rest part the parts must sum exactly to the line's net amount, or the write is `refused` with `parts must sum to the line`.
- A part whose category is the other kind (an expense category on an inflow, such as a supplier refund; an income category on an outflow) is a reversal: it lowers that side of the P&L, like a whole reversal line, and needs its own `project_id` unless it is the line's own category or a kept-out category (it counts in no P&L, [0138](../decisions/0138-line-split-review-followups.md)); a line the owner put in the P&L (`set_line_pnl` true) counts its kept-out parts too, so there a kept-out reversal part needs a project, and `set_line_pnl` true on a line with such a part is `refused` with `a reversal part needs a project`. A category and project pair appears once; a part without `project_id` is on the line's project, so it and a part naming that project with the same category are the same pair (`same category and project twice`).
- `project_id` is optional. A part without it keeps the line's project and P&L role; on a shared line it is shared by the line's allocations in proportion. A part with a project counts as that project's direct cost (or overhead, for the overhead project).
- `parts: []` clears the split, and the line counts whole again.
- Refused: `transaction not found`, `category not found`, `project not found`, `a reversal part needs a project`, `same category and project twice`, `line amount is zero`, `parts must sum to the line`, `parts exceed the line`, `a part rounds to zero`, `nothing is left for the rest` (one part would remain), `line has no category for the rest`, `line has a loan split` (use one or the other), and `line has an open review` (resolve the review with `assign_expense` first). A `split_mismatch` review does not block the call.
- When the bank sync changes the amount of a split line so the parts no longer sum to it, the line counts whole and gets an open review item with `reason` `split_mismatch` in `list_review` (unless it already has an open review). Send new parts that sum to the new amount, or `parts: []`, and the review closes; it also closes by itself if the amount comes back to match. Approving or skipping it in the review queue keeps the line counting whole. Undo of a fix brings back the old parts and the review. [FLOW-312](../backlog/TASKS.md#flow-312), [0125](../decisions/0125-split-line-resync-review.md).
- VAT stays on the line. The parts split the net amount.
- While a split is in place, `set_expense_category` and `assign_expense` change only the line's own category and project, which the P&L does not read for a split line. Clear the split with `parts: []` first, or send new parts.

Output `data`: `{ "transaction_id", "parts": [{ "category_id", "project_id", "amount_minor" }], "undo_kind": "line_split", "id", "write_id" }`, with every part in minor units as stored (percents and the rest resolved). `write_id` names this write for `undo_batch`; `undo` does not take it. Undo `kind: "line_split"` with the transaction id puts back the parts from before this write (none, or an earlier split), with their percent and rest markers, and the line's assignment flags. If the parts changed since, undo is `conflict`. It is also `conflict` when the line is now in the P&L (`set_line_pnl` true) and the parts it would put back include a reversal part with no project ([0138](../decisions/0138-line-split-review-followups.md)); undo the `line_pnl` write first.

Once split, the line counts by part in `get_totals`, `list_projects`, `get_project` and `list_project_category`: each part under its own category and project, a part in a kept-out category in the `excluded_*` totals, and the line's own category gets nothing. `count` still counts the line once. If a bank re-sync changes the line amount so the parts no longer sum, the line counts whole until it is split again; `get_expense` shows `line_split.parts_match: false`.

`get_expense` on a split line adds `line_split`: `{ "currency", "line_minor", "parts": [{ "category_id", "category_name", "project_id", "project_name", "amount_minor", "percent", "rest" }], "parts_match" }`. `percent` is the percent the part was given (null for an amount or the rest) and `rest` marks the part that took what was left; both are informational, `amount_minor` is what counts, and a part put back by undo of a write made before FLOW-133 shows neither.

### set_line_pnl

Takes one line out of the P&L, or counts one line of a kept-out category. Decision [0112](../decisions/0112-line-out-of-pnl.md).

```json
{ "idempotency_key": "out-1", "transaction_id": "22222222-2222-4000-8000-000000000020", "in_pnl": false }
```

- `in_pnl: false` keeps the line out, `true` counts it although its category is kept out, `null` clears the override so the line follows its category again. The override wins over the category's `excluded_from_pnl` and covers every part of a split line.
- An out line moves to the `excluded_*` totals of `get_totals`, `list_projects` and `get_project`, and to `get_breakdown`'s `excluded` group, on both bases. Nothing is hidden, except that an unpaid supplier invoice is in no field on `cash` ([0118](../decisions/0118-unpaid-invoices-cash-basis.md)).
- Refused: `transaction not found` (also another company's line) and `loan line is fixed` (a line with a loan split or in a loan category; its parts decide what counts).

Output `data`: `{ "transaction_id", "in_pnl_override", "in_pnl", "undo_kind": "line_pnl", "id", "write_id" }` (`write_id` is for `undo_batch`). Undo `kind: "line_pnl"` with the transaction id puts back the override from before this write. If the override changed since (for example in the app), undo is `conflict`.

### set_lines_pnl

`set_line_pnl` for up to 200 lines in one write. Each item is `{ "transaction_id", "in_pnl" }`, and `in_pnl` is required (`null` clears). Duplicate `transaction_id` values are `validation`. A bad row does not block good rows. Rows use the key `idempotency_key:ordinal`, so the key is 1–124 characters.

```json
{
  "idempotency_key": "out-batch-1",
  "items": [
    { "transaction_id": "22222222-2222-4000-8000-000000000020", "in_pnl": false },
    { "transaction_id": "22222222-2222-4000-8000-000000000021", "in_pnl": null }
  ]
}
```

Output `data`: `{ "batch_key", "ok_count", "error_count", "results" }`, each result `{ "transaction_id", "ok": true, "in_pnl", "undo_kind": "line_pnl" }` or `{ "transaction_id", "ok": false, "code" }`. [undo_batch](#undo_batch) with `batch_key` undoes the rows that succeeded.

## Unpaid · FLOW-330

SUMIT invoices still open, and a mark the owner sets when one was paid before SUMIT has the receipt. Decision [0133](../decisions/0133-invoice-paid-marks.md).

### list_unpaid

Read. No arguments. The open documents the Unpaid screen shows: SUMIT invoices with an amount still open after their linked receipts and credit notes, oldest first. Customer invoices have `direction` `income` and a positive amount; supplier invoices have `direction` `expense` and a negative one.

Output `data`: `{ "invoices", "totals" }`. Each invoice is `{ "id", "description", "doc_date", "currency", "direction", "project_name", "customer_name", "open_gross_minor", "open_net_minor", "marked_paid_at", "document_url" }`; `id` is the transaction id, `marked_paid_at` is when the document was marked paid (`null` when not), and `document_url` is the SUMIT document link on `https://pay.sumit.co.il/` (`null` until a sync reads it). `totals` has one row per currency and direction, `{ "currency", "direction", "open_gross_minor", "marked_gross_minor" }`: the rows not marked, and the marked ones. Customer and supplier amounts never share a total. A marked document stays listed until a sync brings its open amount to zero.

### set_invoice_paid

Marks one open document paid while SUMIT has no receipt for it yet, or clears the mark.

```json
{ "idempotency_key": "paid-1", "transaction_id": "22222222-2222-4000-8000-000000000030", "paid": true }
```

- `paid: true` marks it (marking again keeps the first time), `false` clears it (clearing an unmarked one changes nothing).
- The mark changes no total and no P&L figure: it only moves the document from `open_gross_minor` to `marked_gross_minor` in `list_unpaid`. The P&L follows the receipt when the sync brings it.
- Refused: `invoice not found` (not a document `list_unpaid` lists, already closed, or another company's).

Output `data`: `{ "transaction_id", "marked_paid", "marked_paid_at", "undo_kind": "invoice_paid", "id" }`. Undo `kind: "invoice_paid"` with the transaction id puts the mark back as it was before this write (with its first time and author) or takes it away. If the mark changed since (cleared, or cleared and set again, for example in the app), undo is `conflict`; a document removed since is `not_found`.

## Batch · cycle 6

`assign_expenses` applies up to 200 rows in one write. Each item needs `transaction_id` and at least one of `project_id`, `category_id`, `shares[]` or `parts[]`. When `project_id` is set, `category_id` is required and the row behaves like `assign_expense`. When only `category_id` is set, the row behaves like `set_expense_category`, and `remember: true` on it is `validation`, since remember saves a project. Ids are accepted in any case and compared in lower case. When `shares[]` is set, the row behaves like `assign_expense_split`: `category_id` is optional, and `project_id` or `remember` on the same row is `validation`. Duplicate `transaction_id` values in one call are `validation`. A bad row does not block good rows. Each row uses the key `idempotency_key:ordinal`, so `assign_expenses` and `undo_batch` take a key of 1–124 characters. A retry with a split row's `shares[]` in another order replays the stored response. A row with `parts[]` (and only `transaction_id` besides) runs [split_line](#split_line) on that line with the same parts and rules (`parts: []` clears the split); its `undo_kind` is `line_split`. `project_id`, `category_id`, `remember` or `shares[]` on a parts row is `validation`. Parts are hashed in the order sent, since their order is the stored order ([FLOW-312](../backlog/TASKS.md#flow-312)).

```json
{
  "idempotency_key": "batch-1",
  "items": [
    {
      "transaction_id": "22222222-2222-4000-8000-000000000020",
      "project_id": "8c1a0b2e-1111-4000-8000-000000000001",
      "category_id": "c0ffee00-1111-4000-8000-0000000000a1"
    },
    {
      "transaction_id": "22222222-2222-4000-8000-000000000021",
      "category_id": "c0ffee00-1111-4000-8000-0000000000a1"
    },
    {
      "transaction_id": "22222222-2222-4000-8000-000000000022",
      "category_id": "c0ffee00-1111-4000-8000-0000000000a1",
      "shares": [
        { "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "share": 50 },
        { "project_id": "8c1a0b2e-1111-4000-8000-000000000002", "share": 50 }
      ]
    }
  ]
}
```

Output `data`: `{ "batch_key", "ok_count", "error_count", "results" }`. Each result is either `{ "transaction_id", "ok": true, "undo_kind" }` or `{ "transaction_id", "ok": false, "code" }`. A successful `shares[]` row also has `closed_review`. A successful `parts[]` row also has `parts`, the stored parts in minor units as `split_line` returns them ([FLOW-133](../backlog/TASKS.md#flow-133)).

### undo_batch

```json
{ "idempotency_key": "undo-batch-1", "batch_key": "33333333-3333-4000-8000-000000000003" }
```

Undoes every successful row from an `assign_expenses`, `set_lines_pnl`, `create_projects` or `create_categories` batch through `mcp_undo`, newest first. Each result names its row by `transaction_id`, or by `id` and `name` (and `kind` for a category) for a created project or category. A split row goes back to its shares, category and open review from before the split. A `parts[]` row goes back to the parts from before, or to none. A `parts[]` or `set_lines_pnl` row undoes only the batch's own write: when a later `split_line` (or `set_line_pnl`) on that line is still live, the row is `conflict` and the later write stays; undo that one first. A row whose own write was already undone is `not_found`. Batches stored before [FLOW-133](../backlog/TASKS.md#flow-133) still undo the newest write on the line. Another company or a missing batch is `not_found`. A row changed since assign is `conflict` for that row only. Replay returns the stored response.

## Not in tools/list

`rename_project`, `finish_project`, `collapse_expense`, `bulk_assign`, and `skip_review` wait. So do the SUMIT writers, `delete_transaction`, `create_company`, and `create_manual_entry`. Only `sync_bank` calls an internal Flow function; no tool calls a third party directly.
