-- FLOW-963: reassign_recurring_charge moves every payment of a recurring charge to a project or a
-- category, the earlier ones too; undo_reassign_recurring_charge takes it back, all or none, and refuses
-- once a line changed since; the MCP write is a batch that undo_batch takes back. Invented data only.
-- Amounts are agorot.

begin;

set constraints all immediate;

select plan(40);

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
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Example Cedar')),
  ('foreign_project', tests.fixture_project(pg_temp.id('co_b'), 'Example Foreign')),
  ('water', tests.fixture_category(pg_temp.id('co'), 'Example Water')),
  ('power', tests.fixture_category(pg_temp.id('co'), 'Example Power')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example Rent', 'income'));

insert into public.suppliers (company_id, name) values
  (pg_temp.id('co'), 'Example Utility'), (pg_temp.id('co'), 'Example Other'), (pg_temp.id('co'), 'Example Servicer');
insert into rc (label, id)
select case s.name when 'Example Utility' then 'utility' when 'Example Other' then 'other' else 'servicer' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- The utility: one charge (Oak). Monthly water bills, one from 2023 (older than the stream's 24 months),
-- one in USD (another charge), one removed, one with no category, one split into parts, one waiting for
-- its split, one shared; and another supplier's bill.
insert into rc (label, id) values
  ('w_08', tests.fixture_line(pg_temp.id('co'), 'rc:w08', 12000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-08-05')),
  ('w_09', tests.fixture_line(pg_temp.id('co'), 'rc:w09', 12500, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-09-05')),
  ('w_10', tests.fixture_line(pg_temp.id('co'), 'rc:w10', 13000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-05')),
  ('w_old', tests.fixture_line(pg_temp.id('co'), 'rc:wold', 9000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2023-05-05')),
  ('w_usd', tests.fixture_line(pg_temp.id('co'), 'rc:wusd', 900, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-06', 'USD')),
  ('w_gone', tests.fixture_line(pg_temp.id('co'), 'rc:wgone', 900, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-07')),
  ('w_nocat', tests.fixture_line(pg_temp.id('co'), 'rc:wnocat', 12000, 'expense', pg_temp.id('oak'), null, '2026-06-05')),
  ('w_split', tests.fixture_line(pg_temp.id('co'), 'rc:wsplit', 900, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-05-05')),
  ('w_unalloc', tests.fixture_line(pg_temp.id('co'), 'rc:wunalloc', 900, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-04-05')),
  ('w_shared', tests.fixture_line(pg_temp.id('co'), 'rc:wshared', 900, 'expense', null, pg_temp.id('water'), '2026-07-05', p_pnl_role => 'shared')),
  ('o_10', tests.fixture_line(pg_temp.id('co'), 'rc:o10', 4000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-08'));
update public.transactions set supplier_id = pg_temp.id('utility')
where idempotency_key like 'rc:w%';
update public.transactions set supplier_id = pg_temp.id('other') where id = pg_temp.id('o_10');
update public.transactions set removed_at = now() where id = pg_temp.id('w_gone');
select tests.line_split(pg_temp.id('w_split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('water'), 'project_id', pg_temp.id('oak'), 'amount_minor', 500),
  jsonb_build_object('category_id', pg_temp.id('power'), 'project_id', pg_temp.id('oak'), 'amount_minor', 400)));
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('co'), pg_temp.id('w_unalloc'), 'open', 'unallocated_shared');

-- The servicer: split by project (decision 0185), a charge for Oak and one for Elm. Oak has a bill from
-- 2023 and an unfiled bill whose amount joins it.
insert into rc (label, id) values
  ('s_oak_1', tests.fixture_line(pg_temp.id('co'), 'rc:s1', 20000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-09-10')),
  ('s_oak_2', tests.fixture_line(pg_temp.id('co'), 'rc:s2', 20000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2026-10-10')),
  ('s_oak_old', tests.fixture_line(pg_temp.id('co'), 'rc:sold', 20000, 'expense', pg_temp.id('oak'), pg_temp.id('water'), '2023-03-10')),
  ('s_unfiled', tests.fixture_line(pg_temp.id('co'), 'rc:sunf', 19900, 'expense', null, pg_temp.id('water'), '2026-08-10')),
  ('s_elm', tests.fixture_line(pg_temp.id('co'), 'rc:selm', 5000, 'expense', pg_temp.id('elm'), pg_temp.id('water'), '2026-10-12'));
update public.transactions set supplier_id = pg_temp.id('servicer') where idempotency_key like 'rc:s%';

select tests.authenticate_as('rc_owner');

create temp table rc_out (label text primary key, r jsonb);
grant all on rc_out to anon, authenticated, service_role;
create or replace function pg_temp.undo_ids(p_label text)
returns uuid[]
language sql
as $$ select array(select jsonb_array_elements_text(r->'undo_ids')::uuid from pg_temp.rc_out where label = p_label); $$;
grant execute on function pg_temp.undo_ids(text) to anon, authenticated, service_role;
create or replace function pg_temp.on_project(p_project text, variadic p_lines text[])
returns int
language sql
as $$ select count(*)::int from public.transactions where id in (select pg_temp.id(l) from unnest(p_lines) l) and project_id = pg_temp.id(p_project); $$;
grant execute on function pg_temp.on_project(text, text[]) to anon, authenticated, service_role;

-- 1-7. A project pick on a charge of one project moves every bill, the 2023 one too, and skips the rest.
insert into rc_out select 'proj', public.reassign_recurring_charge('expense', pg_temp.id('utility'), 'ILS', pg_temp.id('oak'), pg_temp.id('elm'), null);
select is((select (r->>'changed')::int from rc_out where label = 'proj'), 4, 'the four bills of the charge change, the 2023 one too');
select is((select (r->>'skipped')::int from rc_out where label = 'proj'), 4, 'no category, split into parts, waiting for its split and shared are skipped');
select is((select r->>'split' from rc_out where label = 'proj'), 'false', 'the server says the party has one charge');
select is(pg_temp.on_project('elm', 'w_08', 'w_09', 'w_10', 'w_old'), 4, 'every bill is on the picked project');
select is(
  (select count(*)::int from public.allocations where transaction_id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10'), pg_temp.id('w_old')) and project_id = pg_temp.id('elm')),
  4, 'their allocations follow the project'
);
select is((select category_id from public.transactions where id = pg_temp.id('w_10')), pg_temp.id('water'), 'a project pick keeps each bill''s category');
select is(pg_temp.on_project('oak', 'w_usd', 'o_10', 'w_nocat', 'w_split', 'w_unalloc'), 5,
  'another currency, another supplier and the skipped bills stay');

-- 8-10. A line changed since the pick makes the undo a conflict, and nothing is undone.
select lives_ok(format('select public.set_transaction_category(%L, %L)', pg_temp.id('w_10'), pg_temp.id('power')), 'a later change to one bill');
select throws_ok(format('select public.undo_reassign_recurring_charge(%L::uuid[])', pg_temp.undo_ids('proj')), 'conflict', 'the undo refuses once a bill changed since');
select is(pg_temp.on_project('elm', 'w_08', 'w_09', 'w_10', 'w_old'), 4, 'and undoes none of them');

-- 11-16. An undo with an id it cannot undo (undone last) undoes nothing; the right ids put every bill back.
select lives_ok(format('select public.set_transaction_category(%L, %L)', pg_temp.id('w_10'), pg_temp.id('water')), 'the bill is as the pick left it again');
select throws_ok(
  format('select public.undo_reassign_recurring_charge(%L::uuid[])', pg_temp.id('w_08') || pg_temp.undo_ids('proj')),
  'undo not found', 'an id that is no undo is refused'
);
select is(pg_temp.on_project('elm', 'w_08', 'w_09', 'w_10', 'w_old'), 4, 'all or none: nothing was undone');
select lives_ok(format('select public.undo_reassign_recurring_charge(%L::uuid[])', pg_temp.undo_ids('proj')), 'the undo runs');
select is(pg_temp.on_project('oak', 'w_08', 'w_09', 'w_10', 'w_old'), 4, 'the undo puts every bill back on its project');
select throws_ok(format('select public.undo_reassign_recurring_charge(%L::uuid[])', pg_temp.undo_ids('proj')), 'undo not found', 'an undone pick cannot be undone again');

-- 17-21. A category pick changes the category of every bill (the one with none too) and keeps the project;
-- its undo puts each category back; the same pick twice changes nothing the second time.
insert into rc_out select 'cat', public.reassign_recurring_charge('expense', pg_temp.id('utility'), 'ILS', null, null, pg_temp.id('power'));
select is((select (r->>'changed')::int from rc_out where label = 'cat'), 5, 'a category pick changes the five bills');
select ok(
  (select bool_and(category_id = pg_temp.id('power') and project_id = pg_temp.id('oak'))
   from public.transactions where id in (pg_temp.id('w_08'), pg_temp.id('w_09'), pg_temp.id('w_10'), pg_temp.id('w_old'), pg_temp.id('w_nocat'))),
  'each bill takes the category and keeps its project'
);
select is(
  (public.reassign_recurring_charge('expense', pg_temp.id('utility'), 'ILS', null, null, pg_temp.id('power'))->>'changed')::int,
  0, 'picking the category the charge already has changes nothing'
);
select lives_ok(format('select public.undo_reassign_recurring_charge(%L::uuid[])', pg_temp.undo_ids('cat')), 'the category undo runs');
select ok(
  (select bool_and(category_id = pg_temp.id('water')) from public.transactions where id in (pg_temp.id('w_08'), pg_temp.id('w_10'), pg_temp.id('w_old')))
  and (select category_id is null from public.transactions where id = pg_temp.id('w_nocat')),
  'every bill has its own category back, and the one with none has none'
);

-- 22-27. A split party: the server needs the charge's project, and moves that charge's bills (filed there
-- at any date, and the unfiled one the stream joins to it), not the other charge's.
select throws_ok(
  format('select public.reassign_recurring_charge(''expense'', %L, ''ILS'', null, %L, null)', pg_temp.id('servicer'), pg_temp.id('cedar')),
  'validation', 'a split party names its charge'
);
select throws_ok(
  format('select public.reassign_recurring_charge(''expense'', %L, ''ILS'', %L, %L, null)', pg_temp.id('servicer'), pg_temp.id('cedar'), pg_temp.id('elm')),
  'validation', 'a project that is not one of its charges is refused'
);
insert into rc_out select 'split', public.reassign_recurring_charge('expense', pg_temp.id('servicer'), 'ILS', pg_temp.id('oak'), pg_temp.id('cedar'), null);
select is((select (r->>'changed')::int from rc_out where label = 'split'), 4, 'the Oak charge''s four bills change');
select is((select r->>'split' from rc_out where label = 'split'), 'true', 'the server says the party is split');
select is(pg_temp.on_project('cedar', 's_oak_1', 's_oak_2', 's_oak_old', 's_unfiled'), 4, 'its bills from 2023 and unfiled move too');
select is(pg_temp.on_project('elm', 's_elm'), 1, 'the Elm charge stays');
select throws_ok(
  format('select public.reassign_recurring_charge(''expense'', %L, ''ILS'', %L, %L, null)', pg_temp.id('utility'), pg_temp.id('elm'), pg_temp.id('cedar')),
  'validation', 'a party with one charge refuses another project as its charge'
);

-- 29-32. Refusals: an income category on an expense charge, another company's project, no pick, a bad direction.
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

-- 33-34. Another company's owner, with a project of its own and this company's party, moves nothing.
select tests.authenticate_as('rc_other');
select is(
  (public.reassign_recurring_charge('expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('foreign_project'), null)->>'changed')::int,
  0, 'another company''s owner finds no payment of this company''s party'
);
reset role;
select is(pg_temp.on_project('oak', 'w_08', 'w_09', 'w_10', 'w_old'), 4, 'and this company''s bills stay');

-- 35-40. The MCP write: one batch row per changed bill, undo_batch takes it back, a retry replays.
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
insert into rc_out select 'mcp', public.mcp_reassign_recurring_charge('rc-1', 'expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('elm'), null);
select is((select r->'data'->>'changed' from rc_out where label = 'mcp'), '4', 'the MCP write changes the four bills');
select is((select jsonb_array_length(r->'data'->'results') from rc_out where label = 'mcp'), 4, 'with one result row each');
select is(
  public.mcp_reassign_recurring_charge('rc-1', 'expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('elm'), null),
  (select r from rc_out where label = 'mcp'),
  'a retry with the same key replays'
);
select is(
  public.mcp_reassign_recurring_charge('rc-2', 'expense', pg_temp.id('utility'), 'ILS', null, pg_temp.id('foreign_project'), null)->'error'->>'code',
  'refused', 'another company''s project is refused in the envelope'
);
select is(
  (public.mcp_undo_batch('rc-undo', (select r->'data'->>'batch_key' from rc_out where label = 'mcp'))->'data'->>'ok_count'),
  '4', 'undo_batch takes every bill back'
);
select is(pg_temp.on_project('oak', 'w_08', 'w_09', 'w_10', 'w_old'), 4, 'every bill is on its project again');

select * from finish();
rollback;
