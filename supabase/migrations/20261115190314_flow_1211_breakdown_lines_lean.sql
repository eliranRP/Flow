-- FLOW-1211 (perf queue): get_breakdown_lines with no key is one computation and a lean row.
-- FLOW-1207's no-key read (p_group_key null, p_excluded false, no p_project_id) recomputed the whole direction for
-- every page of 200 (62.8 ms and 22,452 buffers a page, 5 pages, for 2026's expenses). Now, for that read only:
-- - It returns the whole direction in one call: p_limit and p_offset are ignored, has_more is false, and the
--   computation runs once.
-- - Each row keeps only what Company profit's date and amount lists read: transaction_id, part, description,
--   supplier_name, project_name, doc_date, amount_minor, source, gross_up, and group_key (the key the keyed read
--   would have been asked with: the filing key). Dropped: category_id (it is group_key, or null for 'none'),
--   category_name (constant per group; the screen has the breakdown's name), currency (p_currency), kept_out (always
--   false) and shared (no reader).
-- - total_minor, count and projects are as they were (the whole direction's, and empty).
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
    E'  result jsonb;\n  lean boolean;\nbegin\n');
  -- The whole direction: no page.
  def := pg_temp.swap(def,
    $a$  off := greatest(coalesce(p_offset, 0), 0);
$a$,
    $b$  off := greatest(coalesce(p_offset, 0), 0);
  -- FLOW-1211: a read with no key takes the whole direction in one computation, in a lean row.
  lean := p_group_key is null and p_project_id is null and not coalesce(p_excluded, false);
  if lean then
    lim := 1000000000;
    off := 0;
  end if;
$b$);
  def := pg_temp.swap(def,
    $a$      select jsonb_agg(jsonb_build_object(
        'transaction_id', pg.transaction_id,$a$,
    $b$      select jsonb_agg(case when lean then jsonb_build_object(
        'transaction_id', pg.transaction_id,
        'part', pg.part,
        'description', pg.description,
        'supplier_name', pg.supplier_name,
        'project_name', pg.project_name,
        'doc_date', pg.doc_date,
        'amount_minor', pg.amount_minor,
        'source', pg.source,
        'gross_up', pg.gross_up,
        'group_key', pg.drill_key
      ) else jsonb_build_object(
        'transaction_id', pg.transaction_id,$b$);
  def := pg_temp.swap(def,
    $a$      ) || case
        when p_group_key is null and p_project_id is null and not coalesce(p_excluded, false) then jsonb_build_object('group_key', pg.drill_key)
        else '{}'::jsonb
      end order by pg.n)$a$,
    $b$      ) end order by pg.n)$b$);
  execute def;
end
$lines$;

drop function pg_temp.swap(text, text, text);

commit;
