-- FLOW-1211 (perf queue): get_breakdown_lines with no key is one computation and a lean row.
-- FLOW-1207's no-key read (p_group_key null, p_excluded false, no p_project_id) recomputed the whole direction for
-- every page of 200 (62.8 ms and 22,452 buffers a page, 5 pages, for 2026's expenses). Now, for that read only:
-- - With p_limit null (the new app's call) it returns the whole direction in one computation: p_offset is ignored and
--   has_more is false. With a p_limit (the FLOW-1207 app, still live on phones until they update) it pages exactly as
--   before: the same order, has_more and count. Nothing else sends a null limit (the default is 40).
-- - Each row drops category_id (it is group_key, or null for 'none') and kept_out (always false), for either call; the
--   FLOW-1207 app's schema does not require them. It keeps category_name, currency and shared (that schema requires
--   them), and group_key, the key the keyed read would have been asked with: the filing key.
-- - total_minor, count and projects are as they were.
-- A keyed read, a kept-out read (p_excluded) and a read by project are unchanged and keep every field: flow-mcp names
-- them. The body is patched in place: each anchor must be found exactly once, or the migration fails. Same signature,
-- security, search_path and grants (create or replace keeps them).

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

do $lines$
declare
  def text := pg_get_functiondef('public.get_breakdown_lines(text,text,text,text,date,date,text,boolean,integer,integer,uuid)'::regprocedure);
begin
  def := pg_temp.swap(def,
    E'  result jsonb;\nbegin\n',
    E'  result jsonb;\n  nokey boolean;\nbegin\n');
  def := pg_temp.swap(def,
    $a$  off := greatest(coalesce(p_offset, 0), 0);
$a$,
    $b$  off := greatest(coalesce(p_offset, 0), 0);
  -- FLOW-1211: a read with no key and no limit takes the whole direction in one computation.
  nokey := p_group_key is null and p_project_id is null and not coalesce(p_excluded, false);
  if nokey and p_limit is null then
    lim := 1000000000;
    off := 0;
  end if;
$b$);
  -- The no-key row drops what the screen and the FLOW-1207 schema do not need: category_id and kept_out.
  def := pg_temp.swap(def,
    $a$      ) || case
        when p_group_key is null and p_project_id is null and not coalesce(p_excluded, false) then jsonb_build_object('group_key', pg.drill_key)$a$,
    $b$      ) - case when nokey then array['category_id', 'kept_out'] else array[]::text[] end || case
        when nokey then jsonb_build_object('group_key', pg.drill_key)$b$);
  execute def;
end
$lines$;

drop function pg_temp.swap(text, text, text);

commit;
