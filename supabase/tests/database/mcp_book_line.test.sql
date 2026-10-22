-- FLOW-948 (decision 0208). public.mcp_book_line: a balanced set of legs writes the equivalent
-- legacy rows so the unchanged pnl_lines reflects it, and the derived legs project back to the
-- request. Unbalanced legs are refused; a leg on another company's account is refused; the write
-- is idempotent and undoable. FLOW-953: a kept-out category leg books, kept out of the P&L; a VAT leg is
-- refused. Invented data only. USD amounts are cents.

begin;
select plan(26);

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
insert into bl select 'a_vat', id from public.accounts where company_id=(select id from bl where label='co') and name='VAT control';
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

-- 6. Its income/expense legs project to the request (Repairs -5000, Closing -3000), read as the owner.
reset role;
select is(
  (select sum(-l.amount_minor) from public.legs l join public.accounts a on a.id = l.account_id
   where a.type in ('income', 'expense')
     and l.transaction_id=(select id from public.transactions where description='A split bill'))::bigint,
  -8000::bigint, 'the split booking projects to -8000 total');
set local role authenticated;

-- 6b. A single category leg with NO project of its own + a top-level project_id: the booked line
-- lands in that project (not overhead), and reconciles. (The RPC's 7th arg is p_project_id.)
select ok((public.mcp_book_line('k7', '2026-06-10', 'expense', 'USD', 'Top project bill',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -2000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 2000)
  ), (select id from bl where label='south')))->>'ok' = 'true', 'a single-category booking honors the top-level project_id');
select is(
  (select t.project_id from public.transactions t where t.description='Top project bill' and t.source='manual' limit 1),
  (select id from bl where label='south'), 'the booked line lands in the top-level project, not overhead');
select is(
  (select l.project_id from public.legs l join public.transactions t on t.id=l.transaction_id
   join public.accounts a on a.id=l.account_id
   where t.description='Top project bill' and a.category_id=(select id from public.categories where company_id=(select id from bl where label='co') and name='Repairs') limit 1),
  (select id from bl where label='south'), 'the category leg carries the top-level project');

-- 6c. FLOW-950: a new line with gross-up legs. A Repairs cost and its contra credit on North, and a
-- Rent credit on a payment (an income item netting the payment): credits share the bank leg's sign, so
-- they are gross-up parts; the debit is a normal part.
select ok((public.mcp_book_line('k8', '2026-06-12', 'expense', 'USD', 'Gross-up bill',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -6000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'project_id', (select id from bl where label='north'), 'amount_minor', 9000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'project_id', (select id from bl where label='north'), 'amount_minor', -2000),
    jsonb_build_object('account_id', (select id from bl where label='a_rent'), 'project_id', (select id from bl where label='south'), 'amount_minor', -1000)
  )))->>'ok' = 'true', 'a new line with a contra credit and an income credit is booked');
select is(
  (select string_agg(c.name || ':' || s.amount_minor || ':' || s.gross_up, ' ' order by s.ordinal)
   from public.line_splits s join public.categories c on c.id = s.category_id
   join public.transactions t on t.id = s.transaction_id where t.description = 'Gross-up bill'),
  'Repairs:9000:false Repairs:2000:true Rent:1000:true', 'the credits are gross-up parts, the debit a normal part');
select is(
  (select string_agg(c.name || ':' || l.amount_net, ' ' order by c.name)
   from private.pnl_lines l join public.categories c on c.id = l.category_id
   join public.transactions t on t.id = l.transaction_id where t.description = 'Gross-up bill'),
  'Rent:1000 Repairs:-9000 Repairs:2000', 'the P&L nets Repairs to -7000 and counts Rent +1000');
select is(public.mcp_book_line('k9', '2026-06-12', 'expense', 'USD', 'Wrong kind',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -1000),
    jsonb_build_object('account_id', (select id from bl where label='a_rent'), 'project_id', (select id from bl where label='south'), 'amount_minor', 1000)
  ))->'error'->>'message', 'category kind must match the direction', 'one category leg of the other kind is refused');

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

-- 10. FLOW-953: a kept-out (excluded) category leg books, as a whole line kept out of the P&L.
select is(public.mcp_book_line('k6', '2026-06-10', 'expense', 'USD', 'Kept out',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_draw'), 'amount_minor', 5000)
  ))->>'ok', 'true', 'a kept-out category leg books');
select is(
  (select l.in_pnl::text || '/' || l.amount_net from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id where t.description = 'Kept out' and t.source = 'manual'),
  'false/-5000', 'the kept-out booking stays out of the P&L');

-- 10b. The specific refusal reasons surface so an AI caller can self-correct (FLOW-948); a
-- cross-company account stays generic so it does not leak whether that account exists.
select is(public.mcp_book_line('m1', '2026-06-10', 'expense', 'USD', 'Unbalanced2',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 4000)
  ))->'error'->>'message', 'legs do not balance', 'the balance reason surfaces');
select is(public.mcp_book_line('m2', '2026-06-10', 'expense', 'USD', 'NoBank2',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 5000),
    jsonb_build_object('account_id', (select id from bl where label='a_closing'), 'amount_minor', -5000)
  ))->'error'->>'message', 'exactly one bank leg is required', 'the bank-leg reason surfaces');
select is(public.mcp_book_line('m3', '2026-06-10', 'expense', 'USD', 'Vat2',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 4000),
    jsonb_build_object('account_id', (select id from bl where label='a_vat'), 'amount_minor', 1000)
  ))->'error'->>'message', 'book_line: a VAT leg is a later phase', 'the VAT reason surfaces');
select is(public.mcp_book_line('m4', '2026-06-10', 'expense', 'USD', 'Xco2',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from bl where label='a_other_bank'), 'amount_minor', -5000),
    jsonb_build_object('account_id', (select id from bl where label='a_repairs'), 'amount_minor', 5000)
  ))->'error'->>'message', 'The write was refused.', 'a cross-company account stays generic (no existence leak)');

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
