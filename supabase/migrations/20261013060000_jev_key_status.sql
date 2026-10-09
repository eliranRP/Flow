-- FLOW-704: the Jev Settings row can say "no key". jev_key_status() tells a signed-in user with a
-- company (owner, or viewer of a demo company) whether Vault holds a non-empty jev_api_key:
-- 'ok' or 'missing'. It returns only that word, never the key or its length. A user with no
-- readable company is refused, like the other company reads. Decision 0083 keeps the key itself
-- behind the service-role read_jev_api_key().
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.jev_key_status()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  present boolean := false;
begin
  if (select auth.uid()) is null or private.readable_company_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$
      select exists (
        select 1
        from vault.decrypted_secrets s
        where s.name = 'jev_api_key'
          and btrim(coalesce(s.decrypted_secret, '')) <> ''
      )
    $q$ into present;
  end if;
  return case when present then 'ok' else 'missing' end;
end;
$$;

revoke all on function public.jev_key_status() from public, anon;
grant execute on function public.jev_key_status() to authenticated, service_role;

comment on function public.jev_key_status() is
  'FLOW-704: ''ok'' when Vault holds a non-empty jev_api_key, else ''missing''. Never returns the key. Signed-in users with a readable company only.';

commit;
