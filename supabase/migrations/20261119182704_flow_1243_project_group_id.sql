-- FLOW-1243 (perf queue): get_project answers the project's group id, so the project's ⋯ menu reads its group from the
-- page's own read and the groups read is one request (list_project_groups), not two (plus projects.select(group_id)).
-- Add-only: one key, projects.group_id, beside state_label. flow-mcp's get_project gets the key too; no other key moves.
-- Same signature, security and grants (create or replace keeps them).
--
-- The body is patched in place: the anchor must be found exactly once, or the migration fails.

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

do $patch$
declare
  def text;
begin
  -- get_project, the lean read the app asks with (p_lines false) and flow-mcp's default answer alike
  def := pg_get_functiondef('public.get_project(uuid,text,date,date,boolean)'::regprocedure);
  def := pg_temp.swap(def, $a$    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
$a$, $b$    'state_label', p.state_label,
    'group_id', p.group_id,
    'budget_agorot', p.budget_agorot,
$b$);
  execute def;
end
$patch$;

drop function pg_temp.swap(text, text, text);

commit;
