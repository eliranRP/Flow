# Clients reach the database through granted definer RPCs, and nothing is granted by default

**Date:** 2026-10-19
**Status:** Accepted. Amended by [0201](0201-push-device-row-and-test-push.md): `push_unsubscribe(text)` is granted to `authenticated` again (sign-out and the device row call it).

## Context

A security review on a test database found three things.

- **Default privileges.** Role `postgres`'s default privileges in `public` gave `authenticated` ALL on every new table (TRUNCATE, TRIGGER and REFERENCES included) and sequence, and EXECUTE on every new function. Migrations revoke from `public` and `anon` only, so every function a migration created was executable by `authenticated` unless it said otherwise: 194 `security definer` functions were, 11 of them called by neither the app nor `flow-mcp`. A future table that forgot RLS or a revoke would have been open to every signed-in user.
- **Table privileges.** `forecast_overrides`, `project_groups` and two status views granted `authenticated` TRUNCATE, TRIGGER and REFERENCES. `forecast_overrides` also granted INSERT, UPDATE and DELETE beside its one SELECT policy. `companies` granted DELETE, with a policy letting the owner delete their company through REST.
- **Advisor lints.** Supabase's advisor flags 0029 (a `security definer` function executable by `authenticated`) on every client RPC, and 0008 (RLS enabled, no policy) on every `private` table.

## Decision

- **Definer RPCs are the API.** The app and `flow-mcp` read and write through `security definer` functions in `public`, each with `search_path = ''` and its own company check (`private.current_company_id()` for writes, `private.readable_company_id()` for reads). Lint 0029 is accepted for these on two conditions: a function is granted to `authenticated` only when a client calls it, and every such function is on the allowlist in `supabase/tests/database/privilege_guards.test.sql` (185 today). Adding one, or keeping one a client stopped calling, fails that test until the list is edited on purpose.
- **Nothing by default.** Role `postgres`'s default privileges in `public` grant nothing to `authenticated` or `anon`. Existing objects keep their grants. A migration grants each new table, sequence or function explicitly ([CONTRIBUTING](../../CONTRIBUTING.md#database-privileges)). `supabase_admin`'s defaults still grant both roles, but `postgres` cannot change them, and the guard test checks that `postgres` owns every relation and function in `public`, so they never apply.
- **Table privileges.** No table or view in `public` grants TRUNCATE, TRIGGER or REFERENCES to a client role. `forecast_overrides` is SELECT only for `authenticated`; its writes go through definers.
- **Companies.** `authenticated` has no DELETE on `companies` and the `companies_delete` policy is gone. The owner chose a confirmed "danger zone" action for deleting a company instead; it comes in a later change.
- **Unused RPCs.** `approve_split_review(uuid)` (the app calls the two-argument overload), `clear_loan_split_review`, `company_pnl`, `delete_project_group`, `map_budget_section`, `project_cash_years`, `project_cash_year_months`, `push_unsubscribe`, `request_connector_refresh`, `save_split` and `set_supplier_settings` are not executable by `authenticated`, `anon` or `public`. `company_pnl` stays reachable through `get_dashboard` and `get_project_group`, which were invoker functions and are now `security definer` with the same bodies. Each already checks `private.readable_company_id()` itself, and `company_pnl` checks it again.
- **Private tables.** Every table in `private` has RLS on with no policy, `jev_run_lease` and `loan_deletions` included. Lint 0008 is accepted there on purpose: no client role has a grant, and only definers, running as the owner, touch them.

## Alternatives rejected

**Keep the default grants and revoke in each migration.** Every migration already revokes from `public` and `anon`, and the review still found 194 definers open to `authenticated`. One forgotten line opens a table to every user. A closed default fails safe: a forgotten grant shows up as a broken screen in review, not as a leak.

**Invoker functions behind RLS instead of definers.** Most writes touch several tables, the review queue and the audit log at once, and their rules (closed loans, split sums, undo) are more than a row policy can say. Moving them would be a rewrite with no gain in safety over a definer with its own company check.

**Leave `company_pnl` granted.** It takes a company id and checks it, so it was not open to another company. But no client calls it directly, and the scoping rule is simpler with no exceptions.

## Consequences

A new client RPC needs its grant and its allowlist line in the same PR, or the screen that calls it fails with 42501 and the guard test fails. A pgTAP test that calls one of the 11 revoked functions does so as `service_role` (or `postgres` where `service_role` has no grant), keeping the user's claims, so the function's own company check still runs. The opt-in live SUMIT e2e signs a `service_role` token for its owner to seed a supplier exemption and a split. Deleting a company is not possible from the app or REST until the danger-zone action ships.
