-- FLOW-1069 (decision 0261, step 4 of the plan): IRR since the purchase on get_property_returns, and the
-- review nit of FLOW-1070: the net profit's holding filter, and get_property_return_lines' deal_holding,
-- read a line's category before its part, as private.property_lines and category_in_rehab do.
--
-- 1. private.xirr(dates, amounts): the yearly rate that brings dated flows to a net present value of
--    zero (actual/365), by bisection between -99.99% and 10,000%. Null when the flows do not change sign
--    or no rate in that range brings them to zero.
-- 2. get_property_returns' `deal` gains the IRR's flows: irr_out_minor (what went in, negative),
--    irr_in_minor (what came back), irr_terminal_minor (what the owner holds at the period's end) and
--    irr_dates (how many dates); its metrics gain irr_bp. The flows are every line of the property up to
--    the period's end, signed as the owner's cash (the purchase, rehab, holding and loan payments out;
--    rent and loan proceeds in), from the first purchase line. The last flow, at the period's end, is
--    today's equity (value less the loans), or, with no value, the ARV less the selling costs and the
--    loans. Null without a purchase line, or with neither a value nor an ARV.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

create or replace function private.xirr(p_dates date[], p_amounts numeric[])
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  lo numeric := -0.9999;
  hi numeric := 100;
  mid numeric;
  f_lo numeric;
  f_hi numeric;
  f_mid numeric;
  d0 date;
  n integer := coalesce(array_length(p_dates, 1), 0);
  i integer;
  has_in boolean := false;
  has_out boolean := false;
begin
  if n < 2 or n <> coalesce(array_length(p_amounts, 1), 0) then
    return null;
  end if;
  for i in 1..n loop
    if p_amounts[i] > 0 then has_in := true; end if;
    if p_amounts[i] < 0 then has_out := true; end if;
  end loop;
  if not has_in or not has_out then
    return null;
  end if;
  select min(d) into d0 from unnest(p_dates) d;
  f_lo := private.xirr_npv(lo, p_dates, p_amounts, d0);
  f_hi := private.xirr_npv(hi, p_dates, p_amounts, d0);
  if f_lo is null or f_hi is null or sign(f_lo) = sign(f_hi) then
    return null;
  end if;
  for i in 1..200 loop
    mid := (lo + hi) / 2;
    f_mid := private.xirr_npv(mid, p_dates, p_amounts, d0);
    if f_mid = 0 or hi - lo < 0.0000001 then
      return mid;
    end if;
    if sign(f_mid) = sign(f_lo) then
      lo := mid;
      f_lo := f_mid;
    else
      hi := mid;
    end if;
  end loop;
  return (lo + hi) / 2;
end;
$$;

create or replace function private.xirr_npv(p_rate numeric, p_dates date[], p_amounts numeric[], p_d0 date)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select sum(a / power(1 + p_rate, (d - p_d0) / 365.0))
  from unnest(p_dates, p_amounts) as f(d, a);
$$;

-- As private.div_half_even: get_property_returns runs as the signed-in user.
revoke all on function private.xirr(date[], numeric[]) from public, anon;
revoke all on function private.xirr_npv(numeric, date[], numeric[], date) from public, anon;
grant execute on function private.xirr(date[], numeric[]) to authenticated, service_role;
grant execute on function private.xirr_npv(numeric, date[], numeric[], date) to authenticated, service_role;
comment on function private.xirr(date[], numeric[]) is
  'FLOW-1069: the yearly rate (actual/365) that brings dated flows to zero, by bisection; null without a sign change or a root between -99.99% and 10,000%.';

do $returns$
declare
  def text;
  a_decl constant text := $a$  holding_out bigint;
$a$;
  a_filter constant text := $a$    and coalesce(a.part, c.loan_part::text, '') <> 'principal';$a$;
  a_return constant text := $a$  return jsonb_build_object(
    'currency', cur,$a$;
  a_deal constant text := $a$      'life_cash_flow_minor', life_cf
    ),$a$;
  a_metrics constant text := $a$      'break_even_sale_minor', case when costs is not null and selling_bp < 10000
        then private.div_half_even(costs::numeric * 10000, 10000 - selling_bp) end
$a$;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_decl) <> 1 or pg_temp.anchor_count(def, a_filter) <> 1
    or pg_temp.anchor_count(def, a_return) <> 1 or pg_temp.anchor_count(def, a_deal) <> 1
    or pg_temp.anchor_count(def, a_metrics) <> 1
  then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, a_decl, a_decl || $n$  irr_terminal bigint;
  irr_dates date[];
  irr_amounts numeric[];
  irr_out bigint;
  irr_in bigint;
  irr numeric;
$n$);
  -- FLOW-1070: the category's loan part first, as property_lines and category_in_rehab read it.
  def := replace(def, a_filter, $n$    and coalesce(c.loan_part::text, a.part, '') <> 'principal';$n$);
  def := replace(def, a_return, $n$  -- FLOW-1069: the IRR since the purchase, on the owner's dated cash, with what is held at the period's end.
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

$n$ || a_return);
  def := replace(def, a_deal, $n$      'life_cash_flow_minor', life_cf,
      'irr_out_minor', irr_out,
      'irr_in_minor', irr_in,
      'irr_terminal_minor', irr_terminal,
      'irr_dates', coalesce(array_length(irr_dates, 1), 0)
    ),$n$);
  def := replace(def, a_metrics, $n$      'break_even_sale_minor', case when costs is not null and selling_bp < 10000
        then private.div_half_even(costs::numeric * 10000, 10000 - selling_bp) end,
      'irr_bp', case when irr is not null then least(greatest(round(irr * 10000), -2147483647), 2147483647)::integer end
$n$);
  execute def;
end
$returns$;

-- FLOW-1070: deal_holding reads the category's loan part first too, so its lines still add up to the figure.
do $lines$
declare
  def text;
  a_filter constant text := $a$coalesce(x.part, lc.loan_part::text, '') <> 'principal'$a$;
begin
  def := pg_get_functiondef('public.get_property_return_lines(uuid,text,date,date,uuid,integer,integer)'::regprocedure);
  if pg_temp.anchor_count(def, a_filter) <> 1 then
    raise exception 'get_property_return_lines is not the expected definition';
  end if;
  execute replace(def, a_filter, $n$coalesce(lc.loan_part::text, x.part, '') <> 'principal'$n$);
end
$lines$;

drop function pg_temp.anchor_count(text, text);

commit;
