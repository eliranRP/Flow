-- FLOW-1224 (owner, 2026-11-18: "No need to wait for older versions; there are no users on older versions."). One
-- function is patched in place; no table changes.
--
-- public.projects_cash_month, with p_project: FLOW-1223 (20261118013500) put a constant stub, {"count": 0, "cash": []},
-- under `unassigned` in one project's answer, so the app before FLOW-1213 kept parsing it. No app reads it there, and
-- no app before FLOW-1213 is in use, so the else branch is `'{}'::jsonb` again: one project's answer has no
-- `unassigned` key. The list's answer is unchanged.
--
-- Grants, security definer, search_path, volatility and the signature are unchanged: create or replace keeps the
-- ACLs, and the function is re-created from its own definition (pg_get_functiondef), with the anchor required to
-- match exactly once. The anchor is the body as it stands after 20261118013500.

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

do $flow_1224$
declare
  def text := pg_get_functiondef('public.projects_cash_month(date,date,uuid)'::regprocedure);
begin
  def := pg_temp.swap(def,
    $a$  ) else jsonb_build_object(
    -- FLOW-1223: a constant stub for the app before FLOW-1213, whose schema requires the key (FLOW-1224 drops it).
    'unassigned', jsonb_build_object('count', 0, 'cash', '[]'::jsonb)
  ) end
  into result;$a$,
    $b$  ) else '{}'::jsonb end
  into result;$b$);
  execute def;
end
$flow_1224$;

drop function pg_temp.swap(text, text, text);

commit;
