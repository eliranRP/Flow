-- FLOW-124 / FLOW-125 (server parts). The list reads return each row's source and kept_out, and
-- get_transaction returns pnl_state: in, out, or mixed for a line split with one part kept out.
-- Invented data only. Amounts are agorot.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('lso_owner', 'lso-owner@example.com');
  perform tests.create_supabase_user('lso_viewer', 'lso-viewer@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lso_owner'), 'Example Line State LLC', true);

create temp table lso (label text primary key, id uuid);
grant all on lso to authenticated, service_role;
insert into lso (label, id) select 'co', id from public.companies where name = 'Example Line State LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from lso where label = 'co'), 'Harbor', 'active'),
  ((select id from lso where label = 'co'), 'Pier', 'active');
insert into lso (label, id) select lower(name), id from public.projects
where company_id = (select id from lso where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from lso where label = 'co'), 'Materials', 'expense', 90, false, false),
  ((select id from lso where label = 'co'), 'Owner draw', 'expense', 91, false, true);
insert into lso (label, id) select 'materials', id from public.categories
where name = 'Materials' and company_id = (select id from lso where label = 'co');
insert into lso (label, id) select 'draw', id from public.categories
where name = 'Owner draw' and company_id = (select id from lso where label = 'co');

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_assigned, category_suggested, pnl_role
)
select
  (select id from lso where label = 'co'), 'expense', 'receipt', v.status::public.line_status, 'ILS',
  v.amount, v.amount, v.amount, 0, 'source', '2026-06-10', '2026-06-10', v.source::public.txn_source, v.ikey,
  (select id from lso where label = 'harbor'), (select id from lso where label = v.category), v.ikey,
  not v.guess, not v.guess, v.guess, 'project'
from (values
  (5000, 'lso:in', 'materials', 'posted', 'sumit', false),
  (6000, 'lso:out', 'draw', 'posted', 'sumit', false),
  (7000, 'lso:taken_out', 'materials', 'posted', 'manual', false),
  (4000, 'lso:split', 'materials', 'posted', 'sumit', false),
  (3000, 'lso:guess', 'draw', 'pending', 'sumit', true),
  (2000, 'lso:waiting_out', 'draw', 'posted', 'manual', false)
) as v(amount, ikey, category, status, source, guess);
insert into lso (label, id) select replace(idempotency_key, 'lso:', 'txn_'), id
from public.transactions where idempotency_key like 'lso:%';
-- A guess is set after insert, as a sync leaves it.
update public.transactions set category_suggested = true where id = (select id from lso where label = 'txn_guess');
update public.transactions set in_pnl_override = false where id = (select id from lso where label = 'txn_taken_out');

-- The split line: 1500 on Harbor in the kept-out category, 2500 on Pier in the P&L.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select (select id from lso where label = 'co'), (select id from lso where label = 'txn_split'), v.ordinal,
  (select id from lso where label = v.category), (select id from lso where label = v.project), v.amount
from (values (1, 'draw', 'harbor', 1500), (2, 'materials', 'pier', 2500)) as v(ordinal, category, project, amount);

insert into public.review_queue (company_id, transaction_id, status, reason)
values ((select id from lso where label = 'co'), (select id from lso where label = 'txn_waiting_out'), 'open', 'suggested');

insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('lso_viewer'), (select id from lso where label = 'co'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.lso where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The row for one line in a list of rows.
create or replace function pg_temp.row_of(p_rows jsonb, p_label text)
returns jsonb
language sql
as $$
  select r from jsonb_array_elements(p_rows) r
  where coalesce(r->>'transaction_id', r->>'id') = pg_temp.id(p_label)::text
  limit 1;
$$;
grant execute on function pg_temp.row_of(jsonb, text) to authenticated, service_role;

select tests.authenticate_as('lso_owner');

-- get_transaction: pnl_state.
select is(public.get_transaction(pg_temp.id('txn_in'))->>'pnl_state', 'in', 'a line in the P&L is in');
select is(public.get_transaction(pg_temp.id('txn_out'))->>'pnl_state', 'out', 'a line in a kept-out category is out');
select is(public.get_transaction(pg_temp.id('txn_taken_out'))->>'pnl_state', 'out', 'a line the owner took out is out');
select is(public.get_transaction(pg_temp.id('txn_split'))->>'pnl_state', 'mixed', 'a split line with one part kept out is mixed');
select is(public.get_transaction(pg_temp.id('txn_guess'))->>'pnl_state', 'in',
  'a pending line with a guessed kept-out category still counts, as in_pnl says');
select is(
  (public.get_transaction(pg_temp.id('txn_split'))->>'in_pnl')::boolean, true,
  'in_pnl is as it was');

-- list_project_category: the parts on that project and category.
select is(
  pg_temp.row_of(public.list_project_category(pg_temp.id('harbor'), pg_temp.id('materials'))->'rows', 'txn_in')
    - 'id' - 'description' - 'doc_date' - 'amount_net',
  '{"source": "sumit", "kept_out": false}'::jsonb,
  'list_project_category: a counted row has its source and is not kept out');
select is(
  (pg_temp.row_of(public.list_project_category(pg_temp.id('harbor'), pg_temp.id('draw'))->'rows', 'txn_out')->>'kept_out')::boolean,
  true, 'list_project_category: a row in a kept-out category is kept out');
select is(
  (pg_temp.row_of(public.list_project_category(pg_temp.id('harbor'), pg_temp.id('draw'))->'rows', 'txn_split')->>'kept_out')::boolean,
  true, 'list_project_category: the kept-out part of a split line is kept out');
select is(
  (pg_temp.row_of(public.list_project_category(pg_temp.id('pier'), pg_temp.id('materials'))->'rows', 'txn_split')->>'kept_out')::boolean,
  false, 'list_project_category: its counted part on another project is not');

-- get_breakdown_lines: each row is a part already in or out.
select is(
  pg_temp.row_of(public.get_breakdown_lines('expense', 'category', pg_temp.id('materials')::text, 'ILS', '2026-06-01', '2026-06-30')->'rows', 'txn_in')->>'source',
  'sumit', 'get_breakdown_lines: a row has its source');
select is(
  (pg_temp.row_of(public.get_breakdown_lines('expense', 'category', pg_temp.id('materials')::text, 'ILS', '2026-06-01', '2026-06-30')->'rows', 'txn_split')->>'kept_out')::boolean,
  false, 'get_breakdown_lines: a counted row is not kept out, even on a mixed line');
select is(
  (pg_temp.row_of(public.get_breakdown_lines('expense', 'category', null, 'ILS', '2026-06-01', '2026-06-30', 'cash', true)->'rows', 'txn_split')->>'kept_out')::boolean,
  true, 'get_breakdown_lines: a row in the kept-out list is kept out');

-- project_waiting: the review row and the guessed line.
select is(
  pg_temp.row_of(public.project_waiting(pg_temp.id('harbor')), 'txn_waiting_out') ->> 'source',
  'manual', 'project_waiting: a waiting row has its source');
select is(
  (pg_temp.row_of(public.project_waiting(pg_temp.id('harbor')), 'txn_waiting_out')->>'kept_out')::boolean,
  true, 'project_waiting: a waiting row in a kept-out category is kept out');
select is(
  (pg_temp.row_of(public.project_waiting(pg_temp.id('harbor')), 'txn_guess')->>'kept_out')::boolean,
  false, 'project_waiting: a guessed line that still counts is not kept out');

-- list_review.
select is(
  (pg_temp.row_of(public.list_review(), 'txn_waiting_out')->>'kept_out')::boolean,
  true, 'list_review: a line in a kept-out category is kept out');
select is(
  pg_temp.row_of(public.list_review(), 'txn_waiting_out')->>'source',
  'manual', 'list_review: the source is still there');

-- list_auto_assigned_today: connector lines filed today.
select is(
  pg_temp.row_of(public.list_auto_assigned_today(), 'txn_in') - 'id' - 'description' - 'doc_date' - 'amount_net'
    - 'amount_original' - 'currency' - 'line_status' - 'direction' - 'supplier_name' - 'project_name' - 'category_name',
  '{"source": "sumit", "kept_out": false}'::jsonb,
  'list_auto_assigned_today: a counted row has its source and is not kept out');
select is(
  (pg_temp.row_of(public.list_auto_assigned_today(), 'txn_out')->>'kept_out')::boolean,
  true, 'list_auto_assigned_today: a kept-out row is kept out');
select is(
  (pg_temp.row_of(public.list_auto_assigned_today(), 'txn_split')->>'kept_out')::boolean,
  false, 'list_auto_assigned_today: a mixed line is not kept out as a whole');

-- A viewer reads the same.
select tests.authenticate_as('lso_viewer');
select is(public.get_transaction(pg_temp.id('txn_split'))->>'pnl_state', 'mixed', 'a viewer reads pnl_state');
select is(
  (pg_temp.row_of(public.list_review(), 'txn_waiting_out')->>'kept_out')::boolean,
  true, 'a viewer reads kept_out in the review list');
select is(
  (pg_temp.row_of(public.project_waiting(pg_temp.id('harbor')), 'txn_waiting_out')->>'kept_out')::boolean,
  true, 'a viewer reads kept_out on a project''s waiting rows');

select * from finish();
rollback;
