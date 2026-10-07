-- FLOW-311. MCP split_line: validation, scope, happy path, replay, undo, conflict, cross-tenant.
-- Invented data only. Amounts are cents.

begin;

select plan(27);

do $users$
begin
  perform tests.create_supabase_user('msl_owner', 'msl-owner@example.com');
  perform tests.create_supabase_user('msl_other', 'msl-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('msl_owner'), 'Example Line LLC', false),
  (tests.get_supabase_uid('msl_other'), 'Example Neighbor LLC', false);

create temp table msl (label text primary key, id uuid);
grant all on msl to authenticated, service_role;
insert into msl (label, id) select 'co', id from public.companies where name = 'Example Line LLC';
insert into msl (label, id) select 'other_co', id from public.companies where name = 'Example Neighbor LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from msl where label = 'co'), 'East', 'active'),
  ((select id from msl where label = 'co'), 'West', 'active');
insert into msl (label, id) select lower(name), id from public.projects where name in ('East', 'West');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values
  ((select id from msl where label = 'co'), 'Repairs', 'expense', 90, false),
  ((select id from msl where label = 'co'), 'Supplies', 'expense', 91, false);
insert into msl (label, id) select lower(name), id from public.categories where name in ('Repairs', 'Supplies');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
values
  ((select id from msl where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
   -10000, -10000, 10000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'msl:bill',
   (select id from msl where label = 'east'), (select id from msl where label = 'repairs'), 'msl:bill', false, true),
  ((select id from msl where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
   -5000, -5000, 5000, 0, 'source', '2026-06-11', '2026-06-11', 'manual', 'msl:review',
   (select id from msl where label = 'east'), null, 'msl:review', false, false),
  ((select id from msl where label = 'other_co'), 'expense', 'expense', 'project', 'posted', 'USD',
   -10000, -10000, 10000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'msl:foreign',
   null, null, 'msl:foreign', false, false);
insert into msl (label, id) select replace(idempotency_key, 'msl:', 'txn_'), id
from public.transactions where idempotency_key like 'msl:%';

insert into public.review_queue (company_id, transaction_id, status, reason)
values ((select id from msl where label = 'co'), (select id from msl where label = 'txn_review'), 'open', 'missing_category');
insert into msl (label, id) select 'review', id from public.review_queue
where transaction_id = (select id from msl where label = 'txn_review');

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('msl_owner'), (select id from msl where label = 'co'), 'hash-msl-write', 'kid', array['write']::text[], '2099-01-01'),
  (tests.get_supabase_uid('msl_owner'), (select id from msl where label = 'co'), 'hash-msl-read', 'kid', array['read']::text[], '2099-01-01');
insert into msl (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-msl-write';
insert into msl (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-msl-read';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('msl_owner');
  tid uuid;
begin
  select id into tid from pg_temp.msl where label = p_label;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create function pg_temp.parts(p_east bigint, p_west bigint) returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('category_id', (select id from msl where label = 'repairs'),
      'project_id', (select id from msl where label = 'east'), 'amount_minor', p_east),
    jsonb_build_object('category_id', (select id from msl where label = 'supplies'),
      'project_id', (select id from msl where label = 'west'), 'amount_minor', p_west)
  )
$$;
grant execute on function pg_temp.parts(bigint, bigint) to authenticated, service_role;

select pg_temp.as_mcp('read');
select is(
  public.mcp_split_line('k-read', (select id from msl where label = 'txn_bill'), pg_temp.parts(4000, 6000)) -> 'error' ->> 'code',
  'forbidden', 'a read token cannot split');

select pg_temp.as_mcp('write');
select is(
  public.mcp_split_line('k-one', (select id from msl where label = 'txn_bill'), '[{"category_id": "00000000-0000-4000-8000-000000000000", "amount_minor": 1}]'::jsonb) -> 'error' ->> 'code',
  'validation', 'one part is validation');
select is(
  public.mcp_split_line('k-key', (select id from msl where label = 'txn_bill'),
    jsonb_build_array(pg_temp.parts(4000, 6000) -> 0 || '{"share": 1}'::jsonb, pg_temp.parts(4000, 6000) -> 1)) -> 'error' ->> 'code',
  'validation', 'an unknown key is validation');
select is(
  public.mcp_split_line('k-sum', (select id from msl where label = 'txn_bill'), pg_temp.parts(4000, 5999)) -> 'error' ->> 'message',
  'parts must sum to the line', 'parts that miss the line by a cent are refused with a reason');
select is(
  public.mcp_split_line('k-foreign', (select id from msl where label = 'txn_foreign'), pg_temp.parts(4000, 6000)) -> 'error' ->> 'message',
  'transaction not found', 'another company''s line is not found');
select is(
  public.mcp_split_line('k-review-id', (select id from msl where label = 'review'), pg_temp.parts(4000, 6000)) -> 'error' ->> 'message',
  'id is not a transaction; list_review.id is the review id', 'a review id is explained');
select is(
  public.mcp_split_line('k-open', (select id from msl where label = 'txn_review'), pg_temp.parts(2000, 3000)) -> 'error' ->> 'message',
  'line has an open review', 'a line with an open review is refused');
select is((select count(*)::integer from public.line_splits), 0, 'no refused call wrote parts');

-- Happy path.
select is(
  public.mcp_split_line('k-1', (select id from msl where label = 'txn_bill'), pg_temp.parts(4000, 6000)),
  jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'transaction_id', (select id from msl where label = 'txn_bill'),
    'parts', pg_temp.parts(4000, 6000),
    'undo_kind', 'line_split',
    'id', (select id from msl where label = 'txn_bill'))),
  'the split returns its parts and undo kind');
select is(
  (select jsonb_build_array(user_assigned, category_suggested) from public.transactions where id = (select id from msl where label = 'txn_bill')),
  '[true, false]'::jsonb, 'the line is no longer a suggestion');
select is(
  public.mcp_split_line('k-1', (select id from msl where label = 'txn_bill'), pg_temp.parts(4000, 6000)) -> 'data' ->> 'undo_kind',
  'line_split', 'replay returns the stored response');
select is(
  public.mcp_split_line('k-1', (select id from msl where label = 'txn_bill'), pg_temp.parts(5000, 5000)) -> 'error' ->> 'code',
  'conflict', 'the same key with other parts is a conflict');
select is((select count(*)::integer from public.line_splits), 2, 'the replay wrote nothing more');

select is(
  (select jsonb_agg(x ->> 'amount_minor' order by x ->> 'amount_minor') from jsonb_array_elements(
    public.get_line_split((select id from msl where label = 'txn_bill')) -> 'parts') x),
  '["4000", "6000"]'::jsonb, 'get_line_split lists the parts');
select is(
  public.get_line_split((select id from msl where label = 'txn_bill')) ->> 'parts_match',
  'true', 'and they match the line');
select is(public.get_line_split((select id from msl where label = 'txn_foreign')), null, 'get_line_split hides another company''s line');

-- A second split, then undo twice: back to the first, then to none.
select is(
  public.mcp_split_line('k-2', (select id from msl where label = 'txn_bill'), pg_temp.parts(1, 9999)) -> 'ok',
  'true'::jsonb, 'a second split replaces the parts');
select is(
  public.mcp_undo('u-1', 'line_split', (select id from msl where label = 'txn_bill')) -> 'ok',
  'true'::jsonb, 'undo the second split');
select is(public.get_line_split((select id from msl where label = 'txn_bill')) -> 'parts' -> 0 ->> 'amount_minor', '4000',
  'the first split is back');
select is(
  public.mcp_undo('u-2', 'line_split', (select id from msl where label = 'txn_bill')) -> 'ok',
  'true'::jsonb, 'undo the first split');
select is(public.get_line_split((select id from msl where label = 'txn_bill')) -> 'parts', '[]'::jsonb, 'no parts remain');
select is(
  (select jsonb_build_array(user_assigned, category_suggested) from public.transactions where id = (select id from msl where label = 'txn_bill')),
  '[false, false]'::jsonb, 'undo restores the line''s own assignment flags');
select is(
  public.mcp_undo('u-3', 'line_split', (select id from msl where label = 'txn_bill')) -> 'error' ->> 'code',
  'not_found', 'nothing is left to undo');

-- Undo refuses once the parts changed outside this write.
select is(
  public.mcp_split_line('k-3', (select id from msl where label = 'txn_bill'), pg_temp.parts(4000, 6000)) -> 'ok',
  'true'::jsonb, 'split again');
select tests.authenticate_as('msl_owner');
select lives_ok($$select public.save_line_split((select id from msl where label = 'txn_bill'), pg_temp.parts(3000, 7000))$$,
  'the owner changes the parts in the app');
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('u-4', 'line_split', (select id from msl where label = 'txn_bill')) -> 'error' ->> 'code',
  'conflict', 'undo after a later change is a conflict');
select is(public.get_line_split((select id from msl where label = 'txn_bill')) -> 'parts' -> 0 ->> 'amount_minor', '3000',
  'and leaves the owner''s parts');

select * from finish();
rollback;
