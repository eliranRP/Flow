-- FLOW-474: list_utility_months covers a bounded range. The as-of date may be at most a year after today
-- (a later one is refused: validation), and at most 600 months are listed (the as-of month and the 599 before
-- it). A property's real months read the same. The body is patched in place: each anchor must be
-- found exactly once, or the migration fails. The signature and grants stay.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

do $range$
declare
  def text;
  fn text := 'public.list_utility_months(uuid,date)';
  check_anchor text := E'  if cid is null then\n    raise exception ''forbidden'' using errcode = ''42501'';\n  end if;\n';
  start_anchor text := E'        least((select min(b.month) from bills b), (select min(r.month) from rents r)),\n';
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, check_anchor) <> 1 or pg_temp.anchor_count(def, start_anchor) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, check_anchor, check_anchor || $n$  -- FLOW-474: an as-of date at most a year ahead.
  if today > private.flow_today() + interval '1 year' then
    raise exception 'validation';
  end if;
$n$);
  def := replace(def, start_anchor, $n$        -- FLOW-474: at most the 600 months up to the as-of month.
        -- greatest() skips nulls, so a property with no lines keeps a null start and no months.
        case when least((select min(b.month) from bills b), (select min(r.month) from rents r)) is not null then
          greatest(
            least((select min(b.month) from bills b), (select min(r.month) from rents r)),
            (date_trunc('month', today) - interval '599 months')::date
          )
        end,
$n$);
  execute def;
end;
$range$;

drop function pg_temp.anchor_count(text, text);

commit;
