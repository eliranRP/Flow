# The JWT company claim comes from membership

**Date:** 2026-09-28
**Status:** Accepted

## Context

The access token hook can add `company_id` on the Free plan. The slice already isolates tenants with `companies.owner_id` and `private.current_company_id()`.

## Decision

`company_member` is filled from the company owner. `custom_access_token_hook` copies that company id into the JWT. RLS stays on the owner lookup, so a stale or extra claim cannot open another company's rows. After `create_company`, the client calls `refreshSession()`.

An auth user with no company still sees nothing. Deleting orphan auth users is an operator step in the runbook. The migration does not delete `auth.users`.

## Consequences

Enable the hook in the Supabase dashboard. The function name is `public.custom_access_token_hook`.
