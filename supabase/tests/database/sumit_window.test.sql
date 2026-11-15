-- FLOW-1163 (20261115185900_flow_1163_sumit_window.sql): upsert_sumit_window stores one run of a SUMIT
-- documents window. A partial run (p_complete false) stores and never sweeps, and its continuation
-- (settings.pull) commits with the documents. The run that finishes a window that took more than one
-- run stores with p_complete false too: no sweep. Only a window listed whole in one run sweeps, and it
-- holds, not removes, a line in a closed period (FLOW-1166). Idempotent: a page stored twice changes
-- nothing. upsert_sumit_documents is the same function with the sweep on. Invented names and figures,
-- @example.com only.

begin;

select plan(29);

do $users$
begin
  perform tests.create_supabase_user('sw_owner', 'sw-owner@example.com');
end
$users$;

create temp table sw (label text primary key, id uuid);
grant all on sw to authenticated, service_role;
insert into sw (label, id) values ('co', tests.fixture_company('sw_owner', 'Example Window Co'));

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 1163, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from sw where label = 'co';

create or replace function pg_temp.co() returns uuid language sql set search_path = '' as $$
  select id from pg_temp.sw where label = 'co';
$$;
-- A closed date well back, and a document dated before and one after it.
create or replace function pg_temp.closed() returns date language sql set search_path = '' as $$
  select (date_trunc('month', current_date) - interval '3 months')::date - 1;
$$;
create or replace function pg_temp.sd(p_id integer, p_date date default current_date - 3)
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object(
    'idempotency_key', 'sumit:' || p_id, 'external_id', p_id::text, 'direction', 'income', 'doc_kind', 'invoice',
    'pnl_role', null, 'amount_gross', '11700', 'amount_net', '10000', 'vat_amount', '1700', 'vat_status', 'source',
    'doc_date', p_date, 'cash_date', null, 'description', 'Example document ' || p_id,
    'linked_external_id', null, 'budget_section_id', null, 'budget_section_name', null,
    'party_name', 'Example Customer', 'party_kind', 'customer', 'party_external_id', 900, 'document_url', null);
$$;
create or replace function pg_temp.docs(p_from integer, p_to integer)
returns jsonb language sql set search_path = '' as $$
  select coalesce(jsonb_agg(pg_temp.sd(g) order by g), '[]'::jsonb) from generate_series(p_from, p_to) g;
$$;
-- The service role calls the window function.
create or replace function pg_temp.win(p_docs jsonb, p_complete boolean, p_pull jsonb)
returns integer language plpgsql set search_path = '' as $$
declare n integer;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  n := public.upsert_sumit_window(pg_temp.co(), p_docs, p_complete, p_pull);
  reset role;
  return n;
end; $$;
create or replace function pg_temp.live(p_id integer) returns boolean language sql set search_path = '' as $$
  select (select t.removed_at is null from public.transactions t
    where t.company_id = pg_temp.co() and t.source = 'sumit' and t.external_id = p_id::text);
$$;
create or replace function pg_temp.live_count() returns integer language sql set search_path = '' as $$
  select count(*)::integer from public.transactions t
  where t.company_id = pg_temp.co() and t.source = 'sumit' and t.removed_at is null;
$$;
create or replace function pg_temp.pull() returns jsonb language sql set search_path = '' as $$
  select c.settings->'pull' from public.connector_connections c where c.company_id = pg_temp.co() and c.provider = 'sumit';
$$;
create or replace function pg_temp.pulled(p_start integer) returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object('v', 1, 'company', 1163, 'at', '2026-11-15T03:00:00.000Z', 'start', p_start, 'anchor', p_start,
    'repeats', 0, 'invoices', '[]'::jsonb, 'rates', '{}'::jsonb, 'deferred', '[]'::jsonb);
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- 0. Who may call it.
select tests.authenticate_as('sw_owner');
select throws_ok(
  format($$select public.upsert_sumit_window(%L::uuid, '[]'::jsonb, true, null)$$, pg_temp.co()),
  '42501', 'permission denied for function upsert_sumit_window', 'an owner cannot call the window function');
reset role;
select has_function('public', 'upsert_sumit_window', array['uuid', 'jsonb', 'boolean', 'jsonb'], 'the window function exists');

-- 1. A whole window in one go, as before: 11 open documents, an old one, a closed-period one. The
-- connection holds a cursor the compare-and-set keeps.
update public.connector_connections set sync_cursor = 'c1' where company_id = pg_temp.co() and provider = 'sumit';
update public.companies set books_closed_through = pg_temp.closed() where id = pg_temp.co();
select is(pg_temp.win(pg_temp.docs(1, 11) || jsonb_build_array(pg_temp.sd(100), pg_temp.sd(200, pg_temp.closed() - 10)),
  true, null), 13, 'a whole window in one go stores its 13 documents (the closed-period one is a new line, so it is inserted)');
select is(pg_temp.live_count(), 13, 'all 13 are live');
select is((select c.sync_cursor from public.connector_connections c where c.company_id = pg_temp.co() and c.provider = 'sumit'),
  'c1', 'the cursor compare-and-set is as before');
select is(pg_temp.pull(), null, 'a whole window leaves no continuation');

-- 2. The first partial run: stores, does not sweep, keeps the continuation; a stale sync_page_cap clears.
update public.connector_connections set last_error = 'sync_page_cap', next_attempt_at = now() + interval '15 minutes'
where company_id = pg_temp.co() and provider = 'sumit';
select is(pg_temp.win(pg_temp.docs(1, 3), false, pg_temp.pulled(20000)), 3, 'a partial run stores its documents');
select is(pg_temp.live_count(), 13, 'and removes nothing (100 and 200 were not listed, and still stand)');
select is(pg_temp.pull()->>'start', '20000', 'the continuation is stored with them');
select is((select c.last_error is null and c.next_attempt_at is null from public.connector_connections c
  where c.company_id = pg_temp.co() and c.provider = 'sumit'), true,
  'a pull that moves clears a stale sync_page_cap and its 15-minute wait');
select is((select c.settings->>'sumit_company_id' from public.connector_connections c
  where c.company_id = pg_temp.co() and c.provider = 'sumit'), '1163', 'the settings keep the SUMIT company id');
select is((select c.sync_cursor from public.connector_connections c where c.company_id = pg_temp.co() and c.provider = 'sumit'),
  'c1', 'the cursor is untouched by a partial run');

-- 3. Idempotent: the same page again changes nothing.
create temp table before_rows as
  select t.external_id, md5((to_jsonb(t) - 'updated_at')::text) as h
  from public.transactions t where t.company_id = pg_temp.co() and t.source = 'sumit';
grant all on before_rows to service_role;
select pg_temp.win(pg_temp.docs(1, 3), false, pg_temp.pulled(20000));
select is((select count(*)::integer from public.transactions t where t.company_id = pg_temp.co() and t.source = 'sumit'), 13,
  'a page stored again adds no row');
select is((select count(*)::integer from before_rows b join public.transactions t
    on t.company_id = pg_temp.co() and t.source = 'sumit' and t.external_id = b.external_id
    where b.h is distinct from md5((to_jsonb(t) - 'updated_at')::text)), 0, 'and changes no row');

-- 4. The second partial run replaces the continuation.
select pg_temp.win(pg_temp.docs(4, 6), false, pg_temp.pulled(39999));
select is(pg_temp.pull()->>'start', '39999', 'the next partial run moves the continuation on');
select is(pg_temp.live_count(), 13, 'and still removes nothing');
select is(pg_temp.live(100) and pg_temp.live(200), true, 'the documents no run has listed yet are untouched');

-- 5. The run that finishes a window that took more than one run stores with p_complete false: it does
-- not sweep either, so the documents no run listed (100, and the closed-period 200) stay.
select is(pg_temp.win(pg_temp.docs(7, 11), false, null), 5, 'the finishing run of a resumed window stores its documents');
select is(pg_temp.live(100) and pg_temp.live(200), true, 'and removes nothing');
select is(pg_temp.live_count(), 13, 'every document is still live');
select is(pg_temp.pull(), null, 'the finished window leaves no continuation');

-- 6. A window listed whole in one run sweeps as before: 100 is removed, the closed-period 200 is held.
select pg_temp.win(pg_temp.docs(1, 11), true, null);
select is(pg_temp.live(100), false, 'a whole window in one run removes the document it did not list');
select is(pg_temp.live(200), true, 'a closed-period document it did not list is not removed');
select is((select h.kind || ':' || h.state from private.closed_line_holds h
  where h.company_id = pg_temp.co() and h.transaction_id = (select t.id from public.transactions t
    where t.company_id = pg_temp.co() and t.source = 'sumit' and t.external_id = '200')), 'remove:held',
  'its removal is held (FLOW-1166)');

-- 7. A pull that is not an object is refused.
select throws_ok(
  format($$select pg_temp.win(%L::jsonb, false, '"x"'::jsonb)$$, pg_temp.docs(1, 1)::text),
  'P0001', 'pull must be an object', 'a pull that is not an object is refused');

-- 8. A pull written by a partial run is dropped by a run that clears it, and by the old name.
select pg_temp.win(pg_temp.docs(1, 3) || jsonb_build_array(pg_temp.sd(102)), false, pg_temp.pulled(20000));
select is(pg_temp.pull()->>'start', '20000', 'a continuation is stored again');
do $old$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform public.upsert_sumit_documents((select id from pg_temp.sw where label = 'co'), pg_temp.docs(1, 11));
  reset role;
end
$old$;
select is(pg_temp.pull(), null, 'upsert_sumit_documents is the window function with the sweep on and no continuation');
select is(pg_temp.live(102), false, 'and its sweep still removes what the run did not list');
select is(pg_temp.live_count(), 12, 'while the closed-period document is held');

select * from finish();

rollback;
