-- FLOW-107. One read of a bank line's loan split, with what each part does in the P&L.
-- The app's transaction screen and MCP get_expense both use it, so they agree with private.pnl_lines.

begin;

set local lock_timeout = '5s';

create or replace function public.get_loan_split(p_transaction_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with parts as (
    select s.part, s.amount_minor, s.needs_review, s.loan_id
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where s.transaction_id = p_transaction_id
      and t.removed_at is null
      and s.company_id = (select private.readable_company_id())
  ),
  counted as (
    select l.part, l.in_pnl
    from private.pnl_lines l
    where l.transaction_id = p_transaction_id
      and l.part is not null
  )
  select case when not exists (select 1 from parts) then null else jsonb_build_object(
    'loan_id', (select min(loan_id::text)::uuid from parts),
    'loan_name', (
      select l.name from public.loans l
      where l.id = (select min(loan_id::text)::uuid from parts)
    ),
    'needs_review', (select bool_or(needs_review) from parts),
    'by_parts', exists (select 1 from counted),
    'parts', (
      select jsonb_agg(jsonb_build_object(
        'part', p.part,
        'amount_minor', p.amount_minor,
        'in_pnl', c.in_pnl
      ) order by case p.part when 'interest' then 0 when 'escrow' then 1 else 2 end)
      from parts p
      left join counted c on c.part = p.part
    )
  ) end;
$$;

comment on function public.get_loan_split(uuid) is
  'FLOW-107. Null when the line has no loan split. by_parts is true when the P&L counts the line by its parts; then each part''s in_pnl says whether it counts. Otherwise in_pnl is null and the whole line counts under its own category.';

revoke all on function public.get_loan_split(uuid) from public, anon;
grant execute on function public.get_loan_split(uuid) to authenticated, service_role;

commit;
