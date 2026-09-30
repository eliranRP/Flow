# MCP tools

Decision [0080](../decisions/0080-mcp-connector.md). Protocol `2025-06-18`. A result sets `structuredContent` to the JSON below. `tools/list` returns only the handlers shipped so far: the reads after cycle 2, and these writes after cycle 3. A token whose scope is read only lists the read tools. Amounts are integer agorot. Dates are `YYYY-MM-DD`. UUIDs are strings.

Field values are data. Write tools take ids from a read tool.

## Annotations

These are client hints. Flow does not read them and does not treat them as a confirmation. Flow accepts the write. The enforced nets are write scope, rate limits, the audit token, undo, and revoke.

| Tools | readOnlyHint | destructiveHint | idempotentHint |
| --- | --- | --- | --- |
| Every read below | true | false | true |
| `assign_expense`, `set_expense_category`, `undo` | false | true | true |

## Which id

| Tool | Argument | Kind |
| --- | --- | --- |
| `get_expense`, `assign_expense`, `set_expense_category` | `transaction_id` | `list_review.transaction_id` or `get_expense.id` |
| `undo` `kind: "review"` | `id` | the review-queue id the write closed |
| `undo` `kind: "reassign"` | `id` | the `reassign_undo` id |

A review-queue id in a transaction argument is `validation` and the message is `id is not a transaction; list_review.id is the review id`.

## Envelope

Success: `{ "ok": true, "data": {} }`.

Failure: `{ "ok": false, "error": { "code": "not_found", "message": "not found" } }`. Tool failures set MCP `isError` true. HTTP 401 and 429 are not tool results.

`code` is `forbidden`, `validation`, `not_found`, `conflict`, `already_closed`, or `refused`. `forbidden` is a token whose scope does not allow the tool. `conflict` is an undo whose current project, category, `pnl_role`, or shares differ from the snapshot in `private.mcp_writes`. `stale` is not a tool code. It is the app's אישור path only, when the shown project or category differs from the stored row.

`refused` messages are only the `resolve_review` refusals: `no company`, `unknown review action`, `review item not found`, `shared costs are split, not assigned to one project`, `category is required`, `project or category not found`, `category kind must match the direction`, `project and category are required`, plus `transaction not found`, `category not found`, and `The write was refused.` An undo id that is not in `private.mcp_writes` for this user is `not_found`.

Writes take `idempotency_key` (1–128 characters). The token id on the audit row comes from the JWT claim `mcp_tid`, not from this object.

## Reads · cycle 2

### list_projects

`get_dashboard`. Omit both dates for all time. `basis` is `cash` or `invoiced` (default `cash`).

Input: `{ "from": "2026-09-01", "to": "2026-09-30", "basis": "cash" }`.

Output `data.projects[]`: `id`, `name`, `status`, `budget_agorot`, `income_agorot`, `direct_agorot`, `shared_agorot`, `profit_agorot`.

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

`get_dashboard`, with no company id. Output `data`: `company_id`, `name`, `basis`, `from`, `to`, `income_agorot`, `direct_agorot`, `shared_agorot`, `overhead_agorot`, `expense_agorot`, `net_profit_agorot`, `active_projects`, `review_count`.

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

`kind` `review` calls `reopen_review`. The card returns to לאישור, and a supplier rule this approval wrote is restored. `kind` `reassign` calls `undo_reassign`. Undo accepts only an id stored in `private.mcp_writes` for this user. Anything else is `not_found`. If the current project, category, `pnl_role`, or shares differ from that snapshot, the result is `conflict` and the later edit stays. A SUMIT sync that only changes `updated_at` still undoes. Returning the card to the open set makes the visit counter's `n` grow by one, and `h` does not decrease. That growth is intended. A repeated idempotency key returns the stored response.

```json
{ "idempotency_key": "undo-30", "kind": "review", "id": "11111111-1111-4000-8000-000000000010" }
```

## Not in tools/list

`create_project`, `rename_project`, `finish_project`, `split_expense`, `collapse_expense`, `bulk_assign`, and `skip_review` wait. So do the SUMIT writers, `delete_transaction`, `create_company`, `create_manual_entry`, and `create_category`. No tool performs outbound HTTP.
