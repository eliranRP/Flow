# Search filters on search_transactions

**Date:** 2026-10-08
**Status:** Accepted (FLOW-323, server part; the owner chose "server now")

## Context

FLOW-323 asks for one list of every transaction with a search field and filters: income or expenses, project, category, period and waiting for review. Its MCP line asks `search_expenses` and its RPC to take the same filters. `search_transactions` (0080) took only text and a filed or all scope, and matched the description and the supplier. Income lines could not be found by payer, and a row did not say its currency or whether it waits for review.

## Decision

**`search_transactions` takes the filters.** It gains five optional arguments: `p_from`, `p_to`, `p_project`, `p_category` and `p_direction`. `p_scope` also takes `pending`. Every argument has a default, so the old 4-argument call reads the same lines.
- `p_from` and `p_to` bound `doc_date`, both ends included. `from` after `to` is `validation`.
- `p_project` matches the line's own project, a share of a shared cost on it (`allocations`), or a line split part on it. A part with no project is on the line's project (0138), so the line's own project covers it. `none` lists lines with no project, no share and no part on a project.
- `p_category` matches the line's own category, or a part of its line split or loan split. `none` lists lines with no category and no parts.
- `p_direction` is `income` or `expense`.
- A project or category is an id or `none`; anything else is `validation`. Another company's id matches nothing, since every row is from the reader's company.
- The text matches the description, the supplier and the customer, in any case. `%` and `_` in it are plain characters.

**Rows say how a line stands.** Each row adds:
- `currency` and `amount_original`;
- `line_status` and `customer_name`;
- `waiting_review`;
- `kept_out`, the 0135 rule;
- `split_parts`, the line split's part count, 0 when whole;
- `loan_matched`.

Rows are newest first. Ties break on description, then id, so paging never repeats or skips a row.

**MCP `search_expenses` takes the same filters:** `from`, `to`, `direction`, `project_id` and `category_id`. On `filed` and `all` they go to the RPC. On `pending` with a filter, the RPC picks the page and the rows stay `list_review` rows, newest first. Without a filter, `pending` reads as before.

**No new index.** A company holds thousands of lines, and `(company_id, doc_date)` already serves the range. A trigram index on the description is for when a company passes about 50,000 lines.

## Alternatives rejected

- **A new `list_transactions` function next to `search_transactions`.** That would mean two functions for one list. The search screen and MCP should read the same rows.
- **A separate `review` argument.** The scope already says it; `pending` was added to the RPC instead.
- **`pending` always through the RPC.** That would change the order and the text matching of an existing MCP read that nobody asked to change.
