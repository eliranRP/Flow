-- FLOW-811: an index for every foreign key the database advisor reports without a covering
-- index (unindexed_foreign_keys, 35 on 2026-10-09). Each index leads with the key's columns in
-- the key's order, so deleting or re-keying the referenced row (a category, project, supplier,
-- customer, transaction, company or MCP token) finds the referencing rows by index instead of a
-- scan. Most keys are composite (company_id, x) so a row can only point inside its own company.
-- Existing single-column indexes stay: queries filter on those columns alone. reassign_undo
-- (company_id) is covered by its (company_id, transaction_id) index.
-- The tables are small, so plain create index inside the transaction is fine (no concurrently).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create index mcp_batches_token_id_fk_idx on private.mcp_batches (token_id);
create index mcp_credentials_company_id_fk_idx on private.mcp_credentials (company_id);
create index mcp_sync_jobs_token_id_fk_idx on private.mcp_sync_jobs (token_id);
create index mcp_writes_token_id_fk_idx on private.mcp_writes (token_id);
create index allocations_company_id_transaction_id_fk_idx on public.allocations (company_id, transaction_id);
create index companies_id_overhead_project_id_fk_idx on public.companies (id, overhead_project_id);
create index company_viewers_company_id_fk_idx on public.company_viewers (company_id);
create index connector_skips_company_id_fk_idx on public.connector_skips (company_id);
create index invoice_paid_marks_company_id_transaction_id_fk_idx on public.invoice_paid_marks (company_id, transaction_id);
create index jev_line_failures_company_id_transaction_id_fk_idx on public.jev_line_failures (company_id, transaction_id);
create index jev_outcomes_company_id_transaction_id_fk_idx on public.jev_outcomes (company_id, transaction_id);
create index line_splits_company_id_category_id_fk_idx on public.line_splits (company_id, category_id);
create index line_splits_company_id_project_id_fk_idx on public.line_splits (company_id, project_id);
create index loan_splits_company_id_category_id_fk_idx on public.loan_splits (company_id, category_id);
create index loans_company_id_escrow_category_id_fk_idx on public.loans (company_id, escrow_category_id);
create index loans_company_id_fees_category_id_fk_idx on public.loans (company_id, fees_category_id);
create index loans_company_id_interest_category_id_fk_idx on public.loans (company_id, interest_category_id);
create index loans_company_id_principal_category_id_fk_idx on public.loans (company_id, principal_category_id);
create index loans_company_id_project_id_fk_idx on public.loans (company_id, project_id);
create index overhead_company_id_transaction_id_fk_idx on public.overhead (company_id, transaction_id);
create index party_external_refs_company_id_customer_id_fk_idx on public.party_external_refs (company_id, customer_id);
create index party_external_refs_company_id_supplier_id_fk_idx on public.party_external_refs (company_id, supplier_id);
create index reassign_undo_company_id_transaction_id_fk_idx on public.reassign_undo (company_id, transaction_id);
create index review_queue_company_id_transaction_id_fk_idx on public.review_queue (company_id, transaction_id);
create index split_rule_targets_company_id_project_id_fk_idx on public.split_rule_targets (company_id, project_id);
create index split_rule_targets_company_id_rule_id_fk_idx on public.split_rule_targets (company_id, rule_id);
create index split_rules_company_id_supplier_id_fk_idx on public.split_rules (company_id, supplier_id);
create index suppliers_company_id_remembered_category_id_fk_idx on public.suppliers (company_id, remembered_category_id);
create index suppliers_company_id_remembered_project_id_fk_idx on public.suppliers (company_id, remembered_project_id);
create index tag_suggestions_company_id_transaction_id_fk_idx on public.tag_suggestions (company_id, transaction_id);
create index transactions_company_id_category_id_fk_idx on public.transactions (company_id, category_id);
create index transactions_company_id_customer_id_fk_idx on public.transactions (company_id, customer_id);
create index transactions_company_id_project_id_fk_idx on public.transactions (company_id, project_id);
create index transactions_company_id_supplier_id_fk_idx on public.transactions (company_id, supplier_id);

commit;
