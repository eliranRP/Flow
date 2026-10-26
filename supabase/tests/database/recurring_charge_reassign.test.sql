-- FLOW-963: reassign_recurring_charge moves every payment of a recurring charge to a project or a
-- category, the earlier ones too; undo_reassign_recurring_charge takes it back; the MCP write is a batch
-- that undo_batch takes back. Invented data only. Amounts are agorot.

begin;

set constraints all immediate;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('rc_owner', 'rc-owner@example.com');
  perform tests.create_supabase_user('rc_other', 'rc-other@example.com');
end
$users$;

create temp table rc (label text primary key, id uuid);
grant all on rc to anon, authenticated, service_role;

insert into rc (label, id) values
  ('co', tests.fixture_company('rc_owner', 'Example Charge LLC')),
  ('co_b', tests.fixture_company('rc_other', 'Example Elsewhere Charge LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rc where label = p_label; $$;
grant execute on function pg_temp.id(text) to anon, authenticated, service_role;

insert into rc (label, id) values
  ('oak', tests.fixture_project(pg_temp.id('co'), 'Example Oak')),
  ('elm', tests.fixture_project(pg_temp.id('co'), 'Example Elm')),
  ('foreign_project', tests.fixture_project(pg_temp.id('co_b'), 'Example Foreign')),
  ('water', tests.fixture_category(pg_temp.id('co'), 'Example Water')),
  ('power', tests.fixture_category(pg_temp.id('co'), 'Example Power')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example Rent', 'income'));

insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Utility'), (pg_temp.id('co'), 'Example Other');
insert into rc (label, id) select case s.name when 'Example Utility' then 'utility' else 'other' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- Three monthly water bills on Oak, one in USD (another charge), one removed, one of another supplier,
-- and a shared one.
insert into rc (label, id) values
  ('w_08', tests.fixture_line(pg_temp.id('co'), 'rc:w08', 12000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-08-05')),
  ('w_09', tests.fixture_line(pg_temp.id('co'), 'rc:w09', 12500, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-09-05')),
  ('w_10', tests.fixture_line(pg_temp.id('co'), 'rc:w10', 13000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-05')),
  ('w_usd', tests.fixture_line(pg_temp.id('co'), 'rc:wusd', 900, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-06', 'USD')),
  ('w_gone', tests.fixture_line(pg_temp.id('co'), 'rc:wgone', 900, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-07')),
  ('w_shared', tests.fixture_line(pg_temp.id('co'), 'rc:wshared', 900, 'expense', null, pg_temp.id('water'), '2026-07-05', p_pnl_role => 'shared')),
  ('o_10', tests.fixture_line(pg_temp.id('co'), 'rc:o10', 4000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-08'));
update public.transactions set supplier_id = pg_temp.id('utility')
where id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10'), pg_temp.id('w_usd'), pg_temp.id('w_gone'), pg_temp.id('w_shared'));
update public.transactions set supplier_id = pg_temp.id('other') where id = pg_temp.id('o_10');
update public.transactions set removed_at = now() where id = pg_temp.id('w_gone');

select tests.authenticate_as('rc_owner');

-- 1-6. A project pick moves every ILS line of the supplier, the earlier ones too, and skips the shared one.
create temp table rc_out as
select public.reassign_recurring_charge('expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('elm'), null) as r;
grant all on rc_out to anon, authenticated, service_role;
select is((select (r->>'changed')::int from rc_out), 3, 'the three bills of the charge change');
select is((select (r->>'skipped')::int from rc_out), 1, 'the shared bill is skipped and counted');
select is(
  (select count(*)::int from public.transactions where id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10')) and project_id = pg_temp.id('elm')),
  3, 'every bill of the charge is on the picked project, the earlier ones too'
);
select is(
  (select count(*)::int from public.allocations where transaction_id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10')) and project_id = pg_temp.id('elm')),
  3, 'their allocations follow the project'
);
select is((select category_id from public.transactions where id = pg_temp.id('w_10')), pg_temp.id('water'), 'a project pick keeps each bill''s category');
select ok(
  (select project_id = pg_temp.id('oak') from public.transactions where id = pg_temp.id('w_usd'))
  and (select project_id = pg_temp.id('oak') from public.transactions where id = pg_temp.id('o_10')),
  'another currency and another supplier are other charges, and stay'
);

-- 7-8. The undo puts every bill back.
select lives_ok(
  format('select public.undo_reassign_recurring_charge(%L::uuid[])', (select array(select jsonb_array_elements_text(r->'undo_ids'))::text from rc_out)),
  'the undo runs'
);
select is(
  (select count(*)::int from public.transactions where id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10')) and project_id = pg_temp.id('oak')),
  3, 'the undo puts every bill back on its project'
);

-- 9-11. A category pick changes the category of every bill and keeps the project; a second pick of the
-- same category changes nothing.
select is(
  (public.reassign_recurring_charge('expense', pg_temp.id('utility'), 'ILS', null, null, pg_temp.id('power'))->>'changed')::int,
  3, 'a category pick changes the three bills'
);
select ok(
  (select bool_and(category_id = pg_temp.id('power') and project_id = pg_temp.id('oak'))
   from public.transactions where id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10'))),
  'each bill takes the category and keeps its project'
);
select is(
  (public.reassign_recurring_charge('expense', pg_temp.id('utility'), 'ILS', null, null, pg_temp.id('power'))->>'changed')::int,
  0, 'picking the category the charge already has changes nothing'
);

-- 12-15. Refusals: an income category on an expense charge, another company's project, no pick, a bad direction.
select throws_ok(
  format('select public.reassign_recurring_charge(''expense'', %L, ''ILS'', null, null, %L)', pg_temp.id('utility'), pg_temp.id('rent')),
  'category not found', 'an expense charge takes no income category'
);
select throws_ok(
  format('select public.reassign_recurring_charge(''expense'', %L, ''ILS'', null, %L, null)', pg_temp.id('utility'), pg_temp.id('foreign_project')),
  'project not found', 'another company''s project is refused'
);
select throws_ok(
  format('select public.reassign_recurring_charge(''expense'', %L, ''ILS'', null, null, null)', pg_temp.id('utility')),
  'validation', 'a pick names a project or a category'
);
select throws_ok(
  format('select public.reassign_recurring_charge(''sideways'', %L, ''ILS'', null, %L, null)', pg_temp.id('utility'), pg_temp.id('elm')),
  'validation', 'the direction is expense or income'
);

-- 16. Another company's owner moves nothing of this one.
select tests.authenticate_as('rc_other');
select throws_ok(
  format('select public.reassign_recurring_charge(''expense'', %L, ''ILS'', null, %L, null)', pg_temp.id('utility'), pg_temp.id('elm')),
  'project not found', 'another company''s owner is refused'
);

-- 17-22. The MCP write: one batch row per changed bill, undo_batch takes it back, a retry replays.
reset role;
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('rc_owner'), pg_temp.id('co'), 'hash-rc-write', 'kid', array['write']::text[], '2099-01-01');
insert into rc (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-rc-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('rc_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('write'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
create temp table rc_mcp as
select public.mcp_reassign_recurring_charge('rc-1', 'expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('elm'), null) as r;
grant all on rc_mcp to anon, authenticated, service_role;
select is((select r->'data'->>'changed' from rc_mcp), '3', 'the MCP write changes the three bills');
select is((select r->'data'->>'skipped' from rc_mcp), '1', 'and counts the shared one');
select is(
  public.mcp_reassign_recurring_charge('rc-1', 'expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('elm'), null),
  (select r from rc_mcp),
  'a retry with the same key replays'
);
select is(
  public.mcp_reassign_recurring_charge('rc-2', 'expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('foreign_project'), null)->'error'->>'code',
  'refused', 'another company''s project is refused in the envelope'
);
select is(
  (public.mcp_undo_batch('rc-undo', (select r->'data'->>'batch_key' from rc_mcp))->'data'->>'ok_count'),
  '3', 'undo_batch takes every bill back'
);
select is(
  (select count(*)::int from public.transactions where id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10')) and project_id = pg_temp.id('oak')),
  3, 'every bill is on its project again'
);

select * from finish();
rollback;
