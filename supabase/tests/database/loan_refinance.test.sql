-- FLOW-962 (decision 0214): a loan closed for a refinance names the loan that replaced it.
-- loans.refinanced_into_id is another loan of the same company; set_loan_refinance names or clears
-- it with an undo; list_loans shows it; deleting the new loan clears it. Invented figures. Fixed
-- dates. @example.com only.

begin;

select plan(15);

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

insert into f962 (label, id) values
  ('old', pg_temp.add_demand('f962-old')),
  ('new', pg_temp.add_demand('f962-new')),
  ('newer', pg_temp.add_demand('f962-newer')),
  ('foreign', pg_temp.add_demand('f962-foreign', 'f962_other', 'other_write'));

-- Validation and refusals.
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

-- A change since the write is a conflict.
select ok((pg_temp.refi('f962-link-2', pg_temp.id('old'), pg_temp.id('newer'))->>'ok')::boolean, 'link again');
update public.loans set refinanced_into_id = pg_temp.id('new') where id = pg_temp.id('old');
select is(pg_temp.undo('f962-undo-stale', pg_temp.id('old'))->'error'->>'code', 'conflict', 'undo is a conflict once the link changed since');
update public.loans set refinanced_into_id = pg_temp.id('newer') where id = pg_temp.id('old');

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
