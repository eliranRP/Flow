-- FLOW-102 review. undo kind overhead_project takes a company id. Another company's
-- token cannot undo this company's overhead project; the owner still can.
-- Invented data only.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('out_owner', 'out-owner@example.com');
  perform tests.create_supabase_user('out_other', 'out-other@example.com');
end
$users$;

create temp table out_ref (label text primary key, id uuid);
grant all on out_ref to authenticated;

select tests.authenticate_as('out_owner');
select public.create_company('Example Undo Owner LLC', true);
select public.upsert_project(null, 'Office', null, 'active');
insert into out_ref (label, id) select 'co', id from public.companies where name = 'Example Undo Owner LLC';
insert into out_ref (label, id) select 'office', id from public.projects where name = 'Office';

select tests.authenticate_as('out_other');
select public.create_company('Example Undo Other LLC', true);
select public.upsert_project(null, 'Other Office', null, 'active');
insert into out_ref (label, id) select 'co_other', id from public.companies where name = 'Example Undo Other LLC';
insert into out_ref (label, id) select 'other_office', id from public.projects where name = 'Other Office';

reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('out_owner'), 'hash-out-owner-0001', array['read','write'], now() + interval '90 days', 'pepper-out'
);
insert into out_ref (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-out-owner-0001';
select public.store_mcp_credential(
  tests.get_supabase_uid('out_other'), 'hash-out-other-0001', array['read','write'], now() + interval '90 days', 'pepper-out2'
);
insert into out_ref (label, id) select 'tok_other', id from private.mcp_credentials where token_hash = 'hash-out-other-0001';

create function pg_temp.as_mcp(u text, tok text) returns void
language sql
as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claim.sub', tests.get_supabase_uid(u)::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', tests.get_supabase_uid(u), 'role', 'authenticated',
      'mcp_tid', (select id from out_ref where label = tok))::text,
    true
  );
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated;

select pg_temp.as_mcp('out_owner', 'tok');
select public.mcp_set_overhead_project('out-set', (select id from out_ref where label = 'office'));

-- The other company sets its own overhead project, so it has an undo row of its own.
select pg_temp.as_mcp('out_other', 'tok_other');
select public.mcp_set_overhead_project('out-other-set', (select id from out_ref where label = 'other_office'));

select is(
  public.mcp_undo('out-cross', 'overhead_project', (select id from out_ref where label = 'co'))->'error'->>'code',
  'not_found',
  'another company cannot undo this company''s overhead project'
);

reset role;
select is(
  (select overhead_project_id from public.companies where id = (select id from out_ref where label = 'co')),
  (select id from out_ref where label = 'office'),
  'the owner''s overhead project is unchanged'
);
select is(
  (select overhead_project_id from public.companies where id = (select id from out_ref where label = 'co_other')),
  (select id from out_ref where label = 'other_office'),
  'the other company''s own setting is unchanged'
);

select pg_temp.as_mcp('out_owner', 'tok');
select is(
  public.mcp_undo('out-own', 'overhead_project', (select id from out_ref where label = 'co'))->'ok',
  'true'::jsonb,
  'the owner can undo their own overhead project (positive control)'
);
reset role;
select is(
  (select overhead_project_id from public.companies where id = (select id from out_ref where label = 'co')),
  null::uuid,
  'the owner''s undo cleared it'
);

select * from finish();
rollback;
