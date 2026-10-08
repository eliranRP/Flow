-- FLOW-124 / FLOW-125 (server parts). The list reads return each row's source and kept_out, and
-- get_transaction returns pnl_state: in, out, or mixed for a line split with one part kept out.
-- Invented data only. Amounts are agorot.

begin;

select plan(32);

do $users$
begin
  perform tests.create_supabase_user('lso_owner', 'lso-owner@example.com');
  perform tests.create_supabase_user('lso_viewer', 'lso-viewer@example.com');
  perform tests.create_supabase_user('lso_stranger', 'lso-stranger@example.com');
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

-- A shared line split by category, allocated whole to Harbor: 1000 kept out, 2000 counted.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description,
  user_assigned, category_assigned, category_suggested, pnl_role
)
values (
  (select id from lso where label = 'co'), 'expense', 'receipt', 'posted', 'ILS',
  3000, 3000, 3000, 0, 'source', '2026-06-12', '2026-06-12', 'manual', 'lso:shared',
  (select id from lso where label = 'materials'), 'lso:shared', true, true, false, 'shared'
);
insert into lso (label, id) select 'txn_shared', id from public.transactions where idempotency_key = 'lso:shared';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values ((select id from lso where label = 'co'), (select id from lso where label = 'txn_shared'),
  (select id from lso where label = 'harbor'), 10000, 3000);
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select (select id from lso where label = 'co'), (select id from lso where label = 'txn_shared'), v.ordinal,
  (select id from lso where label = v.category), null, v.amount
from (values (1, 'draw', 1000), (2, 'materials', 2000)) as v(ordinal, category, amount);

-- A loan payment counted by its parts (the company's loan-part categories): interest and escrow
-- count, the principal is kept out.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from lso where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS');
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
values (
  (select id from lso where label = 'co'), 'expense', 'expense', null, 'posted', 'ILS',
  -100000, -100000, 100000, 0, 'source', '2026-06-12', '2026-06-12', 'manual', 'lso:loan',
  (select id from lso where label = 'materials'), 'lso:loan', true
);
insert into lso (label, id) select 'txn_loan', id from public.transactions where idempotency_key = 'lso:loan';
insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select
  (select id from lso where label = 'co'), l.id, (select id from lso where label = 'txn_loan'),
  v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k where k.company_id = l.company_id and k.loan_part = v.part::public.loan_split_part),
  false
from public.loans l
cross join (values
  ('interest', 70000),
  ('escrow', 20000),
  ('principal', 10000)
) as v(part, amount)
where l.company_id = (select id from lso where label = 'co');

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

-- A shared split line, in the drill-down of a project it is allocated to.
select is(
  (pg_temp.row_of(public.list_project_category(pg_temp.id('harbor'), pg_temp.id('draw'))->'rows', 'txn_shared')->>'kept_out')::boolean,
  true, 'list_project_category: the kept-out part of a shared split line is kept out');
select is(
  (pg_temp.row_of(public.list_project_category(pg_temp.id('harbor'), pg_temp.id('materials'))->'rows', 'txn_shared')->>'kept_out')::boolean,
  false, 'list_project_category: its counted part is not');

-- A loan payment counted by its parts.
select is(public.get_transaction(pg_temp.id('txn_loan'))->>'pnl_state', 'mixed',
  'a loan payment counted by its parts, the principal kept out, is mixed');
select is((public.get_transaction(pg_temp.id('txn_loan'))->>'pnl_fixed')::boolean, true,
  'and pnl_fixed says it is a loan line');

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

-- The set read list_review uses gives each line the same state as the one-line read
-- (the list_review speed fix, decision 0155).
select is(
  (select jsonb_object_agg(st.transaction_id, st.state) from private.line_pnl_states(
    array(select id from lso where label like 'txn_%')) st),
  (select jsonb_object_agg(l.id, private.line_pnl_state(l.id)) from lso l where l.label like 'txn_%'),
  'line_pnl_states matches line_pnl_state on every line'
);
select is(
  (select count(*)::int from private.line_pnl_states(array(select id from lso where label like 'txn_%'))),
  (select count(*)::int from lso where label like 'txn_%'),
  'and answers once per line'
);

-- Another company reads none of these lines, now that the state reads skip row security.
select tests.authenticate_as('lso_stranger');
select lives_ok($$select public.create_company('Example Stranger LLC', true)$$, 'a stranger has a company of their own');
select is(
  (select count(*)::int from private.line_pnl_states(array(select id from lso where label like 'txn_%')))
    + (select count(private.line_pnl_state(l.id))::int from lso l where l.label like 'txn_%'),
  0,
  'and reads no state for another company''s lines'
);

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
