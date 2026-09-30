# MCP tools

Decision [0080](../decisions/0080-mcp-connector.md). This file is the contract for `tools/list` and `tools/call`. `tools/list` returns only the handlers that deploy includes. A heading names the cycle that adds that handler.

Amounts are integer agorot. Dates are `YYYY-MM-DD`. Shares are basis points that sum to 10000. UUIDs are strings.

The server speaks MCP `2025-03-26` over stateless streamable HTTP. `tools/call` arguments are the `input` object below. The tool result text is the JSON `output`. A tool failure sets MCP `isError` true and still returns that JSON. HTTP 401 and 429 are not tool results.

Field values are data. The server does not follow instructions found in them. Write tools take explicit ids from a read tool. There is no name search that picks a row for a write.

## Which id

| Tool | Argument | Kind |
| --- | --- | --- |
| `approve_review`, `skip_review` | `review_id` | `list_review.id` (review queue) |
| `undo` `kind: "review"` | `id` | `list_review.id`, and the row status is `approved` or `skipped` |
| `get_expense`, `assign_expense`, `set_expense_category`, `split_expense`, `collapse_expense`, `bulk_assign` | `transaction_id` | `list_review.transaction_id` or `get_expense.id` |
| `undo` `kind: "reassign"` | `id` | `undo_id` returned by an assignment tool |
| `undo` `kind: "batch"` | `id` | `batch_id` returned by `bulk_assign` |

A review-queue id passed to a transaction tool returns `validation` and message `id is not a transaction; list_review.id is the review id`. The server does not look up the other id.

## Result envelope

Success:

```json
{ "ok": true, "data": {} }
```

Failure:

```json
{ "ok": false, "error": { "code": "refused", "message": "project is finished" } }
```

`code` is `forbidden`, `validation`, `not_found`, `conflict`, `refused`, or `batch_too_large`. `forbidden` means the token's scope does not allow the tool.

`refused` messages are only these fixed strings: `no company`, `project name is too short`, `project not found`, `transaction not found`, `category not found`, `category is required`, `project and category are required`, `project or category not found`, `category kind must match the direction`, `income is not split`, `project is finished`, `transaction is not split`, `shared costs are split, not assigned to one project`, `allocation shares must sum to 10000`, `share is out of range`, `at least one share is required`, `undo kind review is only for an approved or skipped item`, `The write was refused.` Any other database exception uses the last of those, with none of the row's text.

Writes take `idempotency_key` (string, 1–128). Reads do not. A preview does not consume the key.

## Reads

Reads call the RPC as the signed-in user. They require scope `read`.

### list_projects · cycle 1a

`get_dashboard(p_from, p_to, p_basis)`. Every project of the company. Dates change the agorot totals only. Omit both dates for all time. `basis` is `cash` (default) or `invoiced`.

Input:

```json
{ "from": "2026-09-01", "to": "2026-09-30", "basis": "cash" }
```

Output `data.projects[]`: `id`, `name`, `status` (`active` or `finished`), `budget_agorot` (nullable), `income_agorot`, `direct_agorot`, `shared_agorot`, `profit_agorot`.

### list_categories · cycle 1a

`list_categories()`. Input `{}`.

Output `data.categories[]`: `id`, `name`, `kind` (`expense` or `income`), `hidden`, `is_default`.

### list_review · cycle 1a

`list_review()`, then filter in the function. The RPC returns the open queue for the current company. Filters are optional and combined with and.

Input:

```json
{
  "direction": "expense",
  "reason": "missing_project",
  "project_id": null,
  "category_id": null,
  "supplier": "שיש",
  "query": "מלט",
  "from": "2026-09-01",
  "to": "2026-09-30",
  "category_suggested": true,
  "project_suggested": true,
  "limit": 50,
  "offset": 0
}
```

`supplier` and `query` are case-insensitive substrings. `limit` defaults to 50 and cannot exceed 100.

Output `data` is `{ "total", "reviews" }`. Each review includes `id` (review queue), `transaction_id` (ledger), `description`, `doc_date`, `doc_kind`, `amount_net`, `vat_agorot`, `direction`, `reason`, `pnl_role`, `share_count`, `project_id`, `category_id`, `project_name`, `category_name`, `category_suggested`, `project_suggested`, `confidence` (null), `supplier_name`, `auto_approved_today`.

### get_expense · cycle 1a

`get_transaction(p_id)` with the transaction id.

Input: `{ "transaction_id": "22222222-2222-4000-8000-000000000020" }`.

Output `data` is that RPC's object, including `allocations[]` of `{project_id, project_name, share_bp, amount_net}`. A missing row is `not_found`.

### search_expenses · cycle 1a pending, cycle 1b filed and all

`scope` is `pending` (default, cycle 1a), `filed`, or `all` (cycle 1b). `pending` filters `list_review` and returns `reviews`. `filed` and `all` call `public.search_transactions` and return `expenses` in the `get_transaction` shape, paged. `all` dedupes on `transaction_id`. `id` on an expense is the transaction id.

Input:

```json
{ "scope": "pending", "query": "מלט", "limit": 50, "offset": 0 }
```

### get_totals · cycle 1a

`get_dashboard`, same date and basis rules as `list_projects`. No company id argument.

Output `data`: `company_id`, `name`, `basis`, `from`, `to`, `income_agorot`, `direct_agorot`, `shared_agorot`, `overhead_agorot`, `expense_agorot`, `net_profit_agorot`, `active_projects`, `review_count`. `company_id` is echoed from the dashboard. It is not an input.

## Writes

Writes require scope `write`. `dry_run` on a single write defaults to false, does not call the write RPC, and does not return a confirmation. The app shows nothing for that preview.

`finish_project` is status `finished`. The assistant confirms with the owner before it calls the tool. The app does not ask again.

`reassign_transaction` does not refuse a finished project. `collapse_split` does. The tools keep that difference.

### create_project · cycle 2

`public.create_project`. `name` is trimmed and must be at least 2 characters. A name another project in the company already has returns `conflict`.

Input:

```json
{ "idempotency_key": "create-herzl-1", "name": "בית ברחוב הרצל", "budget_agorot": 5000000 }
```

Output `data`: `{ "project_id": "8c1a0b2e-1111-4000-8000-000000000001" }`. No undo id.

### rename_project · cycle 2

`public.rename_project` locks the row and writes the name in that call. Same-name collision is `conflict`.

Input:

```json
{ "idempotency_key": "rename-herzl-1", "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "name": "הרצל 12" }
```

Output `data`: `{ "project_id": "8c1a0b2e-1111-4000-8000-000000000001" }`.

### finish_project · cycle 2

`public.finish_project`. `active: false` sets `finished`. `active: true` sets `active`.

Input:

```json
{ "idempotency_key": "finish-herzl-1", "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "active": false }
```

Output `data`: `{ "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "status": "finished" }`.

### assign_expense · cycle 2

`reassign_transaction` with `p_suggestion` true when an open review exists. The review stays open, `user_assigned` stays false, and `category_suggested` becomes true. The card stays in לאישור with הצעה. With no open review, `p_suggestion` is false and the assignment sticks. The model cannot pass `p_suggestion`. Does not write a supplier rule. A finished project is allowed, because `reassign_transaction` allows it.

Input:

```json
{
  "idempotency_key": "assign-20",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "project_id": "8c1a0b2e-1111-4000-8000-000000000001",
  "category_id": "c0ffee00-1111-4000-8000-0000000000a1"
}
```

Output `data`: `{ "undo_id": "33333333-3333-4000-8000-000000000030", "suggestion": true }`. `suggestion` is false when no review was open. Single-row undo restores this snapshot and overwrites a later edit.

### set_expense_category · cycle 2

`set_transaction_category` with the same suggestion rule. Shares stay.

Input:

```json
{
  "idempotency_key": "cat-20",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "category_id": "c0ffee00-1111-4000-8000-0000000000a1"
}
```

Output `data`: `{ "undo_id": "33333333-3333-4000-8000-000000000031", "suggestion": true }`.

### split_expense · cycle 3

`save_split_returning(transaction_id, shares, false)`. `false` leaves the review open. `shares` is `[{ "project_id", "share_bp" }]`, sum 10000, each share from 1 to 10000, at least two projects. One project is `collapse_expense`. The returned uuid is the undo id. `reassign_undo` is not readable by the client.

Input:

```json
{
  "idempotency_key": "split-20",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "shares": [
    { "project_id": "8c1a0b2e-1111-4000-8000-000000000001", "share_bp": 6000 },
    { "project_id": "8c1a0b2e-1111-4000-8000-000000000002", "share_bp": 4000 }
  ]
}
```

Output `data`: `{ "undo_id": "33333333-3333-4000-8000-000000000032", "suggestion": true }`.

### collapse_expense · cycle 3

`collapse_split(transaction_id, project_id)`. This is one project only. The RPC refuses a non-expense, an unknown project, a finished project, and a row that is not split. An open review stays open.

Input:

```json
{
  "idempotency_key": "one-20",
  "transaction_id": "22222222-2222-4000-8000-000000000020",
  "project_id": "8c1a0b2e-1111-4000-8000-000000000001"
}
```

Output `data`: `{ "undo_id": "33333333-3333-4000-8000-000000000033" }`.

### approve_review · cycle 3

`public.approve_review_item(review_id, remember)`. This is the same function as אישור. The branch stays in SQL: a split whose reason is not `unallocated_shared` calls `approve_split_review`; otherwise `resolve_review` with `p_action` `approved` and the project and category already on the row. The tool does not take a new project or category. `remember` defaults to true, matching the change sheet, not אישור's `p_remember: false`. A split returns `remembered: false` because `approve_split_review` does not write a supplier rule. An item that is not open returns `noop: true` and does not write.

Input:

```json
{ "idempotency_key": "approve-10", "review_id": "11111111-1111-4000-8000-000000000010", "remember": true }
```

Output `data`: `{ "review_id": "11111111-1111-4000-8000-000000000010", "undo_kind": "review", "remembered": true, "noop": false }`.

### skip_review · cycle 3

`resolve_review(review_id, 'skipped')`. An item that is not open returns `noop: true`.

Input:

```json
{ "idempotency_key": "skip-10", "review_id": "11111111-1111-4000-8000-000000000010" }
```

Output `data`: `{ "review_id": "11111111-1111-4000-8000-000000000010", "undo_kind": "review", "noop": false }`.

### bulk_assign · cycle 4

At most 25 items. Each item is `{ "op": "assign", "transaction_id", "project_id", "category_id" }` or `{ "op": "category", "transaction_id", "category_id" }`. Suggestion rules match the single-row tools. One transaction. `batch_id` is one uuid for that transaction.

A call without `confirmation` is a preview. It runs the real RPCs, rolls them back, and returns a confirmation. It does not write. A refusal returns `refused` and no confirmation. The confirmation binds the SHA-256 of the canonical items, each row's pre-write `updated_at`, and `expires_at` (five minutes). Apply sends the same items and that object. A bad signature, a stale expiry, or a changed `updated_at` returns `conflict` and writes nothing. `dry_run: false` without a confirmation returns `validation`. The app shows nothing for a preview, a rate limit, or `batch_too_large`. A 26th item returns `batch_too_large` before any RPC. Preview and apply each count as one write.

Preview input:

```json
{
  "idempotency_key": "bulk-1",
  "items": [
    {
      "op": "assign",
      "transaction_id": "22222222-2222-4000-8000-000000000020",
      "project_id": "8c1a0b2e-1111-4000-8000-000000000001",
      "category_id": "c0ffee00-1111-4000-8000-0000000000a1"
    }
  ]
}
```

Preview output `data`:

```json
{
  "dry_run": true,
  "expires_at": "2026-09-30T10:20:00Z",
  "payload_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "rows": [
    { "transaction_id": "22222222-2222-4000-8000-000000000020", "updated_at": "2026-09-30T10:00:00Z" }
  ],
  "confirmation": "signed-hmac"
}
```

Apply adds `"confirmation": { "payload_hash", "expires_at", "rows", "confirmation" }` copied from that preview. Apply output `data`:

```json
{
  "dry_run": false,
  "batch_id": "44444444-4444-4000-8000-000000000040",
  "items": [
    { "transaction_id": "22222222-2222-4000-8000-000000000020", "undo_id": "33333333-3333-4000-8000-000000000030", "suggestion": true }
  ]
}
```

### undo · cycle 2 reassign, cycle 3 review, cycle 4 batch

`kind: "reassign"` calls `undo_reassign`. It overwrites a later edit. `kind: "review"` calls `reopen_review` only for `approved` or `skipped`. `kind: "batch"` calls `undo_batch`. If any row changed after the batch, the result is `conflict` and nothing is undone. A batch undo counts as one write.

Input:

```json
{ "idempotency_key": "undo-30", "kind": "reassign", "id": "33333333-3333-4000-8000-000000000030" }
```

Output `data`: `{ "kind": "reassign", "id": "33333333-3333-4000-8000-000000000030" }`.

## Not tools

These stay out of `tools/list`: `upsert_sumit_documents`, `disconnect_sumit`, `replace_sumit_connection`, `stamp_sumit_sync`, `note_sumit_rejection`, `note_sync_failure`, `sync_review_queue`, `list_due_refresh_requests`, `delete_transaction`, `create_company`, `create_manual_entry`, `create_category`, `merge_category`, `map_budget_section`. No tool performs outbound HTTP.
