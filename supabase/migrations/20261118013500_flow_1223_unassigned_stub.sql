-- FLOW-1223 (perf steward's diff review, 2026-11-18). One function is patched in place; no table changes.
--
-- public.projects_cash_month, with p_project: 20261115185901 (FLOW-1213) left `unassigned` out of one project's
-- answer. The app before that change (still on phones: a PWA keeps an old build for hours or days after a deploy)
-- parses this answer with a schema that requires `unassigned` ({count, cash}), so on those phones the project
-- page's own read and its ⋯ menu figures failed. One project's answer now carries a constant stub,
-- {"count": 0, "cash": []}, which that schema accepts. No app reads `unassigned` from one project's answer (only the
-- Projects list reads it, from the list's answer), and the stub is a literal, so the unassigned CTEs FLOW-1213
-- stopped running stay skipped. The list's answer is unchanged. FLOW-1224 removes the stub once no such app is in use.
--
-- Grants, security definer, search_path, volatility and the signature are unchanged: create or replace keeps the
-- ACLs, and the function is re-created from its own definition (pg_get_functiondef), with the anchor required to
-- match exactly once. The anchor is the body as it stands after 20261115185901.

begin;

do $flow_1223$
declare
  def text;
  n integer;
  a text;
  b text;
begin
  def := pg_get_functiondef('public.projects_cash_month(date,date,uuid)'::regprocedure);
  a := $a$  ) else '{}'::jsonb end
  into result;$a$;
  b := $n$  ) else jsonb_build_object(
    -- FLOW-1223: a constant stub for the app before FLOW-1213, whose schema requires the key (FLOW-1224 drops it).
    'unassigned', jsonb_build_object('count', 0, 'cash', '[]'::jsonb)
  ) end
  into result;$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'projects_cash_month is not the expected definition (unassigned else %)', n;
  end if;
  def := replace(def, a, b);
  execute def;
end
$flow_1223$;

commit;
