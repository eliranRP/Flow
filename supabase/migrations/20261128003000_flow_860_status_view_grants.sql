-- FLOW-860 (the security scan, 2026-11-28): the two connector status views are read-only for the
-- clients. connector_connection_status and sumit_connection_status were created while role postgres's
-- default privileges still granted every new object in public to authenticated
-- (20261019135347_privilege_hardening.sql removed those defaults later), and their own migrations
-- revoked from public and anon only, so authenticated kept INSERT, UPDATE and DELETE on them.
-- Both views read with the caller's rights (security_invoker), and authenticated holds no write on
-- what they read, so no write went through; the grants are taken back so the table privileges say
-- what the clients may do. Grants only: no view, row or function changes.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

revoke all on public.connector_connection_status from public, anon, authenticated;
grant select on public.connector_connection_status to authenticated, service_role;

revoke all on public.sumit_connection_status from public, anon, authenticated;
grant select on public.sumit_connection_status to authenticated, service_role;

commit;
