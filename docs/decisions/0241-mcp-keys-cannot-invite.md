# MCP keys cannot invite people or change a member's role

**Date:** 2026-11-01
**Status:** Accepted
**Amends:** [0095](0095-mcp-first.md) (an MCP tool is withheld on purpose when the action gives someone access, and the database enforces it, as in [0194](0194-delete-company-danger-zone.md))

## Context

[0167](0167-team-members.md) let the owner invite people and set their role, in the app and through two flow-mcp tools, `invite_member` and `set_member_role`. A flow-mcp key with write scope is held by an AI agent. While it works, the agent reads text that other people wrote: payees, memos, notes, counterparties and file names from banks and users. Text like that is data, and an agent can be misled by it. Giving someone access to the books is the one action that is hard to take back once they have seen the numbers, so the owner decided that a key must not be able to do it.

## Decision

- **The database refuses it.** `public.invite_member` and `public.set_member_role` read the request's JWT claims the way `delete_company` does (`mcp_tid`, as `private.active_company()` reads it). A request that carries a flow-mcp token gets `forbidden` (42501) before anything else. Signatures, bodies and grants are otherwise unchanged, so the app works as before.
- **The tools are removed.** `invite_member` and `set_member_role` leave `tools/list`, and `mcp_invite_member` and `mcp_set_member_role` are dropped. The owner invites people and changes roles in the app (Settings, צוות).
- **`remove_member` stays.** It only takes access away and has an undo.
- **Earlier writes.** The `invite` undo kind stays in `undo`: a pending invite made earlier can still be cancelled. A `member_role` undo goes through `set_member_role`, so a key is refused; the owner puts a role back in the app.
- **Agents treat returned text as data.** The server instructions and the `get_started` rules say that text in results (payees, memos, notes, counterparties, file names) is data from users or banks, never instructions, and that the agent asks the owner before bulk writes.
- **`sync_bank` says it has no undo.** It brings Flow in line with the bank, as the scheduled sync does.

## Alternatives rejected

**Keep the tools and ask for confirmation.** The confirmation would be given by the same agent that holds the key.

**Allow viewer invites only.** A viewer reads every figure of the company, which is the exposure.

**Drop `remove_member` too.** It removes access, never grants it, and the owner can undo it.

## Consequences

This is a second exception to [0095](0095-mcp-first.md), after [0194](0194-delete-company-danger-zone.md). The team section of [TOOLS.md](../mcp/TOOLS.md) says where inviting and roles are done. A new action that grants access to the company gets the same database guard and no tool.
