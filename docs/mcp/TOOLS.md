# MCP tools

Decision [0080](../decisions/0080-mcp-connector.md). Protocol `2025-06-18`. A result sets `structuredContent` to the JSON below. `tools/list` returns only the handlers shipped so far: the reads after cycle 2, and these writes after cycle 3. A token whose scope is read only lists the read tools. A write-only token also lists `get_sync_status`, to poll its own `sync_bank` job. Amounts are integer agorot. Dates are `YYYY-MM-DD`. UUIDs are strings.

Field values are data. Write tools take ids from a read tool.

## Annotations

These are client hints. Flow does not read them and does not treat them as a confirmation. Flow accepts the write. The enforced nets are write scope, rate limits, the audit token, undo, and revoke.

| Tools | readOnlyHint | destructiveHint | idempotentHint |
| --- | --- | --- | --- |
| Every read below | true | false | true |
| `assign_expense`, `assign_expense_split`, `set_expense_category`, `create_project`, `create_category`, `sync_bank`, `hide_category`, `set_category_pnl`, `set_overhead_project`, `rename_company`, `add_loan`, `update_loan`, `attach_loan_payment`, `split_line`, `set_line_pnl`, `set_lines_pnl`, `undo`, `undo_batch` | false | true | true |

## Which id

| Tool | Argument | Kind |
| --- | --- | --- |
| `get_expense`, `assign_expense`, `assign_expense_split`, `set_expense_category`, `split_line`, `set_line_pnl` | `transaction_id` | `list_review.transaction_id` or `get_expense.id` |
| `undo` `kind: "review"` | `id` | the review-queue id the write closed |
| `undo` `kind: "reassign"` | `id` | the `reassign_undo` id |
| `undo` `kind: "project"` | `id` | the project id `create_project` returned |
| `undo` `kind: "category"` | `id` | the category id `create_category` returned |
| `undo` `kind: "category_hidden"` | `id` | the category id `hide_category` returned |
| `undo` `kind: "category_pnl"` | `id` | the category id `set_category_pnl` returned |
| `undo` `kind: "company"` | `id` | the company id `rename_company` returned |
| `undo` `kind: "loan"` | `id` | the loan id `add_loan` returned |
| `undo` `kind: "loan_update"` | `id` | the loan id |
| `undo` `kind: "loan_split"` | `id` | the transaction id `attach_loan_payment` used |
| `undo` `kind: "overhead_project"` | `id` | the company id `set_overhead_project` returned |
| `undo` `kind: "line_split"` | `id` | the transaction id `split_line` used |
| `undo` `kind: "line_pnl"` | `id` | the transaction id `set_line_pnl` used |

A review-queue id in a transaction argument is `validation` and the message is `id is not a transaction; list_review.id is the review id`.

## Envelope

Success: `{ "ok": true, "data": {} }`.

Failure: `{ "ok": false, "error": { "code": "not_found", "message": "not found" } }`. Tool failures set MCP `isError` true. HTTP 401 and 429 are not tool results.

`code` is `forbidden`, `validation`, `not_found`, `conflict`, `already_closed`, `refused`, or `unavailable`. `forbidden` is a token whose scope does not allow the tool. `conflict` is an undo whose current project, category, `pnl_role`, or shares differ from the snapshot in `private.mcp_writes`. `unavailable` with message `retry` is a deadlock or serialization failure. It is not stored, so the same idempotency key can be sent again. `stale` is not a tool code. It is the app's אישור path only, when the shown project or category differs from the stored row.

`refused` messages are only the `resolve_review` refusals: `no company`, `unknown review action`, `review item not found`, `shared costs are split, not assigned to one project`, `category is required`, `project or category not found`, `category kind must match the direction`, `project and category are required`, plus `transaction not found`, `category not found`, `project name is too short`, `project already exists`, `category name is too short`, `category already exists`, `unknown category kind`, `in use`, `loan category is fixed`, `project not found`, `parts must sum to the line`, `line has a loan split`, `line has a split by category`, `line has an open review`, and `The write was refused.` An undo id that is not in `private.mcp_writes` for this user is `not_found`. A row that is missing or belongs to another company is answered the same way on every tool: write tools return `refused` with a `... not found` message, and read tools and `undo` return `not_found`. Neither says whether the id exists in another company.

Writes take `idempotency_key` (1–128 characters). The token id on the audit row comes from the JWT claim `mcp_tid`, not from this object.

## Reads · cycle 2

These reads need the standby signing key. Without it, `tools/list` is empty and `tools/call` is a tool error with `isError`. A token without `read` is `forbidden`.

### list_projects

`get_dashboard`. Omit both dates for all time. `basis` is `cash` or `invoiced` (default `cash`).

Input: `{ "from": "2026-09-01", "to": "2026-09-30", "basis": "cash" }`.

Output `data`: `basis` (the basis used, `cash` when omitted) and `projects[]`: `id`, `name`, `status`, `budget_agorot`, `income_agorot`, `direct_agorot`, `shared_agorot`, `profit_agorot`, `is_overhead`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `profit_minor`). `*_agorot` fields are ILS only; foreign amounts are in `by_currency` minor units (cents for USD).

### get_project

`get_project(p_id, p_basis)`, with no company id. `id` is a project id from `list_projects`. It takes no dates: every total is all time, so it matches the `list_projects` row only when `list_projects` omits both dates. `basis` is `cash` or `invoiced` (default `cash`, the same as `list_projects` and `get_totals`; the app's project screen reads `invoiced`). Only income depends on the basis. A malformed `id` or `basis` is `validation`. An unknown id and a project in another company are both `not_found`.

Input: `{ "id": "8c1a0b2e-1111-4000-8000-000000000001", "basis": "cash" }`.

Output `data`: `id`, `name`, `status`, `state_label`, `budget_agorot`, `sumit_budget_section_id`, `is_overhead`, `after_overhead`, `basis`, `income_agorot`, `direct_agorot`, `shared_agorot`, `profit_agorot`, `overhead_share_agorot`, `overhead_weighted`, `profit_after_overhead_agorot`, `pending_count`, `pending_agorot`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `profit_minor`), `categories[]` (`id`, `name`, `amount_agorot`, `has_shared_share`), `categories_by_currency[]` (`currency`, `id`, `name`, `amount_minor`, `has_shared_share`), `excluded_categories_by_currency[]` (same fields), `excluded_income_by_currency[]` (`currency`, `id`, `name`, `amount_minor`, `count`; FLOW-121), `other_currencies[]`, `pending_other_currencies[]`, and `transactions[]` (`id`, `description`, `doc_date`, `amount_net`, `currency`, `direction`, `source`, `doc_kind`, `category`), the 40 newest lines, and `loans[]` (`id`, `name`, `currency`, `balance_minor`), the loans filed under this project (FLOW-105; empty when none). `loans` is read apart from the P&L and changes none of its numbers. `*_agorot` fields are ILS only; `by_currency` and `categories_by_currency` are minor units per currency (cents for USD). Each transaction's `amount_net` is in its own `currency`.

Expense lines in a category with `excluded_from_pnl` (see `set_category_pnl`) are left out of `direct_*`, `shared_*`, `profit_*`, `by_currency`, `categories`, and `categories_by_currency`. They are listed per currency in `excluded_categories_by_currency` (minor units, positive for an expense), so nothing disappears. Income filed to the project that is out of the P&L (a kept-out income category, or a line taken out with `set_line_pnl`) is left out of `income_*` and listed by category in `excluded_income_by_currency`, on the same basis as `income_agorot`, in positive minor units with its line `count`. A line whose category is only a guess (`category_suggested`) counts in the P&L even when that category is kept out, until the category is confirmed; a loan category stays kept out either way ([0114](../decisions/0114-kept-out-guesses.md)). `categories`, `categories_by_currency` and `excluded_categories_by_currency` list only confirmed lines, so a guessed line is in `direct_*` but in none of the category lists until it is confirmed. Uncategorised lines stay in the P&L. `transactions[]` still lists the newest lines whatever their category. Each `count` in `other_currencies[]` and `pending_other_currencies[]` counts only lines in the P&L.

`transactions[]` is the 40 newest lines filed to the project or shared with it, by `doc_date`, then `created_at`, then `id`, all newest first, so the list is the same on every call. It is not the P&L. It includes lines with `line_status` `pending` (unsettled bank lines), which no total counts until they post. A row does not carry `line_status`, so a pending row looks the same as a posted one. A shared line shows its full `amount_net`, not this project's share; the share is in `shared_*`. A line in a kept-out category is listed too.

Mercury income is `invoice_receipt` ([0097](../decisions/0097-mercury-income-invoice-receipt.md)), so it counts the same on both bases and switching `basis` does not change it. On `invoiced`, a Mercury deposit and a SUMIT invoice for the same income both count.

`other_currencies[]` is one row per non-ILS currency: `currency`, `income_minor`, `expense_minor`, `count`. The amounts keep the stored sign. `expense_minor` is negative for normal expenses, and a negative expense (a refund, decision [0103](../decisions/0103-reversals-across-directions.md)) adds a positive amount to it. `income_minor` is positive for normal income, and a negative income line lowers it. `count` counts each counted line once (a split loan payment once per part in the P&L), plus one per shared line this project has a share of. Kept-out categories and lines with `line_status` `pending` (unsettled bank lines) are left out. A posted line that waits for review is counted here and is also in `pending_other_currencies`. `pending_other_currencies[]` covers the non-ILS lines counted in `pending_count` (waiting for review on this project, whatever their `line_status`): `currency`, `expense_minor` (their stored, signed amounts) and `count`.

On the company's overhead project (`is_overhead` true, see `set_overhead_project`), project-filed expense lines count as overhead, so `direct_*` and `categories*` leave them out and `transactions[]` still lists them. Its income and shared shares stay on the project.

### list_categories

Input `{}`. Output `data.categories[]`: `id`, `name`, `kind`, `hidden`, `is_default`, `excluded_from_pnl`, `loan_part`. `loan_part` is `interest`, `escrow`, or `principal` on the three loan categories and null on every other category. It stays the same if a loan category is renamed, so match loan categories by `loan_part`, not by name.

### list_review

`list_review()`, then filter. `limit` defaults to 50 and cannot exceed 100.

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

Output `data`: `{ "total", "reviews" }`. `id` is the review-queue id. `transaction_id` is the ledger id. Also `description`, `doc_date`, `doc_kind`, `amount_net`, `vat_agorot`, `direction`, `reason`, `pnl_role`, `share_count`, `project_id`, `category_id`, `project_name`, `category_name`, `category_suggested`, `project_suggested`, `supplier_name`, and `meta` (the line's bank details, see [get_expense](#get_expense)).

Income that already has a project but only a guess of a kept-out category is queued with `reason` `suggested`: the guess counts in the P&L until it is confirmed, and approving it (or `assign_expense` / `set_expense_category`) confirms it ([FLOW-126](../backlog/TASKS.md#flow-126), [0114](../decisions/0114-kept-out-guesses.md)). A guessed loan category is not queued: it is out of the P&L even as a guess ([FLOW-127](../backlog/TASKS.md#flow-127)).

### get_expense

`get_transaction` with the transaction id. A missing row is `not_found`. Output includes `allocations[]` of `{project_id, project_name, share_bp, amount_net}`. A line split with `split_line` also has `line_split` (see [split_line](#split_line)).

Output also has `loan_split` ([FLOW-107](../backlog/TASKS.md#flow-107)), from `get_loan_split`: `null` when the line has no loan split (and always for income, which skips the read), else `{loan_id, loan_name, needs_review, by_parts, parts[]}` with `parts` in the order interest, escrow, principal, each `{part, amount_minor, in_pnl}`. `amount_minor` is positive and the parts add up to the line. `by_parts` is true when the P&L counts the line by its parts (three parts, none needs review, no VAT, parts add up), and then `in_pnl` says whether that part counts; the principal is kept out by default. When `by_parts` is false, `in_pnl` is null and the whole line counts under its own category. A failed split read is `refused`, like the row read.

The row also has `in_pnl` (whether the line counts in the P&L), `in_pnl_override` (`false` out, `true` in, `null` follows the category; see [set_line_pnl](#set_line_pnl)), `category_excluded_from_pnl`, and `pnl_fixed` (a loan line: `set_line_pnl` refuses it) ([FLOW-108](../backlog/TASKS.md#flow-108)). `category_suggested` is true while the category is only a guess; a guessed kept-out category still counts, so `in_pnl` is true until the category is confirmed ([FLOW-121](../backlog/TASKS.md#flow-121)).

Output also has `meta` ([FLOW-304](../backlog/TASKS.md#flow-304)), the line's bank details from `get_line_meta`: `{method, card_last4, memo, account, counterparty, bank_description}`. `method` is `card`, `ach`, `wire`, `check`, `transfer`, `other`, or null when the provider gave none (manual and most SUMIT lines). `card_last4` is exactly the last 4 digits or null. `account` is the bank account's name; no account number is returned. In `memo` and `bank_description` any run of 5 or more digits keeps only its last 4 (`••1234`). Every field is null when unknown. Lines imported before FLOW-304 have only `method` (from the provider's kind), `counterparty` and `bank_description` until the next sync touches them. A failed meta read is `refused`. `list_review` and `search_expenses` rows carry the same `meta`.

### search_expenses

`scope` is `pending` (default), `filed`, or `all`. `pending` filters `list_review`. `filed` and `all` call `public.search_transactions`. `id` on an expense is the transaction id. Each expense also has `meta` (see [get_expense](#get_expense)).

Input: `{ "scope": "filed", "query": "מלט", "limit": 50, "offset": 0 }`.

### get_totals

`get_dashboard`, with no company id. Output `data`: `company_id`, `name`, `basis`, `from`, `to`, `income_agorot`, `direct_agorot`, `shared_agorot`, `overhead_agorot`, `expense_agorot`, `unassigned_income_agorot`, `unassigned_expense_agorot`, `overhead_project_id`, `net_profit_agorot`, `excluded_income_agorot`, `excluded_expense_agorot`, `active_projects`, `review_count`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `overhead_minor`, `expense_minor`, `net_profit_minor`, `excluded_income_minor`, `excluded_expense_minor`, `excluded_count`, `count`, `loan_split_fallback_count`, `unassigned_income_minor`, `unassigned_expense_minor`). The buckets add up ([0101](../decisions/0101-unassigned-and-overhead-project.md)): `direct + shared + overhead + unassigned_expense = expense`, and the projects' `profit_minor` minus `overhead` plus `unassigned_income - unassigned_expense` is `net_profit`, within 1 minor unit per shared loan-split part. Unassigned income has no project. Unassigned cost has no `pnl_role`, a project role and no project, or a shared role and no split. Cost filed to the overhead project (see `set_overhead_project`) is in `overhead_*`, not `direct_*`. `*_agorot` fields are ILS only; foreign amounts are in `by_currency` minor units (cents for USD). Excluded lines stay out of the main buckets and appear only in the `excluded_*` fields. A line whose category is only a guess counts in the main buckets even when that category is kept out, and moves to `excluded_*` once the category is confirmed; a guessed loan category stays out ([0114](../decisions/0114-kept-out-guesses.md)). A loan payment with a valid three-part split counts by part: interest and escrow in the totals, the principal in `excluded_expense_*` and `excluded_count`, and the bank line's own category gets nothing. `loan_split_fallback_count` is the number of lines in the period that have a split but count whole, because a part needs review or the line carries VAT. It is 0 when none do. `count` counts lines in the P&L only, so a split line counts once and a kept-out line is in `excluded_count`, not `count`. Before decision [0099](../decisions/0099-categories-outside-pnl.md) `count` included kept-out lines; `count + excluded_count` is the old number (a loan payment that counts by part adds 1 to both). A project's shared share of each part rounds half to even.

### get_breakdown

`get_breakdown` or `get_breakdown_lines` ([0110](../decisions/0110-home-breakdown.md)). `direction` is `income` or `expense` (required). `group_by` is `category` (default), `project`, or `payer`. `basis` defaults to `cash`. Omit both dates for all time; one date alone is `validation`.

Without `group`: output `data` is `direction`, `basis`, `group_by`, `from`, `to`, `totals[]` (`currency`, `amount_minor`, `count`), `groups[]` (`key`, `name`, `currency`, `amount_minor`, `count`, `shared`), `excluded[]` (kept-out lines, not in the totals), and `review_count`. `totals` equal `get_totals`' `income_minor` / `expense_minor`. Under `project`, `key` is a project id, `overhead`, or `unassigned`; a shared cost is split by its allocations and the project's row has `shared: true`. A null `name` means no category, payer, or project (key `none` or `unassigned`). Passing `currency`, `limit`, or `offset` here is `validation`.

With `group` (a `key` from `groups`) and `currency` (default `ILS`), or with `excluded: true` (not both): output `data.rows[]` (`transaction_id`, `part`, `description`, `supplier_name`, `project_name`, `category_name`, `doc_date`, `currency`, `amount_minor`, `shared`) newest first, and `has_more`. `limit` defaults to 40, at most 100.

`amount_minor` is positive for income and for a normal expense. A loan payment with a valid split counts by part, so its rows carry `part`.

Input: `{ "direction": "expense", "group_by": "project", "from": "2026-06-01", "to": "2026-06-30" }`.

## Writes · cycle 3

An open review is closed by `approve_review_item`. The card leaves לאישור. `remember` defaults to false. `user_assigned` becomes true. There is no second tap in the app.

### assign_expense

Passes the project and category into `approve_review_item` when a review is open. Otherwise `reassign_transaction`. A finished project is allowed, because `reassign_transaction` allows it.

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

`create_project` and `create_category` record undo rows. Undo deletes the row only when nothing in the company references it. Otherwise undo is `conflict` and the row stays.

### create_project

```json
{ "idempotency_key": "proj-1", "name": "Site Alpha", "status": "active" }
```

`status` is optional (`active` or `finished`). Output `data`: `{ "id", "undo_kind": "project" }`.

### create_category

```json
{ "idempotency_key": "cat-new-1", "name": "Tools", "kind": "expense" }
```

There is no cost-type argument on categories. Output `data`: `{ "id", "undo_kind": "category" }`.

### hide_category

```json
{ "idempotency_key": "hide-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1" }
```

Output `data`: `{ "id", "undo_kind": "category_hidden" }`. Undo restores the prior `hidden` flag.

### set_category_pnl

```json
{ "idempotency_key": "pnl-1", "category_id": "c0ffee00-1111-4000-8000-0000000000a1", "excluded": true }
```

Output `data`: `{ "id", "undo_kind": "category_pnl" }`. Undo restores the prior `excluded_from_pnl` value. `refused` / `loan category is fixed` for the three loan categories (any category with a `loan_part` in `list_categories`, seeded as `ריבית משכנתא`, `מסים וביטוח`, and `תשלומי הלוואה`), whatever their current name. A new category whose English name matches a default kept-out name ([0099](../decisions/0099-categories-outside-pnl.md); case, spaces, punctuation, `&` or `and`, and a plural `s` are ignored, so `Owner distribution` and `CapEx/Rehab` match) starts kept out, and so does a category renamed into one. Other refusals match `category not found` and the usual write envelope.

### set_overhead_project

```json
{ "idempotency_key": "oh-1", "project_id": "8c1a0b2e-1111-4000-8000-000000000002" }
```

Marks one project as the company's overhead project. Expense lines filed to it with a project role count as overhead in `get_totals`, `list_projects`, and `get_project`, not as direct cost, and the overhead share of the after-overhead view includes them. `project_id: null` clears it. `project_id` is required. Output `data`: `{ "id", "overhead_project_id", "undo_kind": "overhead_project" }`, where `id` is the company id. Undo restores the prior overhead project, or is `conflict` if it changed since or the prior project was deleted. In `get_project`, the overhead project's `overhead_share_agorot` is 0 and its income is left out of the other projects' weights ([0117](../decisions/0117-overhead-project-weights.md)). A project in another company is `refused` / `project not found`. `list_projects` and `get_project` return `is_overhead`, and `get_totals` returns `overhead_project_id`.

### rename_company

Renames the token's company. The owner only: a viewer or a read token is `forbidden`. There is no company argument, so another company cannot be named. The name is trimmed and must be 2 to 100 characters, or the call is `validation`. The app calls the same rule through `public.rename_company(p_company_id, p_name)`, which refuses any id but the caller's own company.

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

### get_sync_status

```json
{ "job_id": "…" }
```

Read tool. Offered to read and write tokens. Readable by the user who started the job, in the same company; another user's job is `not_found`.

Output `data`: `{ "job_id", "state", "started_at", "finished_at" }` plus:

- `state: "running"`: nothing else yet.
- `state: "done"`: `added`, `duplicates`, `removed`, `newest_date`. `added` is new lines. `duplicates` counts lines already stored, skipped as new and refreshed in place. `removed` is voided or dropped lines. `newest_date` is the latest `doc_date` among live Mercury transactions, or null.
- `state: "failed"`: `error` `{ code, message }`. `unavailable` / `retry`: another run claimed the connector, the quiet window, or Mercury's rate limit; send `sync_bank` again with a new key. `not_found` / `bank is not connected`. `refused` / `bank key was rejected; reconnect in Settings`. `refused` / `The bank sync failed.`: any other failure, including a result whose shape the finish step rejected. A job still running after 5 minutes reads as `unavailable` / `retry`.

The finish step stores a result only when it is exactly `added`, `duplicates`, `removed` (whole numbers, not negative) and `newest_date` (`YYYY-MM-DD` or null).

## Loans · cycle 5

Read tools use `mcp_list_loans` and shared schedule math. Writes use the same writer gate as cycle 4. Amounts in tool arguments are major units (decimal strings or numbers); responses include `_minor` integer fields. `annual_rate_percent` is the nominal rate (6.875 means 6.875%).

### list_loans

Input `{}`. Output `data.loans[]`: `id`, `name`, `currency`, `principal_minor`, `annual_rate_ppm`, `term_months`, `start_date`, `payment_minor`, `escrow_minor`, `balance_minor`, `project_id` and `project_name` (null when the loan has no project).

### get_loan_schedule

Input `{ "loan_id", "from": 0, "limit": 12 }`. `limit` defaults to 12 and cannot exceed 600. Output `data`: `{ "loan_id", "from", "limit", "total", "rows" }` where each row has `date`, `payment`, `interest`, `escrow`, `principal`, `balance` (major strings) and matching `*_minor` fields.

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

Optional `payment` and `escrow` (default 0). Optional `project_id` files the loan under a project of this company; a project of another company, or an unknown one, is `refused` / `project not found` and nothing is written. Omitted `currency` uses `mcp_company_loan_currency()` (USD only when every one of the newest 1000 open lines is USD, the same lines the app reads; otherwise ILS). Output includes computed `payment`, `schedule_preview` (first three rows), `id`, and `undo_kind`: `"loan"`. Invalid terms return `validation` with a `LoanScheduleError` code (`principal`, `rate`, `term`, `payment`, `escrow`, `start_date`, `payment_below_interest`).

### update_loan

Patch fields: `name`, `principal`, `annual_rate_percent`, `term_months`, `start_date`, `payment`, `escrow`. `currency` is rejected. An explicit `null` (other than `project_id`) or an empty patch is `validation`. The name is trimmed. A patch that leaves principal-and-interest (`payment` minus `escrow`) below the first month's interest is `refused` / `payment below interest`, and nothing is stored. The same rule holds for a loan saved in the app. `project_id` files the loan under a project, `null` clears it, and leaving it out keeps it; a project of another company is `refused` / `project not found`. Payments already attached stay on the project they were filed under. Output `{ "id", "project_id", "undo_kind": "loan_update" }`. Undo restores the previous project (or none), and is `refused` / `project not found` if that project was deleted since.

### attach_loan_payment

```json
{
  "idempotency_key": "split-1",
  "transaction_id": "<ledger id>",
  "loan_id": "<loan id>"
}
```

The handler loads the line, picks the schedule row for `doc_date`, and splits like the app. The database takes exactly one `interest`, `escrow` and `principal` part, each a whole non-negative number of minor units, summing to the line; anything else is `refused` / `invalid loan parts`. Principal that would take the loan balance below zero is `loan balance exceeded`, from the app too. A loan saved before these checks with a payment below the interest makes this tool and `get_loan_schedule` return `refused` / `payment below interest` until the payment is raised. Output includes `parts[]` and `undo_kind`: `"loan_split"`. Undo `kind: "loan_split"` takes the **transaction** id. Once attached, the payment counts by its parts in `get_totals`, `get_project` and `list_project_category`: interest and escrow stay in the P&L under `ריבית משכנתא` and `מסים וביטוח`, and the principal counts under `תשלומי הלוואה`, which is kept out and shows in the excluded totals. The line's own category gets nothing. A split that needs review, or a line that carries VAT, counts whole instead ([0100](../decisions/0100-loan-split-pnl.md)). Deleting the split (undo) puts the whole line back. If the parts were corrected in the app after the attach (a changed amount or category; `scheduled_minor` is not compared), undo is `conflict` and the corrected split stays. An undo of `update_loan` that would bring back a payment below the interest is `refused` / `payment below interest`.

When the loan has a project and the line has no project, no shares and no role (and a category), the line is filed as a direct cost on that project, the same rule `assign_expense` uses, so the parts count there: interest and escrow as direct cost, principal in the excluded totals (FLOW-105, [0105](../decisions/0105-loan-project.md)). Output `project_inherited` (true or false), `project_id` (when inherited) and `project_inherited_reason` when false: `loan has no project`, `line already has a project`, `line has shares`, `line has a role` or `line has no category`. The line is then left exactly as it was. Undo of `loan_split` restores the line's previous project when nothing changed it since (`project_restored` true); a line changed after the attach keeps its new project (`project_restored` false).

### undo (loan kinds)

| `kind` | `id` |
| --- | --- |
| `loan` | loan id from `add_loan` |
| `loan_update` | loan id |
| `loan_split` | transaction id |

Refused messages add `loan not found`, `loan currency mismatch`, `loan already attached`, `loan balance exceeded`, `no schedule row for this date`, `loan categories missing`, `invalid loan terms`, `project not found`, `payment below interest`, and `invalid loan parts`.

## Line splits · FLOW-311

### split_line

Splits one bank line into parts, each with its own category, optional project, and exact amount in minor units of the line's currency (cents for USD, agorot for ILS). Decision [0104](../decisions/0104-line-split-by-category.md).

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

- Two to 50 parts. `amount_minor` is a whole number above zero. The parts must sum exactly to the line's net amount, or the write is `refused` with `parts must sum to the line`.
- Each category must be of the line's kind (an expense category on an outflow, an income category on an inflow). A category and project pair appears once.
- `project_id` is optional. A part without it keeps the line's project and P&L role; on a shared line it is shared by the line's allocations in proportion. A part with a project counts as that project's direct cost (or overhead, for the overhead project).
- `parts: []` clears the split, and the line counts whole again.
- Refused: `transaction not found`, `category not found`, `project not found`, `category kind must match the direction`, `parts must sum to the line`, `line has a loan split` (use one or the other), and `line has an open review` (resolve the review with `assign_expense` first).
- VAT stays on the line. The parts split the net amount.
- While a split is in place, `set_expense_category` and `assign_expense` change only the line's own category and project, which the P&L does not read for a split line. Clear the split with `parts: []` first, or send new parts.

Output `data`: `{ "transaction_id", "parts": [{ "category_id", "project_id", "amount_minor" }], "undo_kind": "line_split", "id" }`. Undo `kind: "line_split"` with the transaction id puts back the parts from before this write (none, or an earlier split) and the line's assignment flags. If the parts changed since, undo is `conflict`.

Once split, the line counts by part in `get_totals`, `list_projects`, `get_project` and `list_project_category`: each part under its own category and project, a part in a kept-out category in the `excluded_*` totals, and the line's own category gets nothing. `count` still counts the line once. If a bank re-sync changes the line amount so the parts no longer sum, the line counts whole until it is split again; `get_expense` shows `line_split.parts_match: false`.

`get_expense` on a split line adds `line_split`: `{ "currency", "line_minor", "parts": [{ "category_id", "category_name", "project_id", "project_name", "amount_minor" }], "parts_match" }`.

### set_line_pnl

Takes one line out of the P&L, or counts one line of a kept-out category. Decision [0112](../decisions/0112-line-out-of-pnl.md).

```json
{ "idempotency_key": "out-1", "transaction_id": "22222222-2222-4000-8000-000000000020", "in_pnl": false }
```

- `in_pnl: false` keeps the line out, `true` counts it although its category is kept out, `null` clears the override so the line follows its category again. The override wins over the category's `excluded_from_pnl` and covers every part of a split line.
- An out line moves to the `excluded_*` totals of `get_totals`, `list_projects` and `get_project`, and to `get_breakdown`'s `excluded` group, on both bases. Nothing is hidden.
- Refused: `transaction not found` (also another company's line) and `loan line is fixed` (a line with a loan split or in a loan category; its parts decide what counts).

Output `data`: `{ "transaction_id", "in_pnl_override", "in_pnl", "undo_kind": "line_pnl", "id" }`. Undo `kind: "line_pnl"` with the transaction id puts back the override from before this write. If the override changed since (for example in the app), undo is `conflict`.

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

## Batch · cycle 6

`assign_expenses` applies up to 200 rows in one write. Each item needs `transaction_id` and at least one of `project_id` or `category_id`. When `project_id` is set, `category_id` is required and the row behaves like `assign_expense`. When only `category_id` is set, the row behaves like `set_expense_category`. When `shares[]` is set, the row behaves like `assign_expense_split`: `category_id` is optional, and `project_id` or `remember` on the same row is `validation`. Duplicate `transaction_id` values in one call are `validation`. A bad row does not block good rows. Each row uses the key `idempotency_key:ordinal`, so `assign_expenses` and `undo_batch` take a key of 1–124 characters.

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

Output `data`: `{ "batch_key", "ok_count", "error_count", "results" }`. Each result is either `{ "transaction_id", "ok": true, "undo_kind" }` or `{ "transaction_id", "ok": false, "code" }`. A successful split row also has `closed_review`.

### undo_batch

```json
{ "idempotency_key": "undo-batch-1", "batch_key": "33333333-3333-4000-8000-000000000003" }
```

Undoes every successful row from an `assign_expenses` or `set_lines_pnl` batch through `mcp_undo`, newest first. A split row goes back to its shares, category and open review from before the split. Another company or a missing batch is `not_found`. A row changed since assign is `conflict` for that row only. Replay returns the stored response.

## Not in tools/list

`rename_project`, `finish_project`, `collapse_expense`, `bulk_assign`, and `skip_review` wait. So do the SUMIT writers, `delete_transaction`, `create_company`, and `create_manual_entry`. Only `sync_bank` calls an internal Flow function; no tool calls a third party directly.
