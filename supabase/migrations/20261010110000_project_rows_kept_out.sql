-- The project page's month headers added kept-out lines (income or expenses in a category out
-- of the P&L, or a line the owner took out), so a month header did not match the project's
-- profit. get_project's transactions[] now carries kept_out for each line, and the app leaves
-- those lines out of the month sums. A posted line follows private.pnl_lines: kept out when no
-- part of it on this project (or allocated to it) counts. A pending line, which pnl_lines does
-- not hold yet, follows the same rule on its own category and override as the plain branch of
-- pnl_lines.
-- get_project is otherwise as in 20261010090000_loan_kinds_rates.sql; it is patched in place so
-- the copy cannot drift. Grants are kept by create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

do $kept$
declare
  def text;
  anchor constant text := $old$'parts_minor', case when exists ($old$;
begin
  def := pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure);
  if position(anchor in def) = 0 or position('''kept_out''' in def) > 0 then
    raise exception 'get_project is not the expected definition';
  end if;
  execute replace(def, anchor, $new$'kept_out', case
          when t.line_status = 'posted' then not coalesce((
            select bool_or(pl.in_pnl)
            from private.pnl_lines pl
            where pl.transaction_id = t.id
              and (pl.project_id = p.id or exists (
                select 1 from public.allocations a
                where a.transaction_id = t.id and a.project_id = p.id
              ))
          ), false)
          else not private.line_in_pnl(
            case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
              then t.in_pnl_override end,
            private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
            c.loan_part
          )
        end,
        $new$ || anchor);
end
$kept$;

commit;
