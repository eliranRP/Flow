# MCP cycle 4 writes and sync_bank

**Date:** 2026-10-06
**Status:** Accepted

## Context

Cycle 4 adds `create_project`, `create_category`, and an on-demand Mercury pull through the existing `mercury-sync` force path. [0080](0080-mcp-connector.md) said no MCP tool performs outbound HTTP. Bank sync already lives in an internal edge function with encrypted keys and connector RPCs.

## Decision

Ship the three write tools with the same idempotency, writer gate, and undo patterns as cycle 3a. `sync_bank` is the only MCP tool that POSTs to another Flow function (`mercury-sync` with `force: true`). It still does not call Mercury or any third party from `flow-mcp`. Begin/finish RPCs store the result after a successful pull. Undo for create deletes projects and categories only when no company row references them; otherwise undo is `conflict`.

## Alternatives rejected

- Date-range arguments on `sync_bank`: would advance `sync_cursor` past filtered rows or require cursor reset.
- Calling Mercury from `flow-mcp`: duplicates connector logic and key handling.

## Consequences

[0080](0080-mcp-connector.md) stays Accepted; its no-outbound-HTTP line applies to third parties. Operators should smoke `sync_bank` after deploy because the MCP JWT may not pass `auth.getUser()` on `mercury-sync` (see PR Decisions needed).
