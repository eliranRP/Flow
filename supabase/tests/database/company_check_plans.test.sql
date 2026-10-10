-- Row security calls the company checks once per table a query reads. As plpgsql they keep
-- their plans for the connection; as SECURITY DEFINER SQL functions they were planned again
-- on every call.
begin;
select plan(1);

select results_eq(
  $$
    select p.proname::text, l.lanname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'private'
      and p.proname in ('active_company', 'active_company_for', 'company_role', 'readable_company_id')
    order by p.proname
  $$,
  $$
    values
      ('active_company', 'plpgsql'),
      ('active_company_for', 'plpgsql'),
      ('company_role', 'plpgsql'),
      ('readable_company_id', 'plpgsql')
  $$,
  'the company checks are plpgsql, so their plans are cached'
);

select * from finish();
rollback;
