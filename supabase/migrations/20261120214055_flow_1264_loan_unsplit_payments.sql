-- FLOW-1264: the Loans list calls a loan late when a scheduled payment passed with no payment recorded for it
-- (FLOW-1258). loan_balances.last_paid_on reads only lines split to the loan, so a bank line that paid the loan but is
-- not split yet (it waits in the review queue) made the loan read late. This view finds such a line: per open loan
-- with a monthly payment, the latest posted, not removed expense line of the last 75 days (Israel time) in the loan's
-- currency, within 2% of the payment, that no loan split covers, from a supplier that an earlier line split to this
-- loan came from. The supplier ties the line to the loan, so an unrelated expense of about the same amount does not
-- count; a loan with nothing split yet has no match. The list counts it as the loan's payment for the late check
-- only; balances and totals still read splits alone.
--
-- security_invoker, as loan_balances: the caller's RLS on loans and transactions applies, and private.loan_parts is
-- read as loan_balances reads it. The 75 days bound the scan to the (company_id, doc_date) index.
-- supabase/tests/database/flow_1264_loan_unsplit_payments.test.sql checks it.

begin;

set local lock_timeout = '5s';

create view public.loan_unsplit_payments with (security_invoker = true) as
  select l.company_id, l.id as loan_id, max(t.doc_date) as last_on
  from public.loans l
  join public.transactions t
    on t.company_id = l.company_id
   and t.currency = l.currency
   and t.direction = 'expense'::public.txn_direction
   and t.line_status = 'posted'::public.line_status
   and t.removed_at is null
   and t.doc_date >= (now() at time zone 'Asia/Jerusalem')::date - 75
   and abs(t.amount_original - l.payment_minor) * 50 <= l.payment_minor
  where l.status = 'open'::public.loan_status
    and l.payment_minor > 0
    and not exists (
      select 1 from private.loan_parts s where s.company_id = t.company_id and s.transaction_id = t.id
    )
    and exists (
      select 1 from private.loan_parts s
      join public.transactions p on p.company_id = s.company_id and p.id = s.transaction_id
      where s.company_id = l.company_id and s.loan_id = l.id and p.supplier_id = t.supplier_id
    )
  group by l.company_id, l.id;

comment on view public.loan_unsplit_payments is
  'FLOW-1264: per open loan, the latest unsplit expense line of the last 75 days within 2% of its payment, from a supplier of its split lines.';

revoke all on public.loan_unsplit_payments from public, anon, authenticated;
grant select on public.loan_unsplit_payments to authenticated, service_role;

commit;
