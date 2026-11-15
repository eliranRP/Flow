-- FLOW-1202 (perf queue, decision 0230): company_next_month_inputs carries next month's skips in the slim answer
-- too (p_rest false: Company profit's month view and next month's card), so the app no longer sends
-- forecast_overrides_for(next month) beside it.
-- - skips is, as FLOW-1195 made it for p_rest true, an object by month of the moved_out item keys in item_key
--   order, a month with none having no key. With p_rest false it holds next month only; with p_rest true it is
--   the same as it was (next month to the horizon). The one query serves both; only the months it filters on differ.
-- - rest_edits stays with p_rest true only.
--
-- The body is patched in place: each anchor must be found exactly once, or the migration fails. Same signature,
-- security and grants (create or replace keeps them).

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.swap(p_def text, p_from text, p_to text)
returns text
language plpgsql
immutable
as $$
begin
  if (char_length(p_def) - char_length(replace(p_def, p_from, ''))) / char_length(p_from) <> 1 then
    raise exception 'anchor not found exactly once: %', left(p_from, 80);
  end if;
  return replace(p_def, p_from, p_to);
end;
$$;

do $inputs$
declare
  def text := pg_get_functiondef('public.company_next_month_inputs(date,boolean)'::regprocedure);
  -- The skips query as FLOW-1195 wrote it, inside the p_rest branch.
  skips_block constant text := $a$    -- FLOW-1195: each month's skips (forecast_overrides_for's moved_out keys), next month to the horizon, so the
    -- year view reads them with the rest of the answer, not once per month.
    select coalesce(jsonb_object_agg(s.month, s.item_keys order by s.month), '{}'::jsonb)
    into rest_skips
    from (
      select f.month, jsonb_agg(f.item_key order by f.item_key) as item_keys
      from public.forecast_overrides f
      where f.company_id = cid
        and f.moved_out
        and f.month = any(rest_months)
      group by f.month
    ) s;
$a$;
begin
  def := pg_temp.swap(def, $a$  rest_skips jsonb;$a$, $b$  month_skips jsonb;$b$);
  -- Out of the p_rest branch, and after it, for every answer.
  def := pg_temp.swap(def, skips_block || $a$  end if;
$a$, $b$  end if;

  -- FLOW-1195, FLOW-1202: each month's skips (forecast_overrides_for's moved_out keys). With p_rest, next month to
  -- the horizon, so the year view reads them with the rest of the answer, not once per month; without it, next
  -- month's only, which the card needs and reads no longer apart.
  select coalesce(jsonb_object_agg(s.month, s.item_keys order by s.month), '{}'::jsonb)
  into month_skips
  from (
    select f.month, jsonb_agg(f.item_key order by f.item_key) as item_keys
    from public.forecast_overrides f
    where f.company_id = cid
      and f.moved_out
      and f.month = any(case when p_rest then rest_months else array[next_month] end)
    group by f.month
  ) s;
$b$);
  def := pg_temp.swap(def, $a$    'edits', edits
  ) || case when p_rest then jsonb_build_object('rest_edits', rest_edits, 'skips', rest_skips) else '{}'::jsonb end;$a$,
    $b$    'edits', edits,
    'skips', month_skips
  ) || case when p_rest then jsonb_build_object('rest_edits', rest_edits) else '{}'::jsonb end;$b$);
  execute def;
end
$inputs$;

drop function pg_temp.swap(text, text, text);

commit;
