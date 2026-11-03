-- FLOW-1025 (decision 0251, amends 0245): the money in the deal counts what the owner adds to cover
-- a negative cash flow, and how long the cash taken out still lasts.
--
-- - money_in_parts.shortfall_minor: the running cash flow since the first rent, all time, when it is
--   below zero (signed as the lines: negative), else 0. Money in adds it: a rental that loses money
--   every month uses up the cash a refinance took out, then needs the owner's own money again, and
--   money in follows it from below zero to above.
-- - equity.cash_out_cover_months: with all the cash out (money in below zero) and a negative cash
--   flow in the period, how many whole months of that cash flow, at its yearly pace, the cash still
--   out covers. Null otherwise.

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
  a_decl constant text := $a$  earn_annual numeric;
$a$;
  a_money constant text := $a$  money_in := -(acquisition + renovation + holding + financing);
$a$;
  a_parts constant text := $a$        'financing_minor', financing
      ),
      'all_cash_out', money_in <= 0
$a$;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_decl) <> 1 or pg_temp.anchor_count(def, a_money) <> 1
    or pg_temp.anchor_count(def, a_parts) <> 1
  then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, a_decl, a_decl || $n$  shortfall bigint;
$n$);
  def := replace(def, a_money, $n$  -- FLOW-1025: the running cash flow since the first rent, when below zero, is money the owner put in.
  shortfall := least(coalesce((life->>'income')::bigint, 0) + coalesce((life->>'opex')::bigint, 0)
    + coalesce((life->>'debt_service')::bigint, 0) + coalesce((life->>'capex')::bigint, 0), 0);
  money_in := -(acquisition + renovation + holding + financing + shortfall);
$n$);
  def := replace(def, a_parts, $n$        'financing_minor', financing,
        'shortfall_minor', shortfall
      ),
      'all_cash_out', money_in <= 0,
      'cash_out_cover_months', case when money_in < 0 and cash_flow < 0
        then floor(-money_in * 12 / (-cash_flow * earn_annual))::integer end
$n$);
  execute def;
end
$returns$;

drop function pg_temp.anchor_count(text, text);

commit;
