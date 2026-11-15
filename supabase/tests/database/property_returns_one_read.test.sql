-- FLOW-1203. get_property_returns reads the property's lines once (private.property_lines_in cuts
-- each date range from them) and takes the refinance set from the same lines. Parity: a pg_temp
-- copy of the body from before FLOW-1203 (with private.refinance_transactions as it was, reading
-- the lines itself) is the oracle, and the full JSON must be equal on a property with a refinance,
-- one with hard-money draws and one with neither, for the year, a quarter and the default range.
-- Invented data only.

begin;

select plan(17);

do $users$
begin
  perform tests.create_supabase_user('pp_owner', 'pp-owner@example.com');
end
$users$;

create temp table pp (label text primary key, id uuid);
grant all on pp to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pp (label, id) values ('co', tests.fixture_company('pp_owner', 'Example Parity LLC', true));
insert into public.accounts (company_id, name, type) values (pg_temp.id('co'), 'Example loan principal', 'liability');
insert into pp (label, id) values
  ('refi', tests.fixture_project(pg_temp.id('co'), 'Example refinanced rental')),
  ('hml', tests.fixture_project(pg_temp.id('co'), 'Example hard-money flip')),
  ('plain', tests.fixture_project(pg_temp.id('co'), 'Example plain rental')),
  ('purchase', tests.fixture_category(pg_temp.id('co'), 'Purchase', 'expense', true)),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('proceeds', tests.fixture_category(pg_temp.id('co'), 'Loan proceeds', 'income', true)),
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Repairs')),
  ('rf_tax', tests.fixture_category(pg_temp.id('co'), 'Example refinance taxes', 'expense')),
  ('draw_cat', tests.fixture_category(pg_temp.id('co'), 'Example draws', 'income', true)),
  ('refund_cat', tests.fixture_category(pg_temp.id('co'), 'Example renovation refunds', 'income', true));
update public.categories set rehab = false where id = pg_temp.id('rf_tax');
update public.categories set ledger_account_id = (
  select a.id from public.accounts a where a.company_id = pg_temp.id('co') and a.name = 'Example loan principal')
where id = pg_temp.id('draw_cat');
update public.categories set rehab = true, ledger_account_id = (
  select a.id from public.accounts a where a.company_id = pg_temp.id('co') and a.name = 'Example loan principal')
where id = pg_temp.id('refund_cat');
insert into pp (label, id)
select 'rf_int', coalesce(
  (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'interest'),
  tests.fixture_category(pg_temp.id('co'), 'Example refinance interest', 'expense'));
update public.categories set loan_part = 'interest', rehab = false where id = pg_temp.id('rf_int') and loan_part is null;
insert into pp (label, id)
select 'rf_fee', coalesce(
  (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'fees'),
  tests.fixture_category(pg_temp.id('co'), 'Example refinance loan fees', 'expense', true));
update public.categories set loan_part = 'fees' where id = pg_temp.id('rf_fee') and loan_part is null;
insert into pp (label, id)
select 'principal_cat', c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'principal';
update public.projects set arv_minor = 30000000 where id in (pg_temp.id('refi'), pg_temp.id('hml'), pg_temp.id('plain'));

-- A refinance: the purchase, a mortgage taken over at closing, a refinance closing three weeks
-- before the first rent (its taxes and new-loan fees are the rental's, its payoff interest stays
-- holding), the first rent and one payment of the new loan.
insert into pp (label, id) values
  ('rf-buy', tests.fixture_line(pg_temp.id('co'), 'pp:rf-buy', 3000000, p_project => pg_temp.id('refi'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-01-05')),
  ('rf-tax1', tests.fixture_line(pg_temp.id('co'), 'pp:rf-tax1', 10000, p_project => pg_temp.id('refi'), p_category => pg_temp.id('rf_tax'), p_doc_date => '2026-03-01')),
  ('rf-close', tests.fixture_line(pg_temp.id('co'), 'pp:rf-close', 19910000, 'income', pg_temp.id('refi'), pg_temp.id('proceeds'), '2026-06-10')),
  ('rf-rent', tests.fixture_line(pg_temp.id('co'), 'pp:rf-rent', 200000, 'income', pg_temp.id('refi'), pg_temp.id('rent'), '2026-08-01')),
  ('rf-pay', tests.fixture_line(pg_temp.id('co'), 'pp:rf-pay', 130000, p_project => pg_temp.id('refi'), p_category => pg_temp.id('rf_int'), p_doc_date => '2026-09-01'));
select tests.line_split(pg_temp.id('rf-close'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('proceeds'), 'project_id', pg_temp.id('refi'), 'amount_minor', 20000000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.id('rf_tax'), 'project_id', pg_temp.id('refi'), 'amount_minor', 50000, 'gross_up', true),
  jsonb_build_object('category_id', pg_temp.id('rf_int'), 'project_id', pg_temp.id('refi'), 'amount_minor', 30000, 'gross_up', true),
  jsonb_build_object('category_id', pg_temp.id('rf_fee'), 'project_id', pg_temp.id('refi'), 'amount_minor', 10000, 'gross_up', true)));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values
  (pg_temp.id('co'), 'Example mortgage taken over', 2400000, 50000, 360, '2026-01-01', 20000, 0, 'ILS', pg_temp.id('refi')),
  (pg_temp.id('co'), 'Example refinance loan', 20000000, 70000, 360, '2026-07-01', 130000, 0, 'ILS', pg_temp.id('refi'));

-- Hard-money draws: a loan that funds the purchase at closing and pays draws into the bank, a
-- renovation refund, a deposit after the first rent, another loan's proceeds, a principal payment.
insert into pp (label, id) values
  ('hml-buy', tests.fixture_line(pg_temp.id('co'), 'pp:hml-buy', 3000000, p_project => pg_temp.id('hml'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-03-02')),
  ('hml-d1', tests.fixture_line(pg_temp.id('co'), 'pp:hml-d1', 2000000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-04-01')),
  ('hml-d2', tests.fixture_line(pg_temp.id('co'), 'pp:hml-d2', 1000000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-05-01')),
  ('hml-ref', tests.fixture_line(pg_temp.id('co'), 'pp:hml-ref', 50000, 'income', pg_temp.id('hml'), pg_temp.id('refund_cat'), '2026-04-15')),
  ('hml-rent', tests.fixture_line(pg_temp.id('co'), 'pp:hml-rent', 200000, 'income', pg_temp.id('hml'), pg_temp.id('rent'), '2026-07-01')),
  ('hml-dep', tests.fixture_line(pg_temp.id('co'), 'pp:hml-dep', 300000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-07-05')),
  ('hml-second', tests.fixture_line(pg_temp.id('co'), 'pp:hml-second', 8000000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-06-02')),
  ('hml-pay', tests.fixture_line(pg_temp.id('co'), 'pp:hml-pay', 100000, p_project => pg_temp.id('hml'), p_category => pg_temp.id('principal_cat'), p_doc_date => '2026-08-01'));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id, status, closed_on)
values (pg_temp.id('co'), 'Example hard-money loan', 20000000, 120000, 12, '2026-03-01', 200000, 0, 'ILS', pg_temp.id('hml'), 'paid_off', '2026-09-30');
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Example second loan', 10000000, 80000, 360, '2026-06-01', 80000, 0, 'ILS', pg_temp.id('hml'));

-- Neither: a purchase paid with a loan that has its proceeds line, rent, a repair before the rent.
insert into pp (label, id) values
  ('pl-buy', tests.fixture_line(pg_temp.id('co'), 'pp:pl-buy', 15000000, p_project => pg_temp.id('plain'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-01-05')),
  ('pl-proc', tests.fixture_line(pg_temp.id('co'), 'pp:pl-proc', 11000000, 'income', pg_temp.id('plain'), pg_temp.id('proceeds'), '2026-01-05')),
  ('pl-hold', tests.fixture_line(pg_temp.id('co'), 'pp:pl-hold', 100000, p_project => pg_temp.id('plain'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-02-01')),
  ('pl-rent', tests.fixture_line(pg_temp.id('co'), 'pp:pl-rent', 2400000, 'income', pg_temp.id('plain'), pg_temp.id('rent'), '2026-03-01')),
  ('pl-rep', tests.fixture_line(pg_temp.id('co'), 'pp:pl-rep', 300000, p_project => pg_temp.id('plain'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-04-01')),
  -- On the last day of the quarter and of the year read below: the cut keeps both ends of a range.
  ('pl-q-end', tests.fixture_line(pg_temp.id('co'), 'pp:pl-q-end', 210000, 'income', pg_temp.id('plain'), pg_temp.id('rent'), '2026-09-30')),
  ('pl-y-end', tests.fixture_line(pg_temp.id('co'), 'pp:pl-y-end', 220000, 'income', pg_temp.id('plain'), pg_temp.id('rent'), '2026-12-31'));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Example plain mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'ILS', pg_temp.id('plain'));
-- ==== end of fixtures ====

-- The oracle: private.refinance_transactions and get_property_returns as they were before FLOW-1203.
create function pg_temp.refi_old(p_company_id uuid, p_project_id uuid, p_currency text)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with l as (
    select * from private.property_lines(p_company_id, p_project_id, null, null) x where x.currency = p_currency
  ),
  closing as (
    select a.line_date as d from l a where a.line = 'acquisition' order by a.amount_minor, a.line_date limit 1
  )
  select distinct f.transaction_id
  from l f
  cross join closing c
  where f.line = 'financing' and f.amount_minor > 0 and f.line_date > c.d
    and exists (
      select 1 from public.loans lo
      where lo.company_id = p_company_id and lo.project_id = p_project_id and lo.currency = p_currency
        and lo.start_date > c.d + 75
        and f.line_date between lo.start_date - 120 and lo.start_date + 30
        and f.amount_minor >= lo.principal_minor * 0.8
    );
$$;
grant execute on function pg_temp.refi_old(uuid, uuid, text) to authenticated, service_role;

CREATE FUNCTION pg_temp.gpr_old(p_project_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  p record;
  cur text;
  d_from date;
  d_to date;
  days integer;
  inv jsonb;
  bracket integer;
  st jsonb;
  cats jsonb;
  life jsonb;
  income bigint;
  opex bigint;
  debt bigint;
  capex bigint;
  before_rent bigint;
  not_counted bigint;
  principal bigint;
  other_cur jsonb;
  noi bigint;
  cash_flow bigint;
  rehab bigint;
  first_rent date;
  acquisition bigint;
  renovation bigint;
  holding bigint;
  financing bigint;
  purchase bigint;
  closing date;
  taken_over bigint;
  taken_over_loans jsonb;
  units integer;
  land bigint;
  land_source text;
  land_acc uuid;
  land_acc_name text;
  land_suggest jsonb;
  purchase_source text;
  money_in bigint;
  v_start record;
  v_end record;
  appreciation bigint;
  building bigint;
  dep_year bigint;
  tax bigint;
  total bigint;
  missing text[] := '{}';
  annual numeric;
  earning_days integer;
  earn_annual numeric;
  shortfall bigint;
  service_days integer;
  acquired_on date;
  held_days integer;
  life_cf bigint;
  equity bigint;
  loan_bal bigint;
  selling_bp integer;
  selling bigint;
  costs bigint;
  net_profit bigint;
  flip_roi numeric;
  holding_out bigint;
  irr_terminal bigint;
  irr_dates date[];
  irr_amounts numeric[];
  irr_out bigint;
  irr_in bigint;
  irr numeric;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  select pr.investment_currency, pr.purchase_minor, pr.arv_minor, pr.value_minor, pr.value_date,
    pr.units, pr.land_minor, pr.selling_cost_bp
  into p
  from public.projects pr
  where pr.id = p_project_id and pr.company_id = cid;
  if not found then
    return null;
  end if;
  cur := p.investment_currency;
  d_to := coalesce(p_to, (now() at time zone 'Asia/Jerusalem')::date);
  d_from := coalesce(p_from, (d_to - interval '1 year')::date + 1);
  days := d_to - d_from + 1;
  annual := 365.0 / days;
  inv := private.project_investment(cid, p_project_id);
  select c.tax_bracket_bp into bracket from public.companies c where c.id = cid;

  -- All time: the first rent and the money in.
  with a as (
    select * from private.property_lines(cid, p_project_id, null, null) x where x.currency = cur
  )
  select
    (select min(a.line_date) from a where a.line = 'income'),
    coalesce(jsonb_object_agg(g.line, g.amount_minor), '{}'::jsonb)
  into first_rent, life
  from (select a.line, sum(a.amount_minor)::bigint as amount_minor from a group by a.line) g;
  acquisition := coalesce((life->>'acquisition')::bigint, 0);
  renovation := coalesce((life->>'renovation')::bigint, 0);
  holding := coalesce((life->>'holding')::bigint, 0);
  financing := coalesce((life->>'financing')::bigint, 0);

  -- The period.
  with l as (
    select * from private.property_lines(cid, p_project_id, d_from, d_to) x where x.currency = cur
  ),
  sums as (
    select l.line, sum(l.amount_minor)::bigint as amount_minor, count(distinct l.transaction_id)::integer as lines
    from l group by l.line
  ),
  by_cat as (
    select l.line, l.category_id, sum(l.amount_minor)::bigint as amount_minor,
      count(distinct l.transaction_id)::integer as lines
    from l group by l.line, l.category_id
  )
  select
    coalesce((select jsonb_object_agg(s.line, jsonb_build_object('amount_minor', s.amount_minor, 'lines', s.lines)) from sums s), '{}'::jsonb),
    coalesce((
      select jsonb_object_agg(g.line, g.rows)
      from (
        select b.line, jsonb_agg(jsonb_build_object(
          'category_id', b.category_id, 'name', c.name, 'amount_minor', b.amount_minor, 'lines', b.lines
        ) order by abs(b.amount_minor) desc, c.name nulls last) as rows
        from by_cat b
        left join public.categories c on c.id = b.category_id and c.company_id = cid
        group by b.line
      ) g
    ), '{}'::jsonb),
    coalesce((select sum(-l.amount_minor) from l where l.part = 'principal' and l.line = 'debt_service'), 0)::bigint
  into st, cats, principal;

  select coalesce(jsonb_agg(distinct x.currency), '[]'::jsonb) into other_cur
  from private.property_lines(cid, p_project_id, d_from, d_to) x
  where x.currency <> cur;

  income := coalesce((st->'income'->>'amount_minor')::bigint, 0);
  opex := coalesce((st->'opex'->>'amount_minor')::bigint, 0);
  debt := coalesce((st->'debt_service'->>'amount_minor')::bigint, 0);
  capex := coalesce((st->'capex'->>'amount_minor')::bigint, 0);
  before_rent := coalesce((st->'holding'->>'amount_minor')::bigint, 0) + coalesce((st->'renovation'->>'amount_minor')::bigint, 0);
  not_counted := coalesce((st->'acquisition'->>'amount_minor')::bigint, 0) + coalesce((st->'financing'->>'amount_minor')::bigint, 0);
  noi := income + opex;
  cash_flow := noi + debt + capex;

  -- The purchase: the acquisition lines when there are any, else the typed figure.
  if acquisition < 0 then
    -- A loan paid out at closing without passing through the bank (a mortgage taken over in a
    -- Sub2, or a lender who paid the title company) is part of the price: the bank shows only the
    -- cash the owner brought. Such a loan starts within 30 days before to 75 days after the
    -- closing (the largest purchase line) and has no proceeds line of 80% of it or more from 120
    -- days before its first payment to 30 days after. A later refinance is not part of the price.
    select a.line_date into closing
    from private.property_lines(cid, p_project_id, null, null) a
    where a.currency = cur and a.line = 'acquisition'
    order by a.amount_minor, a.line_date limit 1;
    select coalesce(sum(least(coalesce(lo.closing_paid_minor, greatest(lo.principal_minor - dr.draws_minor, 0)), lo.principal_minor)), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('loan_id', lo.id, 'name', lo.name, 'principal_minor', lo.principal_minor,
        'closing_paid_minor', lo.closing_paid_minor,
        'draws_minor', dr.draws_minor,
        'counted_minor', least(coalesce(lo.closing_paid_minor, greatest(lo.principal_minor - dr.draws_minor, 0)), lo.principal_minor))
        order by lo.start_date), '[]'::jsonb)
    into taken_over, taken_over_loans
    from public.loans lo
    -- FLOW-1199 (decision 0269): the draws the loan paid into the bank after closing are not the price.
    cross join lateral (
      select coalesce(sum(f.amount_minor), 0)::bigint as gross_minor
      from private.property_lines(cid, p_project_id, lo.start_date + 1,
        coalesce(lo.closed_on, (now() at time zone 'Asia/Jerusalem')::date)) f
      join public.categories fc on fc.id = f.category_id and fc.company_id = cid
      join public.accounts fa on fa.id = fc.ledger_account_id and fa.company_id = cid
      where f.currency = cur and f.line = 'financing' and f.amount_minor > 0
        and fa.type = 'liability' and fc.rehab is not true
        and (first_rent is null or f.line_date < first_rent)
        and not exists (
          select 1 from public.loans o
          where o.company_id = cid and o.project_id = p_project_id and o.id <> lo.id
            and f.line_date between o.start_date - 120 and o.start_date + 30
            and f.amount_minor >= o.principal_minor * 0.8
        )
    ) dg
    -- Draws lent on top of the principal show as principal paid back above it: not taken off. Loan
    -- payments carry no link to their loan, so this reads the property's principal paid back up to
    -- 30 days after the payoff (today + 30 while the loan is open).
    cross join lateral (
      select coalesce(-sum(f.amount_minor), 0)::bigint as repaid_minor
      from private.property_lines(cid, p_project_id, lo.start_date + 1,
        coalesce(lo.closed_on, (now() at time zone 'Asia/Jerusalem')::date) + 30) f
      left join public.categories pc on pc.id = f.category_id and pc.company_id = cid
      where f.currency = cur and f.amount_minor < 0 and coalesce(f.part, pc.loan_part::text) = 'principal'
    ) rp
    cross join lateral (
      select dg.gross_minor - least(dg.gross_minor, greatest(rp.repaid_minor - lo.principal_minor, 0)) as draws_minor
    ) dr
    where lo.company_id = cid and lo.project_id = p_project_id and lo.currency = cur
      and lo.start_date between closing - 30 and closing + 75
      and not exists (
        select 1 from private.property_lines(cid, p_project_id, lo.start_date - 120, lo.start_date + 30) f
        where f.currency = cur and f.line = 'financing' and f.amount_minor >= lo.principal_minor * 0.8
      );
    purchase := -acquisition + taken_over;
    purchase_source := 'lines';
  elsif p.purchase_minor is not null then
    purchase := p.purchase_minor;
    purchase_source := 'typed';
  else
    missing := array_append(missing, 'purchase');
  end if;

  -- The money in: what the property took from the owner that is not its running results.
  -- FLOW-1025: the running cash flow since the first rent, when below zero, is money the owner put in.
  shortfall := least(coalesce((life->>'income')::bigint, 0) + coalesce((life->>'opex')::bigint, 0)
    + coalesce((life->>'debt_service')::bigint, 0) + coalesce((life->>'capex')::bigint, 0), 0);
  money_in := -(acquisition + renovation + holding + financing + shortfall);
  if acquisition = 0 and purchase is not null then
    -- No purchase line: the typed price stands in for it.
    money_in := money_in + purchase;
  end if;
  if acquisition = 0 and purchase is null then
    money_in := null;
  end if;

  rehab := case when inv->'rehab_other_currencies' = '[]'::jsonb then (inv->>'rehab_minor')::bigint end;

  select v.value_minor, v.value_date into v_end from public.project_values v
  where v.company_id = cid and v.project_id = p_project_id and v.value_date <= d_to
  order by v.value_date desc limit 1;
  select v.value_minor, v.value_date into v_start from public.project_values v
  where v.company_id = cid and v.project_id = p_project_id and v.value_date <= d_from
  order by v.value_date desc limit 1;
  -- FLOW-466: no value by the period's start, the first value recorded in it, before the last.
  if v_start.value_minor is null and v_end.value_minor is not null then
    select v.value_minor, v.value_date into v_start from public.project_values v
    where v.company_id = cid and v.project_id = p_project_id and v.value_date > d_from and v.value_date < v_end.value_date
    order by v.value_date limit 1;
  end if;
  if v_end.value_minor is null or p.value_minor is null then
    missing := array_append(missing, 'value');
  elsif v_start.value_minor is null then
    missing := array_append(missing, 'value_history');
  else
    appreciation := v_end.value_minor - v_start.value_minor;
  end if;

  -- FLOW-461: the typed land, else the property's postings to the company's land account.
  select c.land_account_id, a.name into land_acc, land_acc_name
  from public.companies c
  left join public.accounts a on a.id = c.land_account_id and a.company_id = c.id
  where c.id = cid;
  if p.land_minor is not null then
    land := p.land_minor;
    land_source := 'typed';
  elsif land_acc is not null then
    -- Only a positive balance is a land (as for the suggestion); none, or a credit, leaves it missing.
    land := private.project_account_balance(cid, p_project_id, land_acc, cur);
    if land > 0 then
      land_source := 'books';
    else
      land := null;
    end if;
  else
    select jsonb_build_object('account_id', s.id, 'name', s.name, 'amount_minor', s.balance)
    into land_suggest
    from (
      select a.id, a.name, private.project_account_balance(cid, p_project_id, a.id, cur) as balance
      from public.accounts a
      where a.company_id = cid and a.type = 'asset' and a.archived_at is null
        and a.name ~* '(קרקע|land)' and a.name !~* '(שיפור|improve)'
    ) s
    where s.balance > 0
    order by s.balance desc
    limit 1;
  end if;
  if land is null then
    missing := array_append(missing, 'land');
  end if;
  if bracket is null then
    missing := array_append(missing, 'tax_bracket');
  end if;
  -- FLOW-466: depreciation runs while the property is in service, from the first rent.
  service_days := case when first_rent is null or first_rent > d_to then 0
    when first_rent > d_from then d_to - first_rent + 1 else days end;
  if purchase is not null and rehab is not null and land is not null then
    building := greatest(purchase + rehab - land, 0);
    dep_year := private.div_half_even(building::numeric * 10, 275);
    if bracket is not null then
      tax := private.div_half_even(building::numeric * 10 * bracket * service_days, 275::numeric * 10000 * 365);
    end if;
  end if;
  -- One unit until the owner says otherwise.
  units := coalesce(p.units, 1);

  total := cash_flow + principal + coalesce(appreciation, 0) + coalesce(tax, 0);
  -- FLOW-464: a first rent inside the period scales the per-year metrics over the days since it.
  earning_days := case when first_rent > d_from and first_rent <= d_to then d_to - first_rent + 1 else days end;
  earn_annual := 365.0 / earning_days;

  -- FLOW-1068: the deal as a whole. The first purchase line dates the purchase; the cash flow since
  -- the first rent is all time; the selling cost is 8% of the ARV until the owner sets it.
  select min(a.line_date) into acquired_on
  from private.property_lines(cid, p_project_id, null, null) a
  where a.currency = cur and a.line = 'acquisition';
  held_days := case when acquired_on <= d_to then d_to - acquired_on + 1 end;
  life_cf := coalesce((life->>'income')::bigint, 0) + coalesce((life->>'opex')::bigint, 0)
    + coalesce((life->>'debt_service')::bigint, 0) + coalesce((life->>'capex')::bigint, 0);
  equity := (inv->>'current_equity_minor')::bigint;
  loan_bal := (inv->>'loan_balance_minor')::bigint;
  selling_bp := coalesce(p.selling_cost_bp, 800);
  if p.arv_minor is not null then
    selling := private.div_half_even(p.arv_minor::numeric * selling_bp, 10000);
  end if;
  -- The holding costs that rehab does not already count (a category counts in rehab unless it is
  -- switched off, so a line can be both), signed as the lines: a cost is negative. A loan's principal
  -- paid before the first rent is holding in property_lines, but it pays back the loan that funded the
  -- price, which the purchase already counts: it is no cost of the deal (the review of #1012).
  select coalesce(sum(a.amount_minor), 0)::bigint into holding_out
  from private.property_lines(cid, p_project_id, null, null) a
  left join public.categories c on c.id = a.category_id and c.company_id = cid
  where a.currency = cur and a.line = 'holding' and not a.in_rehab
    and coalesce(c.loan_part::text, a.part, '') <> 'principal'
    -- FLOW-1200 (decision 0270): a refinance closing's costs, other than interest, are the rental's.
    and not (
      a.transaction_id in (select pg_temp.refi_old(cid, p_project_id, cur))
      and coalesce(c.loan_part::text, a.part, '') <> 'interest'
    );
  if purchase is not null and rehab is not null then
    costs := purchase + rehab - holding_out;
    if p.arv_minor is not null then
      net_profit := p.arv_minor - selling - costs;
    end if;
  end if;
  if net_profit is not null and money_in > 0 then
    flip_roi := net_profit * 10000.0 / money_in;
  end if;

  -- FLOW-1069: the IRR since the purchase, on the owner's dated cash, with what is held at the period's end.
  if equity is not null then
    irr_terminal := equity;
  elsif p.arv_minor is not null and selling is not null then
    irr_terminal := p.arv_minor - selling - coalesce(loan_bal, 0);
  end if;
  if acquired_on is not null and acquired_on <= d_to and irr_terminal is not null then
    -- What went in and what came back, from the lines alone; the holding at the period's end is apart.
    select coalesce(sum(a.amount_minor) filter (where a.amount_minor < 0), 0)::bigint,
      coalesce(sum(a.amount_minor) filter (where a.amount_minor > 0), 0)::bigint
    into irr_out, irr_in
    from private.property_lines(cid, p_project_id, null, null) a
    where a.currency = cur and a.line_date >= acquired_on and a.line_date <= d_to;
    select array_agg(f.d order by f.d), array_agg(f.a order by f.d)
    into irr_dates, irr_amounts
    from (
      select g.d, sum(g.a)::numeric as a
      from (
        select a.line_date as d, a.amount_minor as a
        from private.property_lines(cid, p_project_id, null, null) a
        where a.currency = cur and a.line_date >= acquired_on and a.line_date <= d_to
        union all
        select d_to, irr_terminal
      ) g
      group by g.d
    ) f;
    irr := private.xirr(irr_dates, irr_amounts);
  end if;

  return jsonb_build_object(
    'currency', cur,
    'from', d_from,
    'to', d_to,
    'days', days,
    'earning_days', earning_days,
    'annualized_from', case when earning_days < days then first_rent end,
    'first_rent', first_rent,
    'other_currencies', other_cur,
    'missing', to_jsonb(missing),
    'inputs', jsonb_build_object(
      'purchase_minor', purchase,
      'purchase_source', purchase_source,
      'purchase_typed_minor', p.purchase_minor,
      'arv_minor', p.arv_minor,
      'value_minor', p.value_minor,
      'value_date', p.value_date,
      'units', units,
      'units_default', p.units is null,
      'taken_over_minor', coalesce(taken_over, 0),
      'taken_over_loans', coalesce(taken_over_loans, '[]'::jsonb),
      'land_minor', land,
      'land_source', land_source,
      'land_typed_minor', p.land_minor,
      'land_account', case when land_acc is not null then jsonb_build_object('account_id', land_acc, 'name', land_acc_name) end,
      'land_suggestion', land_suggest,
      'tax_bracket_bp', bracket,
      'rehab_minor', rehab,
      'loan_balance_minor', (inv->>'loan_balance_minor')::bigint,
      'value_start', case when v_start.value_minor is not null
        then jsonb_build_object('value_minor', v_start.value_minor, 'value_date', v_start.value_date) end,
      'value_end', case when v_end.value_minor is not null
        then jsonb_build_object('value_minor', v_end.value_minor, 'value_date', v_end.value_date) end
    ),
    'statement', jsonb_build_object(
      'income_minor', income,
      'opex_minor', opex,
      'noi_minor', noi,
      'debt_service_minor', debt,
      'capex_minor', capex,
      'cash_flow_minor', cash_flow,
      'before_rent_minor', before_rent,
      'not_counted_minor', not_counted,
      'lines', st,
      'by_category', cats
    ),
    'sources', jsonb_build_object(
      'cash_flow_minor', cash_flow,
      'principal_minor', principal,
      'appreciation_minor', appreciation,
      'tax_savings_minor', tax,
      'depreciation_year_minor', dep_year,
      'building_minor', building,
      'total_minor', total,
      'total_bp', case when money_in > 0 then round(total * earn_annual * 10000 / money_in)::integer end
    ),
    'equity', jsonb_build_object(
      'equity_today_minor', (inv->>'current_equity_minor')::bigint,
      'forced_equity_minor', case when p.arv_minor is not null and purchase is not null and rehab is not null
        then p.arv_minor - purchase - rehab end,
      'money_in_minor', money_in,
      'money_in_parts', jsonb_build_object(
        'acquisition_minor', case when acquisition = 0 then -purchase else acquisition end,
        'renovation_minor', renovation,
        'holding_minor', holding,
        'financing_minor', financing,
        'shortfall_minor', shortfall
      ),
      'all_cash_out', money_in <= 0,
      'cash_out_cover_months', case when money_in < 0 and cash_flow < 0
        then floor(-money_in * 12 / (-cash_flow * earn_annual))::bigint end
    ),
    'deal', jsonb_build_object(
      'selling_cost_bp', selling_bp,
      'selling_cost_default', p.selling_cost_bp is null,
      'selling_cost_minor', selling,
      'holding_minor', holding_out,
      'net_profit_minor', net_profit,
      'acquired_on', acquired_on,
      'held_days', held_days,
      'life_cash_flow_minor', life_cf,
      'irr_out_minor', irr_out,
      'irr_in_minor', irr_in,
      'irr_terminal_minor', irr_terminal,
      'irr_dates', coalesce(array_length(irr_dates, 1), 0)
    ),
    'metrics', jsonb_build_object(
      'cash_on_cash_bp', case when money_in > 0 then round(cash_flow * earn_annual * 10000 / money_in)::integer end,
      'cap_rate_bp', case when p.value_minor > 0 then round(noi * earn_annual * 10000 / p.value_minor)::integer end,
      'dscr_milli', case when debt < 0 then round(noi * 1000.0 / -debt)::integer end,
      'cash_flow_per_unit_month_minor', round(cash_flow * 365.0 / (units * earning_days * 12))::bigint,
      'roe_bp', case when equity > 0 then least(greatest(round(total * earn_annual * 10000 / equity), -2147483647), 2147483647)::integer end,
      'roi_since_purchase_bp', case when money_in > 0 and equity is not null
        then least(greatest(round((greatest(life_cf, 0) + equity - money_in) * 10000.0 / money_in), -2147483647), 2147483647)::integer end,
      'equity_multiple_milli', case when money_in > 0 and equity is not null
        then least(greatest(round((greatest(life_cf, 0) + equity) * 1000.0 / money_in), -2147483647), 2147483647)::integer end,
      'break_even_occupancy_bp', case when income > 0 then round((-opex - debt) * 10000.0 / income)::integer end,
      'expense_ratio_bp', case when income > 0 then round(-opex * 10000.0 / income)::integer end,
      'grm_milli', case when income > 0 and purchase is not null
        then round(purchase * 1000.0 / (income * earn_annual))::integer end,
      'ltv_bp', case when p.value_minor > 0 and loan_bal is not null
        then round(loan_bal * 10000.0 / p.value_minor)::integer end,
      'flip_roi_bp', least(greatest(round(flip_roi), -2147483647), 2147483647)::integer,
      'flip_roi_year_bp', case when held_days > 0 then least(greatest(round(flip_roi * 365 / held_days), -2147483647), 2147483647)::integer end,
      'arv_margin_bp', case when p.arv_minor > 0 and net_profit is not null
        then round(net_profit * 10000.0 / p.arv_minor)::integer end,
      'rule_70_minor', case when p.arv_minor is not null and costs is not null
        then private.div_half_even(p.arv_minor::numeric * 7, 10) - rehab - purchase end,
      'break_even_sale_minor', case when costs is not null and selling_bp < 10000
        then private.div_half_even(costs::numeric * 10000, 10000 - selling_bp) end,
      'irr_bp', case when irr is not null then least(greatest(round(irr * 10000), -2147483647), 2147483647)::integer end
    )
  );
end;
$function$;
grant execute on function pg_temp.gpr_old(uuid, date, date) to authenticated, service_role;

select tests.authenticate_as('pp_owner');

-- Sanity: the fixtures reach the rules the rewrite must keep.
select is((public.get_property_returns(pg_temp.id('refi'), '2026-01-01', '2026-12-31')->'deal'->>'holding_minor')::bigint, -40000::bigint,
  'the refinance closing''s taxes and fees are not holding (the fixture reaches the refinance rule)');
select is((public.get_property_returns(pg_temp.id('hml'), '2026-01-01', '2026-12-31')->'inputs'->'taken_over_loans'->0->>'draws_minor')::bigint, 3000000::bigint,
  'the hard-money loan''s draws are found (the fixture reaches the draws rule)');
select ok((public.get_property_returns(pg_temp.id('plain'), '2026-01-01', '2026-12-31')->'metrics'->>'irr_bp') is not null,
  'the IRR is computed (the fixture reaches the IRR inputs)');

-- Parity: the whole JSON, for each property and range.
select is(public.get_property_returns(pg_temp.id('refi'), '2026-01-01', '2026-12-31'), pg_temp.gpr_old(pg_temp.id('refi'), '2026-01-01', '2026-12-31'),
  'a property with a refinance: the year is the same as before');
select is(public.get_property_returns(pg_temp.id('refi'), '2026-07-01', '2026-09-30'), pg_temp.gpr_old(pg_temp.id('refi'), '2026-07-01', '2026-09-30'),
  'a property with a refinance: a quarter is the same as before');
select is(public.get_property_returns(pg_temp.id('refi')), pg_temp.gpr_old(pg_temp.id('refi')),
  'a property with a refinance: the default range is the same as before');
select is(public.get_property_returns(pg_temp.id('hml'), '2026-01-01', '2026-12-31'), pg_temp.gpr_old(pg_temp.id('hml'), '2026-01-01', '2026-12-31'),
  'a property with draws: the year is the same as before');
select is(public.get_property_returns(pg_temp.id('hml'), '2026-07-01', '2026-09-30'), pg_temp.gpr_old(pg_temp.id('hml'), '2026-07-01', '2026-09-30'),
  'a property with draws: a quarter is the same as before');
select is(public.get_property_returns(pg_temp.id('hml')), pg_temp.gpr_old(pg_temp.id('hml')),
  'a property with draws: the default range is the same as before');
select is(public.get_property_returns(pg_temp.id('plain'), '2026-01-01', '2026-12-31'), pg_temp.gpr_old(pg_temp.id('plain'), '2026-01-01', '2026-12-31'),
  'a property with neither: the year is the same as before');
select is(public.get_property_returns(pg_temp.id('plain'), '2026-07-01', '2026-09-30'), pg_temp.gpr_old(pg_temp.id('plain'), '2026-07-01', '2026-09-30'),
  'a property with neither: a quarter is the same as before');
select is(public.get_property_returns(pg_temp.id('plain')), pg_temp.gpr_old(pg_temp.id('plain')),
  'a property with neither: the default range is the same as before');
-- A range before the purchase and one after every line: empty periods, the same.
select is(public.get_property_returns(pg_temp.id('refi'), '2025-01-01', '2025-12-31'), pg_temp.gpr_old(pg_temp.id('refi'), '2025-01-01', '2025-12-31'),
  'a range before the purchase is the same as before');
select is(public.get_property_returns(pg_temp.id('hml'), '2028-01-01', '2028-12-31'), pg_temp.gpr_old(pg_temp.id('hml'), '2028-01-01', '2028-12-31'),
  'a range after every line is the same as before');

-- The refinance set is the same as before, and empty where there is none.
select is(array(select x from private.refinance_transactions(pg_temp.id('co'), pg_temp.id('refi'), 'ILS') x order by x),
  array(select x from pg_temp.refi_old(pg_temp.id('co'), pg_temp.id('refi'), 'ILS') x order by x),
  'private.refinance_transactions: the same set as before');
select is((select count(*) from private.refinance_transactions(pg_temp.id('co'), pg_temp.id('refi'), 'ILS')), 1::bigint, 'and the refinance closing is in it');
select is(array(select x from private.refinance_transactions(pg_temp.id('co'), pg_temp.id('plain'), 'ILS') x), '{}'::uuid[],
  'a property with no loan that starts after closing has none');

select * from finish();
rollback;
