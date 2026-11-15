-- FLOW-1207 (perf queue, decision 0230): get_breakdown_lines reads a whole direction with no group key.
-- Company profit's date and amount orders read every counted line, one read per category (FLOW-1194). With
-- p_group_key null (and p_excluded false, and no p_project_id: a read of one project with a null key still
-- returns no rows) the read now returns every counted line of the direction, in the
-- company currency, paged as before (p_limit up to 200, p_offset, has_more), newest first.
-- - Each line is merged within its own group (a split line's parts in two categories stay two rows, as the
--   one-category reads return them), and each row carries group_key: the key the keyed read would have been
--   asked with (the category id, or 'none'), so the screen files the rows as before.
-- - total_minor and count are the whole direction's; projects is empty (it is the split of one group).
-- - A keyed read, a kept-out read (p_excluded) and a read by project are unchanged, and carry no group_key.
--   Before this, a null key returned no rows; nothing in the app or MCP tools sends one.
--
-- The body is patched in place: each anchor must be found exactly once, or the migration fails. Same
-- signature, security and grants (create or replace keeps them).

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
  -- A null key takes every counted group.
  def := pg_temp.swap(def,
    $a$and x.in_pnl and x.drill_key = p_group_key)$a$,
    $b$and x.in_pnl and ((p_group_key is null and p_project_id is null) or x.drill_key = p_group_key))$b$);
  -- Merged by group too, so a line's parts in two categories stay two rows; the group's key travels on.
  def := pg_temp.swap(def,
    $a$      bool_or(r.gross_up) as gross_up
    from r$a$,
    $b$      bool_or(r.gross_up) as gross_up,
      min(r.drill_key) as drill_key
    from r$b$);
  def := pg_temp.swap(def,
    $a$case when coalesce(p_excluded, false) then r.drill_key end$a$,
    $b$case when coalesce(p_excluded, false) or (p_group_key is null and p_project_id is null) then r.drill_key end$b$);
  def := pg_temp.swap(def,
    $a$      m.category_id,
      row_number() over$a$,
    $b$      m.category_id,
      m.drill_key,
      row_number() over$b$);
  def := pg_temp.swap(def,
    $a$        'category_id', pg.category_id
      ) order by pg.n)$a$,
    $b$        'category_id', pg.category_id
      ) || case
        when p_group_key is null and p_project_id is null and not coalesce(p_excluded, false) then jsonb_build_object('group_key', pg.drill_key)
        else '{}'::jsonb
      end order by pg.n)$b$);
  -- The split by project belongs to one group.
  def := pg_temp.swap(def,
    $a$case when p_project_id is not null or coalesce(p_excluded, false)$a$,
    $b$case when p_group_key is null or p_project_id is not null or coalesce(p_excluded, false)$b$);
  -- A last sort key, so the order of the pages is total whatever the grouping (a row of 'parent' grouping may share
  -- every key before it with a row of another group).
  def := pg_temp.swap(def,
    $a$p.name nulls first, m.project_id) as n$a$,
    $b$p.name nulls first, m.project_id, m.drill_key) as n$b$);
  execute def;
end
$lines$;

drop function pg_temp.swap(text, text, text);

commit;
