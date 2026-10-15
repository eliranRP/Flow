-- FLOW-442: a loan payment's part on the cash lists says what it is out of.
--
-- cash_month_lines and project_cash_month_lines already return a loan payment's parts as rows of
-- their own, each with its part (principal, interest, escrow or fees). On the לא נספר ברווח list
-- the principal row read as the lender and the category alone, so nothing said it is one part of a
-- bigger payment. Each part row now also carries line_minor: the whole payment's bank amount
-- (gross, positive), as a split line's row already does (FLOW-432). parts stays null on these rows:
-- the row is the part.

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
  line_anchor text := $a$'line_minor', case when pg.split_shown then pg.line_gross end,$a$;
begin
  foreach fn in array array[
    'public.cash_month_lines(date,text,text,integer,integer)',
    'public.project_cash_month_lines(uuid,date,text,text,integer,integer)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, line_anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, line_anchor, $a$'line_minor', case when pg.split_shown or pg.part is not null then pg.line_gross end,$a$);
    execute def;
  end loop;
end;
$lines$;

drop function pg_temp.anchor_count(text, text);

commit;
