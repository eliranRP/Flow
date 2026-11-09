-- FLOW-1126 (FLOW-1125's plan, option A approved 2026-11-09): the member report's forecast.
--
-- 1. public.get_member_projection_inputs() (owner and viewers): each property's starting point for the forecast,
--    read only when the forecast opens, so the report's own read stays as it is:
--    - rent_minor: the scheduled rent, the median of the last three full months' rent, so neither a month with
--      a turnover or a late payment nor one with two payments sets it, and empty months are not counted twice;
--    - rented_months: the months since the first rent, at most 12, to scale a partial year's costs (a vacant
--      month in a rented year is not a partial year);
--    - costs: the last 12 full months of opex lines after the first rent, by category, as costs (positive);
--      debt service and CapEx are left out (the loans' schedules and the CapEx reserve take their place);
--    - units; and each open loan's terms and rate changes, for its schedule (principal and interest only).
-- 2. The setting's `projection` part: the assumptions, the by-year changes and the category types, all
--    optional (the defaults live in packages/shared), validated by private.member_projection_check within
--    FLOW-1125's bounds. set_member_report sets it like the other parts; undo is kind member_report.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- ===========================================================================
-- 1 the inputs
-- ===========================================================================

create function private.member_projection_input(p_company_id uuid, p_project_id uuid, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cur text;
  units integer;
  d_from date := (p_to - interval '12 months')::date + 1;
  rent bigint;
  months integer;
  costs jsonb;
  loans jsonb;
begin
  select p.investment_currency, coalesce(p.units, 1) into cur, units
  from public.projects p where p.id = p_project_id and p.company_id = p_company_id;
  -- The rent of each of the last three full months (a month with none counts as none); the median is the
  -- scheduled rent.
  select percentile_disc(0.5) within group (order by coalesce(m.amount, 0)) into rent
  from generate_series(date_trunc('month', p_to) - interval '2 months', date_trunc('month', p_to), interval '1 month') g(month)
  left join (
    select date_trunc('month', a.line_date) as month, sum(a.amount_minor) as amount
    from private.property_lines(p_company_id, p_project_id, (date_trunc('month', p_to) - interval '2 months')::date, p_to) a
    where a.currency = cur and a.line = 'income'
    group by 1
  ) m on m.month = g.month;
  -- The months since the first rent, at most 12.
  select least(12, (extract(year from age(date_trunc('month', p_to), date_trunc('month', min(a.line_date)))) * 12
      + extract(month from age(date_trunc('month', p_to), date_trunc('month', min(a.line_date)))))::integer + 1)
  into months
  from private.property_lines(p_company_id, p_project_id, null, null) a
  where a.currency = cur and a.line = 'income' and a.line_date <= p_to;
  select coalesce(jsonb_agg(jsonb_build_object('category_id', x.category_id, 'name', x.name, 'amount_minor', x.amount)
    order by x.amount desc), '[]'::jsonb)
  into costs
  from (
    select a.category_id, c.name, (-sum(a.amount_minor))::bigint as amount
    from private.property_lines(p_company_id, p_project_id, d_from, p_to) a
    left join public.categories c on c.id = a.category_id and c.company_id = p_company_id
    where a.currency = cur and a.line = 'opex'
    group by a.category_id, c.name
    having sum(a.amount_minor) <> 0
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object(
      'loan_id', l.id,
      'kind', l.kind,
      'currency', l.currency,
      'principal_minor', l.principal_minor,
      'annual_rate_ppm', l.annual_rate_ppm,
      'term_months', l.term_months,
      'start_date', l.start_date,
      'payment_minor', l.payment_minor,
      'interest_only_months', l.interest_only_months,
      'amortization_months', l.amortization_months,
      'balance_minor', coalesce(b.balance_minor, 0)::bigint,
      'rates', coalesce((
        select jsonb_agg(jsonb_build_object('effective_date', r.effective_date, 'annual_rate_ppm', r.annual_rate_ppm)
          order by r.effective_date)
        from public.loan_rates r where r.loan_id = l.id and r.company_id = p_company_id), '[]'::jsonb)
    ) order by l.id), '[]'::jsonb)
  into loans
  from public.loans l
  left join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
  where l.company_id = p_company_id and l.project_id = p_project_id and l.status = 'open'::public.loan_status;
  return jsonb_build_object(
    'project_id', p_project_id,
    'rent_minor', coalesce(rent, 0),
    'rented_months', coalesce(months, 0),
    'units', units,
    'costs', costs,
    'loans', loans
  );
end;
$$;
revoke all on function private.member_projection_input(uuid, uuid, date) from public, anon, authenticated;

create function public.get_member_projection_inputs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  d_to date;
  props jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  -- The last full month ends the window.
  d_to := (date_trunc('month', (now() at time zone 'Asia/Jerusalem')::date) - interval '1 day')::date;
  select coalesce(jsonb_agg(private.member_projection_input(cid, p.id, d_to) order by p.name), '[]'::jsonb)
  into props
  from public.projects p
  join public.companies c on c.id = p.company_id
  where p.company_id = cid
    and p.status = 'active'::public.project_status
    and p.id is distinct from c.overhead_project_id
    and (p.value_minor is not null or exists (
      select 1 from public.loans l
      where l.company_id = cid and l.project_id = p.id and l.status = 'open'::public.loan_status));
  -- `today`: the date today's loan balances are at, for the schedules' anchor.
  return jsonb_build_object('as_of', d_to, 'today', (now() at time zone 'Asia/Jerusalem')::date, 'properties', props);
end;
$$;
revoke all on function public.get_member_projection_inputs() from public, anon;
grant execute on function public.get_member_projection_inputs() to authenticated;
comment on function public.get_member_projection_inputs() is
  'FLOW-1126: each report property''s starting point for the forecast: scheduled rent, months rented, the last 12 full months of opex by category, units, and its open loans'' terms. Decision 0264.';

-- ===========================================================================
-- 2 the projection part
-- ===========================================================================

create function private.member_projection_check(p_part jsonb, p_company_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  series text;
begin
  if jsonb_typeof(p_part) <> 'object' then
    raise exception 'validation';
  end if;
  for k, v in select * from jsonb_each(p_part) loop
    if k in ('rent_growth_bp', 'tax_growth_bp', 'insurance_growth_bp', 'hoa_growth_bp', 'other_growth_bp', 'appreciation_bp') then
      if not private.json_int_between(v, -2000, 3000) then raise exception 'validation'; end if;
    elsif k in ('maintenance_bp', 'capex_bp') then
      if not private.json_int_between(v, 0, 3000) then raise exception 'validation'; end if;
    elsif k = 'stay_months' then
      if not private.json_int_between(v, 1, 120) then raise exception 'validation'; end if;
    elsif k = 'empty_months_tenths' then
      if not private.json_int_between(v, 0, 120) then raise exception 'validation'; end if;
    elsif k = 'turnover_cost_minor' then
      if not private.json_int_between(v, 0, 10000000) then raise exception 'validation'; end if;
    elsif k = 'ltv_bp' then
      if not private.json_int_between(v, 0, 10000) then raise exception 'validation'; end if;
    elsif k = 'closing_bp' then
      if not private.json_int_between(v, 0, 2000) then raise exception 'validation'; end if;
    elsif k = 'rate_ppm' then
      if jsonb_typeof(v) <> 'null' and not private.json_int_between(v, 0, 300000) then raise exception 'validation'; end if;
    elsif k = 'term_years' then
      if not private.json_int_between(v, 1, 40) then raise exception 'validation'; end if;
    elsif k = 'years' then
      if not private.json_int_between(v, 1, 10) then raise exception 'validation'; end if;
    elsif k = 'by_year' then
      -- {"rent": {"2": 500}, ...}: a series' change in a given year, 1 to 10, as basis points.
      if jsonb_typeof(v) <> 'object' then raise exception 'validation'; end if;
      for series in select jsonb_object_keys(v) loop
        if series not in ('rent', 'tax', 'insurance', 'hoa', 'other', 'appreciation')
          or jsonb_typeof(v->series) <> 'object'
          or exists (
            select 1 from jsonb_each(v->series) y
            where y.key !~ '^([1-9]|10)$' or not private.json_int_between(y.value, -2000, 3000))
        then
          raise exception 'validation';
        end if;
      end loop;
    elsif k = 'category_types' then
      -- {"<category id>": "tax" | "insurance" | "hoa" | "repairs" | "other"}, not another company's categories.
      if jsonb_typeof(v) <> 'object'
        or (select count(*) from jsonb_object_keys(v)) > 200
        or exists (
          select 1 from jsonb_each(v) t
          where t.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or jsonb_typeof(t.value) <> 'string'
            or t.value #>> '{}' not in ('tax', 'insurance', 'hoa', 'repairs', 'other')
            -- Another company's category is refused; one deleted since is ignored, so a deletion never locks the setting.
            or exists (select 1 from public.categories c where c.id = t.key::uuid and c.company_id <> p_company_id))
      then
        raise exception 'validation';
      end if;
    else
      raise exception 'validation';
    end if;
  end loop;
end;
$$;
revoke all on function private.member_projection_check(jsonb, uuid) from public, anon, authenticated;

do $check$
declare
  def text;
  a_keys constant text := $a$where k not in ('members', 'assumptions', 'rate_rule', 'quotes', 'yields', 'quote_date'))$a$;
  a_date constant text := $a$  part := p_config->'quote_date';$a$;
begin
  def := pg_get_functiondef('private.member_report_check(uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_keys) <> 1 or pg_temp.anchor_count(def, a_date) <> 1 then
    raise exception 'member_report_check is not the expected definition';
  end if;
  def := replace(def, a_keys, $n$where k not in ('members', 'assumptions', 'rate_rule', 'quotes', 'yields', 'quote_date', 'projection'))$n$);
  def := replace(def, a_date, $n$  -- FLOW-1126: the forecast's assumptions.
  if p_config ? 'projection' then
    perform private.member_projection_check(p_config->'projection', p_company_id);
  end if;

$n$ || a_date);
  execute def;
end
$check$;

drop function pg_temp.anchor_count(text, text);

commit;
