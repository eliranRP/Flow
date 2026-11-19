-- FLOW-1234 (perf, Company profit): company_next_month_inputs rescanned the recurring charges' lines.
-- Its `streams` CTE (FLOW-1216) reads private.recurring_charge_lines_of_projects, a security definer function that
-- the planner does not inline. The `not exists (select 1 from streams ...)` in the answer then ran as a nested-loop
-- anti join that rescanned the function's result about 94 times. Marking the CTE `as materialized` computes it once.
-- The same rows come out, so the answer is the same; grants, security definer, search_path and the signature are
-- unchanged.
--
-- company_next_month_inputs is patched in place, as 20261118094256 did: the anchor must match exactly once, or the
-- migration stops. `with streams as (` appears once in the live body.

begin;

set local lock_timeout = '5s';

do $flow_1234$
declare
  def text;
  n integer;
  a text := $a$  with streams as ($a$;
  b text := $b$  with streams as materialized ($b$;
begin
  def := pg_get_functiondef('public.company_next_month_inputs(date,boolean)'::regprocedure);
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'company_next_month_inputs is not the expected definition (streams %)', n;
  end if;
  def := replace(def, a, b);
  execute def;
end
$flow_1234$;

commit;
