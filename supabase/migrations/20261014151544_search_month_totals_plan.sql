-- Red-main fix for FLOW-908: search_transactions' first page took 2.3 s on main's CI (0.12 s on a
-- fresh local database). With no planner statistics the planner may nested-loop the matching
-- lines against their P&L states, 4,000 x 4,000 comparisons, in two places: search_transactions
-- joined the lines to private.line_pnl_states, and line_pnl_states joined the lines to their
-- parts. Both now read their states as one id-keyed jsonb map built once (an init plan), so no
-- plan can turn quadratic. Same rows, same rule.

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
  anchor := $a$          from matched mt
          left join private.line_pnl_states(array(select id from matched)) st
            on st.transaction_id = mt.id
          where st.state is distinct from 'out'
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'search_transactions is not the expected definition (month states)';
  end if;
  def := replace(def, anchor, $n$          from matched mt
          -- The states as one id-keyed map, read once: a join of the lines to the states could
          -- nested-loop 4,000 x 4,000 when the planner had no statistics.
          where (
            (select coalesce(jsonb_object_agg(st.transaction_id, st.state), '{}'::jsonb)
             from private.line_pnl_states(array(select id from matched)) st)
            ->> mt.id::text
          ) is distinct from 'out'
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
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    select t.id,
      case
        when t.line_status = 'posted' then coalesce(
          (
            select coalesce(jsonb_object_agg(parts.transaction_id, parts.state), '{}'::jsonb)
            from (
              select pl.transaction_id,
                case
                  when bool_and(pl.in_pnl) then 'in'
                  when not bool_or(pl.in_pnl) then 'out'
                  else 'mixed'
                end as state
              from private.pnl_lines pl
              where pl.transaction_id = any($1)
              group by pl.transaction_id
            ) parts
          ) ->> t.id::text,
          pending.state
        )
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
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
