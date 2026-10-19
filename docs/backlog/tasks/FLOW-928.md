<a id="flow-928"></a>
# FLOW-928 · Invite send caps and redundant indexes (advisors review)
- **Type:** SMALL CYCLE · **Status:** in-progress · **Depends on:** #735 (decision 0193) · **Source:** Supabase advisors review 2026-10-19: no limit on invite emails; unused indexes ("don't drop them blindly").
- **Files:** `supabase/migrations/20261019151437_invite_caps_redundant_indexes.sql`, `supabase/migrations.lock`, `supabase/tests/database/invite_caps.test.sql`, `supabase/tests/database/foreign_key_indexes.test.sql`, `supabase/tests/database/privilege_guards.test.sql`, `supabase/functions/_shared/invite_email.ts`, `supabase/functions/_shared/invite_email_test.ts`, `supabase/functions/flow-mcp/tools_specs.ts`, `supabase/functions/flow-mcp/tools_team_test.ts`, `packages/shared/src/database.types.ts`, `app/src/team-api.ts`, `app/src/team-api.test.ts`, `app/src/screens/team-screen.test.tsx`, `docs/decisions/0195-invite-caps-redundant-indexes.md`, `docs/mcp/TOOLS.md`.
- [x] `invite_member`: 10 new invites per company and 20 per inviting user in any 24 hours, else `invite_limit` (23514) with nothing written (decision 0195).
- [x] `claim_invite_email`: the invite-email function sends at most 3 emails per pending, unexpired invite.
- [x] The app's failure toast for the cap; flow-mcp refuses with `invite_limit`.
- [x] Drop the 12 redundant indexes, checked in the local and production catalogs; the foreign-key index guard asks for a valid, usable index.
- [ ] Follow-up: whole indexes for the three foreign keys the guard lists as exceptions, and a look at `loans_interest_category_idx` and `split_rule_targets_project_idx` once their scans are understood.
