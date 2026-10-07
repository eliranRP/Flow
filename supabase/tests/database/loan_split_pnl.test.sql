-- FLOW-101. A loan payment counts by its split parts in every P&L read.
-- Invented data only. Amounts are USD minor units (100000 is 1000.00).

begin;

select plan(38);

do $users$
begin
  perform tests.create_supabase_user('ls_owner', 'ls-owner@example.com');
  perform tests.create_supabase_user('ls_other', 'ls-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('ls_owner'), 'Example Loans LLC', false),
  (tests.get_supabase_uid('ls_other'), 'Example Neighbour LLC', false);

create temp table ls_ref (label text primary key, id uuid);
grant all on ls_ref to authenticated, service_role;

insert into ls_ref (label, id)
select 'co', id from public.companies where name = 'Example Loans LLC';
insert into ls_ref (label, id)
select 'co2', id from public.companies where name = 'Example Neighbour LLC';

insert into public.projects (company_id, name, status)
select (select id from ls_ref where label = 'co'), v.name, 'active'
from (values ('Site One'), ('Site Two'), ('Site Three'), ('Site Four')) as v(name);
insert into public.projects (company_id, name, status)
values ((select id from ls_ref where label = 'co2'), 'Site Nine', 'active');

insert into ls_ref (label, id)
select case name
  when 'Site One' then 'p1' when 'Site Two' then 'p2'
  when 'Site Three' then 'p3' when 'Site Four' then 'p4' else 'p9' end,
  id
from public.projects;

insert into public.categories (company_id, name, kind, sort_order, is_default)
select c.id, v.name, 'expense'::public.category_kind, 50, false
from public.companies c
cross join (values ('Mortgage servicer'), ('Materials')) as v(name)
where c.name in ('Example Loans LLC', 'Example Neighbour LLC');

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
select c.id, 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD'
from public.companies c
where c.name in ('Example Loans LLC', 'Example Neighbour LLC');

-- Lines. main: the 1000.00 payment, filed under an ordinary category.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, removed_at
)
select
  c.id, 'expense', 'expense', v.role::public.pnl_role, v.status::public.line_status, 'USD',
  v.gross, v.net, -v.gross, v.vat, 'source',
  '2026-06-10', '2026-06-10', 'manual', v.ikey,
  case when v.role = 'project' then
    (select p.id from public.projects p where p.company_id = c.id and p.name = v.project) end,
  (select k.id from public.categories k where k.company_id = c.id and k.name = v.cat and k.kind = 'expense'),
  v.ikey, true,
  case when v.removed then now() end
from public.companies c
join (values
  ('main',     'project', 'posted', -100000, -100000,     0, 'Site One', 'Mortgage servicer', false),
  ('flagged',  'project', 'posted',  -50000,  -50000,     0, 'Site One', 'Materials',         false),
  ('vat',      'project', 'posted',  -11800,  -10000, -1800, 'Site One', 'Materials',         false),
  ('removed',  'project', 'posted', -100000, -100000,     0, 'Site One', 'Mortgage servicer', true),
  ('unposted', 'project', 'pending', -100000, -100000,    0, 'Site One', 'Mortgage servicer', false),
  ('shared',   'shared',  'posted',  -99999,  -99999,     0, null,       'Mortgage servicer', false),
  ('zero',     'shared',  'posted',       0,       0,     0, null,       'Mortgage servicer', false)
) as v(ikey, role, status, gross, net, vat, project, cat, removed) on true
where c.name = 'Example Loans LLC';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'project', 'posted', 'USD',
  -30000, -30000, 30000, 0, 'source', '2026-06-11', '2026-06-11', 'manual', 'neighbour',
  (select p.id from public.projects p where p.company_id = c.id and p.name = 'Site Nine'),
  (select k.id from public.categories k where k.company_id = c.id and k.name = 'Mortgage servicer'),
  'neighbour', true
from public.companies c
where c.name = 'Example Neighbour LLC';

-- Splits. Amounts are positive, the line is negative.
insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select
  t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k
   where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense'),
  v.flagged
from public.transactions t
join public.loans l on l.company_id = t.company_id
join (values
  ('main',     'interest',  70000, 'ריבית משכנתא', false),
  ('main',     'escrow',    20000, 'מסים וביטוח',   false),
  ('main',     'principal', 10000, 'תשלומי הלוואה', false),
  ('flagged',  'interest',  30000, 'ריבית משכנתא', true),
  ('flagged',  'escrow',    10000, 'מסים וביטוח',   true),
  ('flagged',  'principal', 10000, 'תשלומי הלוואה', true),
  ('vat',      'interest',   7000, 'ריבית משכנתא', false),
  ('vat',      'escrow',     2800, 'מסים וביטוח',   false),
  ('vat',      'principal',  2000, 'תשלומי הלוואה', false),
  ('removed',  'interest',  70000, 'ריבית משכנתא', false),
  ('removed',  'escrow',    20000, 'מסים וביטוח',   false),
  ('removed',  'principal', 10000, 'תשלומי הלוואה', false),
  ('unposted', 'interest',  70000, 'ריבית משכנתא', false),
  ('unposted', 'escrow',    20000, 'מסים וביטוח',   false),
  ('unposted', 'principal', 10000, 'תשלומי הלוואה', false),
  ('shared',   'interest',  69999, 'ריבית משכנתא', false),
  ('shared',   'escrow',    20000, 'מסים וביטוח',   false),
  ('shared',   'principal', 10000, 'תשלומי הלוואה', false),
  ('zero',     'interest',      0, 'ריבית משכנתא', false),
  ('zero',     'escrow',        0, 'מסים וביטוח',   false),
  ('zero',     'principal',     0, 'תשלומי הלוואה', false),
  ('neighbour', 'interest', 20000, 'ריבית משכנתא', false),
  ('neighbour', 'escrow',    5000, 'מסים וביטוח',   false),
  ('neighbour', 'principal', 5000, 'תשלומי הלוואה', false)
) as v(ikey, part, amount, cat, flagged) on t.idempotency_key = v.ikey
where t.company_id in (select id from ls_ref where label in ('co', 'co2'));

-- The shared line is split a third each over three sites. The zero line goes to one.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from ls_ref where label = v.proj), v.bp, v.amt
from public.transactions t
join (values
  ('shared', 'p2', 3333, -33333),
  ('shared', 'p3', 3333, -33333),
  ('shared', 'p4', 3334, -33333),
  ('zero',   'p2', 10000, 0)
) as v(ikey, proj, bp, amt) on t.idempotency_key = v.ikey;

create function pg_temp.usd(p_period boolean default true)
returns jsonb
language sql
as $$
  select x
  from jsonb_array_elements(
    case when p_period
      then public.company_pnl((select id from ls_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')
      else public.company_pnl((select id from ls_ref where label = 'co'), null, null, 'cash')
    end -> 'by_currency'
  ) x
  where x->>'currency' = 'USD';
$$;
grant execute on function pg_temp.usd(boolean) to authenticated;

create function pg_temp.proj_cats(p_label text, p_key text)
returns jsonb
language sql
as $$
  select coalesce(jsonb_object_agg(x->>'name', x->'amount_minor'), '{}'::jsonb)
  from jsonb_array_elements(
    public.get_project((select id from ls_ref where label = p_label), 'cash') -> p_key
  ) x
  where x->>'currency' = 'USD';
$$;
grant execute on function pg_temp.proj_cats(text, text) to authenticated;

select tests.authenticate_as('ls_owner');

-- company_pnl: the 1000.00 payment counts by part.
select is(
  (select jsonb_build_object(
      'direct', pg_temp.usd()->'direct_minor',
      'excluded_expense', pg_temp.usd()->'excluded_expense_minor')),
  '{"direct": 150000, "excluded_expense": 20000}'::jsonb,
  'company_pnl: direct counts interest and escrow (900.00 of the payment) and the principal is kept out'
);

select is(
  pg_temp.usd()->'expense_minor',
  '239999'::jsonb,
  'company_pnl: expense is the whole-line fallbacks plus interest and escrow of both split lines'
);

select is(
  pg_temp.usd()->'net_profit_minor',
  '-239999'::jsonb,
  'company_pnl: net follows the expense'
);

select is(
  pg_temp.usd()->'shared_minor',
  '89999'::jsonb,
  'company_pnl: a shared split line counts interest and escrow only'
);

select is(
  pg_temp.usd()->'excluded_count',
  '3'::jsonb,
  'company_pnl: each principal part, including the zero one, is a kept-out row'
);

select is(
  pg_temp.usd()->'loan_split_fallback_count',
  '2'::jsonb,
  'company_pnl: a flagged split and a VAT line fall back and are counted once each'
);

select is(
  pg_temp.usd(false)->'loan_split_fallback_count',
  '2'::jsonb,
  'company_pnl: the fallback count without a period'
);

select is(
  (select x->'loan_split_fallback_count'
   from jsonb_array_elements(
     public.company_pnl((select id from ls_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'by_currency'
   ) x where x->>'currency' = 'USD') is not null,
  true,
  'company_pnl: the count is a field on the by_currency row'
);

-- The line's own category gets nothing, the part categories get the parts.
select is(
  pg_temp.proj_cats('p1', 'categories_by_currency'),
  '{"Materials": 60000, "ריבית משכנתא": 70000, "מסים וביטוח": 20000}'::jsonb,
  'get_project: part categories in categories_by_currency, the line''s own category gets 0'
);

select is(
  pg_temp.proj_cats('p1', 'excluded_categories_by_currency'),
  '{"תשלומי הלוואה": 10000}'::jsonb,
  'get_project: the principal sits in excluded_categories_by_currency'
);

select is(
  (select jsonb_build_object(
      'direct', x->'direct_minor', 'shared', x->'shared_minor', 'profit', x->'profit_minor')
   from jsonb_array_elements(
     public.get_project((select id from ls_ref where label = 'p1'), 'cash')->'by_currency'
   ) x where x->>'currency' = 'USD'),
  '{"direct": 150000, "shared": 0, "profit": -150000}'::jsonb,
  'get_project: direct counts the parts, not the whole payment'
);

select is(
  (select x->'expense_minor'
   from jsonb_array_elements(public.get_home()->'other_currencies') x
   where x->>'currency' = 'USD'),
  '-239999'::jsonb,
  'get_home: the USD expense counts by part'
);

-- A removed or an unposted line counts nowhere.
select is(
  (select count(*)::int from private.pnl_lines
   where transaction_id in (
     select id from public.transactions where idempotency_key in ('removed', 'unposted'))),
  0,
  'a removed and an unposted line emit no rows'
);

select is(
  (select count(*)::int from private.pnl_lines where transaction_id in (
     select id from public.transactions where idempotency_key = 'main')),
  3,
  'a valid split line emits one row per part'
);

select is(
  (select jsonb_object_agg(l.part::text, l.amount_net)
   from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key = 'main'),
  '{"interest": -70000, "escrow": -20000, "principal": -10000}'::jsonb,
  'parts are signed like the line'
);

select is(
  (select jsonb_object_agg(l.part::text, l.in_pnl)
   from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key = 'main'),
  '{"interest": true, "escrow": true, "principal": false}'::jsonb,
  'in_pnl follows the part category'
);

select is(
  (select count(distinct l.line_amount_net)::int from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key = 'main'),
  1,
  'every part row carries the same line amount'
);

select is(
  (select jsonb_agg(l.part order by l.transaction_id)
   from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key in ('flagged', 'vat')),
  '[null, null]'::jsonb,
  'a flagged split and a VAT line emit the whole line, with no part'
);

select is(
  (select jsonb_object_agg(t.idempotency_key, l.loan_split_fallback)
   from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key in ('main', 'flagged', 'vat', 'shared')),
  '{"main": false, "flagged": true, "vat": true, "shared": false}'::jsonb,
  'loan_split_fallback marks only the split lines that fell back'
);

-- Shared allocations: each project's parts add up to its share, within one minor unit.
select cmp_ok(
  (
    select max(abs(
      coalesce((select sum(v::bigint) from jsonb_each_text(
        pg_temp.proj_cats(p.label, 'categories_by_currency')) as e(k, v)), 0)
      + coalesce((select sum(v::bigint) from jsonb_each_text(
        pg_temp.proj_cats(p.label, 'excluded_categories_by_currency')) as e(k, v)), 0)
      - (-a.amount_net)
    ))
    from public.allocations a
    join ls_ref p on p.id = a.project_id
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'shared'
  )::bigint,
  '<=',
  1::bigint,
  'a shared split line: each project''s parts sum to its share within 1 minor unit'
);

select is(
  (select count(*)::int
   from jsonb_array_elements(
     public.company_pnl((select id from ls_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'projects') x
   where (x->>'id')::uuid in (select id from ls_ref where label in ('p2', 'p3', 'p4'))
     and (x->>'shared_agorot')::bigint = 0
     and exists (
       select 1 from jsonb_array_elements(x->'by_currency') c
       where c->>'currency' = 'USD' and (c->>'shared_minor')::bigint > 0)),
  3,
  'company_pnl projects[]: each of the three sites carries a USD shared share'
);

select lives_ok(
  $$select public.company_pnl((select id from ls_ref where label = 'co'), null, null, 'invoiced')$$,
  'a zero-amount shared split line does not crash company_pnl'
);

select lives_ok(
  $$select public.get_project((select id from ls_ref where label = 'p2'), 'cash')$$,
  'a zero-amount shared split line does not crash get_project'
);

-- loan_balances reads the split table, not the view.
select is(
  (select balance_minor from public.loan_balances
   where company_id = (select id from ls_ref where label = 'co')),
  11978000::bigint,
  'loan_balances: principal less the posted, unflagged principal parts only'
);

-- Another company's caller. Positive control first: the owner sees their own rows.
select is(
  (select count(*)::int from private.pnl_lines
   where company_id = (select id from ls_ref where label = 'co')),
  11,
  'owner sees their own pnl_lines rows'
);

select is(
  (select count(*)::int from private.pnl_lines
   where company_id = (select id from ls_ref where label = 'co2')),
  0,
  'owner sees none of the other company''s rows'
);

select tests.authenticate_as('ls_other');

select is(
  (select count(*)::int from private.pnl_lines
   where company_id = (select id from ls_ref where label = 'co')),
  0,
  'another company''s caller gets no pnl_lines rows of this company'
);

select is(
  (select count(*)::int from private.pnl_lines
   where company_id = (select id from ls_ref where label = 'co2')),
  3,
  'the neighbour sees their own three parts (positive control)'
);

select throws_ok(
  $$select public.company_pnl((select id from ls_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')$$,
  'P0001',
  'forbidden',
  'company_pnl refuses another company''s id'
);

select is(
  public.get_project((select id from ls_ref where label = 'p1'), 'cash'),
  null::jsonb,
  'get_project returns nothing for another company''s project'
);

select is(
  (select jsonb_build_object('direct', x->'direct_minor', 'excluded', x->'excluded_expense_minor')
   from jsonb_array_elements(
     public.company_pnl((select id from ls_ref where label = 'co2'), '2026-06-01', '2026-06-30', 'cash')->'by_currency'
   ) x where x->>'currency' = 'USD'),
  '{"direct": 25000, "excluded": 5000}'::jsonb,
  'the neighbour''s own totals count their own split (positive control)'
);

select tests.authenticate_as('ls_owner');

select is(
  (select jsonb_agg(l.line_amount_net) from private.pnl_lines l
   where l.company_id = (select id from ls_ref where label = 'co2')),
  null::jsonb,
  'the owner still sees none of the neighbour''s rows after switching back'
);

-- Deleting the split restores the whole line under its own category.
select lives_ok(
  $$delete from public.loan_splits
    where transaction_id = (select id from public.transactions where idempotency_key = 'main'
      and company_id = (select id from ls_ref where label = 'co'))$$,
  'the owner deletes the split of the main line'
);

select is(
  (select count(*)::int from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key = 'main' and t.company_id = (select id from ls_ref where label = 'co')
     and l.part is null and l.amount_net = -100000 and l.in_pnl),
  1,
  'with no split the whole line is back in the P&L'
);

select is(
  pg_temp.proj_cats('p1', 'categories_by_currency')->'Mortgage servicer',
  '100000'::jsonb,
  'get_project: the whole payment counts under the line''s own category again'
);

select is(
  pg_temp.usd()->'direct_minor',
  '160000'::jsonb,
  'company_pnl: direct counts the whole line again'
);

select is(
  pg_temp.usd()->'loan_split_fallback_count',
  '2'::jsonb,
  'an unsplit line is not a fallback'
);

select is(
  (select balance_minor from public.loan_balances
   where company_id = (select id from ls_ref where label = 'co')),
  11988000::bigint,
  'loan_balances: the deleted split no longer reduces the balance'
);

select * from finish();

rollback;
