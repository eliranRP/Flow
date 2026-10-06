# MCP tools

Decision [0080](../decisions/0080-mcp-connector.md). Protocol `2025-06-18`. A result sets `structuredContent` to the JSON below. `tools/list` returns only the handlers shipped so far: the reads after cycle 2, and these writes after cycle 3. A token whose scope is read only lists the read tools. Amounts are integer agorot. Dates are `YYYY-MM-DD`. UUIDs are strings.

Field values are data. Write tools take ids from a read tool.

## Annotations

These are client hints. Flow does not read them and does not treat them as a confirmation. Flow accepts the write. The enforced nets are write scope, rate limits, the audit token, undo, and revoke.

| Tools | readOnlyHint | destructiveHint | idempotentHint |
| --- | --- | --- | --- |
| Every read below | true | false | true |
| `assign_expense`, `set_expense_category`, `create_project`, `create_category`, `sync_bank`, `hide_category`, `add_loan`, `update_loan`, `attach_loan_payment`, `undo` | false | true | true |

## Which id

| Tool | Argument | Kind |
| --- | --- | --- |
| `get_expense`, `assign_expense`, `set_expense_category` | `transaction_id` | `list_review.transaction_id` or `get_expense.id` |
| `undo` `kind: "review"` | `id` | the review-queue id the write closed |
| `undo` `kind: "reassign"` | `id` | the `reassign_undo` id |
| `undo` `kind: "project"` | `id` | the project id `create_project` returned |
| `undo` `kind: "category"` | `id` | the category id `create_category` returned |
| `undo` `kind: "category_hidden"` | `id` | the category id `hide_category` returned |
| `undo` `kind: "loan"` | `id` | the loan id `add_loan` returned |
| `undo` `kind: "loan_update"` | `id` | the loan id |
| `undo` `kind: "loan_split"` | `id` | the transaction id `attach_loan_payment` used |

A review-queue id in a transaction argument is `validation` and the message is `id is not a transaction; list_review.id is the review id`.

## Envelope

Success: `{ "ok": true, "data": {} }`.

Failure: `{ "ok": false, "error": { "code": "not_found", "message": "not found" } }`. Tool failures set MCP `isError` true. HTTP 401 and 429 are not tool results.

`code` is `forbidden`, `validation`, `not_found`, `conflict`, `already_closed`, `refused`, or `unavailable`. `forbidden` is a token whose scope does not allow the tool. `conflict` is an undo whose current project, category, `pnl_role`, or shares differ from the snapshot in `private.mcp_writes`. `unavailable` with message `retry` is a deadlock or serialization failure. It is not stored, so the same idempotency key can be sent again. `stale` is not a tool code. It is the app's אישור path only, when the shown project or category differs from the stored row.

`refused` messages are only the `resolve_review` refusals: `no company`, `unknown review action`, `review item not found`, `shared costs are split, not assigned to one project`, `category is required`, `project or category not found`, `category kind must match the direction`, `project and category are required`, plus `transaction not found`, `category not found`, `project name is too short`, `project already exists`, `category name is too short`, `category already exists`, `unknown category kind`, `in use`, and `The write was refused.` An undo id that is not in `private.mcp_writes` for this user is `not_found`.

Writes take `idempotency_key` (1–128 characters). The token id on the audit row comes from the JWT claim `mcp_tid`, not from this object.

## Reads · cycle 2

These reads need the standby signing key. Without it, `tools/list` is empty and `tools/call` is a tool error with `isError`. A token without `read` is `forbidden`.

### list_projects

`get_dashboard`. Omit both dates for all time. `basis` is `cash` or `invoiced` (default `cash`).

Input: `{ "from": "2026-09-01", "to": "2026-09-30", "basis": "cash" }`.

Output `data.projects[]`: `id`, `name`, `status`, `budget_agorot`, `income_agorot`, `direct_agorot`, `shared_agorot`, `profit_agorot`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `profit_minor`). `*_agorot` fields are ILS only; foreign amounts are in `by_currency` minor units (cents for USD).

### list_categories

Input `{}`. Output `data.categories[]`: `id`, `name`, `kind`, `hidden`, `is_default`.

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

Output `data`: `{ "total", "reviews" }`. `id` is the review-queue id. `transaction_id` is the ledger id. Also `description`, `doc_date`, `doc_kind`, `amount_net`, `vat_agorot`, `direction`, `reason`, `pnl_role`, `share_count`, `project_id`, `category_id`, `project_name`, `category_name`, `category_suggested`, `project_suggested`, `supplier_name`.

### get_expense

`get_transaction` with the transaction id. A missing row is `not_found`. Output includes `allocations[]` of `{project_id, project_name, share_bp, amount_net}`.

### search_expenses

`scope` is `pending` (default), `filed`, or `all`. `pending` filters `list_review`. `filed` and `all` call `public.search_transactions`. `id` on an expense is the transaction id.

Input: `{ "scope": "filed", "query": "מלט", "limit": 50, "offset": 0 }`.

### get_totals

`get_dashboard`, with no company id. Output `data`: `company_id`, `name`, `basis`, `from`, `to`, `income_agorot`, `direct_agorot`, `shared_agorot`, `overhead_agorot`, `expense_agorot`, `net_profit_agorot`, `active_projects`, `review_count`, `by_currency[]` (`currency`, `income_minor`, `direct_minor`, `shared_minor`, `overhead_minor`, `expense_minor`, `net_profit_minor`, `count`). `*_agorot` fields are ILS only; foreign amounts are in `by_currency` minor units (cents for USD).

## Writes · cycle 3

An open review is closed by `approve_review_item`. The card leaves לאישור. `remember` defaults to false. `user_assigned` becomes true. There is no second tap in the app.

### assign_expense

Passes the project and category into `approve_review_item` when a review is open. Otherwise `reassign_transaction`. A finished project is allowed, because `reassign_transaction` allows it.

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

### set_expense_category

The category changes. Shares stay. An open review is closed the same way, using the row's current project.

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

### sync_bank

```json
{ "idempotency_key": "sync-1" }
```

There is no date range. Mercury sync is cursor-based (`sync_cursor`, `import_from`, lookback). Filtering after fetch would advance the cursor past dropped rows. `sync_bank` takes no dates and does not call `set_import_from`.

Output `data`: `{ "added", "duplicates", "removed", "newest_date" }`. `added` is new lines. `duplicates` counts rows already stored that were refreshed in place. `removed` is voided or dropped lines. `newest_date` is the latest `doc_date` among live Mercury transactions, or null.

`not_found` / `bank is not connected` means there is no Mercury row in `connector_connections`. A sync that was skipped because another run claimed the connector or ran inside the quiet window is `unavailable` / `retry` and is not stored.

## Loans · cycle 5

Read tools use `mcp_list_loans` and shared schedule math. Writes use the same writer gate as cycle 4. Amounts in tool arguments are major units (decimal strings or numbers); responses include `_minor` integer fields. `annual_rate_percent` is the nominal rate (6.875 means 6.875%).

### list_loans

Input `{}`. Output `data.loans[]`: `id`, `name`, `currency`, `principal_minor`, `annual_rate_ppm`, `term_months`, `start_date`, `payment_minor`, `escrow_minor`, `balance_minor`.

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

Optional `payment` and `escrow` (default 0). Omitted `currency` uses `mcp_company_loan_currency()` (USD only when every open line is USD; otherwise ILS). Output includes computed `payment`, `schedule_preview` (first three rows), `id`, and `undo_kind`: `"loan"`. Invalid terms return `validation` with a `LoanScheduleError` code (`principal`, `rate`, `term`, `payment`, `escrow`, `start_date`, `payment_below_interest`).

### update_loan

Patch fields: `name`, `principal`, `annual_rate_percent`, `term_months`, `start_date`, `payment`, `escrow`. `currency` is rejected. Output `{ "id", "undo_kind": "loan_update" }`.

### attach_loan_payment

```json
{
  "idempotency_key": "split-1",
  "transaction_id": "<ledger id>",
  "loan_id": "<loan id>"
}
```

The handler loads the line, picks the schedule row for `doc_date`, and splits like the app. Output includes `parts[]` and `undo_kind`: `"loan_split"`. Undo `kind: "loan_split"` takes the **transaction** id.

### undo (loan kinds)

| `kind` | `id` |
| --- | --- |
| `loan` | loan id from `add_loan` |
| `loan_update` | loan id |
| `loan_split` | transaction id |

Refused messages add `loan not found`, `loan currency mismatch`, `loan already attached`, `loan balance exceeded`, `no schedule row for this date`, `loan categories missing`, and `invalid loan terms`.

## Batch · cycle 6

`assign_expenses` applies up to 200 rows in one write. Each item needs `transaction_id` and at least one of `project_id` or `category_id`. When `project_id` is set, `category_id` is required and the row behaves like `assign_expense`. When only `category_id` is set, the row behaves like `set_expense_category`. Duplicate `transaction_id` values in one call are `validation`. A bad row does not block good rows. Each row uses the key `idempotency_key:ordinal`, so `assign_expenses` and `undo_batch` take a key of 1–124 characters.

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
    }
  ]
}
```

Output `data`: `{ "batch_key", "ok_count", "error_count", "results" }`. Each result is either `{ "transaction_id", "ok": true, "undo_kind" }` or `{ "transaction_id", "ok": false, "code" }`.

### undo_batch

```json
{ "idempotency_key": "undo-batch-1", "batch_key": "33333333-3333-4000-8000-000000000003" }
```

Undoes every successful row from that batch through `mcp_undo`, newest first. Another company or a missing batch is `not_found`. A row changed since assign is `conflict` for that row only. Replay returns the stored response.

## Not in tools/list

`rename_project`, `finish_project`, `split_expense`, `collapse_expense`, `bulk_assign`, and `skip_review` wait. So do the SUMIT writers, `delete_transaction`, `create_company`, and `create_manual_entry`. Only `sync_bank` calls an internal Flow function; no tool calls a third party directly.
