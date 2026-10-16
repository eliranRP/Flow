-- FLOW-140 (server part). get_breakdown's groups carry `projects`: how many projects have a
-- counted line in the group. A category's card shows "N projects" without a second read.
-- The function is patched, like the migrations before it, and only the anchors below change.

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $projects$
declare
  def text;
  group_anchor text := 'bool_or(r.shared) as shared';
  json_anchor text := $a$'shared', g.shared$a$;
begin
  def := pg_get_functiondef('public.get_breakdown(text,date,date,text,text)'::regprocedure);
  if pg_temp.anchor_count(def, group_anchor) <> 1 or pg_temp.anchor_count(def, json_anchor) <> 1 then
    raise exception 'get_breakdown is not the expected definition';
  end if;
  def := replace(def, group_anchor,
    group_anchor || E',\n      count(distinct r.project_id) filter (where r.project_id is not null)::integer as project_count');
  def := replace(def, json_anchor, json_anchor || E',\n        ''projects'', g.project_count');
  execute def;
end
$projects$;
