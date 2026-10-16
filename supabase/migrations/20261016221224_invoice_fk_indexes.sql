-- The two foreign keys from (company_id, transaction_id) to transactions had no index that leads with
-- those columns, so the foreign-key index check failed on main (FLOW-811). Index both.
begin;

create index if not exists invoice_payment_links_company_transaction_idx
  on public.invoice_payment_links (company_id, transaction_id);
create index if not exists invoice_match_dismissals_company_transaction_idx
  on public.invoice_match_dismissals (company_id, transaction_id);

commit;
