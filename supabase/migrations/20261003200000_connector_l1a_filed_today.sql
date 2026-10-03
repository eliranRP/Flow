-- L1a slice. Line currency columns, the filed-today list, and the off-P&L seed.
-- private.filed_today_rows() stays out until MCP 3b (20261003180000) merges.
-- categories already has unique (company_id, kind, name). A second unique index
-- would make ON CONFLICT (company_id, kind, name) ambiguous. That duplicate
-- index stays the L1b backlog item.

create type public.line_status as enum ('pending', 'posted', 'void');

alter table public.transactions
  add column line_status public.line_status not null default 'posted',
  add column currency text not null default 'ILS',
  add column amount_original bigint,
  add column fx_rate numeric,
  add column fx_rate_date date,
  add column provider_meta jsonb not null default '{}'::jsonb;

update public.transactions
set amount_original = abs(amount_gross)
where amount_original is null;

alter table public.transactions
  alter column amount_original set not null;

alter table public.transactions
  add constraint transactions_amount_original_nonneg check (amount_original >= 0) not valid,
  add constraint transactions_currency_code check (currency ~ '^[A-Z]{3}$') not valid,
  add constraint transactions_fx_pair check (
    (fx_rate is null and fx_rate_date is null)
    or (fx_rate > 0 and fx_rate_date is not null)
  ) not valid,
  add constraint transactions_source_currency check (
    (source::text <> 'mercury' or currency = 'USD')
    and (source::text <> 'sumit' or currency = 'ILS')
  ) not valid;

alter table public.transactions validate constraint transactions_amount_original_nonneg;
alter table public.transactions validate constraint transactions_currency_code;
alter table public.transactions validate constraint transactions_fx_pair;
alter table public.transactions validate constraint transactions_source_currency;

-- Existing writers omit amount_original. Fill it from the stored gross so the
-- not-null column does not reject those inserts.
create or replace function private.fill_amount_original()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount_original is null then
    new.amount_original := pg_catalog.abs(new.amount_gross);
  end if;
  return new;
end;
$$;

revoke all on function private.fill_amount_original() from public, anon;
grant execute on function private.fill_amount_original() to authenticated, service_role;

create trigger transactions_fill_amount_original
  before insert on public.transactions
  for each row execute function private.fill_amount_original();

create or replace function private.is_connector_source(p_source public.txn_source)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_source::text = 'sumit';
$$;

revoke all on function private.is_connector_source(public.txn_source) from public, anon;
grant execute on function private.is_connector_source(public.txn_source) to authenticated, service_role;

create or replace function public.list_auto_assigned_today()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', filed.id,
    'description', filed.description,
    'doc_date', filed.doc_date,
    'amount_net', filed.amount_net,
    'amount_original', filed.amount_original,
    'currency', filed.currency,
    'line_status', filed.line_status,
    'direction', filed.direction,
    'supplier_name', s.name,
    'project_name', p.name,
    'category_name', c.name
  ) order by filed.created_at desc), '[]'::jsonb)
  from public.transactions filed
  left join public.suppliers s on s.id = filed.supplier_id
  left join public.projects p on p.id = filed.project_id
  left join public.categories c on c.id = filed.category_id
  where filed.company_id = (select private.current_company_id())
    and private.is_connector_source(filed.source)
    and filed.line_status = 'posted'
    and filed.removed_at is null
    and filed.created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')
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
    );
$$;

revoke all on function public.list_auto_assigned_today() from public, anon;
grant execute on function public.list_auto_assigned_today() to authenticated, service_role;

create or replace function public.list_review()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'transaction_id', t.id,
    'description', t.description,
    'doc_date', t.doc_date,
    'doc_kind', t.doc_kind,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'currency', t.currency,
    'vat_agorot', t.vat_amount,
    'direction', t.direction,
    'line_status', t.line_status,
    'reason', q.reason,
    'pnl_role', t.pnl_role,
    'share_count', (
      select count(*)::int
      from public.allocations a
      where a.transaction_id = t.id
    ),
    'project_id', t.project_id,
    'category_id', t.category_id,
    'project_name', p.name,
    'category_name', c.name,
    'category_suggested', t.category_suggested,
    'project_suggested', (
      t.project_id is not null
      and not t.user_assigned
      and not t.project_assigned
      and coalesce(t.pnl_role, 'project') is distinct from 'shared'
      and (
        select count(*)
        from public.allocations a
        where a.transaction_id = t.id
          and a.company_id = t.company_id
      ) <= 1
      and not exists (
        select 1
        from public.suppliers sp
        where sp.id = t.supplier_id
          and sp.company_id = t.company_id
          and sp.remembered_project_id = t.project_id
      )
    ),
    'confidence', null,
    'supplier_name', s.name,
    'auto_approved_today', (
      select count(*)::int
      from public.transactions filed
      where filed.company_id = q.company_id
        and private.is_connector_source(filed.source)
        and filed.line_status = 'posted'
        and filed.removed_at is null
        and filed.created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')
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
    )
  ) order by t.doc_date, q.created_at), '[]'::jsonb)
  from public.review_queue q
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  where q.company_id = (select private.current_company_id())
    and q.status = 'open'
    and t.removed_at is null;
$$;

revoke all on function public.list_review() from public, anon;
grant execute on function public.list_review() to authenticated, service_role;

create or replace function public.sync_review_queue(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
        then 'unallocated_shared'
      when t.category_id is null then 'missing_category'
      when coalesce(t.pnl_role, 'project') = 'project' and t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'expense'
    and (
      (
        t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
      )
      or t.category_id is null
      or (
        coalesce(t.pnl_role, 'project') = 'project'
        and t.project_id is null
      )
      or (t.category_suggested and not t.user_assigned)
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.sync_review_queue(uuid) from public, anon, authenticated;
grant execute on function public.sync_review_queue(uuid) to service_role;

alter table public.categories
  add column excluded_from_pnl boolean not null default false;

create or replace function private.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (company_id, name, kind, sort_order, is_default) values
    (new.id, 'חומרים', 'expense', 1, true),
    (new.id, 'קבלני משנה', 'expense', 2, true),
    (new.id, 'עבודה', 'expense', 3, true),
    (new.id, 'ציוד והשכרה', 'expense', 4, true),
    (new.id, 'הובלה', 'expense', 5, true),
    (new.id, 'ביטוח', 'expense', 6, true),
    (new.id, 'אחר', 'expense', 7, true),
    (new.id, 'תקבול מלקוח', 'income', 1, true),
    (new.id, 'הכנסה אחרת', 'income', 2, true);
  insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl) values
    (new.id, 'תשלומי הלוואה', 'expense', 8, true, true),
    (new.id, 'העברות', 'expense', 9, true, true),
    (new.id, 'העברות', 'income', 3, true, true);
  return new;
end;
$$;

revoke all on function private.seed_default_categories() from public, anon;
grant execute on function private.seed_default_categories() to authenticated, service_role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select c.id, v.name, v.kind, v.sort_order, true, true
from public.companies c
cross join (
  values
    ('תשלומי הלוואה', 'expense'::public.category_kind, 8),
    ('העברות', 'expense'::public.category_kind, 9),
    ('העברות', 'income'::public.category_kind, 3)
) as v(name, kind, sort_order)
on conflict (company_id, kind, name) do nothing;
