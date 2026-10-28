-- FLOW-101 review. ILS split in the category drill-down, a fallback outside the period,
-- and a split that is not three parts yet. Invented data only (ILS agorot).

begin;

select plan(8);

select tests.create_supabase_user('le_owner', 'le-owner@example.com');
select tests.create_supabase_user('le_other', 'le-other@example.com');

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('le_owner'), 'Example Edges Ltd', false),
  (tests.get_supabase_uid('le_other'), 'Example Edges Neighbour Ltd', false);

create temp table le_ref (label text primary key, id uuid);
grant all on le_ref to authenticated, service_role;
insert into le_ref (label, id) select 'co', id from public.companies where name = 'Example Edges Ltd';

insert into public.projects (company_id, name, status)
values ((select id from le_ref where label = 'co'), 'Site One', 'active');
insert into le_ref (label, id) select 'p1', id from public.projects where name = 'Site One';

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from le_ref where label = 'co'), 'Mortgage servicer', 'expense', 50, false);

insert into le_ref (label, id)
select v.label, k.id
from public.categories k
join (values ('own', 'Mortgage servicer'), ('interest', 'ריבית משכנתא')) v(label, name) on v.name = k.name
where k.company_id = (select id from le_ref where label = 'co') and k.kind = 'expense';

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from le_ref where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS');

-- june: a valid split. may: a flagged split a month earlier. partial: only two parts so far.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from le_ref where label = 'co'), 'expense', 'expense', 'project', 'posted', 'ILS',
  -100000, -100000, 100000, 0, 'source', v.d::date, v.d::date, 'manual', v.ikey,
  (select id from le_ref where label = 'p1'), (select id from le_ref where label = 'own'), v.ikey, true
from (values ('june', '2026-06-10'), ('may', '2026-05-10'), ('partial', '2026-06-12')) as v(ikey, d);

select tests.loan_split(t.id, l.id, (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense'),
    'needs_review', v.flagged))
  from (values
    ('june', 'interest', 70000, 'ריבית משכנתא', false),
    ('june', 'escrow', 20000, 'מסים וביטוח', false),
    ('june', 'principal', 10000, 'תשלומי הלוואה', false),
    ('may', 'interest', 70000, 'ריבית משכנתא', true),
    ('may', 'escrow', 20000, 'מסים וביטוח', true),
    ('may', 'principal', 10000, 'תשלומי הלוואה', true),
    ('partial', 'interest', 70000, 'ריבית משכנתא', false),
    ('partial', 'escrow', 30000, 'מסים וביטוח', false),
    ('partial', 'principal', 0, 'תשלומי הלוואה', false)
  ) as v(ikey, part, amount, cat, flagged)
  where v.ikey = t.idempotency_key
))
from public.transactions t
join public.loans l on l.company_id = t.company_id
where t.idempotency_key in ('june', 'may', 'partial');
-- The writer refuses a two-part split, so the partial one is made by taking a part leg away
-- and posting the line again: its two parts are then kept off the books.
delete from public.legs
where transaction_id = (select id from public.transactions where idempotency_key = 'partial') and part = 'principal';
select private.post_lines((select id from le_ref where label = 'co'),
  array[(select id from public.transactions where idempotency_key = 'partial')]);

select tests.authenticate_as('le_owner');

-- These RPCs are not granted to authenticated (decision 0193): the test calls them as service_role
-- with the user's claims, and each still checks the caller's company.
set local role service_role;
select is(
  (select jsonb_build_object('direct', x->'direct_agorot', 'excluded', x->'excluded_expense_agorot')
   from public.company_pnl((select id from le_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash') x),
  '{"direct": 190000, "excluded": 10000}'::jsonb,
  'ILS totals: the June split counts 900.00 by part, the partial split counts whole'
);
set local role authenticated;

set local role service_role;
select is(
  (select x->'loan_split_fallback_count'
   from jsonb_array_elements(
     public.company_pnl((select id from le_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'by_currency') x
   where x->>'currency' = 'ILS'),
  '1'::jsonb,
  'a fallback outside the period is not counted; the partial split in it is'
);
set local role authenticated;

set local role service_role;
select is(
  (select x->'loan_split_fallback_count'
   from jsonb_array_elements(
     public.company_pnl((select id from le_ref where label = 'co'), null, null, 'cash')->'by_currency') x
   where x->>'currency' = 'ILS'),
  '2'::jsonb,
  'all time counts both fallbacks'
);
set local role authenticated;

select is(
  (select count(*)::int from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key = 'partial' and l.part is null and l.loan_split_fallback),
  1,
  'a split that is not three parts emits the whole line'
);

select is(
  (select jsonb_build_object('total', x->'total_agorot', 'amounts', (select jsonb_agg(r->'amount_net') from jsonb_array_elements(x->'rows') r))
   from public.list_project_category((select id from le_ref where label = 'p1'), (select id from le_ref where label = 'interest')) x),
  '{"total": 70000, "amounts": [-70000]}'::jsonb,
  'list_project_category: the interest category lists the June part only'
);

select is(
  (select jsonb_build_object('total', x->'total_agorot', 'n', jsonb_array_length(x->'rows'))
   from public.list_project_category((select id from le_ref where label = 'p1'), (select id from le_ref where label = 'own')) x),
  '{"total": 200000, "n": 2}'::jsonb,
  'list_project_category: the line''s own category keeps only the two fallback lines, not the June payment'
);

select tests.authenticate_as('le_other');

select is(
  public.list_project_category((select id from le_ref where label = 'p1'), (select id from le_ref where label = 'interest')),
  null::jsonb,
  'list_project_category: another company''s caller gets nothing'
);

select is(
  (select count(*)::int from private.project_category_entries((select id from le_ref where label = 'p1'))),
  0,
  'project_category_entries: another company''s caller gets no rows'
);

select * from finish();

rollback;
