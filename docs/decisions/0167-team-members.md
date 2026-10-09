# Team members, invites, and several companies per user

**Date:** 2026-10-09
**Status:** Accepted (FLOW-601, the owner's option A with the invite inbox, 2026-10-09)

## Context

A company had exactly one person, its owner (`companies.owner_id`, unique), and a user had at most one company. The only other reader was the demo viewer (`company_viewers`). The owner wants to add people to a company as viewers (read only) or editors, to belong to several companies, and an invitee to see all their invites and join, decline, or decide later.

## Decision

1. `companies.owner_id` is no longer unique. A user can own several companies. `create_company` refuses only the same name twice for the same owner (a double tap), and opens the new company.
2. `company_members` holds an editor or a viewer of a company (`role` `editor` or `viewer`). The owner stays `companies.owner_id` and is never a member row. Rows are written only through the RPCs below.
3. `company_invites` holds an email (lower case) and a role, `pending` until the invitee joins (`accepted`) or declines (`declined`), or the owner takes it back (`cancelled`). One pending invite per company and email. No email is sent: the invitee sees it after signing in with Google with that address, and only a confirmed email that is also the verified email of their Google sign-in matches (the account email alone can be changed by its user).
4. Which company a request opens, in order: a flow-mcp token's credential company (that company while the user still belongs to it, or none); the app's `x-flow-company` request header, when the user belongs to it; the company the user last switched to (`active_companies`); the oldest company they own; their oldest membership. The header lets two devices show two companies at once without one switching the other.
5. `private.current_company_id()`, which every write policy and write RPC uses, is that company when the user is its owner or an editor. `private.readable_company_id()`, which every read uses, is that company for any role, then the demo viewer's company. `private.owner_company_id()` is that company only for its owner.
6. Editors do the bookkeeping: everything the owner does on lines, projects, categories, loans and splits. These stay the owner's: the team (invite, role, remove), the company's name and currency (already owner-checked), connectors (connect, disconnect, the import date, the SUMIT and Mercury connect and sync functions), Jev settings, and the MCP credential. Push notifications still go to owners only.
7. A viewer member is read only, like the demo viewer: write RPCs answer `forbidden`.
8. RPCs: `list_my_companies` (the switcher, with each company's role and the active one), `switch_company`, `list_team`, `invite_member` (viewer by default; a pending invite to the same email changes its role), `cancel_invite` (the toast's ביטול), `set_member_role`, `remove_member`, `my_invites`, `accept_invite` (joins and opens the company), `decline_invite` (for good) and `reopen_invite` (the toast's ביטול after a decline, within 10 minutes of it; the owner cannot see or cancel a declined invite, so it does not come back later). Edge functions find the owner's company with `owner_company_for(user, hint)`, never by `owner_id` alone.
9. MCP: `list_team`, and `invite_member`, `set_member_role`, `remove_member` with undo kinds `invite`, `member_role` and `member_remove`. The member is named by `member_id`, since `user_id` is reserved for the token's identity.

## Alternatives rejected

- Only the saved active company, no header: two devices on two companies would write to whichever was opened last.
- An editor manages connectors and Jev: they hold the owner's keys and spend, so they stay with the owner.
- Sending invite emails: no mail service is set up; the owner tells the person, and the invite waits in their inbox.

## Consequences

- Every write path that used `current_company_id()` now accepts editors with no change of its own. Every read follows the opened company.
- An invite to an email that never signs in stays pending until the owner cancels it.
- A member who is removed loses access at once; their next request opens their own company or none.
- A flow-mcp key is made for the company the app shows (its `x-flow-company` header), else the one last switched to, and only when the user owns it. Making a key still revokes the user's other keys, so an owner of several companies has one live key at a time.
