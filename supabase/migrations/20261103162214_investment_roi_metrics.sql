-- FLOW-1068 (decision 0260): ROI, a renovation's net profit, and more of the book's deal metrics on
-- get_property_returns.
--
-- 1. A new input, projects.selling_cost_bp: the costs of selling (agent, closing, transfer taxes) as
--    basis points of the ARV, 0 to 30%. Null reads as 8%, the default the owner approved. It is set
--    with set_project_investment and undone with kind project_investment, as the other figures.
-- 2. get_property_returns gains a `deal` object: the effective selling cost, the net profit at the
--    sale (ARV - selling costs - purchase - rehab - the holding costs rehab does not count; Real Estate by the Numbers Ch 42
--    counts all four buckets), the first purchase line's date, the days held, and the cash flow
--    since the first rent, all time.
-- 3. Its metrics gain: return on equity, ROI since purchase and the equity multiplier, break-even
--    occupancy, loan to value, the gross rent multiplier and the expense ratio (a rental); and ROI
--    on the money in, ROI per year, the margin on the ARV, the 70% rule and the break-even sale
--    price (a renovation). Each is null when an input it needs is missing.
--
-- forced_equity_minor (ARV - purchase - rehab) stays as it was: a rental's forced appreciation.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- ===========================================================================
-- 1 the input
-- ===========================================================================

alter table public.projects
  add column selling_cost_bp integer,
  add constraint projects_selling_cost_check check (selling_cost_bp is null or selling_cost_bp between 0 and 3000);
comment on column public.projects.selling_cost_bp is
  'FLOW-1068: the costs of selling the property (agent, closing, transfer taxes) in basis points of the ARV (800 = 8%). Null reads as 8%.';

create or replace function private.project_figures(p_company_id uuid, p_project_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'currency', p.investment_currency,
    'purchase_minor', p.purchase_minor,
    'arv_minor', p.arv_minor,
    'value_minor', p.value_minor,
    'value_date', p.value_date,
    'units', p.units,
    'land_minor', p.land_minor,
    'selling_cost_bp', p.selling_cost_bp
  )
  from public.projects p
  where p.id = p_project_id and p.company_id = p_company_id;
$$;

do $set_inv$
declare
  def text;
  a_units constant text := $a$    elsif k = 'units' then$a$;
  a_set constant text := $a$      land_minor = case when p_patch ? 'land_minor' then (p_patch->>'land_minor')::bigint else p.land_minor end,
$a$;
begin
  def := pg_get_functiondef('public.set_project_investment(uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_units) <> 1 or pg_temp.anchor_count(def, a_set) <> 1 then
    raise exception 'set_project_investment is not the expected definition';
  end if;
  def := replace(def, a_units, $n$    elsif k = 'selling_cost_bp' then
      if jsonb_typeof(v) <> 'null'
         and (jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,4}$' or v::text::integer > 3000)
      then
        raise exception 'validation';
      end if;
$n$ || a_units);
  def := replace(def, a_set, a_set || $n$      selling_cost_bp = case when p_patch ? 'selling_cost_bp' then (p_patch->>'selling_cost_bp')::integer else p.selling_cost_bp end,
$n$);
  execute def;
end
$set_inv$;
comment on function public.set_project_investment(uuid, jsonb) is
  'Sets a project''s investment currency, purchase, ARV, value, units, land and selling cost (owner only); a key left out keeps its figure, a null clears it. Decisions 0143, 0244 and 0260.';

-- mcp_undo project_investment puts the selling cost back too. A write made before this migration has
-- no selling_cost_bp in its figures: its undo leaves the selling cost as it is and compares the rest.
do $undo_inv$
declare
  def text;
  a_check constant text := $a$      if not found or private.project_figures(cid, p_id) is distinct from rec.prior->'after' then$a$;
  a_set constant text := $a$            land_minor = (rec.prior->'before'->>'land_minor')::bigint
        where p.id = p_id and p.company_id = cid;$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_check) <> 1 or pg_temp.anchor_count(def, a_set) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_check, $n$      if not found or (case when rec.prior->'after' ? 'selling_cost_bp' then private.project_figures(cid, p_id)
          else private.project_figures(cid, p_id) - 'selling_cost_bp' end) is distinct from rec.prior->'after' then$n$);
  def := replace(def, a_set, $n$            land_minor = (rec.prior->'before'->>'land_minor')::bigint,
            selling_cost_bp = case when rec.prior->'before' ? 'selling_cost_bp'
              then (rec.prior->'before'->>'selling_cost_bp')::integer else p.selling_cost_bp end
        where p.id = p_id and p.company_id = cid;$n$);
  execute def;
end
$undo_inv$;

-- ===========================================================================
-- 2, 3 get_property_returns
-- ===========================================================================

do $returns$
declare
  def text;
  a_decl constant text := $a$  service_days integer;
$a$;
  a_select constant text := $a$    pr.units, pr.land_minor
  into p$a$;
  a_return constant text := $a$  return jsonb_build_object(
    'currency', cur,$a$;
  a_metrics constant text := $a$    'metrics', jsonb_build_object(
$a$;
  a_per_unit constant text := $a$      'cash_flow_per_unit_month_minor', round(cash_flow * 365.0 / (units * earning_days * 12))::bigint
$a$;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_decl) <> 1 or pg_temp.anchor_count(def, a_select) <> 1
    or pg_temp.anchor_count(def, a_return) <> 1 or pg_temp.anchor_count(def, a_metrics) <> 1
    or pg_temp.anchor_count(def, a_per_unit) <> 1
  then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, a_decl, a_decl || $n$  acquired_on date;
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
$n$);
  def := replace(def, a_select, $n$    pr.units, pr.land_minor, pr.selling_cost_bp
  into p$n$);
  def := replace(def, a_return, $n$  -- FLOW-1068: the deal as a whole. The first purchase line dates the purchase; the cash flow since
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
  -- switched off, so a line can be both), signed as the lines: a cost is negative.
  select coalesce(sum(a.amount_minor), 0)::bigint into holding_out
  from private.property_lines(cid, p_project_id, null, null) a
  where a.currency = cur and a.line = 'holding' and not a.in_rehab;
  if purchase is not null and rehab is not null then
    costs := purchase + rehab - holding_out;
    if p.arv_minor is not null then
      net_profit := p.arv_minor - selling - costs;
    end if;
  end if;
  if net_profit is not null and money_in > 0 then
    flip_roi := net_profit * 10000.0 / money_in;
  end if;

$n$ || a_return);
  def := replace(def, a_metrics, $n$    'deal', jsonb_build_object(
      'selling_cost_bp', selling_bp,
      'selling_cost_default', p.selling_cost_bp is null,
      'selling_cost_minor', selling,
      'holding_minor', holding_out,
      'net_profit_minor', net_profit,
      'acquired_on', acquired_on,
      'held_days', held_days,
      'life_cash_flow_minor', life_cf
    ),
$n$ || a_metrics);
  def := replace(def, a_per_unit, $n$      'cash_flow_per_unit_month_minor', round(cash_flow * 365.0 / (units * earning_days * 12))::bigint,
      'roe_bp', case when equity > 0 then round(total * earn_annual * 10000 / equity)::integer end,
      'roi_since_purchase_bp', case when money_in > 0 and equity is not null
        then round((greatest(life_cf, 0) + equity - money_in) * 10000.0 / money_in)::integer end,
      'equity_multiple_milli', case when money_in > 0 and equity is not null
        then round((greatest(life_cf, 0) + equity) * 1000.0 / money_in)::integer end,
      'break_even_occupancy_bp', case when income > 0 then round((-opex - debt) * 10000.0 / income)::integer end,
      'expense_ratio_bp', case when income > 0 then round(-opex * 10000.0 / income)::integer end,
      'grm_milli', case when income > 0 and purchase is not null
        then round(purchase * 1000.0 / (income * earn_annual))::integer end,
      'ltv_bp', case when p.value_minor > 0 and loan_bal is not null
        then round(loan_bal * 10000.0 / p.value_minor)::integer end,
      'flip_roi_bp', round(flip_roi)::integer,
      'flip_roi_year_bp', case when held_days > 0 then round(flip_roi * 365 / held_days)::integer end,
      'arv_margin_bp', case when p.arv_minor > 0 and net_profit is not null
        then round(net_profit * 10000.0 / p.arv_minor)::integer end,
      'rule_70_minor', case when p.arv_minor is not null and costs is not null
        then private.div_half_even(p.arv_minor::numeric * 7, 10) - rehab - purchase end,
      'break_even_sale_minor', case when costs is not null and selling_bp < 10000
        then private.div_half_even(costs::numeric * 10000, 10000 - selling_bp) end
$n$);
  execute def;
end
$returns$;

drop function pg_temp.anchor_count(text, text);

commit;
