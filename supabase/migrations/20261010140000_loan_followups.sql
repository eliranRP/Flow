-- FLOW-114 loan follow-ups.
-- 1. loan_balances.flagged_parts and mcp_list_loans' flagged_transaction_ids leave out parts
--    on lines that were removed or voided: nothing about them can be corrected, and they
--    already do not count in the balance.
-- 2. clear_loan_split_review is for the owner in the app; service_role never calls it.

begin;
set local lock_timeout = '5s';

create or replace view public.loan_balances
with (security_invoker = true) as
select
  l.company_id,
  l.id as loan_id,
  l.currency,
  (
    l.principal_minor - coalesce(
      sum(s.amount_minor) filter (
        where s.part = 'principal'::public.loan_split_part
          and t.line_status = 'posted'::public.line_status
          and t.removed_at is null
          and s.needs_review is not true
      ),
      0
    )
  )::bigint as balance_minor,
  count(*) filter (
    where s.needs_review
      and t.removed_at is null
      and t.line_status is distinct from 'void'::public.line_status
  )::integer as flagged_parts
from public.loans l
left join public.loan_splits s
  on s.company_id = l.company_id
 and s.loan_id = l.id
left join public.transactions t
  on t.company_id = s.company_id
 and t.id = s.transaction_id
group by l.company_id, l.id, l.currency, l.principal_minor;

comment on view public.loan_balances is
  'Principal left on the loan, in the loan currency. Posted principal that is still on the books reduces it, unless that part needs review. flagged_parts is how many parts are waiting, on lines that are not removed or void. Decision 0088.';

-- mcp_list_loans: as in 20261010090000_loan_kinds_rates.sql, with flagged_transaction_ids
-- limited to lines that are not removed or void, like flagged_parts.
do $patch$
declare
  def text;
  anchor constant text := '
        from public.loan_splits s
        where s.company_id = l.company_id
          and s.loan_id = l.id
          and s.needs_review
      ) f';
  replacement constant text := '
        from public.loan_splits s
        join public.transactions t
          on t.company_id = s.company_id
         and t.id = s.transaction_id
        where s.company_id = l.company_id
          and s.loan_id = l.id
          and s.needs_review
          and t.removed_at is null
          and t.line_status is distinct from ''void''::public.line_status
      ) f';
begin
  def := pg_get_functiondef('public.mcp_list_loans()'::regprocedure);
  if position(anchor in def) = 0 or position(anchor in substr(def, position(anchor in def) + 1)) > 0 then
    raise exception 'mcp_list_loans: flagged ids anchor not found once';
  end if;
  execute replace(def, anchor, replacement);
end;
$patch$;

revoke execute on function public.clear_loan_split_review(uuid) from service_role;

commit;
