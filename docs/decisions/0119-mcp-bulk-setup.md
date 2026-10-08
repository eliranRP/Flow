# Bulk setup over MCP, and telling clients the tool list changed

**Date:** 2026-10-08
**Status:** Accepted

## Context

The MCP write bucket allows 20 writes a minute per token (40 per user). A company setup over MCP called `create_project` and `create_category` once per row, so a setup of a few dozen rows ran into HTTP 429 and stalled. Separately, `initialize` said `listChanged: false`, and a client that listed the tools before a deploy kept the old list until it reconnected, so new tools stayed invisible to it.

## Decision

- Two batch writes, `create_projects` and `create_categories`, take up to 100 rows each. Like `assign_expenses` ([0093](0093-mcp-batch.md)), the whole batch is one write against the rate limit, rows succeed or fail on their own, each row runs the single-row write with the key `idempotency_key:ordinal`, and `undo_batch` with the returned `batch_key` removes the rows that were created (newest first, with the same `conflict` rule as `undo`).
- A name that is already taken is `refused` for that row and returns `existing_id`, so a client can rerun a setup and still learn every id. The same name twice in one batch (per kind for categories) is `validation` for the whole call.
- The rate limits stay as they are. A higher burst would also loosen every other write.
- `initialize` now says `listChanged: true` and returns an `Mcp-Session-Id` of a random id plus a short hash of the tool list that token sees. On a `tools/call` whose session id carries an older hash, and whose `Accept` allows `text/event-stream`, the reply is a stream with `notifications/tools/list_changed` first and the usual reply second. The server keeps no session state: the hash is all it checks. A request without a session id, or one that accepts only JSON, gets plain JSON as before.

## Alternatives rejected

- Raising the write burst for setup. It needs a notion of "setup" the server cannot see, and it weakens the net for every write.
- Answering a stale session with HTTP 404 so the client starts over. The spec allows it, but the call in flight is lost and not every client retries.

## Consequences

`undo_batch` now names a row it undid by `transaction_id` when the batch row had one, and by `id` and `name` for a created project or category.

A session id cannot change mid-session, so after a deploy a long session hears `list_changed` on every `tools/call` until it reconnects, and may list the tools again each time. Listing is one read against the read bucket (60 a minute).
