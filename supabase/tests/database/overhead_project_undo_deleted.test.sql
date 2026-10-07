-- FLOW-116. Undo kind overhead_project returns conflict, like the other undo kinds, when the
-- project it would go back to has been deleted since. Invented data only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('oud_owner', 'oud-owner@example.com');
end
$users$;

create temp table oud_ref (label text primary key, id uuid);
grant all on oud_ref to authenticated;

select tests.authenticate_as('oud_owner');
select public.create_company('Example Undo Deleted LLC', true);
select public.upsert_project(null, 'Office A', null, 'active');
select public.upsert_project(null, 'Office B', null, 'active');
insert into oud_ref (label, id) select 'co', id from public.companies where name = 'Example Undo Deleted LLC';
insert into oud_ref (label, id) select 'a', id from public.projects where name = 'Office A';
insert into oud_ref (label, id) select 'b', id from public.projects where name = 'Office B';

reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('oud_owner'), 'hash-oud-owner-0001', array['read','write'], now() + interval '90 days', 'pepper-oud'
);
insert into oud_ref (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-oud-owner-0001';

create function pg_temp.as_mcp() returns void
language sql
as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claim.sub', tests.get_supabase_uid('oud_owner')::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', tests.get_supabase_uid('oud_owner'), 'role', 'authenticated',
      'mcp_tid', (select id from oud_ref where label = 'tok'))::text,
    true
  );
$$;
grant execute on function pg_temp.as_mcp() to authenticated;

-- Every write in this test shares one now(), and undo takes the newest write. Age the
-- earlier writes after each one, so the newest is the one undo should find.
create function pg_temp.age_writes() returns void
language sql
as $$
  update private.mcp_writes set created_at = created_at - interval '1 minute'
  where user_id = tests.get_supabase_uid('oud_owner');
$$;

-- Case 1: A, then B. A is deleted. Undoing B would go back to A.
select pg_temp.as_mcp();
select public.mcp_set_overhead_project('oud-set-a', (select id from oud_ref where label = 'a'));
reset role;
select pg_temp.age_writes();
select pg_temp.as_mcp();
select public.mcp_set_overhead_project('oud-set-b', (select id from oud_ref where label = 'b'));
reset role;
select pg_temp.age_writes();
select pg_temp.as_mcp();
reset role;
delete from public.projects where id = (select id from oud_ref where label = 'a');

select pg_temp.as_mcp();
select is(
  public.mcp_undo('oud-undo-1', 'overhead_project', (select id from oud_ref where label = 'co'))->'error'->>'code',
  'conflict',
  'undo back to a deleted project is a conflict'
);
reset role;
select is(
  (select overhead_project_id from public.companies where id = (select id from oud_ref where label = 'co')),
  (select id from oud_ref where label = 'b'),
  'the current overhead project is unchanged'
);

-- Case 2: B, then cleared. B is deleted. Undoing the clear would go back to B.
select pg_temp.as_mcp();
select public.mcp_set_overhead_project('oud-clear', null);
reset role;
select pg_temp.age_writes();
select pg_temp.as_mcp();
reset role;
delete from public.projects where id = (select id from oud_ref where label = 'b');

select pg_temp.as_mcp();
select is(
  public.mcp_undo('oud-undo-2', 'overhead_project', (select id from oud_ref where label = 'co'))->'error'->>'code',
  'conflict',
  'undoing a clear back to a deleted project is a conflict, not refused'
);
reset role;
select is(
  (select overhead_project_id from public.companies where id = (select id from oud_ref where label = 'co')),
  null::uuid,
  'the setting stays cleared'
);

-- Positive control: a live project still undoes.
insert into public.projects (company_id, name, status)
select (select id from oud_ref where label = 'co'), 'Office C', 'active';
insert into oud_ref (label, id) select 'c', id from public.projects where name = 'Office C';
select pg_temp.as_mcp();
select public.mcp_set_overhead_project('oud-set-c', (select id from oud_ref where label = 'c'));
reset role;
select pg_temp.age_writes();
select pg_temp.as_mcp();
select public.mcp_set_overhead_project('oud-clear-c', null);
reset role;
select pg_temp.age_writes();
select pg_temp.as_mcp();
select is(
  public.mcp_undo('oud-undo-3', 'overhead_project', (select id from oud_ref where label = 'co'))->'ok',
  'true'::jsonb,
  'undo back to a live project still works (positive control)'
);
reset role;
select is(
  (select overhead_project_id from public.companies where id = (select id from oud_ref where label = 'co')),
  (select id from oud_ref where label = 'c'),
  'the undo restored the live project'
);

select * from finish();
rollback;
