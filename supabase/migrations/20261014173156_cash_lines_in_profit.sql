-- FLOW-438: the cash lines that count in profit, in one list.
--
-- cash_month_lines and project_cash_month_lines take a fourth side, 'in_profit': the month's
-- lines in the view's cash that the P&L counts, money in and money out together (each row keeps
-- its own side). It is נכנס and יצא without the לא נספר ברווח lines, so a month page can list
-- what makes up its profit, and list 'not_in_profit' under it. The other sides do not change.

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
  check_anchor text := $a$p_side not in ('in', 'out', 'excluded', 'not_in_profit')$a$;
  filter_anchor text := $a$(p_side = 'not_in_profit' and p.in_cash and not p.in_pnl)$a$;
begin
  foreach fn in array array[
    'public.cash_month_lines(date,text,text,integer,integer)',
    'public.project_cash_month_lines(uuid,date,text,text,integer,integer)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, check_anchor) <> 1 or pg_temp.anchor_count(def, filter_anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, check_anchor, $a$p_side not in ('in', 'out', 'excluded', 'not_in_profit', 'in_profit')$a$);
    def := replace(def, filter_anchor, $a$(p_side = 'not_in_profit' and p.in_cash and not p.in_pnl)
        or (p_side = 'in_profit' and p.in_cash and p.in_pnl)$a$);
    execute def;
  end loop;
end;
$lines$;

drop function pg_temp.anchor_count(text, text);

commit;
