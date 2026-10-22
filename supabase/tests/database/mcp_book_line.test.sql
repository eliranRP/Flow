-- FLOW-948 (decision 0208). public.mcp_book_line: a balanced set of legs writes the equivalent
-- legacy rows so the unchanged pnl_lines reflects it, and the derived legs project back to the
-- request. Unbalanced legs are refused; a leg on another company's account is refused; the write
-- is idempotent and undoable. Invented data only. USD amounts are cents.

begin;
select plan(14);

do $u$ begin
  perform tests.create_supabase_user('bl_owner', 'bl-owner@example.com');
  perform tests.create_supabase_user('bl_other', 'bl-other@example.com');
end $u$;

insert into public.companies (owner_id, name, is_demo) values
  (tests.get_supabase_uid('bl_owner'), 'Book LLC', false),
  (tests.get_supabase_uid('bl_other'), 'Other LLC', false);

create temp table bl (label text primary key, id uuid);
grant all on bl to authenticated, service_role;
insert into bl select 'co', id from public.companies where name = 'Book LLC';
insert into bl select 'other_co', id from public.companies where name = 'Other LLC';

insert into public.projects (company_id, name, status)
select (select id from bl where label='co'), v.n, 'active' from (values ('North'),('South')) v(n);
insert into bl select lower(name), id from public.projects where company_id = (select id from bl where label='co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl) values
  ((select id from bl where label='co'), 'Repairs', 'expense', 90, false, false),
  ((select id from bl where label='co'), 'Closing', 'expense', 91, false, false),
  ((select id from bl where label='co'), 'Rent', 'income', 92, false, false),
  ((select id from bl where label='co'), 'Draw', 'expense', 93, false, true);
insert into public.categories (company_id, name, kind, sort_order, is_default) values
  ((select id from bl where label='other_co'), 'Foreign', 'expense', 90, false);

insert into bl select 'a_repairs', id from public.accounts where company_id=(select id from bl where label='co') and name='Repairs';
insert into bl select 'a_closing', id from public.accounts where company_id=(select id from bl where label='co') and name='Closing';
insert into bl select 'a_rent', id from public.accounts where company_id=(select id from bl where label='co') and name='Rent';
insert into bl select 'a_draw', id from public.accounts where company_id=(select id from bl where label='co') and name='Draw';
insert into bl select 'a_bank', id from public.accounts where company_id=(select id from bl where label='co') and name='Bank/Clearing';
insert into bl select 'a_other_bank', id from public.accounts where company_id=(select id from bl where label='other_co') and name='Bank/Clearing';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('bl_owner'), (select id from bl where label='co'), 'hash-bl-write', 'kid', array['write']::text[], '2099-01-01');
insert into bl select 'write', id from private.mcp_credentials where token_hash='hash-bl-write';

create or replace function pg_temp.as_mcp(p_label text) returns void language plpgsql set search_path='' as $$
declare uid uuid := tests.get_supabase_uid('bl_owner'); tid uuid;
begin
  select id into tid from pg_temp.bl where label=p_label;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','aal','aal1','mcp_tid',tid)::text, true);
end $$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

set local role authenticated;
select pg_temp.as_mcp('write');

-- 1. A single-category payment of 5000 (expense): bank -5000, Repairs +5000.
select ok((public.mcp_book_line('k1', '2026-06-10', 'expense', 'USD', 'A repair bill',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'project_id', (select id from bl where label='north'), 'amount_minor', 5000)
  )))->>'ok' = 'true', 'a balanced single-category payment is booked');

-- 2. It created a legacy transaction that pnl_lines shows as -5000 under Repairs/North.
select is(
  (select l.amount_net from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.company_id=(select id from bl where label='co') and t.source='manual' and t.description='A repair bill'
     and l.category_id=(select id from public.categories where company_id=(select id from bl where label='co') and name='Repairs') limit 1),
  -5000::bigint, 'pnl_lines reflects the booked line as -5000 under Repairs');

-- 3. The derived legs balance and project back to the request.
select is(
  (select sum(l.amount_minor) from public.legs l
   join public.transactions t on t.id=l.transaction_id
   where t.description='A repair bill')::bigint, 0::bigint, 'the booked line''s legs balance to 0');

-- 4. A two-category split deposit... actually a split payment: bank -8000, Repairs 5000 North + Closing 3000 South.
select ok((public.mcp_book_line('k2', '2026-06-11', 'expense', 'USD', 'A split bill',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -8000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'project_id', (select id from bl where label='north'), 'amount_minor', 5000),
    jsonb_build_object('account_id', (select id from bl where label='a_closing'), 'project_id', (select id from bl where label='south'), 'amount_minor', 3000)
  )))->>'ok' = 'true', 'a balanced split payment is booked as line_splits');

-- 5. The split created two line_splits.
select is(
  (select count(*) from public.line_splits s
   join public.transactions t on t.id=s.transaction_id where t.description='A split bill')::bigint,
  2::bigint, 'the split booking created two line_splits');

-- 6. Its projection matches the request (Repairs -5000, Closing -3000).
select is(
  (select sum(amount_net) from private.legs_pnl_projection((select id from bl where label='co')) p
   where p.transaction_id=(select id from public.transactions where description='A split bill'))::bigint,
  -8000::bigint, 'the split booking projects to -8000 total');

-- 7. Unbalanced legs are refused.
select is(public.mcp_book_line('k3', '2026-06-10', 'expense', 'USD', 'Unbalanced',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 4000)
  ))->>'ok', 'false', 'unbalanced legs are refused');

-- 8. A leg on another company's account is refused (no cross-company booking).
select is(public.mcp_book_line('k4', '2026-06-10', 'expense', 'USD', 'Cross company',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_other_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 5000)
  ))->>'ok', 'false', 'a leg on another company''s account is refused');

-- 9. No bank leg is refused.
select is(public.mcp_book_line('k5', '2026-06-10', 'expense', 'USD', 'No bank',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 5000),
    jsonb_build_object('account_id', (select id from bl where label='a_closing'), 'amount_minor', -5000)
  ))->>'ok', 'false', 'a booking with no bank leg is refused');

-- 10. Booking a kept-out (excluded) category leg is refused in phase-1 (no invented behavior).
select is(public.mcp_book_line('k6', '2026-06-10', 'expense', 'USD', 'Kept out',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_draw'), 'amount_minor', 5000)
  ))->>'ok', 'false', 'an excluded-category booking is refused in phase-1');

-- 11. Idempotency: the same key replays the first result, no second line.
select is(public.mcp_book_line('k1', '2026-06-10', 'expense', 'USD', 'A repair bill',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'project_id', (select id from bl where label='north'), 'amount_minor', 5000)
  ))->'data'->>'id',
  (select t.id::text from public.transactions t where t.description='A repair bill' and t.source='manual' limit 1),
  'the same idempotency key replays the first booking');
select is(
  (select count(*) from public.transactions where description='A repair bill' and source='manual')::bigint,
  1::bigint, 'the replay did not create a second line');

-- 12. Undo removes the booked line and its legs.
select ok(public.mcp_undo('u1', 'book_line',
  (select id from public.transactions where description='A split bill' and source='manual'))->>'ok' = 'true',
  'book_line undo succeeds');
select is(
  (select count(*) from public.transactions where description='A split bill' and removed_at is null)::bigint,
  0::bigint, 'undo removed the booked split line');

select finish();
rollback;
