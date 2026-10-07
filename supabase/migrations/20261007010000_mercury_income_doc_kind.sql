begin;

-- Mercury deposits are received income (decision 0097).
-- The invoiced basis (decision 0060) counts invoice, credit and invoice_receipt,
-- so a Mercury income line stored as receipt showed no income there.
-- mercury-sync now writes invoice_receipt. This relabels the rows already stored.
-- Data labeling only: no column, function, grant or policy changes.
--
-- Triggers on public.transactions that fire on this update:
--   transactions_touch          sets updated_at.
--   transactions_fill_category  keeps an existing category; a line with no category
--                               gets the same suggestion an insert or a sync would give.
--   transactions_audit          writes nothing here, because auth.uid() is null.
-- transactions_fill_amount_original (amount_gross) and transactions_loan_splits_stale
-- (amount_original, currency) do not fire, because those columns do not change.
--
-- A skipped review row stays closed while review_queue.doc_fingerprint matches the line,
-- and the fingerprint includes doc_kind. Refresh a fingerprint that matches the line as a
-- receipt, so a skipped Mercury line does not reopen. A line a sync already relabeled
-- (functions deploy before migrations) is refreshed too. A stale fingerprint stays stale.

set local lock_timeout = '5s';

update public.review_queue q
set doc_fingerprint = private.doc_fingerprint(
  t.direction::text, 'invoice_receipt', t.amount_gross, t.doc_date, t.description, t.external_id
)
from public.transactions t
where q.transaction_id = t.id
  and q.company_id = t.company_id
  and t.source = 'mercury'
  and t.direction = 'income'
  and t.doc_kind in ('receipt', 'invoice_receipt')
  and q.doc_fingerprint = private.doc_fingerprint(
    t.direction::text, 'receipt', t.amount_gross, t.doc_date, t.description, t.external_id
  );

update public.transactions set doc_kind = 'invoice_receipt' where source = 'mercury' and direction = 'income' and doc_kind = 'receipt';

commit;
