-- FLOW-1231 (perf): the project page reads loan_balances for one project, but the view had no project_id, so the
-- read was unfiltered: the server totalled every loan of the company (a GROUP BY over loans, private.loan_parts and
-- transactions) and sent every row back. The view gets l.project_id, appended last (a nullable uuid, the loan's
-- project), so the app can filter by it.
--
-- Everything else is as 20261028093217_ledger_only.sql defines it: security_invoker, the same columns in the same
-- order, the same totals. create or replace view only appends a column, so the view is not dropped; its grants
-- (select to authenticated and service_role, 20261004055306_loans_l1.sql) and its comment stay. Nothing depends on
-- the view's rowtype: the functions that read it name its columns and are bound at run time, and no view reads it.
-- supabase/tests/database/flow_1231_loan_balances_project.test.sql compares it with the old definition.

begin;

set local lock_timeout = '5s';

create or replace view public.loan_balances with (security_invoker = true) as
  select l.company_id, l.id as loan_id, l.currency,
    (l.principal_minor::numeric - coalesce(sum(s.amount_minor) filter (
      where s.part = 'principal'::public.loan_split_part and t.line_status = 'posted'::public.line_status
        and t.removed_at is null and s.needs_review is not true), 0::numeric))::bigint as balance_minor,
    count(*) filter (
      where s.needs_review and t.removed_at is null and t.line_status is distinct from 'void'::public.line_status
    )::integer as flagged_parts,
    l.project_id
  from public.loans l
  left join private.loan_parts s on s.company_id = l.company_id and s.loan_id = l.id
  left join public.transactions t on t.company_id = s.company_id and t.id = s.transaction_id
  group by l.company_id, l.id, l.currency, l.principal_minor, l.project_id;

commit;
