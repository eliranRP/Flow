-- FLOW-505: the import range. sumit_status returns import_from; a wider Mercury range clears the
-- sync cursor so the next sync reads from the new start; a narrower one keeps it and keeps rows.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('ir_owner', 'ir-owner@example.com');
end
$users$;

create temp table ir (label text primary key, id uuid);
grant all on ir to authenticated;

select tests.authenticate_as('ir_owner');
select lives_ok($$select public.create_company('Import Range Books', true)$$, 'owner creates a company');
insert into ir (label, id) select 'a', id from public.companies where name = 'Import Range Books';

select is(public.sumit_status()->'import_from', 'null'::jsonb, 'a company with no SUMIT returns a null import_from');

reset role;

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, p.provider, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '1', '1'
from ir, (values ('sumit'::public.connector_provider), ('mercury'::public.connector_provider)) as p(provider)
where label = 'a';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'overhead',
  -1000, -1000, 0, 'unknown',
  '2026-01-15', 'manual', 'ir:old', 'Older row'
from ir where label = 'a';

update public.connector_connections set sync_cursor = '2026-10-01T00:00:00.000Z'
where company_id = (select id from ir where label = 'a') and provider = 'mercury';

create function pg_temp.mercury_cursor() returns text language sql security definer as $$
  select sync_cursor from public.connector_connections
  where company_id = (select id from ir where label = 'a') and provider = 'mercury';
$$;
grant execute on function pg_temp.mercury_cursor() to authenticated;

select tests.authenticate_as('ir_owner');

select lives_ok($$select public.set_import_from('sumit', '2026-03-01')$$, 'the owner sets the SUMIT import start');
select is(public.sumit_status()->>'import_from', '2026-03-01', 'sumit_status returns the SUMIT import start');
select is((public.sumit_status() ? 'connected'), true, 'sumit_status keeps its other keys');

select lives_ok($$select public.set_import_from('mercury', '2026-06-01')$$, 'the owner narrows Mercury from the start to a date');
select is(pg_temp.mercury_cursor(), '2026-10-01T00:00:00.000Z', 'narrowing keeps the Mercury cursor');

select lives_ok($$select public.set_import_from('mercury', '2026-08-01')$$, 'a later date narrows again');
select is(pg_temp.mercury_cursor(), '2026-10-01T00:00:00.000Z', 'a later date keeps the cursor');

select public.set_import_from('mercury', '2026-02-01');
select is(pg_temp.mercury_cursor(), null, 'an earlier date clears the cursor so the next sync reads from it');

reset role;
update public.connector_connections set sync_cursor = '2026-10-02T00:00:00.000Z'
where company_id = (select id from ir where label = 'a') and provider = 'mercury';
select tests.authenticate_as('ir_owner');
select public.set_import_from('mercury', null);
select is(pg_temp.mercury_cursor(), null, 'back to from-the-start clears the cursor too');

reset role;
select is(
  (select count(*)::int from public.transactions where company_id = (select id from ir where label = 'a')),
  1,
  'changing the range keeps the rows already stored'
);

select * from finish();
rollback;
