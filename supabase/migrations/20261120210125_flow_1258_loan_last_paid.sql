-- FLOW-1258: the Loans list says a loan is late when a scheduled payment passed and no payment was recorded for
-- it, so it needs each loan's latest payment. loan_balances gets last_paid_on: the latest doc_date of a posted,
-- not removed bank line split to the loan, appended last (a nullable date; null when nothing is recorded).
--
-- Everything else is as 20261119100000_flow_1232_loan_balances_project.sql defines it: security_invoker, the same
-- columns in the same order, the same totals. create or replace view only appends a column, so the view is not
-- dropped; its grants and its comment stay. Nothing depends on the view's rowtype.
-- supabase/tests/database/flow_1258_loan_last_paid.test.sql checks it.

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
    l.project_id,
    max(t.doc_date) filter (
      where t.line_status = 'posted'::public.line_status and t.removed_at is null
    ) as last_paid_on
  from public.loans l
  left join private.loan_parts s on s.company_id = l.company_id and s.loan_id = l.id
  left join public.transactions t on t.company_id = s.company_id and t.id = s.transaction_id
  group by l.company_id, l.id, l.currency, l.principal_minor, l.project_id;

commit;
