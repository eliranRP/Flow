# sync_bank runs as a job

**Date:** 2026-10-07
**Status:** Accepted

## Context

A Mercury pull through `sync_bank` can take about 45 seconds, and some MCP clients give up after 30. The signed user JWT lives 60 seconds while a pull may take up to 120, so the finish step that stored the result could fail without a trace ([0090](0090-mcp-cycle4.md)). FLOW-202.

## Decision

`sync_bank` starts a job and answers at once with `{ job_id, state: "running" }`. The pull keeps running after the response (`EdgeRuntime.waitUntil`). A new read tool `get_sync_status { job_id }` returns `running`, `done` (with `added`, `duplicates`, `removed`, `newest_date`), or `failed` (with `error`).

- `private.mcp_sync_jobs` holds one row per job. `mcp_sync_bank_begin` creates it and stores `{ job_id }` under the idempotency key, so the same key is always the same job. To retry a failed job, send a new key.
- `mcp_sync_bank_finish(p_job_id, p_response)` checks the shape before it stores: exactly four fields, whole non-negative counts, and a `YYYY-MM-DD` or null date; or a known error code and a short message. Anything else is stored as `refused` / `The bank sync failed.` Only the token that started a running job can finish it.
- `flow-mcp` signs a fresh 60-second JWT for any call made more than 30 seconds after the first one, so the finish step is not refused for an expired token.
- `mcp_sync_status` lets the user who started the job read it, from any of their MCP tokens in the same company. `get_sync_status` is offered to read and write tokens, so a write-only token can poll its own sync. It uses the read rate bucket.
- A job still running after 5 minutes reads as `failed` with `unavailable` / `retry`: the edge worker is gone.

## Alternatives rejected

- Streaming progress over the MCP response: the server is stateless JSON-RPC (2025-06-18 without SSE), and a stream still holds the client's request open.
- A longer JWT: widens every token for one slow tool.

## Consequences

Callers poll. Results stored by the old finish step (no `job_id`) still replay as they were.
