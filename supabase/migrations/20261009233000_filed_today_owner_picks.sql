-- FLOW-309 (prod QA, Eliran 2026-10-08: automatic only): the "filed automatically today" banner and list counted lines the owner
-- filed by hand in review, so the count grew with every manual pick. A connector line with an
-- approved, changed or skipped review row is no longer counted; assistant filings still are.
-- filed_today_rows is otherwise as in 20261003200000_connector_l1a_filed_today.sql. Grants
-- are kept by create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function private.filed_today_rows()
returns table (id uuid, assistant boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') as start_at
  ),
  assistant_rows as (
    select distinct w.transaction_id as id
    from private.mcp_writes w
    join public.transactions t on t.id = w.transaction_id
    cross join bounds
    where w.user_id = auth.uid()
      and w.kind = 'review'
      and w.undone_at is null
      and w.transaction_id is not null
      and w.created_at >= bounds.start_at
      and t.company_id = private.current_company_id()
      and t.removed_at is null
      and t.line_status = 'posted'
      and not exists (
        select 1
        from public.review_queue open_row
        where open_row.transaction_id = t.id
          and open_row.status = 'open'
      )
  ),
  connector_rows as (
    select filed.id
    from public.transactions filed
    cross join bounds
    where filed.company_id = private.current_company_id()
      and private.is_connector_source(filed.source)
      and filed.line_status = 'posted'
      and filed.removed_at is null
      and filed.created_at >= bounds.start_at
      and filed.category_id is not null
      and (
        coalesce(filed.pnl_role, 'project') <> 'project'
        or filed.project_id is not null
        or filed.direction <> 'expense'
      )
      and not exists (
        select 1
        from public.review_queue open_row
        where open_row.transaction_id = filed.id
          and open_row.status = 'open'
      )
      -- A line the owner approved, changed or skipped in review was filed by hand, not
      -- automatically (FLOW-309 QA). Assistant filings still count through assistant_rows.
      and not exists (
        select 1
        from public.review_queue owner_row
        where owner_row.transaction_id = filed.id
          and owner_row.status in ('approved', 'changed', 'skipped')
      )
  )
  select ids.id, (assistant_rows.id is not null) as assistant
  from (
    select connector_rows.id from connector_rows
    union
    select assistant_rows.id from assistant_rows
  ) ids
  left join assistant_rows on assistant_rows.id = ids.id;
$$;

commit;
