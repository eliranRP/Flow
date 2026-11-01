-- FLOW-453 (decision 0245, amends 0244): a property's returns from its real lines.
--
-- 1. Cash lines only: a line the cash view leaves out (a journal entry such as depreciation, a
--    category out of cash, the owner's own switch) is not in the statement or in the money in.
-- 2. The first rent payment splits the property's life. Before it the owner is still investing;
--    from it on the property earns. Every line before it, and every kept-out line at any time
--    (purchase, closing, loan proceeds, refunds), is the money in the deal, in four parts:
--    acquisition (kept-out costs: the purchase and closing), renovation (rehab categories before
--    the rent), holding (every other cost before the rent: interest, insurance, utilities) and
--    financing (kept-out income: loan proceeds, closing refunds). So loan costs held back at
--    closing count, through the net proceeds, and a cash-out refinance lowers the money in.
-- 3. The statement counts the lines from the first rent on; a period's lines before it are listed
--    apart (before_rent_minor).
-- 4. The purchase price is the acquisition lines when there are any, the typed figure otherwise.
-- 5. Money in at or below zero: all the cash came out (all_cash_out), the per-cent figures are null.

begin;

drop function if exists private.property_lines(uuid, uuid, date, date);

-- The project's posted, paid, cash lines (its own and its share of shared ones), with the line of
-- the statement each feeds. p_from null reads all time.
create function private.property_lines(p_company_id uuid, p_project_id uuid, p_from date, p_to date)
returns table (
  transaction_id uuid,
  part text,
  category_id uuid,
  currency text,
  amount_minor bigint,
  line_date date,
  shared boolean,
  line text,
  in_rehab boolean
)
language sql
stable
set search_path = ''
as $$
  with own as (
    select l.transaction_id, l.part, l.category_id, l.currency, l.kind,
      l.amount_net::bigint as amount_minor, coalesce(l.cash_date, l.doc_date) as line_date, false as shared
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.pnl_role is distinct from 'shared'::public.pnl_role
      and not l.unpaid
    union all
    select l.transaction_id, l.part, l.category_id, l.currency, l.kind,
      coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)::bigint,
      coalesce(l.cash_date, l.doc_date), true
    from private.pnl_lines l
    cross join lateral (
      select a.amount_net from public.allocations a
      where a.transaction_id = l.transaction_id and a.project_id = p_project_id
      offset 0
    ) a
    where l.transaction_id = any(array(
        select a2.transaction_id from public.allocations a2
        where a2.company_id = p_company_id and a2.project_id = p_project_id
      ))
      and l.company_id = p_company_id
      and l.pnl_role = 'shared'::public.pnl_role
      and not l.unpaid
  ),
  cash as (
    select o.*, c.excluded_from_pnl, c.rehab, c.loan_part
    from own o
    join public.transactions t on t.id = o.transaction_id and t.company_id = p_company_id
    left join public.categories c on c.id = o.category_id and c.company_id = p_company_id
    where o.amount_minor <> 0
      -- As the cash view counts a line (decision 0170): the owner's switch, else the category.
      and coalesce(
        t.in_cash_override,
        not private.line_category_out(
          c.in_cash is false,
          t.category_suggested and o.category_id is not distinct from t.category_id,
          o.part
        )
      )
  ),
  rent as (
    -- The first rent payment: the first income line that counts, in the project's investment currency.
    select min(x.line_date) as first_rent
    from cash x
    join public.projects pr on pr.id = p_project_id and pr.investment_currency = x.currency
    where x.kind = 'income' and not coalesce(x.excluded_from_pnl, false)
  )
  select x.transaction_id, x.part::text, x.category_id, x.currency, x.amount_minor, x.line_date, x.shared,
    case
      when x.kind = 'income' and coalesce(x.excluded_from_pnl, false) then 'financing'
      when x.kind = 'income' then 'income'
      -- A loan payment's principal, interest and fees: debt service once the property earns,
      -- holding before (its categories are kept out of the P&L, but it is not the purchase).
      when coalesce(x.loan_part::text, x.part::text) in ('principal', 'interest', 'fees') then
        case when r.first_rent is null or x.line_date < r.first_rent then 'holding' else 'debt_service' end
      when coalesce(x.excluded_from_pnl, false) and x.rehab is not true then 'acquisition'
      when r.first_rent is null or x.line_date < r.first_rent then
        case when x.rehab is true then 'renovation' else 'holding' end
      when x.rehab is true then 'capex'
      else 'opex'
    end,
    x.kind = 'expense' and private.category_in_rehab(x.rehab, x.excluded_from_pnl, coalesce(x.loan_part, x.part))
  from cash x
  cross join rent r
  where p_from is null or x.line_date between p_from and p_to;
$$;
revoke all on function private.property_lines(uuid, uuid, date, date) from public, anon;
grant execute on function private.property_lines(uuid, uuid, date, date) to authenticated, service_role;

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
    purchase := -acquisition;
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
  if p.units is null then
    missing := array_append(missing, 'units');
  end if;

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
      'units', p.units,
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
      'cash_flow_per_unit_month_minor', case when p.units is not null
        then round(cash_flow * 365.0 / (p.units * days * 12))::bigint end
    )
  );
end;
$$;
comment on function public.get_property_returns(uuid, date, date) is
  'FLOW-450/453: a property''s cash-flow statement from its first rent, sources of return, money in from its real lines (acquisition, renovation and holding before the rent, financing), equity and metrics, with the missing inputs named. Decisions 0244 and 0245.';

-- The lines behind one figure. For the period: income, opex, debt_service, capex, principal,
-- before_rent (holding and renovation in the period) and not_counted (acquisition and financing
-- in the period). All time: rehab (the building cost), acquisition, renovation, holding,
-- financing and money_in (the four together).
create or replace function public.get_property_return_lines(
  p_project_id uuid,
  p_line text,
  p_from date default null,
  p_to date default null,
  p_category_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cid uuid;
  cur text;
  d_from date;
  d_to date;
  result jsonb;
  all_time constant text[] := array['rehab', 'acquisition', 'renovation', 'holding', 'financing', 'money_in'];
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  -- Another company's project reads as not found before any argument is checked.
  select pr.investment_currency into cur from public.projects pr where pr.id = p_project_id and pr.company_id = cid;
  if cur is null then
    return null;
  end if;
  if p_line is null or p_line not in ('income', 'opex', 'debt_service', 'capex', 'principal', 'before_rent',
      'not_counted', 'rehab', 'acquisition', 'renovation', 'holding', 'financing', 'money_in')
    or (p_from is null) <> (p_to is null) or p_from > p_to
    or p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0
  then
    raise exception 'validation' using errcode = '22023';
  end if;
  if not p_line = any(all_time) then
    d_to := coalesce(p_to, (now() at time zone 'Asia/Jerusalem')::date);
    d_from := coalesce(p_from, (d_to - interval '1 year')::date + 1);
  end if;

  with picked as (
    select x.*
    from private.property_lines(cid, p_project_id, d_from, d_to) x
    where x.currency = cur
      and case p_line
        when 'rehab' then x.in_rehab
        when 'principal' then x.line = 'debt_service' and x.part = 'principal'
        when 'before_rent' then x.line in ('holding', 'renovation')
        when 'not_counted' then x.line in ('acquisition', 'financing')
        when 'money_in' then x.line in ('acquisition', 'renovation', 'holding', 'financing')
        else x.line = p_line
      end
      and (p_category_id is null or x.category_id = p_category_id)
  ),
  per_line as (
    select k.transaction_id, k.category_id, bool_or(k.shared) as shared, max(k.line_date) as line_date,
      sum(k.amount_minor)::bigint as amount_minor, string_agg(distinct k.part, ',') as parts
    from picked k
    group by k.transaction_id, k.category_id
  ),
  page as (
    select r.*, t.description, sup.name as supplier_name, c.name as category_name
    from per_line r
    join public.transactions t on t.id = r.transaction_id and t.company_id = cid
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.categories c on c.id = r.category_id and c.company_id = cid
    order by r.line_date desc, r.transaction_id, r.category_id
    limit p_limit + 1 offset p_offset
  )
  select jsonb_build_object(
    'line', p_line,
    'currency', cur,
    'from', d_from,
    'to', d_to,
    'total_minor', (select coalesce(sum(r.amount_minor), 0)::bigint from per_line r),
    'count', (select count(*)::integer from per_line r),
    'has_more', (select count(*) from page) > p_limit,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', g.transaction_id,
        'description', g.description,
        'supplier_name', g.supplier_name,
        'category_id', g.category_id,
        'category_name', g.category_name,
        'date', g.line_date,
        'amount_minor', g.amount_minor,
        'parts', g.parts,
        'shared', g.shared
      ) order by g.line_date desc, g.transaction_id, g.category_id)
      from (select * from page order by line_date desc, transaction_id, category_id limit p_limit) g
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

commit;
