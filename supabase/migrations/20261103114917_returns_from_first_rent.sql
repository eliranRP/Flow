-- FLOW-464 (decision 0249): the per-year metrics of a property rented for less than the period.
--
-- Cash on cash, cap rate and the cash flow per unit scaled the period's figures to a year over the
-- whole period (365 / days). The statement starts at the first rent, so a property first rented
-- three weeks into a twelve-month period read as a twelfth of what it earns. When the first rent
-- falls inside the period, those metrics scale over the days from the first rent to the period's
-- end instead (earning_days, annualized_from). Months empty after the first rent still count: the
-- scaling averages over every day since it. The total return keeps the whole period, whose
-- principal, appreciation and tax savings run over all of it.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

do $returns$
declare
  def text;
  a_decl constant text := $a$  annual numeric;
$a$;
  a_tot constant text := $a$  total := cash_flow + principal + coalesce(appreciation, 0) + coalesce(tax, 0);
$a$;
  a_days constant text := $a$    'days', days,
$a$;
  a_coc constant text := $a$'cash_on_cash_bp', case when money_in > 0 then round(cash_flow * annual * 10000 / money_in)::integer end,$a$;
  a_cap constant text := $a$'cap_rate_bp', case when p.value_minor > 0 then round(noi * annual * 10000 / p.value_minor)::integer end,$a$;
  a_unit constant text := $a$'cash_flow_per_unit_month_minor', round(cash_flow * 365.0 / (units * days * 12))::bigint$a$;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_decl) <> 1 or pg_temp.anchor_count(def, a_tot) <> 1
    or pg_temp.anchor_count(def, a_days) <> 1 or pg_temp.anchor_count(def, a_coc) <> 1
    or pg_temp.anchor_count(def, a_cap) <> 1 or pg_temp.anchor_count(def, a_unit) <> 1
  then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, a_decl, a_decl || $n$  earning_days integer;
  earn_annual numeric;
$n$);
  def := replace(def, a_tot, a_tot || $n$  -- FLOW-464: a first rent inside the period scales the per-year metrics over the days since it.
  earning_days := case when first_rent > d_from and first_rent <= d_to then d_to - first_rent + 1 else days end;
  earn_annual := 365.0 / earning_days;
$n$);
  def := replace(def, a_days, a_days || $n$    'earning_days', earning_days,
    'annualized_from', case when earning_days < days then first_rent end,
$n$);
  def := replace(def, a_coc, $n$'cash_on_cash_bp', case when money_in > 0 then round(cash_flow * earn_annual * 10000 / money_in)::integer end,$n$);
  def := replace(def, a_cap, $n$'cap_rate_bp', case when p.value_minor > 0 then round(noi * earn_annual * 10000 / p.value_minor)::integer end,$n$);
  def := replace(def, a_unit, $n$'cash_flow_per_unit_month_minor', round(cash_flow * 365.0 / (units * earning_days * 12))::bigint$n$);
  execute def;
end
$returns$;

drop function pg_temp.anchor_count(text, text);

commit;
