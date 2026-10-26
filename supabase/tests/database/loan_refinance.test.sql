-- FLOW-962 (decision 0214): a loan closed for a refinance names the loan that replaced it.
-- loans.refinanced_into_id is another loan of the same company; set_loan_refinance names or clears
-- it with an undo; list_loans shows it; deleting the new loan clears it. Invented figures. Fixed
-- dates. @example.com only.

begin;

select plan(36);

do $users$
begin
  perform tests.create_supabase_user('f962_owner', 'owner962@example.com');
  perform tests.create_supabase_user('f962_other', 'other962@example.com');
end
$users$;

create temp table f962 (label text primary key, id uuid);
grant all on f962 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f962 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_user text default 'f962_owner', p_token text default 'write')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_token))::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

create or replace function pg_temp.add_demand(p_key text, p_user text default 'f962_owner', p_token text default 'write')
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp(p_user, p_token);
  result := public.mcp_add_loan(
    p_key, 'Example ' || p_key, 5000000, 60000, null, '2026-01-01'::date, null, 0, 'ILS', null, 'demand', null, null
  );
  reset role;
  return (result->'data'->>'id')::uuid;
end;
$$;
grant execute on function pg_temp.add_demand(text, text, text) to authenticated, service_role;

create or replace function pg_temp.refi(p_key text, p_loan uuid, p_new uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_set_loan_refinance(p_key, p_loan, p_new);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.refi(text, uuid, uuid) to authenticated, service_role;

create or replace function pg_temp.undo(p_key text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_undo(p_key, 'loan_refinance', p_id);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.undo(text, uuid) to authenticated, service_role;

create or replace function pg_temp.link_of(p_loan text)
returns uuid
language sql
set search_path = ''
as $$
  select l.refinanced_into_id from public.loans l where l.id = pg_temp.id(p_loan);
$$;
grant execute on function pg_temp.link_of(text) to authenticated, service_role;

create or replace function pg_temp.listed(p_loan text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  select l into result
  from jsonb_array_elements(public.mcp_list_loans()) l
  where l->>'id' = pg_temp.id(p_loan)::text;
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.listed(text) to authenticated, service_role;

select tests.authenticate_as('f962_owner');
select public.create_company('Example Refi Co', true);
reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('f962_owner'), 'hash-f962-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f962 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f962-write-1';

select tests.authenticate_as('f962_other');
select public.create_company('Example Other Refi Co', true);
reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('f962_other'), 'hash-f962-other-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f962 (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-f962-other-1';

create or replace function pg_temp.as_owner(p_sql text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  execute p_sql into result;
  reset role;
  return result;
exception
  when others then
    reset role;
    return jsonb_build_object('raised', sqlerrm);
end;
$$;
grant execute on function pg_temp.as_owner(text) to authenticated, service_role;

create or replace function pg_temp.close_loan(p_loan text)
returns void
language sql
set search_path = ''
as $$
  update public.loans set status = 'closed', closed_on = '2026-06-30' where id = pg_temp.id(p_loan);
$$;
grant execute on function pg_temp.close_loan(text) to authenticated, service_role;

insert into f962 (label, id) values
  ('old', pg_temp.add_demand('f962-old')),
  ('new', pg_temp.add_demand('f962-new')),
  ('newer', pg_temp.add_demand('f962-newer')),
  ('a', pg_temp.add_demand('f962-a')),
  ('b', pg_temp.add_demand('f962-b')),
  ('c', pg_temp.add_demand('f962-c')),
  ('d', pg_temp.add_demand('f962-d')),
  ('foreign', pg_temp.add_demand('f962-foreign', 'f962_other', 'other_write'));

-- Validation and refusals.
select is(pg_temp.refi('f962-open', pg_temp.id('old'), pg_temp.id('new'))->'error'->>'code', 'validation', 'an open loan names no new loan');
select pg_temp.close_loan('old');
select is(pg_temp.refi('f962-self', pg_temp.id('old'), pg_temp.id('old'))->'error'->>'code', 'validation', 'a loan cannot name itself');
select is(pg_temp.refi('f962-foreign', pg_temp.id('old'), pg_temp.id('foreign'))->'error'->>'message', 'loan not found', 'another company''s loan is not found');
select is(pg_temp.refi('f962-missing', gen_random_uuid(), pg_temp.id('new'))->'error'->>'message', 'loan not found', 'a missing loan is not found');
select is(pg_temp.link_of('old'), null, 'nothing was linked');

-- Link, list, undo.
select is(pg_temp.refi('f962-link', pg_temp.id('old'), pg_temp.id('new'))->'data'->>'undo_kind', 'loan_refinance', 'set_loan_refinance links the new loan');
select is(pg_temp.link_of('old'), pg_temp.id('new'), 'the loan stores the link');
select is(pg_temp.listed('old')->>'refinanced_into_id', pg_temp.id('new')::text, 'list_loans shows the link');
select is(
  pg_temp.refi('f962-link', pg_temp.id('old'), pg_temp.id('new'))->'data'->>'refinanced_into_id',
  pg_temp.id('new')::text,
  'a replay returns the stored reply'
);
select is(pg_temp.undo('f962-undo-link', pg_temp.id('old'))->>'ok', 'true', 'undo loan_refinance');
select is(pg_temp.link_of('old'), null, 'undo clears the link it made');

-- Two loans never name each other.
select ok((pg_temp.refi('f962-link-n', pg_temp.id('old'), pg_temp.id('new'))->>'ok')::boolean, 'old names new');
select pg_temp.close_loan('new');
select is(pg_temp.refi('f962-cycle', pg_temp.id('new'), pg_temp.id('old'))->'error'->>'code', 'validation', 'new cannot name old back');

-- A change since the write is a conflict.
select ok((pg_temp.refi('f962-link-2', pg_temp.id('old'), pg_temp.id('newer'))->>'ok')::boolean, 'link again');
update public.loans set refinanced_into_id = pg_temp.id('new') where id = pg_temp.id('old');
select is(pg_temp.undo('f962-undo-stale', pg_temp.id('old'))->'error'->>'code', 'conflict', 'undo is a conflict once the link changed since');
update public.loans set refinanced_into_id = pg_temp.id('newer') where id = pg_temp.id('old');

-- The loan the undo would put back is gone: a conflict, and the link stays.
select ok((pg_temp.as_owner(format('select public.delete_loan(%L)', pg_temp.id('new')))->>'loan_id') is not null, 'the earlier new loan is deleted');
select is(pg_temp.undo('f962-undo-gone', pg_temp.id('old'))->'error'->>'code', 'conflict', 'undo is a conflict when the loan before is gone');
select is(pg_temp.link_of('old'), pg_temp.id('newer'), 'and the link stays');

-- Reopening with update_loan clears the link; its undo puts it back.
select pg_temp.close_loan('a');
update public.loans set refinanced_into_id = pg_temp.id('b') where id = pg_temp.id('a');
select is(
  pg_temp.as_owner(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'f962-reopen', pg_temp.id('a'), '{"status": "open"}'))->>'ok',
  'true',
  'update_loan reopens the loan'
);
select is(pg_temp.link_of('a'), null, 'and clears its link');
select is(
  pg_temp.as_owner(format('select public.mcp_undo(%L, %L, %L)', 'f962-reopen-undo', 'loan_update', pg_temp.id('a')))->>'ok',
  'true',
  'undo loan_update'
);
select is(pg_temp.link_of('a'), pg_temp.id('b'), 'puts the link back with the status');

-- Undoing an edit that left the loan closed never brings back a link cleared since.
select is(
  pg_temp.as_owner(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'f962-rename', pg_temp.id('a'), '{"name": "f962 a renamed"}'))->>'ok',
  'true',
  'update_loan renames the closed loan'
);
update public.loans set refinanced_into_id = null where id = pg_temp.id('a');
select is(
  pg_temp.as_owner(format('select public.mcp_undo(%L, %L, %L)', 'f962-rename-undo', 'loan_update', pg_temp.id('a')))->>'ok',
  'true',
  'undo the rename'
);
select is(pg_temp.link_of('a'), null, 'the link stays cleared');

-- Restore: a new loan deleted since leaves no link.
select ok((pg_temp.as_owner(format('select public.delete_loan(%L)', pg_temp.id('a')))->>'loan_id') is not null, 'a is deleted');
select ok((pg_temp.as_owner(format('select public.delete_loan(%L)', pg_temp.id('b')))->>'loan_id') is not null, 'then b');
select is(pg_temp.as_owner(format('select public.restore_loan(%L)', pg_temp.id('a')))->>'raised', null, 'a comes back');
select is(pg_temp.link_of('a'), null, 'with no link, b being gone');

-- Restore: the loans that named the deleted one get it back while still unlinked.
select pg_temp.close_loan('c');
update public.loans set refinanced_into_id = pg_temp.id('d') where id = pg_temp.id('c');
select ok((pg_temp.as_owner(format('select public.delete_loan(%L)', pg_temp.id('d')))->>'loan_id') is not null, 'd is deleted');
select is(pg_temp.link_of('c'), null, 'which clears c''s link');
select is(pg_temp.as_owner(format('select public.restore_loan(%L)', pg_temp.id('d')))->>'raised', null, 'd comes back');
select is(pg_temp.link_of('c'), pg_temp.id('d'), 'and c names it again');

-- The table holds the rules for the app's writes too.
select throws_ok(
  format('update public.loans set refinanced_into_id = %L where id = %L', pg_temp.id('old'), pg_temp.id('old')),
  '23514', null, 'a loan never names itself'
);
select throws_ok(
  format('update public.loans set refinanced_into_id = %L where id = %L', pg_temp.id('foreign'), pg_temp.id('old')),
  '23503', null, 'nor another company''s loan'
);

-- Deleting the new loan clears the link.
delete from public.loans where id = pg_temp.id('newer');
select is(pg_temp.link_of('old'), null, 'deleting the new loan clears the link');

select * from finish();

rollback;
