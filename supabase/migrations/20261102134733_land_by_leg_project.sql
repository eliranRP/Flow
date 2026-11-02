-- FLOW-463 (decision 0248, amended): a property's postings to an account are the legs filed to it.
--
-- private.project_account_balance took a leg's project only when it was set by hand
-- (legs.project_explicit), else the line's. A journal entry files each leg to its property without
-- that flag and leaves the line's project empty, so no property found its land in the books. The
-- balance now reads the leg's own project, as the account's lines in the books do
-- (get_account_lines), so the land on the returns and the account page drill-down agree.

begin;

create or replace function private.project_account_balance(p_company_id uuid, p_project_id uuid, p_account_id uuid, p_currency text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(x.amount_minor), 0)::bigint
  from public.legs x
  join public.transactions t on t.id = x.transaction_id and t.company_id = x.company_id
  where x.company_id = p_company_id
    and x.account_id = p_account_id
    and x.project_id = p_project_id
    and not x.draft
    and t.removed_at is null
    and t.line_status = 'posted'::public.line_status
    and coalesce(t.currency, 'ILS') = p_currency;
$$;

commit;
