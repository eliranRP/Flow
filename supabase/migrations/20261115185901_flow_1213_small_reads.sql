-- FLOW-1213 (perf review, 2026-11-16). Two functions are patched in place; no table changes.
--
-- 1. public.projects_cash_month, with p_project: the unassigned figures (the unassigned_cash and
--    unassigned_lines CTEs) were built and sent for one project too. Only the Projects list reads them
--    (projects-screen.tsx), so the key is now added only when p_project is null. A CTE referenced only
--    inside a CASE branch is not run when the branch is not taken, so one project's answer skips them.
--    The list's answer is unchanged.
--
-- 2. public.mcp_jev_status: private.jev_inputs_key(cid) was computed on every call (FLOW-1206 moved it
--    into a variable, but still computed it whether or not the company had a refusal). It is now read
--    only when the company has a refused line (a jev_line_failures row with refused_at set; the foreign
--    key (company_id, transaction_id) makes its company_id the transaction's). Without such a row the
--    count of lines not retried is 0 whatever the key is, so the answers are the same.
--
-- Grants, security definer, search_path, volatility and the signatures are unchanged: create or
-- replace keeps the ACLs, and each function is re-created from its own definition (pg_get_functiondef),
-- with each anchor required to match exactly once, as 20261115022953 did. The anchors are the bodies
-- as they stand after 20261114123417 (projects_cash_month) and 20261115022953 (mcp_jev_status).

begin;

do $flow_1213$
declare
  def text;
  n integer;
  a text;
  b text;
begin
  -- 1. projects_cash_month: the unassigned object only for the list.
  def := pg_get_functiondef('public.projects_cash_month(date,date,uuid)'::regprocedure);
  a := $a$    ), '[]'::jsonb),
    'unassigned', jsonb_build_object($a$;
  b := $n$    ), '[]'::jsonb)
  ) || case when p_project is null then jsonb_build_object(
    -- FLOW-1213: the unassigned figures are the list's only; one project's answer leaves them out.
    'unassigned', jsonb_build_object($n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'projects_cash_month is not the expected definition (unassigned open %)', n;
  end if;
  def := replace(def, a, b);
  a := $a$      ), '[]'::jsonb)
    )
  )
  into result;$a$;
  b := $n$      ), '[]'::jsonb)
    )
  ) else '{}'::jsonb end
  into result;$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'projects_cash_month is not the expected definition (unassigned close %)', n;
  end if;
  def := replace(def, a, b);
  execute def;

  -- 2. mcp_jev_status: the key only when the company has a refused line.
  def := pg_get_functiondef('public.mcp_jev_status()'::regprocedure);
  a := $a$  -- FLOW-1206: the refused lines are compared with one key, read once per call (whether or not the
  -- company has a refusal).
  refused_key := private.jev_inputs_key(cid);
$a$;
  b := $n$  -- FLOW-1213: the key is read only when the company has a refused line. The count of lines not
  -- retried compares its refused lines with it; without a refusal there is nothing to compare.
  if exists (
    select 1
    from public.jev_line_failures f
    where f.company_id = cid and f.refused_at is not null
  ) then
    refused_key := private.jev_inputs_key(cid);
  end if;
$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'mcp_jev_status is not the expected definition (key read %)', n;
  end if;
  def := replace(def, a, b);
  execute def;
end
$flow_1213$;

commit;
