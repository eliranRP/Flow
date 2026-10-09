-- FLOW-126. Income that already has a project and only a guess of a kept-out category waits in
-- the review queue (reason suggested) until the guess is confirmed; approving it takes the line
-- out of the P&L. Invented data only. Amounts are agorot.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('koir_owner', 'koir-owner@example.com');
  perform tests.create_supabase_user('koir_other', 'koir-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('koir_owner'), 'Example Queue LLC', false),
  (tests.get_supabase_uid('koir_other'), 'Example Beyond LLC', false);

create temp table koir (label text primary key, id uuid);
grant all on koir to authenticated, service_role;
insert into koir (label, id) select 'co', id from public.companies where name = 'Example Queue LLC';
insert into koir (label, id) select 'other_co', id from public.companies where name = 'Example Beyond LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from koir where label = 'co'), 'East', 'active'),
  ((select id from koir where label = 'other_co'), 'West', 'active');
insert into koir (label, id) select 'east', id from public.projects where name = 'East';
insert into koir (label, id) select 'west', id from public.projects where name = 'West';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from koir where label = 'co'), 'Rent in', 'income', 90, false, false),
  ((select id from koir where label = 'co'), 'Deposit back', 'income', 91, false, true),
  ((select id from koir where label = 'other_co'), 'Deposit back', 'income', 91, false, true);
insert into koir (label, id) select 'cat_rent', id from public.categories
where name = 'Rent in' and company_id = (select id from koir where label = 'co');
insert into koir (label, id) select 'cat_back', id from public.categories
where name = 'Deposit back' and company_id = (select id from koir where label = 'co');
insert into koir (label, id) select 'cat_back_west', id from public.categories
where name = 'Deposit back' and company_id = (select id from koir where label = 'other_co');

-- Connector income lines, all posted in June.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from koir where label = v.co), 'income', 'invoice_receipt', 'posted', 'ILS',
  v.amount, v.amount, v.amount, 0, 'source', '2026-06-10', '2026-06-10', 'sumit', v.ikey,
  (select id from koir where label = v.project),
  (select id from koir where label = v.cat),
  v.ikey
from (values
  ('co',       5000, 'koir:guess_proj', 'east', 'cat_back'),
  ('co',       6000, 'koir:kept_proj',  'east', 'cat_back'),
  ('co',       7000, 'koir:rent_guess', 'east', 'cat_rent'),
  ('co',       8000, 'koir:guess_none', null,   'cat_back'),
  ('other_co', 9000, 'koir:guess_west', 'west', 'cat_back_west')
) as v(co, amount, ikey, project, cat);
insert into koir (label, id) select replace(idempotency_key, 'koir:', 'txn_'), id
from public.transactions where idempotency_key like 'koir:%';

-- Every line but the confirmed one carries a guessed category.
update public.transactions
set category_suggested = true
where id in (
  select id from koir where label in ('txn_guess_proj', 'txn_rent_guess', 'txn_guess_none', 'txn_guess_west')
);

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.koir where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.open_reason(p_label text)
returns text
language sql
as $$
  select coalesce(max(q.reason), case when count(*) > 0 then 'open' else 'none' end)
  from public.review_queue q
  where q.transaction_id = pg_temp.id(p_label) and q.status = 'open';
$$;
grant execute on function pg_temp.open_reason(text) to authenticated, service_role;

create or replace function pg_temp.sync(p_label text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.sync_review_queue(pg_temp.id(p_label));
end;
$$;
grant execute on function pg_temp.sync(text) to service_role;

create or replace function pg_temp.income(p_basis text)
returns bigint
language sql
as $$
  select (public.get_project(pg_temp.id('east'), p_basis)->>'income_agorot')::bigint;
$$;
grant execute on function pg_temp.income(text) to authenticated, service_role;

select is(
  (select count(*)::integer from public.transactions
   where id in (pg_temp.id('txn_guess_proj'), pg_temp.id('txn_rent_guess'), pg_temp.id('txn_guess_none'))
     and category_suggested),
  3,
  'setup: three of the company''s lines are guesses'
);

-- Before review the guess counts: rent 7000 + guessed deposit 5000; the confirmed 6000 is out.
select tests.authenticate_as('koir_owner');
select is(pg_temp.income('cash'), 12000::bigint, 'cash: the guessed kept-out income counts in the project');
select is(pg_temp.income('invoiced'), 12000::bigint, 'invoiced: same');
reset role;

set local role service_role;
select pg_temp.sync('co');
reset role;

select is(pg_temp.open_reason('txn_guess_proj'), 'suggested',
  'a project''s income with a guessed kept-out category waits for review');
select is(pg_temp.open_reason('txn_kept_proj'), 'none',
  'a confirmed kept-out category is not queued');
select is(pg_temp.open_reason('txn_rent_guess'), 'none',
  'a guessed in-P&L category on a project''s income is not queued');
select is(pg_temp.open_reason('txn_guess_none'), 'missing_category',
  'income with no project and a guessed category waits as missing_category (FLOW-121, FLOW-309)');
select is(pg_temp.open_reason('txn_guess_west'), 'none',
  'cross-tenant: another company''s line is not queued by this company''s sync');

-- Positive control: the other company's own sync queues its line.
set local role service_role;
select pg_temp.sync('other_co');
reset role;
select is(pg_temp.open_reason('txn_guess_west'), 'suggested',
  'positive control: the other company''s sync queues its own line');

-- Approving the guess confirms the category and takes the line out.
select tests.authenticate_as('koir_owner');
select lives_ok(
  format(
    'select public.resolve_review(%L, ''approved'', %L, %L)',
    (select q.id from public.review_queue q
     where q.transaction_id = pg_temp.id('txn_guess_proj') and q.status = 'open'),
    pg_temp.id('east'),
    pg_temp.id('cat_back')
  ),
  'the owner approves the guessed category'
);
select is(pg_temp.income('cash'), 7000::bigint, 'cash: after approval only the rent counts');
select is(pg_temp.income('invoiced'), 7000::bigint, 'invoiced: same');
reset role;

select is(
  (select row(t.category_suggested, t.project_id = pg_temp.id('east'))::text
   from public.transactions t where t.id = pg_temp.id('txn_guess_proj')),
  '(f,t)',
  'the approved line is confirmed and keeps its project'
);

set local role service_role;
select pg_temp.sync('co');
reset role;
select is(pg_temp.open_reason('txn_guess_proj'), 'none',
  'a later sync does not queue the confirmed line again');

select * from finish();
rollback;
