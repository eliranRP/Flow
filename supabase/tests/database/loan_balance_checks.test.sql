-- FLOW-123: the app split balance check locks the loan, a line that starts to count against
-- a loan past its balance is flagged for review, and a principal edit below what was paid is
-- refused. Fixed dates. @example.com only.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('f123_owner', 'owner123@example.com');
end
$users$;

create temp table f123 (label text primary key, id uuid);
grant all on f123 to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('f123_owner');
  select id into tid from pg_temp.f123 where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

-- A line with the given status and amount, split by the app (as the owner) into
-- interest 0, escrow 0 and the whole amount as principal.
create or replace function pg_temp.app_split_line(p_key text, p_status text, p_amount bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  select c.id, 'expense', 'expense', p_status::public.line_status, -p_amount, -p_amount, p_amount, 0, 'unknown',
    '2026-02-01', 'USD', 'manual', p_key, 'Example loan payment'
  from pg_temp.f123 c where c.label = 'company';

  perform tests.authenticate_as('f123_owner');
  insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
  select t.company_id, (select id from pg_temp.f123 where label = 'loan'), t.id, v.part::public.loan_split_part,
    v.amount, v.amount, c.id
  from public.transactions t
  cross join (values
    ('interest', 'ריבית משכנתא', 0::bigint),
    ('escrow', 'מסים וביטוח', 0::bigint),
    ('principal', 'תשלומי הלוואה', p_amount)
  ) as v(part, category, amount)
  join public.categories c on c.company_id = t.company_id and c.name = v.category and c.kind = 'expense'
  where t.idempotency_key = p_key;
  set constraints all immediate;
  set constraints all deferred;
  reset role;
end;
$$;
grant execute on function pg_temp.app_split_line(text, text, bigint) to authenticated, service_role;

create or replace function pg_temp.balance()
returns bigint
language sql
set search_path = ''
as $$
  select b.balance_minor from public.loan_balances b where b.loan_id = (select id from pg_temp.f123 where label = 'loan');
$$;

create or replace function pg_temp.flagged(p_key text)
returns bigint
language sql
set search_path = ''
as $$
  select count(*) from public.loan_splits s
  join public.transactions t on t.id = s.transaction_id
  where t.idempotency_key = p_key and s.needs_review;
$$;
grant execute on function pg_temp.balance() to authenticated, service_role;
grant execute on function pg_temp.flagged(text) to authenticated, service_role;

select tests.authenticate_as('f123_owner');
select public.create_company('Example Loan Balance Co', true);
reset role;
insert into f123 (label, id) select 'company', id from public.companies where name = 'Example Loan Balance Co';

select public.store_mcp_credential(
  tests.get_supabase_uid('f123_owner'), 'hash-f123-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f123 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f123-write-1';

-- 100,000.00 at 6 percent: month-one interest is 500.00, the payment 1,000.00.
select pg_temp.as_mcp('write');
insert into f123 (label, id)
select 'loan', (
  public.mcp_add_loan('f123-add', 'Example Bank', 10000000, 60000, 360, '2026-01-01'::date, 100000, 10000, 'USD')->'data'->>'id'
)::uuid;
reset role;

-- 1. The app split check locks the loan, like the MCP attach path.

select ok(
  pg_get_functiondef('private.loan_splits_check(uuid)'::regprocedure) ~* 'from public\.loans l where l\.id = loan for update',
  'loan_splits_check locks the loan before the balance check'
);

-- 2. A pending line does not count; when it posts past the balance, its parts wait for review.

select pg_temp.app_split_line('f123:paid', 'posted', 6000000);
select pg_temp.app_split_line('f123:pending', 'pending', 5000000);
select is(pg_temp.balance(), 4000000::bigint, 'a pending line does not lower the balance');

update public.transactions set line_status = 'posted' where idempotency_key = 'f123:pending';
select is(pg_temp.flagged('f123:pending'), 3::bigint, 'a line that posts past the balance has every part flagged');
select is(pg_temp.balance(), 4000000::bigint, 'the flagged line does not take the balance below zero');
select is(
  (select b.flagged_parts from public.loan_balances b where b.loan_id = (select id from f123 where label = 'loan')),
  3,
  'loan_balances counts the flagged parts'
);
select is(pg_temp.flagged('f123:paid'), 0::bigint, 'the line already counted is not flagged');

select tests.authenticate_as('f123_owner');
select throws_ok(
  $$
    select public.clear_loan_split_review((select id from public.transactions where idempotency_key = 'f123:pending'));
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_balance',
  'the owner cannot clear the flag while the line is still past the balance'
);
reset role;

-- A line that posts within the balance is not flagged.
select pg_temp.app_split_line('f123:fits', 'pending', 1000000);
update public.transactions set line_status = 'posted' where idempotency_key = 'f123:fits';
select is(pg_temp.flagged('f123:fits'), 0::bigint, 'a line that posts within the balance is not flagged');
select is(pg_temp.balance(), 3000000::bigint, 'and it lowers the balance');

-- An update that touches neither column, or keeps a posted line posted, changes nothing.
update public.transactions set line_status = 'posted', description = 'Example loan payment 2' where idempotency_key = 'f123:fits';
select is(pg_temp.flagged('f123:fits'), 0::bigint, 'a posted line that stays posted is not checked again');

-- 3. A removed line that comes back past the balance is flagged too.

update public.transactions set removed_at = now() where idempotency_key = 'f123:paid';
select is(pg_temp.balance(), 9000000::bigint, 'a removed line no longer counts');
select pg_temp.app_split_line('f123:refill', 'posted', 5000000);
select is(pg_temp.balance(), 4000000::bigint, 'another line takes its place');
update public.transactions set removed_at = null where idempotency_key = 'f123:paid';
select is(pg_temp.flagged('f123:paid'), 3::bigint, 'the line that comes back past the balance has its parts flagged');
select is(pg_temp.balance(), 4000000::bigint, 'the balance stays at or above zero');

-- 4. The principal cannot drop below what was paid (6,000,000 counted now).

select pg_temp.as_mcp('write');
select is(
  public.mcp_update_loan('f123-low', (select id from f123 where label = 'loan'), '{"principal_minor": 5999999}'::jsonb)->'error',
  '{"code": "refused", "message": "loan balance exceeded"}'::jsonb,
  'update_loan refuses a principal below the principal already paid'
);
select is(
  public.mcp_update_loan('f123-exact', (select id from f123 where label = 'loan'), '{"principal_minor": 6000000}'::jsonb)->'data'->>'undo_kind',
  'loan_update',
  'a principal equal to what was paid saves'
);
select is(pg_temp.balance(), 0::bigint, 'the balance is then zero');

-- Undo puts the principal back up, which is always allowed.
select is(
  public.mcp_undo('f123-undo', 'loan_update', (select id from f123 where label = 'loan'))->'data'->>'kind',
  'loan_update',
  'undo of the principal edit raises it back'
);
reset role;

-- An undo that would lower the principal below what was paid since is refused.
select pg_temp.as_mcp('write');
select is(
  public.mcp_update_loan('f123-raise', (select id from f123 where label = 'loan'), '{"principal_minor": 12000000}'::jsonb)->'data'->>'undo_kind',
  'loan_update',
  'the principal is raised'
);
select pg_temp.app_split_line('f123:more', 'posted', 5000000);
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('f123-undo-low', 'loan_update', (select id from f123 where label = 'loan'))->'error',
  '{"code": "refused", "message": "loan balance exceeded"}'::jsonb,
  'undo that would take the principal below what was paid is refused'
);
reset role;
select is(
  (select principal_minor from public.loans where id = (select id from f123 where label = 'loan')),
  12000000::bigint,
  'the refused undo keeps the principal'
);

select throws_ok(
  $$ update public.loans set principal_minor = 1 where id = (select id from f123 where label = 'loan') $$,
  'P0001',
  'loan balance exceeded',
  'a direct update below the paid principal is refused too'
);

select * from finish();

rollback;
