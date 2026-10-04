-- A signed-in user must not insert public.companies. companies_insert only
-- checked owner_id = auth.uid(), so a viewer could POST /rest/v1/companies
-- and become an owner, skipping create_company's viewer guard.
-- create_company is security definer and remains the only insert path.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

revoke insert on table public.companies from authenticated;

drop policy companies_insert on public.companies;

commit;
