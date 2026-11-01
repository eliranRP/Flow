-- FLOW-454 (decision 0246, amends 0245): a property's returns, after the owner's look at real deals.
--
-- 1. The purchase price adds a loan paid out at closing without passing through the bank: a
--    mortgage taken over in a Sub2 deal, or a lender who paid the title company directly. The bank
--    shows only the cash the owner brought, so the price from the lines alone missed it; the money
--    in stays cash only. inputs.taken_over_minor and taken_over_loans name them.
-- 2. Units are 1 until the owner sets them (inputs.units_default), so cash flow per unit is never
--    missing.

begin;

create or replace function public.get_property_returns(p_project_id uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  select pr.investment_currency, pr.purchase_minor, pr.arv_minor, pr.value_minor, pr.value_date,
    pr.units, pr.land_minor
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
    select coalesce(sum(lo.principal_minor), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('loan_id', lo.id, 'name', lo.name, 'principal_minor', lo.principal_minor)
        order by lo.start_date), '[]'::jsonb)
    into taken_over, taken_over_loans
    from public.loans lo
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
  money_in := -(acquisition + renovation + holding + financing);
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
  if v_end.value_minor is null or p.value_minor is null then
    missing := array_append(missing, 'value');
  elsif v_start.value_minor is null then
    missing := array_append(missing, 'value_history');
  else
    appreciation := v_end.value_minor - v_start.value_minor;
  end if;

  if p.land_minor is null then
    missing := array_append(missing, 'land');
  end if;
  if bracket is null then
    missing := array_append(missing, 'tax_bracket');
  end if;
  if purchase is not null and rehab is not null and p.land_minor is not null then
    building := greatest(purchase + rehab - p.land_minor, 0);
    dep_year := private.div_half_even(building::numeric * 10, 275);
    if bracket is not null then
      tax := private.div_half_even(building::numeric * 10 * bracket * days, 275::numeric * 10000 * 365);
    end if;
  end if;
  -- One unit until the owner says otherwise.
  units := coalesce(p.units, 1);

  total := cash_flow + principal + coalesce(appreciation, 0) + coalesce(tax, 0);

  return jsonb_build_object(
    'currency', cur,
    'from', d_from,
    'to', d_to,
    'days', days,
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
      'land_minor', p.land_minor,
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
      'total_bp', case when money_in > 0 then round(total * annual * 10000 / money_in)::integer end
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
        'financing_minor', financing
      ),
      'all_cash_out', money_in <= 0
    ),
    'metrics', jsonb_build_object(
      'cash_on_cash_bp', case when money_in > 0 then round(cash_flow * annual * 10000 / money_in)::integer end,
      'cap_rate_bp', case when p.value_minor > 0 then round(noi * annual * 10000 / p.value_minor)::integer end,
      'dscr_milli', case when debt < 0 then round(noi * 1000.0 / -debt)::integer end,
      'cash_flow_per_unit_month_minor', round(cash_flow * 365.0 / (units * days * 12))::bigint
    )
  );
end;
$$;


commit;
