-- FLOW-325 follow-up (decision 0138): MCP undo of line_split does not bring back a reversal
-- part with no project on a line the owner has since put in the P&L. Invented data only.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('lsu_owner', 'lsu-owner@example.com');
end
$users$;

create temp table lsu (label text primary key, id uuid);
grant all on lsu to authenticated, service_role;

insert into lsu (label, id) values ('co', tests.fixture_company('lsu_owner', 'Example Undo Check LLC'));
insert into lsu (label, id) values
  ('alpha', tests.fixture_project((select id from lsu where label = 'co'), 'Alpha')),
  ('sales', tests.fixture_category((select id from lsu where label = 'co'), 'Sales', 'income')),
  ('draws', tests.fixture_category((select id from lsu where label = 'co'), 'Owner draws', 'expense', true));
insert into lsu (label, id) values ('refund', tests.fixture_line(
  (select id from lsu where label = 'co'), 'lsu:refund', 10000, 'income',
  (select id from lsu where label = 'alpha'), (select id from lsu where label = 'sales')));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.lsu where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.parts()
returns text
language sql
as $$
  select string_agg((s.project_id is not null)::text || ':' || s.amount_minor, ',' order by s.ordinal)
  from public.line_splits s where s.transaction_id = pg_temp.id('refund');
$$;
grant execute on function pg_temp.parts() to authenticated, service_role;

select public.store_mcp_credential(tests.get_supabase_uid('lsu_owner'), 'hash-lsu-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into lsu (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-lsu-write01';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('lsu_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('write'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

do $$ begin perform pg_temp.as_mcp(); end $$;

-- A: the draw part on no project (allowed: kept out). B: the same part on Alpha.
select is(public.mcp_split_line('lsu-a', pg_temp.id('refund'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('draws'), 'amount_minor', 3000), jsonb_build_object('rest', true)))->>'ok',
  'true', 'split A: a kept-out reversal part with no project');
select is(public.mcp_split_line('lsu-b', pg_temp.id('refund'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('draws'), 'project_id', pg_temp.id('alpha'), 'amount_minor', 3000),
  jsonb_build_object('rest', true)))->>'ok',
  'true', 'split B: the same part on Alpha');
select is(public.mcp_set_line_pnl('lsu-p', pg_temp.id('refund'), true)->>'ok', 'true',
  'the line goes into the P&L: no part lacks a project now');

select is(public.mcp_undo('lsu-u1', 'line_split', pg_temp.id('refund'))->'error'->>'code', 'conflict',
  'undo of split B would bring back the part with no project on a line in the P&L: conflict');
select is(pg_temp.parts(), 'true:3000,false:7000', 'split B stays');

-- Back to following the category: the same undo now goes through.
select is(public.mcp_undo('lsu-u2', 'line_pnl', pg_temp.id('refund'))->>'ok', 'true',
  'the P&L choice is undone');
select is(public.mcp_undo('lsu-u3', 'line_split', pg_temp.id('refund'))->>'ok', 'true',
  'now undo of split B puts split A back');
select is(pg_temp.parts(), 'false:3000,false:7000', 'split A, with the draw on no project');
select is(public.mcp_set_line_pnl('lsu-p2', pg_temp.id('refund'), true)->'error'->>'message',
  'a reversal part needs a project', 'and the line cannot go into the P&L while it has that part');

reset role;

select * from finish();
rollback;
