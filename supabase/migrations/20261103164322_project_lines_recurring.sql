-- FLOW-1110: each row of project_cash_month_lines says whether it belongs to a recurring charge, as
-- cash_month_lines' rows do (FLOW-1035). A project page splits its month into what is left to pay, the
-- recurring charges paid and the one-off lines, and leaves the one-off group out while the rows do not say
-- (FLOW-1044): without the key, a project's one-off lines never showed (owner's screenshot, 2026-11-08).
-- - recurring: true when the row's line is one of private.recurring_month_lines for the month (as of its
--   last day), the same match cash_month_lines uses; false otherwise. The signature, the grants and every
--   other key stay.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (length(p_def) - length(replace(p_def, p_anchor, ''))) / nullif(length(p_anchor), 0);
$$;

do $lines$
declare
  def text;
  fn text := 'public.project_cash_month_lines(uuid,date,text,text,integer,integer)';
  declare_anchor text := E'  result jsonb;\n';
  offset_anchor text := E'  off := greatest(coalesce(p_offset, 0), 0);\n';
  json_anchor text := E'        ''kept_out'', p_side = ''excluded'',\n';
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, declare_anchor) <> 1
     or pg_temp.anchor_count(def, offset_anchor) <> 1
     or pg_temp.anchor_count(def, json_anchor) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, declare_anchor, declare_anchor || E'  recurring_ids uuid[];\n');
  def := replace(def, offset_anchor, offset_anchor || $n$  -- FLOW-1110: the month's lines of the charges recurring_schedule lists for it, as of the month's end.
  select coalesce(array_agg(distinct rl.id), '{}') into recurring_ids
  from private.recurring_month_lines(cid, private.month_end(month_start)) rl;
$n$);
  def := replace(def, json_anchor, json_anchor || $n$        'recurring', pg.transaction_id = any(recurring_ids),
$n$);
  execute def;
end;
$lines$;

drop function pg_temp.anchor_count(text, text);

commit;
