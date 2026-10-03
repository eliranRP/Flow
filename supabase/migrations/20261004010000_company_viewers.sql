-- A read-only smoke user for the demo company. There is no membership role:
-- private.current_company_id() is the owner, and the write policies stay on that.
-- private.readable_company_id() is the owner or a viewer of one is_demo company.
-- Select policies use the readable id. Insert, update, and delete stay on the owner.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create table public.company_viewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.company_viewers is
  'One read-only user, one demo company. Writes stay with the owner. The smoke user is provisioned once from the runbook.';

create or replace function private.company_viewers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.companies c
    where c.id = new.company_id
      and c.is_demo
  ) then
    raise exception 'viewer is only for a demo company' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.companies c
    where c.owner_id = new.user_id
  ) then
    raise exception 'an owner is not a viewer' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.company_viewers_guard() from public, anon, authenticated;

create trigger company_viewers_guard
  before insert or update on public.company_viewers
  for each row execute function private.company_viewers_guard();

alter table public.company_viewers enable row level security;
revoke all on public.company_viewers from public, anon, authenticated;
grant all on public.company_viewers to service_role;

-- Owner, or the demo company this user may only read.
create or replace function private.readable_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_company_id(),
    (
      select v.company_id
      from public.company_viewers v
      join public.companies c on c.id = v.company_id
      where v.user_id = (select auth.uid())
        and c.is_demo
    )
  );
$$;

revoke all on function private.readable_company_id() from public, anon;
grant execute on function private.readable_company_id() to authenticated, service_role;

-- Select for a viewer. Writes stay on private.current_company_id(), which is the owner.
do $policies$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'projects', 'customers', 'suppliers', 'transactions',
    'allocations', 'split_rules', 'split_rule_targets', 'overhead', 'review_queue'
  ]
  loop
    execute format('drop policy %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id = (select private.readable_company_id()))',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (company_id = (select private.current_company_id()))',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (company_id = (select private.current_company_id())) with check (company_id = (select private.current_company_id()))',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (company_id = (select private.current_company_id()))',
      t || '_delete', t
    );
  end loop;
end
$policies$;

drop policy companies_owner on public.companies;

create policy companies_select on public.companies
  for select to authenticated
  using (id = (select private.readable_company_id()));

create policy companies_insert on public.companies
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy companies_update on public.companies
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy companies_delete on public.companies
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

drop policy connector_connections_owner on public.connector_connections;
create policy connector_connections_select on public.connector_connections
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

drop policy connector_skips_owner on public.connector_skips;
create policy connector_skips_select on public.connector_skips
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

drop policy company_integrations_member_select on public.company_integrations;
create policy company_integrations_member_select on public.company_integrations
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

drop policy tag_suggestions_member_select on public.tag_suggestions;
create policy tag_suggestions_member_select on public.tag_suggestions
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

-- Read RPCs the signed-in screens call. Write RPCs keep current_company_id().
do $reads$
declare
  name text;
  def text;
begin
  foreach name in array array[
    'public.list_unpaid()',
    'public.list_review()',
    'public.sumit_status()'
  ]
  loop
    def := pg_get_functiondef(name::regprocedure);
    if position('private.current_company_id()' in def) = 0 then
      raise exception 'expected current_company_id in %', name;
    end if;
    execute replace(def, 'private.current_company_id()', 'private.readable_company_id()');
  end loop;

  def := pg_get_functiondef('public.company_pnl(uuid,date,date,text)'::regprocedure);
  if position('where id = p_company_id and owner_id = (select auth.uid())' in def) = 0 then
    raise exception 'company_pnl owner guard was not found';
  end if;
  execute replace(
    def,
    'where id = p_company_id and owner_id = (select auth.uid())',
    'where id = p_company_id and id = (select private.readable_company_id())'
  );
end
$reads$;

create or replace function public.get_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', coalesce((
          select sum(
            case
              when t.direction = 'income' and t.doc_kind in ('receipt', 'invoice_receipt') then t.amount_net
              when t.direction = 'expense' then t.amount_net
              else 0
            end
          )::bigint
          from public.transactions t
          where t.company_id = c.id
            and t.removed_at is null
            and t.line_status = 'posted'
        ), 0),
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.id = (select private.readable_company_id())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'is_demo', false
    )
  );
$$;

create or replace function public.get_dashboard(
  p_from date default null,
  p_to date default null,
  p_basis text default 'cash'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  payload jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return jsonb_build_object(
      'company_id', null,
      'name', null,
      'vat_registered', true,
      'basis', case when p_basis = 'invoiced' then 'invoiced' else 'cash' end,
      'from', p_from,
      'to', p_to,
      'income_agorot', 0,
      'direct_agorot', 0,
      'shared_agorot', 0,
      'overhead_agorot', 0,
      'expense_agorot', 0,
      'net_profit_agorot', 0,
      'prev_income_agorot', null,
      'prev_expense_agorot', null,
      'prev_net_agorot', null,
      'active_projects', 0,
      'review_count', 0,
      'after_overhead', false,
      'projects', '[]'::jsonb
    );
  end if;
  payload := public.company_pnl(cid, p_from, p_to, p_basis);
  return payload || jsonb_build_object(
    'after_overhead', coalesce((select c.after_overhead from public.companies c where c.id = cid), false)
  );
end;
$$;

create or replace function public.create_company(p_name text, p_vat_registered boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (
    select 1 from public.company_viewers v
    where v.user_id = (select auth.uid())
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  clean := btrim(coalesce(p_name, ''));
  if char_length(clean) < 2 then
    raise exception 'company name is too short';
  end if;
  if exists (select 1 from public.companies where owner_id = (select auth.uid())) then
    raise exception 'company already exists';
  end if;
  insert into public.companies (owner_id, name, vat_registered, vat_rate_bp)
  values (
    (select auth.uid()),
    clean,
    coalesce(p_vat_registered, true),
    case when coalesce(p_vat_registered, true) then 1800 else 0 end
  )
  returning id into cid;
  return cid;
end;
$$;

commit;
