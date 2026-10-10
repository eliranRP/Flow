# Invite emails through Resend

**Date:** 2026-10-10
**Status:** Accepted (FLOW-607, the owner's pick: send real invite emails)

## Context

Decision [0167](0167-team-members.md) sent no email: the invitee saw the invite after signing in with Google with that address. The owner invited someone and expected an email.

## Decision

1. A new invite sends one email through Resend. The app calls the `invite-email` edge function right after `invite_member` answers `existing: false`. A role change on a pending invite sends nothing.
2. The function reads `list_team` and `list_my_companies` with the caller's own token, so it mails only a pending invite of a company the caller owns. The invite id is the Resend idempotency key.
3. A failed send is silent in the app. The invite is saved either way and waits in the invitee's inbox.
4. Settings: `RESEND_API_KEY` (secret), `INVITE_EMAIL_FROM` and `APP_URL`. Until a sending domain is verified in Resend, the default test sender reaches only the Resend account's own address.
5. The MCP `invite_member` tool does not send the email yet.

## Consequences

- The email says who invited, the company, the role, and to sign in with Google using that address.
- Real delivery to other people needs a verified domain in Resend and `INVITE_EMAIL_FROM` set to it.
