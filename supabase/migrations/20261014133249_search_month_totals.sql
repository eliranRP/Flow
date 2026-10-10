-- Search month totals (bug report 2026-10-10): the search screen loads 50 lines a page and a
-- month showed its net only once every one of its lines had loaded, so most month heads had
-- none. search_transactions now returns `months` on its first page (p_offset 0): one row per
-- month and currency of every matching line, not only the page, with income and expense as the
-- rows draw them (a kept-out line counts 0; an income line with a negative amount is money out,
-- decision 0120). Later pages leave it out, so paging costs what it did.
-- private.line_pnl_states is planned for the ids it gets: the first page asks it for every
-- matching line, about 4,000 on a large company, and its one shared plan took 2 s for that
-- (a nested loop over pnl_lines per line); planned per call it takes about 70 ms. It also reads
-- the caller's company once per call instead of once per line. Same rows, same rule.

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

create or replace function private.line_pnl_states(p_ids uuid[])
returns table (transaction_id uuid, state text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- Executed, so each call is planned for its own ids (a generic plan nested-looped pnl_lines).
  return query execute $q$
    select t.id,
      case
        when t.line_status = 'posted' then coalesce(parts.state, pending.state)
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    left join (
      select pl.transaction_id,
        case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end as state
      from private.pnl_lines pl
      where pl.transaction_id = any($1)
      group by pl.transaction_id
    ) parts on parts.transaction_id = t.id
    -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
    cross join lateral (
      select case when private.line_in_pnl(
        case when not exists (
          select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.company_id = t.company_id
        ) then t.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
        c.loan_part
      ) then 'in' else 'out' end as state
    ) pending
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids;
end;
$function$;

revoke all on function private.line_pnl_states(uuid[]) from public, anon;
grant execute on function private.line_pnl_states(uuid[]) to authenticated, service_role;

commit;
