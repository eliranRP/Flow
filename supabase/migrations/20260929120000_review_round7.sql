-- Round 7. Do not edit earlier migrations.
-- Shared costs stay on Split. SUMIT rejections back off. The drain can be scheduled again.
-- txn_source loses hapoalim: bank lines come from SUMIT.

update public.transactions set source = 'sumit' where source::text = 'hapoalim';

alter table public.transactions alter column source type text using source::text;
drop type public.txn_source;
create type public.txn_source as enum ('sumit', 'manual', 'photo');
alter table public.transactions
  alter column source type public.txn_source using source::public.txn_source;

alter table public.sumit_connections
  add column reject_attempts integer not null default 0,
  add column next_attempt_at timestamptz;

create or replace function public.get_transaction(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'description', t.description,
    'direction', t.direction,
    'doc_kind', t.doc_kind,
    'doc_date', t.doc_date,
    'amount_gross', t.amount_gross,
    'amount_net', t.amount_net,
    'vat_amount', t.vat_amount,
    'vat_status', t.vat_status,
    'source', t.source,
    'pnl_role', t.pnl_role,
    'project_id', t.project_id,
    'project_name', p.name,
    'category_id', t.category_id,
    'category_name', c.name,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'review_status', (
      select q.status
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id
      order by case when q.status = 'open' then 0 else 1 end, q.created_at desc
      limit 1
    ),
    'review_reason', (
      select q.reason
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
    'paid', t.cash_date is not null,
    'open_gross_agorot', case
      when t.doc_kind = 'invoice' and t.external_id is not null then
        t.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = t.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = t.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = t.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = t.external_id
        ), 0)
      else null
    end,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id,
        'project_name', ap.name,
        'share_bp', a.share_bp,
        'amount_net', a.amount_net
      ) order by ap.name)
      from public.allocations a
      join public.projects ap on ap.id = a.project_id
      where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = p_id
    and t.removed_at is null
    and t.company_id = (select private.current_company_id());
$$;

create or replace function public.reassign_transaction(
  p_id uuid,
  p_project_id uuid,
  p_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  direction public.txn_direction;
  net bigint;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_shares jsonb;
  cat_kind text;
  review_id uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned
  into direction, net, prior_project, prior_category, prior_role, prior_assigned
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;
  if cat_kind is distinct from direction::text then
    raise exception 'category kind must match the direction';
  end if;
  if prior_role = 'shared' or exists (
    select 1
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'unallocated_shared'
  ) then
    raise exception 'shared costs are split, not assigned to one project';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  select q.id into review_id
  from public.review_queue q
  where q.transaction_id = p_id and q.company_id = cid and q.status = 'open'
  order by q.created_at desc
  limit 1;

  delete from public.allocations where transaction_id = p_id and company_id = cid;
  delete from public.overhead where transaction_id = p_id and company_id = cid;

  if direction = 'income' then
    update public.transactions
    set project_id = null,
        category_id = p_category_id,
        pnl_role = null,
        user_assigned = true
    where id = p_id and company_id = cid;
  else
    if p_project_id is null or not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = 'project',
        user_assigned = true
    where id = p_id and company_id = cid;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, p_id, p_project_id, 10000, net);
  end if;

  if review_id is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_allocations = prior_shares
    where id = review_id and company_id = cid;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_shares, review_id
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

revoke all on function public.reassign_transaction(uuid, uuid, uuid) from public, anon;
grant execute on function public.reassign_transaction(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.stamp_sumit_sync(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  update public.sumit_connections
  set last_sync_at = now(),
      last_error = case when last_error like 'sync_sweep%' then last_error else null end,
      reject_attempts = 0,
      next_attempt_at = null
  where company_id = p_company;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'could not stamp the sync';
  end if;
end;
$$;

revoke all on function public.stamp_sumit_sync(uuid) from public, anon, authenticated;
grant execute on function public.stamp_sumit_sync(uuid) to service_role;

-- Re-run after Vault holds cron_secret and flow_sync_url. An empty secret does not schedule.
create or replace function private.schedule_drain()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  if to_regclass('cron.job') is not null then
    begin
      perform cron.unschedule('flow-sumit-drain');
    exception
      when others then
        null;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'flow-sumit-drain skipped: pg_cron or pg_net is missing';
    return;
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
    $sql$ into secret;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
  end;

  if secret is null or btrim(secret) = '' then
    raise notice 'flow-sumit-drain skipped: cron_secret is missing';
    return;
  end if;

  perform cron.schedule(
    'flow-sumit-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := coalesce(
          (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'flow_sync_url'
            limit 1
          ),
          'http://kong:8000/functions/v1/sumit-sync'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-flow-cron', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb
      )
      where exists (
        select 1
        from public.sumit_refresh_requests r
        left join public.sumit_connections c on c.company_id = r.company_id
        where r.claimed_at is null
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
      );
    $cron$
  );
exception
  when undefined_table or undefined_function then
    raise notice 'flow-sumit-drain skipped: %', sqlerrm;
end;
$$;

revoke all on function private.schedule_drain() from public, anon, authenticated;
grant execute on function private.schedule_drain() to service_role;

select private.schedule_drain();
