-- FLOW-1066 (owner, 2026-11-06: "I want to see the forecast revenue on any future month"; decision 0260, amends
-- 0200): the forecast reaches 12 months after the current one (next month through the same month next year,
-- packages/shared/src/forecast-horizon.ts), not only the rest of the year.
--
-- - company_next_month_inputs: rest_edits (every edit of the company's projects that applies to a later month,
--   with an added edit's matched line by month) covers every month of the horizon, next month to 12 ahead, in
--   place of the months left in this year. The year view's card (decision 0200) keeps summing this year's
--   months only; it filters them itself. Every other key is as it was.
-- - expected_months: p_months may be 13 (this month and the horizon's 12), so its months[] cells reach the
--   horizon's last month. Its recurring[] was never limited by p_months: every charge comes back with its pace
--   and next due month, and the app builds any month from it (forecast_any_month.test.sql says so).
--
-- Both bodies are patched in place: each anchor must be found exactly once, or the migration fails.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

do $inputs$
declare
  def text;
  a_months constant text := $a$  -- The months left in this year after this one: none in December.
  rest_months := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', date_trunc('year', today) + interval '11 months', interval '1 month') m
  );
$a$;
  a_comment constant text := $a$  -- The rest of the year's edits: every edit (of the same projects) that applies to any month left in the
  -- year, with each added edit's matched line by month, so the year's forecast applies each month's own.
$a$;
begin
  def := pg_get_functiondef('public.company_next_month_inputs(date)'::regprocedure);
  if pg_temp.anchor_count(def, a_months) <> 1 or pg_temp.anchor_count(def, a_comment) <> 1 then
    raise exception 'company_next_month_inputs is not the expected definition';
  end if;
  def := replace(def, a_months, $n$  -- FLOW-1066: the forecast's months, next month to 12 months after this one (forecast-horizon.ts).
  rest_months := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', this_month + interval '12 months', interval '1 month') m
  );
$n$);
  def := replace(def, a_comment, $n$  -- The later months' edits: every edit (of the same projects) that applies to any month of the forecast,
  -- with each added edit's matched line by month, so each month's forecast applies its own.
$n$);
  execute def;
end
$inputs$;

do $expected$
declare
  def text;
  a_range constant text := $a$  if p_months is null or p_months < 1 or p_months > 12 then
$a$;
begin
  def := pg_get_functiondef('public.expected_months(integer,uuid,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_range) <> 1 then
    raise exception 'expected_months is not the expected definition';
  end if;
  -- FLOW-1066: this month and the forecast's 12.
  def := replace(def, a_range, $n$  if p_months is null or p_months < 1 or p_months > 13 then
$n$);
  execute def;
end
$expected$;

drop function pg_temp.anchor_count(text, text);

commit;
