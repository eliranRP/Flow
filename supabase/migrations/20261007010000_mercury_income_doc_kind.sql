begin;

-- Mercury deposits are received income (decision 0097).
-- The invoiced basis (decision 0060) counts invoice, credit and invoice_receipt,
-- so a Mercury income line stored as receipt showed no income there.
-- mercury-sync now writes invoice_receipt. This relabels the rows already stored.
-- No column, grant or policy changes. One private helper, so pgTAP can run the relabel.
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
-- and the fingerprint includes doc_kind. Functions deploy before migrations, so a sync in
-- that window can already have relabeled a skipped line and queued it again as open.
-- 1. Close that open row: the line is already invoice_receipt, the open row is its newest
--    review row, and the skipped row right before it matches the line as a receipt.
-- 2. Refresh a fingerprint that matches the line as a receipt, so the skip keeps holding.
-- 3. Relabel. A stale fingerprint stays stale. Running it again changes nothing.

create or replace function private.relabel_mercury_income()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  closed integer;
  refreshed integer;
  relabeled integer;
begin
  delete from public.review_queue o
  using public.transactions t
  where o.transaction_id = t.id
    and o.company_id = t.company_id
    and o.status = 'open'
    and t.source = 'mercury'
    and t.direction = 'income'
    and t.doc_kind = 'invoice_receipt'
    and not exists (
      select 1 from public.review_queue n
      where n.transaction_id = t.id and n.created_at > o.created_at
    )
    and exists (
      select 1 from public.review_queue s
      where s.transaction_id = t.id
        and s.company_id = t.company_id
        and s.status = 'skipped'
        and s.created_at < o.created_at
        and s.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, 'receipt', t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue m
          where m.transaction_id = t.id
            and m.created_at > s.created_at
            and m.created_at < o.created_at
        )
    );
  get diagnostics closed = row_count;

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
  get diagnostics refreshed = row_count;

  update public.transactions
  set doc_kind = 'invoice_receipt'
  where source = 'mercury' and direction = 'income' and doc_kind = 'receipt';
  get diagnostics relabeled = row_count;

  return jsonb_build_object('closed', closed, 'refreshed', refreshed, 'relabeled', relabeled);
end;
$$;

revoke all on function private.relabel_mercury_income() from public, anon, authenticated, service_role;

set local lock_timeout = '5s';

select private.relabel_mercury_income();

commit;
