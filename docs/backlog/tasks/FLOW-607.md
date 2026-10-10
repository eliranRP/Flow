<a id="flow-607"></a>
# FLOW-607 · Email the invite when the owner invites a team member
- **Type:** FEATURE · **Status:** in-progress (draft PR on claude/project-thread-7hoido) · **Depends on:** FLOW-601 · **Source:** the owner sent an invite and no email arrived, 2026-10-10.
- [ ] A new invite (not a role change) also sends one email through Resend, from the new `invite-email` edge function. The function re-reads the team as the caller, so only the owner of the invite's company can send it. A failed send never fails the invite; the invitee still sees it after signing in with that address. Sender and link are settings: `INVITE_EMAIL_FROM` (default Resend's test sender, which reaches only the Resend account's own address until a domain is verified) and `APP_URL`. Decision [0177](../../decisions/0177-invite-email.md).
- [ ] Follow-up (not in this task): the MCP `invite_member` tool does not send the email yet.
