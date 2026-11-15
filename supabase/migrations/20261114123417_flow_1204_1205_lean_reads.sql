-- FLOW-1204, FLOW-1205 (perf queue, decision 0230): three reads stop computing or sending what no screen reads.
-- - projects_cash_month: projects[].pending_count and projects[].deletable (the project menu's, two passes over the
--   open review queue and suggested lines, and six index probes per project) are in the answer only with p_project;
--   the list asks without it and draws neither. The menu reads its own row. Also left out, with no reader:
--   projects[].group_id and the top-level month and basis. flow-mcp does not call it.
-- - get_project, lean (p_lines false, as the app asks): no investment.rehab_by_category (only the returns screen reads
--   it, and it now asks with lines), and no from and to (no app reader). With lines (flow-mcp's default) both stay,
--   rehab_by_category[].hidden included.
-- - expected_months with p_months 0 (the app's): no recurring[].months_seen, recurring[].source or top-level
--   project_id. With p_months 1 to 13 (flow-mcp's) they stay.
--
-- Each body is patched in place: every anchor must be found exactly once, or the migration fails. Same signatures,
-- security and grants (create or replace keeps them).

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
  -- projects_cash_month
  def := pg_get_functiondef('public.projects_cash_month(date,date,uuid)'::regprocedure);
  def := pg_temp.swap(def, $a$      p.group_id,
      p.created_at,$a$, $b$      p.created_at,$b$);
  def := pg_temp.swap(def, $a$      coalesce((select wc.n from waiting_counts wc where wc.project_id = p.id), 0) as pending_count,
      private.project_is_empty(cid, p.id) as deletable,$a$, $b$      -- FLOW-1204: the project menu's two figures, for the one project asked for only.
      case when p_project is not null then coalesce((select wc.n from waiting_counts wc where wc.project_id = p.id), 0) end as pending_count,
      case when p_project is not null then private.project_is_empty(cid, p.id) end as deletable,$b$);
  def := pg_temp.swap(def, $a$    'month', to_char(month_start, 'YYYY-MM-DD'),
    'base_currency', base,
    'basis', basis,
$a$, $b$    'base_currency', base,
$b$);
  def := pg_temp.swap(def, $a$        'group_id', r.group_id,
$a$, $b$$b$);
  def := pg_temp.swap(def, $a$        'first_month', r.first_month,
        'pending_count', r.pending_count,
        'deletable', r.deletable
      ) order by r.name)$a$, $b$        'first_month', r.first_month
      ) || case when p_project is not null
        then jsonb_build_object('pending_count', r.pending_count, 'deletable', r.deletable)
        else '{}'::jsonb end order by r.name)$b$);
  execute def;

  -- get_project
  def := pg_get_functiondef('public.get_project(uuid,text,date,date,boolean)'::regprocedure);
  def := pg_temp.swap(def, $a$    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'profit_agorot', profit,$a$, $b$    'profit_agorot', profit,$b$);
  def := pg_temp.swap(def, $a$  return result || jsonb_build_object($a$, $b$  -- FLOW-1205: the period echo is for the lines form (flow-mcp's); the app reads none of it.
  return result || case when p_lines then jsonb_build_object(
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end
  ) else '{}'::jsonb end || jsonb_build_object($b$);
  def := pg_temp.swap(def, $a$    'investment', private.project_investment(cid, p_id),$a$, $b$    -- FLOW-1205: rehab_by_category is for the lines form too; the returns screen asks with lines.
    'investment', (select case when p_lines then i else i - 'rehab_by_category' end from private.project_investment(cid, p_id) i),$b$);
  execute def;

  -- expected_months
  def := pg_get_functiondef('public.expected_months(integer,uuid,date)'::regprocedure);
  def := pg_temp.swap(def, $a$      'today', today,
      'project_id', p_project_id,
      'recurring',$a$, $b$      'today', today,
      'recurring',$b$);
  def := pg_temp.swap(def, $a$          'months_seen', r.months_seen,
$a$, $b$$b$);
  def := pg_temp.swap(def, $a$          'source', r.source,
$a$, $b$$b$);
  def := pg_temp.swap(def, $a$          'handover', r.handover
        ) order by$a$, $b$          'handover', r.handover
        -- FLOW-1205: months_seen and source are for a read with months (flow-mcp's); the app reads none of them.
        ) || case when p_months > 0 then jsonb_build_object('months_seen', r.months_seen, 'source', r.source) else '{}'::jsonb end
        order by$b$);
  def := pg_temp.swap(def, $a$    ) || case when p_months > 0 then jsonb_build_object(
      'months',$a$, $b$    ) || case when p_months > 0 then jsonb_build_object(
      'project_id', p_project_id,
      'months',$b$);
  execute def;
end
$patch$;

drop function pg_temp.swap(text, text, text);

commit;
