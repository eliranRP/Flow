-- FLOW-101 review. Shared split parts round half to even, so a project's parts
-- sum to its share within 1 minor unit. Invented data only (USD minor units).

begin;

select plan(12);

select tests.create_supabase_user('lr_owner', 'lr-owner@example.com');
select tests.create_supabase_user('lr_other', 'lr-other@example.com');

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lr_owner'), 'Example Rounding LLC', false),
  (tests.get_supabase_uid('lr_other'), 'Example Rounding Neighbour LLC', false);

create temp table lr_ref (label text primary key, id uuid);
grant all on lr_ref to authenticated, service_role;

insert into lr_ref (label, id)
select 'co', id from public.companies where name = 'Example Rounding LLC';

insert into public.projects (company_id, name, status)
select (select id from lr_ref where label = 'co'), v.name, 'active'
from (values ('Site A'), ('Site B'), ('Site C'), ('Site D'), ('Site E'), ('Site F')) as v(name);

insert into lr_ref (label, id)
select name, id from public.projects
where company_id = (select id from lr_ref where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from lr_ref where label = 'co'), 'Mortgage servicer', 'expense', 50, false);

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from lr_ref where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD');

-- odd: 1000.01 over three sites; truncation leaves A and B 2 cents short.
-- tie: 0.06 over three sites; D's escrow share is exactly 1.5 cents.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
select (select id from lr_ref where label = 'co'), 'expense', 'expense', 'shared', 'posted', 'USD',
  v.net, v.net, -v.net, 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.ikey,
  (select id from public.categories where company_id = (select id from lr_ref where label = 'co') and name = 'Mortgage servicer'),
  v.ikey, true
from (values ('odd', -100001), ('tie', -6)) as v(ikey, net);

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
)
select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense')
from public.transactions t
join public.loans l on l.company_id = t.company_id
join (values
  ('odd', 'interest', 70001, 'ריבית משכנתא'),
  ('odd', 'escrow', 20000, 'מסים וביטוח'),
  ('odd', 'principal', 10000, 'תשלומי הלוואה'),
  ('tie', 'interest', 1, 'ריבית משכנתא'),
  ('tie', 'escrow', 3, 'מסים וביטוח'),
  ('tie', 'principal', 2, 'תשלומי הלוואה')
) as v(ikey, part, amount, cat) on v.ikey = t.idempotency_key;

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from lr_ref where label = v.proj), v.bp, v.amt
from public.transactions t
join (values
  ('odd', 'Site A', 3334, -33334),
  ('odd', 'Site B', 3333, -33334),
  ('odd', 'Site C', 3333, -33333),
  ('tie', 'Site D', 5000, -3),
  ('tie', 'Site E', 3333, -2),
  ('tie', 'Site F', 1667, -1)
) as v(ikey, proj, bp, amt) on v.ikey = t.idempotency_key;

-- Every part of one project, in and out of the P&L, from the category helper.
create function pg_temp.parts_sum(p_label text)
returns bigint
language sql
as $$
  select coalesce(-sum(e.amount_net), 0)::bigint
  from private.project_category_entries_by_currency((select id from lr_ref where label = p_label)) e
  where e.currency = 'USD';
$$;
grant execute on function pg_temp.parts_sum(text) to authenticated;

create function pg_temp.pnl_shared(p_label text)
returns bigint
language sql
as $$
  select (c->>'shared_minor')::bigint
  from jsonb_array_elements(
    public.company_pnl((select id from lr_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'projects') p,
    jsonb_array_elements(p->'by_currency') c
  where (p->>'id')::uuid = (select id from lr_ref where label = p_label)
    and c->>'currency' = 'USD';
$$;
grant execute on function pg_temp.pnl_shared(text) to authenticated;

create function pg_temp.project_shared(p_label text)
returns bigint
language sql
as $$
  select (c->>'shared_minor')::bigint
  from jsonb_array_elements(
    public.get_project((select id from lr_ref where label = p_label), 'cash')->'by_currency') c
  where c->>'currency' = 'USD';
$$;
grant execute on function pg_temp.project_shared(text) to authenticated;

select is(
  array[
    private.div_half_even(5, 2), private.div_half_even(7, 2),
    private.div_half_even(-5, 2), private.div_half_even(-7, 2),
    private.div_half_even(5, -2), private.div_half_even(2, 3), private.div_half_even(-1, 3)
  ],
  array[2, 4, -2, -4, -2, 1, 0]::bigint[],
  'div_half_even: ties go to the even neighbour, otherwise to the nearest, in every sign'
);

select is(private.div_half_even(5, 0), null::bigint, 'div_half_even: a zero line is null, not an error');

select tests.authenticate_as('lr_owner');

select is(
  array[pg_temp.parts_sum('Site A'), pg_temp.parts_sum('Site B'), pg_temp.parts_sum('Site C')],
  array[33334, 33334, 33333]::bigint[],
  'odd line: each project''s parts sum to its share (truncation left A and B 2 cents short)'
);

select cmp_ok(
  (select max(abs(pg_temp.parts_sum(p) - s)) from (values ('Site A', 33334), ('Site B', 33334), ('Site C', 33333)) v(p, s)),
  '<=', 1::bigint,
  'odd line: every project within 1 minor unit of its share'
);

select is(
  array[pg_temp.pnl_shared('Site A'), pg_temp.pnl_shared('Site B'), pg_temp.pnl_shared('Site C')],
  array[30001, 30001, 30000]::bigint[],
  'company_pnl projects[]: interest and escrow shares round half to even per part'
);

select is(
  array[pg_temp.project_shared('Site A'), pg_temp.project_shared('Site B'), pg_temp.project_shared('Site C')],
  array[30001, 30001, 30000]::bigint[],
  'get_project by_currency: the same shares as company_pnl'
);

select is(
  (select jsonb_object_agg(x->>'name', x->'amount_minor')
   from jsonb_array_elements(public.get_project((select id from lr_ref where label = 'Site A'), 'cash')->'categories_by_currency') x
   where x->>'currency' = 'USD'),
  '{"ריבית משכנתא": 23334, "מסים וביטוח": 6667}'::jsonb,
  'get_project categories_by_currency: each part rounds to the nearest cent'
);

-- Tie: D's escrow share is 3 * 3 / 6 = 1.5, which rounds to 2 (even), and its interest 0.5 rounds to 0.
select is(
  pg_temp.pnl_shared('Site D'),
  2::bigint,
  'tie: half rounds to even (0.5 -> 0, 1.5 -> 2), not away from zero (3) or down (1)'
);

select is(
  pg_temp.project_shared('Site D'),
  2::bigint,
  'tie: get_project rounds the same way'
);

select is(
  array[pg_temp.parts_sum('Site D'), pg_temp.parts_sum('Site E'), pg_temp.parts_sum('Site F')],
  array[3, 2, 0]::bigint[],
  'tie: D and E sum to their shares, F is 1 short (within 1)'
);

-- Cross-tenant: another company's caller reads none of it; the owner above did.
select tests.authenticate_as('lr_other');

select is(pg_temp.parts_sum('Site A'), 0::bigint, 'another company''s caller gets no category parts of this project');

select is(
  public.get_project((select id from lr_ref where label = 'Site A'), 'cash'),
  null::jsonb,
  'another company''s caller gets no get_project for this project'
);

select * from finish();

rollback;
