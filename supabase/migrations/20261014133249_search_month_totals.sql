-- Search month totals (bug report 2026-10-10): the search screen loads 50 lines a page and a
-- month showed its net only once every one of its lines had loaded, so most month heads had
-- none. search_transactions now returns `months` on its first page (p_offset 0): one row per
-- month and currency of every matching line, not only the page, with income and expense as the
-- rows draw them (a kept-out line counts 0; an income line with a negative amount is money out,
-- decision 0120). Later pages leave it out, so paging costs what it did.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint, boolean)'::regprocedure);
  anchor := E'      ''total'', (select count(*) from matched),\n';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'search_transactions is not the expected definition (total)';
  end if;
  def := replace(def, anchor, anchor || $n$      -- Every matching line's month totals, on the first page only.
      'months', case when off = 0 then coalesce((
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'currency', m.currency,
          'income_minor', m.income_minor,
          'expense_minor', m.expense_minor
        ) order by m.month desc, m.currency)
        from (
          select
            to_char(mt.doc_date, 'YYYY-MM') as month,
            mt.currency,
            coalesce(sum(abs(mt.amount_net)) filter (
              where mt.direction = 'income' and mt.amount_net >= 0
            ), 0)::bigint as income_minor,
            coalesce(sum(abs(mt.amount_net)) filter (
              where not (mt.direction = 'income' and mt.amount_net >= 0)
            ), 0)::bigint as expense_minor
          from matched mt
          left join private.line_pnl_states(array(select id from matched)) st
            on st.transaction_id = mt.id
          where st.state is distinct from 'out'
          group by 1, 2
        ) m
      ), '[]'::jsonb) end,
$n$);
  execute def;
end
$patch$;

commit;
