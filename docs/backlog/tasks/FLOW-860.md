<a id="flow-860"></a>
# FLOW-860 · The privilege guards cover every client write grant and the private definers
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-28 (two guards the tests did not pin yet).
- **Files:** `supabase/tests/database/privilege_guards.test.sql`, `supabase/migrations/20261128003000_flow_860_status_view_grants.sql`, `supabase/migrations.lock`, a changelog fragment.

- [x] No client role holds a table-level INSERT, UPDATE or DELETE on a table or view in `public`; the only column-level write is UPDATE on `companies`, and its six columns are pinned.
- [x] The connector status views (`connector_connection_status`, `sumit_connection_status`) grant the clients SELECT only; the first run of the new assertion found the INSERT, UPDATE and DELETE that their early migrations had left to `authenticated`.
- [x] One assertion lists, by full signature, every SECURITY DEFINER function in `private` that `authenticated` can execute; a new one or a new overload joins the list in the change that grants it.

**Acceptance:** a migration that grants a client role a table write, or a private definer to `authenticated`, fails `privilege_guards.test.sql` until the list says so.
