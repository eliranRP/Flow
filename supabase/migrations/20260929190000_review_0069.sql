-- Decision 0069. Append-only.
-- A SUMIT expense can name a budget section and still have no Flow category.
-- Fill a category from the supplier rule, then that supplier's history, then
-- the default category for the direction, and keep the row in the queue until
-- the owner taps אישור. A plain approve does not write the supplier rule.
-- Also narrow companies UPDATE: id, owner_id, created_at, and is_demo stay revoked.

alter table public.transactions
  add column category_suggested boolean not null default false;

comment on column public.transactions.category_suggested is
  'True when Flow filled the category so the row can be approved in one tap. Decision 0069.';

create or replace function private.fill_suggested_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  picked uuid;
begin
  if new.user_assigned then
    new.category_suggested := false;
    return new;
  end if;

  if new.category_id is not null then
    if tg_op = 'INSERT' then
      new.category_suggested := false;
    elsif new.category_id is distinct from old.category_id then
      new.category_suggested := false;
    end if;
    return new;
  end if;

  picked := null;
  if new.supplier_id is not null then
    select s.remembered_category_id into picked
    from public.suppliers s
    join public.categories c
      on c.id = s.remembered_category_id
     and c.company_id = s.company_id
    where s.id = new.supplier_id
      and s.company_id = new.company_id
      and not c.hidden
      and c.kind::text = new.direction::text;
  end if;

  if picked is null and new.supplier_id is not null then
    select chosen.category_id into picked
    from (
      select t.category_id
      from public.transactions t
      join public.categories c
        on c.id = t.category_id
       and c.company_id = t.company_id
      where t.company_id = new.company_id
        and t.supplier_id = new.supplier_id
        and t.direction = new.direction
        and t.id is distinct from new.id
        and t.removed_at is null
        and t.user_assigned
        and not c.hidden
        and c.kind::text = new.direction::text
      group by t.category_id
      order by count(*) desc, max(t.doc_date) desc
      limit 1
    ) chosen;
  end if;

  if picked is null then
    select c.id into picked
    from public.categories c
    where c.company_id = new.company_id
      and c.kind::text = new.direction::text
      and c.is_default
      and not c.hidden
    order by c.sort_order, c.name
    limit 1;
  end if;

  if picked is null then
    new.category_suggested := false;
    return new;
  end if;

  new.category_id := picked;
  -- A remembered supplier rule is the assignment. History and the default stay a suggestion.
  new.category_suggested := not exists (
    select 1
    from public.suppliers s
    where s.id = new.supplier_id
      and s.company_id = new.company_id
      and s.remembered_category_id = picked
  );
  return new;
end;
$$;

revoke all on function private.fill_suggested_category() from public, anon, authenticated;

drop trigger if exists transactions_fill_category on public.transactions;
create trigger transactions_fill_category
  before insert or update on public.transactions
  for each row execute function private.fill_suggested_category();

-- Rows already imported with a project and no category (חומרי בניין השרון).
update public.transactions
set description = description
where category_id is null
  and user_assigned = false
  and removed_at is null;

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
    and t.source = 'sumit'
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

revoke update on table public.companies from public, anon, authenticated;

grant update (
  name,
  tax_id,
  vat_rate_bp,
  vat_registered,
  after_overhead,
  updated_at
) on table public.companies to authenticated;

-- The owner can select the undo log. No policy matches, so the result is empty.
-- Insert stays revoked, so a direct write is permission denied.
grant select on table public.reassign_undo to authenticated;
