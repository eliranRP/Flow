-- FLOW-366: each cash line row says whether it waits for review and whether it counts in profit.
--
-- The month lines page (נכנס / יצא) shows a tag on a row when it matters: "ממתין לאישור" while the
-- line has an open review, and "· לא נספר ברווח" when the row is not in the P&L. Both were only
-- known from the review queue or the line's P&L flag, so the page could not tell them apart from
-- the row. Each row now also carries:
-- - pending: true when the row's transaction has an open review in review_queue;
-- - in_pnl: false when the row's part is not in the P&L (a loan's principal, a category or a line
--   kept out of profit); true otherwise.
-- Both are on cash_month_lines and project_cash_month_lines. The other keys do not change.

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
  fn text;
  merged_anchor text := E'      sum(r.side_minor)::bigint as amount_minor,\n';
  page_anchor text := E'      t.doc_date,\n';
  json_anchor text := E'        ''kept_out'', p_side = ''excluded'',\n';
begin
  foreach fn in array array[
    'public.cash_month_lines(date,text,text,integer,integer)',
    'public.project_cash_month_lines(uuid,date,text,text,integer,integer)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, merged_anchor) <> 1
       or pg_temp.anchor_count(def, page_anchor) <> 1
       or pg_temp.anchor_count(def, json_anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, merged_anchor, merged_anchor || $n$      bool_or(r.in_pnl) as in_pnl,
$n$);
    -- page already carries m.* (the merged row), so pg.in_pnl is in scope once merged has it.
    def := replace(def, json_anchor, json_anchor || $n$        'in_pnl', pg.in_pnl,
        'pending', exists (
          select 1 from public.review_queue q
          where q.transaction_id = pg.transaction_id and q.status = 'open'
        ),
$n$);
    execute def;
  end loop;
end;
$lines$;

drop function pg_temp.anchor_count(text, text);

commit;
