<a id="flow-860"></a>
# FLOW-860 · The privilege guards cover every client write grant and the private definers
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-28 (two guards the tests did not pin yet).
- **Files:** `supabase/tests/database/privilege_guards.test.sql`, a changelog fragment.

- [x] One assertion lists every INSERT, UPDATE or DELETE a client role holds on a table or view in `public`; the only one allowed is the column-level UPDATE on `companies`.
- [x] One assertion lists every SECURITY DEFINER function in `private` that `authenticated` can execute; a new one joins the list in the change that grants it.

**Acceptance:** a migration that grants a client role a table write, or a private definer to `authenticated`, fails `privilege_guards.test.sql` until the list says so.
