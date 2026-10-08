-- FLOW-205 undo follow-ups: undo of a created project or category that a review row or a
-- reassign undo still points at is a conflict, and a hide the app reversed can be re-hidden
-- or undone. Invented data only. Emails use @example.com.

begin;

select plan(14);

select tests.create_supabase_user('muf_owner', 'muf-owner@example.com');

create temp table muf (label text primary key, id uuid);
grant all on muf to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.muf where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select tests.authenticate_as('muf_owner');
select public.create_company('Example Undo Followups Co', true);
reset role;
insert into muf (label, id) select 'company', id from public.companies where name = 'Example Undo Followups Co';

select public.store_mcp_credential(
  tests.get_supabase_uid('muf_owner'), 'hash-muf-write-01', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into muf (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-muf-write-01';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := tests.get_supabase_uid('muf_owner');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'mcp_tid', pg_temp.id('write'))::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
insert into muf (label, id) select 'p_review', (public.mcp_create_project('muf-p1', 'Example Review Project')->'data'->>'id')::uuid;
insert into muf (label, id) select 'p_shares', (public.mcp_create_project('muf-p2', 'Example Shares Project')->'data'->>'id')::uuid;
insert into muf (label, id) select 'p_free', (public.mcp_create_project('muf-p3', 'Example Free Project')->'data'->>'id')::uuid;
insert into muf (label, id) select 'c_reassign', (public.mcp_create_category('muf-c1', 'Example Reassign Cat', 'expense')->'data'->>'id')::uuid;
insert into muf (label, id) select 'c_review', (public.mcp_create_category('muf-c2', 'Example Review Cat', 'expense')->'data'->>'id')::uuid;
insert into muf (label, id) select 'c_hide', (public.mcp_create_category('muf-c3', 'Example Hide Cat', 'expense')->'data'->>'id')::uuid;
insert into muf (label, id) select 'c_hide2', (public.mcp_create_category('muf-c4', 'Example Hide Cat Two', 'expense')->'data'->>'id')::uuid;
reset role;

insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
values (pg_temp.id('company'), 'expense', 'expense', 'posted', -1000, -1000, 1000, 0, 'unknown',
  '2026-06-01', 'ILS', 'manual', 'muf:line', 'Example line');
insert into muf (label, id) select 'line', id from public.transactions where idempotency_key = 'muf:line';

-- Resolved review rows and a reassign undo row that would restore the created ids.
insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at,
  prior_project_id, prior_category_id, prior_allocations)
values
  (pg_temp.id('company'), pg_temp.id('line'), 'approved', 'missing_project', now(),
    pg_temp.id('p_review'), pg_temp.id('c_review'), '[]'::jsonb),
  (pg_temp.id('company'), pg_temp.id('line'), 'changed', 'missing_project', now(),
    null, null, jsonb_build_array(jsonb_build_object('project_id', pg_temp.id('p_shares'), 'share_bp', 10000, 'amount_net', -1000)));
insert into public.reassign_undo (company_id, transaction_id, prior_category_id, prior_user_assigned, prior_allocations)
values (pg_temp.id('company'), pg_temp.id('line'), pg_temp.id('c_reassign'), false, '[]'::jsonb);

select pg_temp.as_mcp();
select is(public.mcp_undo('muf-u1', 'project', pg_temp.id('p_review'))->'error'->>'code', 'conflict',
  'a project a review row would restore is not removed');
select is(public.mcp_undo('muf-u2', 'project', pg_temp.id('p_shares'))->'error'->>'code', 'conflict',
  'nor one in a review row''s prior shares');
select is(public.mcp_undo('muf-u3', 'category', pg_temp.id('c_reassign'))->'error'->>'code', 'conflict',
  'a category a reassign undo would restore is not removed');
select is(public.mcp_undo('muf-u4', 'category', pg_temp.id('c_review'))->'error'->>'code', 'conflict',
  'nor one a review row would restore');
select is(public.mcp_undo('muf-u5', 'project', pg_temp.id('p_free'))->>'ok', 'true',
  'a project nothing points at is removed');

-- A hide the app reversed.
select is(public.mcp_hide_category('muf-h1', pg_temp.id('c_hide'))->>'ok', 'true', 'hide a category');
reset role;
update public.categories set hidden = false where id = pg_temp.id('c_hide');
select pg_temp.as_mcp();
select is(public.mcp_hide_category('muf-h2', pg_temp.id('c_hide'))->>'ok', 'true', 'the MCP hides it again after the app unhid it');
reset role;
select is((select hidden from public.categories where id = pg_temp.id('c_hide')), true, 'it is hidden');
select is(
  (select count(*)::integer from private.mcp_writes where kind = 'category_hidden' and category_id = pg_temp.id('c_hide') and undone_at is null),
  1, 'one undoable hide write');
select pg_temp.as_mcp();
select is(public.mcp_undo('muf-h3', 'category_hidden', pg_temp.id('c_hide'))->>'ok', 'true', 'undo the hide');
reset role;
select is((select hidden from public.categories where id = pg_temp.id('c_hide')), false, 'it is shown, as before the first hide');

select pg_temp.as_mcp();
select is(public.mcp_hide_category('muf-h4', pg_temp.id('c_hide2'))->>'ok', 'true', 'hide another category');
reset role;
update public.categories set hidden = false where id = pg_temp.id('c_hide2');
select pg_temp.as_mcp();
select is(public.mcp_undo('muf-h5', 'category_hidden', pg_temp.id('c_hide2'))->>'ok', 'true',
  'undo of a hide the app already reversed succeeds');
reset role;
select is(
  (select count(*)::integer from private.mcp_writes where kind = 'category_hidden' and category_id = pg_temp.id('c_hide2') and undone_at is null),
  0, 'and closes the write');

select * from finish();
rollback;
