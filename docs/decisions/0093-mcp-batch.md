# MCP cycle 6 batch assign and undo_batch

**Date:** 2026-10-06
**Status:** Accepted

## Context

Agents filing hundreds of review items hit the MCP write rate limit once per `assign_expense` call. Cycle 3a already defines single-row assign, category set, and typed undo with idempotency.

## Decision

Add `assign_expenses` and `undo_batch` as write tools. One `tools/call` is one write rate hit. Each row reuses `mcp_assign_expense` or `mcp_set_expense_category` with a derived per-row idempotency key. Partial success never blocks good rows. Batch-level idempotency replays the stored envelope; a different body is `conflict`. `private.mcp_batches` stores successful row undo targets for `mcp_undo_batch`, which calls `mcp_undo` newest-first with per-row sub-blocks.

## Alternatives rejected

- Raising the write rate limit for agents: would not scale to full-queue runs and weakens abuse protection.
- Client-side JSON-RPC batching: still one rate hit per tool call in the handler.

## Consequences

Open PRs for cycle 5 tools must not redefine cycle 3a undo helpers. Operators should run database tests when Supabase is available. Very large batches remain bounded at 200 rows per call.
