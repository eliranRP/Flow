-- L1a engine. Connector tables, the SUMIT copy, compatibility views, and the jobs.
-- A SUMIT row that still resolves to format 1 stops this migration.
-- private.filed_today_rows() stays out until MCP 3b merges.
-- suppliers.sumit_external_id and customers.sumit_external_id stay. The upsert still writes them.

create type public.connector_provider as enum ('sumit', 'mercury');

create table public.connector_connections (
  id uuid not null default gen_random_uuid() unique,
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  key_ciphertext bytea not null,
  key_nonce bytea not null,
  dek_ciphertext bytea not null,
  dek_nonce bytea not null,
  kek_ref text not null,
  kek_version text not null,
  envelope_version text not null,
  account_labels jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  import_from date,
  sync_cursor text,
  sync_claimed_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  next_attempt_at timestamptz,
  reject_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, provider),
  constraint connector_connections_kek_ref_name check (kek_ref in ('SUMIT_KEK', 'MERCURY_KEK')),
  constraint connector_connections_ciphertext_present check (
    octet_length(key_ciphertext) > 0
    and octet_length(key_nonce) > 0
    and octet_length(dek_ciphertext) > 0
    and octet_length(dek_nonce) > 0
    and length(kek_version) > 0
    and length(envelope_version) > 0
  )
);

create trigger connector_connections_touch
  before update on public.connector_connections
  for each row execute function private.touch_updated_at();

alter table public.connector_connections enable row level security;

create policy connector_connections_owner on public.connector_connections
  for select to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.connector_connections from public, anon, authenticated;
grant select (
  company_id, provider, last_sync_at, last_error, next_attempt_at, import_from, account_labels
) on public.connector_connections to authenticated;
grant select, insert, update, delete on public.connector_connections to service_role;

create table public.connector_refresh_requests (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  forced boolean not null default false
);

create unique index connector_refresh_open_uidx
  on public.connector_refresh_requests (company_id, provider)
  where claimed_at is null;

alter table public.connector_refresh_requests enable row level security;
revoke all on public.connector_refresh_requests from public, anon, authenticated;
grant select, insert, update, delete on public.connector_refresh_requests to service_role;

create table public.connector_skips (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  external_id text,
  reason text not null,
  skipped_at timestamptz not null default now()
);

alter table public.connector_skips enable row level security;
create policy connector_skips_owner on public.connector_skips
  for select to authenticated
  using (company_id = (select private.current_company_id()));
revoke all on public.connector_skips from public, anon, authenticated;
grant select on public.connector_skips to authenticated;
grant select, insert, update, delete on public.connector_skips to service_role;

create table public.party_external_refs (
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  kind text not null,
  external_id text not null,
  supplier_id uuid,
  customer_id uuid,
  primary key (company_id, provider, kind, external_id),
  foreign key (company_id, supplier_id)
    references public.suppliers (company_id, id) on delete cascade,
  foreign key (company_id, customer_id)
    references public.customers (company_id, id) on delete cascade,
  constraint party_external_refs_kind check (
    (kind = 'supplier' and supplier_id is not null and customer_id is null)
    or (kind = 'customer' and customer_id is not null and supplier_id is null)
  )
);

alter table public.party_external_refs enable row level security;
revoke all on public.party_external_refs from public, anon, authenticated;
grant select, insert, update, delete on public.party_external_refs to service_role;

create view public.connector_connection_status
with (security_invoker = true) as
select
  company_id,
  provider,
  (last_error is distinct from 'auth') as connected,
  last_sync_at,
  last_error,
  next_attempt_at,
  import_from,
  account_labels,
  (
    select count(*)::integer
    from public.connector_skips s
    where s.company_id = connector_connections.company_id
      and s.provider = connector_connections.provider
  ) as skip_count
from public.connector_connections;

revoke all on public.connector_connection_status from public, anon;
grant select on public.connector_connection_status to authenticated, service_role;

-- Hold writers out until the copy and the drop commit. A concurrent update
-- otherwise lands on the table this migration then drops.
begin;

set local lock_timeout = '5s';

lock table public.sumit_connections, public.sumit_refresh_requests in access exclusive mode;

-- Format 1 is resealed before this migration. Copy only 2 and 3.
do $format1$
begin
  if exists (
    select 1
    from public.sumit_connections s
    where coalesce(s.envelope_version, case when s.kek_version = '2' then '2' else '1' end) = '1'
  ) then
    raise exception 'sumit envelope format 1 is still sealed';
  end if;
end
$format1$;

insert into public.connector_connections (
  id, company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version,
  account_labels, settings,
  last_sync_at, last_error, next_attempt_at, reject_attempts,
  created_at, updated_at
)
select
  s.id,
  s.company_id,
  'sumit'::public.connector_provider,
  s.key_ciphertext,
  s.key_nonce,
  s.dek_ciphertext,
  s.dek_nonce,
  'SUMIT_KEK',
  s.kek_version,
  coalesce(s.envelope_version, case when s.kek_version = '2' then '2' else '1' end),
  '[]'::jsonb,
  case
    when s.sumit_company_id is null then '{}'::jsonb
    else jsonb_build_object('sumit_company_id', s.sumit_company_id)
  end,
  s.last_sync_at,
  case s.last_error
    when 'sumit_auth' then 'auth'
    when 'sumit_rejected' then 'rejected'
    else s.last_error
  end,
  s.next_attempt_at,
  s.reject_attempts,
  s.created_at,
  s.updated_at
from public.sumit_connections s;

-- One open row per company, keeping its id. A second open row would miss
-- connector_refresh_open_uidx. The same id lets an in-flight unclaim find the row.
insert into public.connector_refresh_requests (id, company_id, provider, requested_at, claimed_at, forced)
overriding system value
select r.id, r.company_id, 'sumit'::public.connector_provider, r.requested_at, r.claimed_at, false
from (
  select distinct on (company_id)
    id, company_id, requested_at, claimed_at
  from public.sumit_refresh_requests
  where claimed_at is null
  order by company_id, requested_at desc, id desc
) r;

insert into public.connector_refresh_requests (id, company_id, provider, requested_at, claimed_at, forced)
overriding system value
select r.id, r.company_id, 'sumit'::public.connector_provider, r.requested_at, r.claimed_at, false
from public.sumit_refresh_requests r
where r.claimed_at is not null;

select pg_catalog.setval(
  pg_catalog.pg_get_serial_sequence('public.connector_refresh_requests', 'id'),
  coalesce((select max(id) from public.connector_refresh_requests), 1),
  exists (select 1 from public.connector_refresh_requests)
);

insert into public.party_external_refs (company_id, provider, kind, external_id, supplier_id)
select s.company_id, 'sumit'::public.connector_provider, 'supplier', s.sumit_external_id::text, s.id
from public.suppliers s
where s.sumit_external_id is not null;

insert into public.party_external_refs (company_id, provider, kind, external_id, customer_id)
select c.company_id, 'sumit'::public.connector_provider, 'customer', c.sumit_external_id::text, c.id
from public.customers c
where c.sumit_external_id is not null;

do $copycount$
declare
  source_count bigint;
  target_count bigint;
begin
  select count(*) into source_count from public.sumit_connections;
  select count(*) into target_count
  from public.connector_connections
  where provider = 'sumit';
  if source_count <> target_count then
    raise exception 'sumit connection copy count mismatch';
  end if;

  select
    (select count(*) from public.sumit_refresh_requests where claimed_at is not null)
    + (select count(distinct company_id) from public.sumit_refresh_requests where claimed_at is null)
  into source_count;
  select count(*) into target_count
  from public.connector_refresh_requests
  where provider = 'sumit';
  if source_count <> target_count then
    raise exception 'sumit refresh copy count mismatch';
  end if;

  select count(*) into source_count from public.suppliers where sumit_external_id is not null;
  select count(*) into target_count
  from public.party_external_refs
  where provider = 'sumit' and kind = 'supplier';
  if source_count <> target_count then
    raise exception 'sumit supplier ref copy count mismatch';
  end if;

  select count(*) into source_count from public.customers where sumit_external_id is not null;
  select count(*) into target_count
  from public.party_external_refs
  where provider = 'sumit' and kind = 'customer';
  if source_count <> target_count then
    raise exception 'sumit customer ref copy count mismatch';
  end if;
end
$copycount$;

drop view public.sumit_connection_status;
drop table public.sumit_connections;
drop table public.sumit_refresh_requests;

commit;

-- security_invoker checks every column the view body reads. Authenticated is not
-- granted ciphertext or settings, so the view reads through this definer function.
-- A session that is not the service role, and not an empty-role superuser, gets
-- null ciphertext. The company filter is the same session's company.
create function private.connector_session_reads_secrets()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or (
      coalesce(auth.role(), '') = ''
      and session_user in ('postgres', 'supabase_admin')
    );
$$;

revoke all on function private.connector_session_reads_secrets() from public, anon, authenticated;

create function private.sumit_connection_rows()
returns table (
  id uuid,
  company_id uuid,
  sumit_company_id bigint,
  key_ciphertext bytea,
  key_nonce bytea,
  dek_ciphertext bytea,
  dek_nonce bytea,
  kek_version text,
  created_at timestamptz,
  updated_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  envelope_version text,
  reject_attempts integer,
  next_attempt_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.company_id,
    nullif(c.settings->>'sumit_company_id', '')::bigint,
    case when private.connector_session_reads_secrets() then c.key_ciphertext else null end,
    case when private.connector_session_reads_secrets() then c.key_nonce else null end,
    case when private.connector_session_reads_secrets() then c.dek_ciphertext else null end,
    case when private.connector_session_reads_secrets() then c.dek_nonce else null end,
    case when private.connector_session_reads_secrets() then c.kek_version else null end,
    c.created_at,
    c.updated_at,
    c.last_sync_at,
    case c.last_error
      when 'auth' then 'sumit_auth'
      when 'rejected' then 'sumit_rejected'
      else c.last_error
    end,
    case when private.connector_session_reads_secrets() then c.envelope_version else null end,
    case when private.connector_session_reads_secrets() then c.reject_attempts else null end,
    c.next_attempt_at
  from public.connector_connections c
  where c.provider = 'sumit'
    and (
      private.connector_session_reads_secrets()
      or c.company_id = (select private.current_company_id())
    );
$$;

revoke all on function private.sumit_connection_rows() from public, anon;
grant execute on function private.sumit_connection_rows() to authenticated, service_role;

create view public.sumit_connections
with (security_invoker = true) as
select
  id,
  company_id,
  sumit_company_id,
  key_ciphertext,
  key_nonce,
  dek_ciphertext,
  dek_nonce,
  kek_version,
  created_at,
  updated_at,
  last_sync_at,
  last_error,
  envelope_version,
  reject_attempts,
  next_attempt_at
from private.sumit_connection_rows();

revoke all on public.sumit_connections from public, anon, authenticated;
grant select (
  id, company_id, sumit_company_id, created_at, updated_at, last_sync_at, last_error, next_attempt_at
) on public.sumit_connections to authenticated;
grant select, insert, update, delete on public.sumit_connections to service_role;

create view public.sumit_refresh_requests
with (security_invoker = true) as
select r.id, r.company_id, r.requested_at, r.claimed_at
from public.connector_refresh_requests r
where r.provider = 'sumit';

revoke all on public.sumit_refresh_requests from public, anon, authenticated;
grant select, insert, update, delete on public.sumit_refresh_requests to service_role;

create view public.sumit_connection_status
with (security_invoker = true) as
select
  s.company_id,
  s.sumit_company_id,
  s.last_error is distinct from 'sumit_auth' as connected,
  s.last_sync_at,
  s.last_error
from public.sumit_connections s;

revoke all on public.sumit_connection_status from public, anon;
grant select on public.sumit_connection_status to authenticated, service_role;

create or replace function private.sumit_connections_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_error text;
  env text;
  stored_settings jsonb;
begin
  if tg_op = 'DELETE' then
    delete from public.connector_connections
    where company_id = old.company_id
      and provider = 'sumit';
    return old;
  end if;

  stored_error := case new.last_error
    when 'sumit_auth' then 'auth'
    when 'sumit_rejected' then 'rejected'
    else new.last_error
  end;
  env := coalesce(
    nullif(new.envelope_version, ''),
    case when new.kek_version = '2' then '2' else '1' end
  );
  stored_settings := case
    when new.sumit_company_id is null then '{}'::jsonb
    else jsonb_build_object('sumit_company_id', new.sumit_company_id)
  end;

  if tg_op = 'INSERT' then
    insert into public.connector_connections (
      id, company_id, provider,
      key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
      kek_ref, kek_version, envelope_version,
      account_labels, settings,
      last_sync_at, last_error, next_attempt_at, reject_attempts,
      created_at, updated_at
    ) values (
      coalesce(new.id, gen_random_uuid()),
      new.company_id,
      'sumit',
      new.key_ciphertext,
      new.key_nonce,
      new.dek_ciphertext,
      new.dek_nonce,
      'SUMIT_KEK',
      new.kek_version,
      env,
      '[]'::jsonb,
      stored_settings,
      new.last_sync_at,
      stored_error,
      new.next_attempt_at,
      coalesce(new.reject_attempts, 0),
      coalesce(new.created_at, pg_catalog.now()),
      coalesce(new.updated_at, pg_catalog.now())
    )
    returning id, created_at, updated_at
    into new.id, new.created_at, new.updated_at;
    return new;
  end if;

  update public.connector_connections
  set key_ciphertext = new.key_ciphertext,
      key_nonce = new.key_nonce,
      dek_ciphertext = new.dek_ciphertext,
      dek_nonce = new.dek_nonce,
      kek_version = new.kek_version,
      envelope_version = env,
      settings = stored_settings,
      last_sync_at = new.last_sync_at,
      last_error = stored_error,
      next_attempt_at = new.next_attempt_at,
      reject_attempts = coalesce(new.reject_attempts, 0)
  where company_id = old.company_id
    and provider = 'sumit';
  if not found then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function private.sumit_connections_write() from public, anon, authenticated;
grant execute on function private.sumit_connections_write() to service_role;

create trigger sumit_connections_write
  instead of insert or update or delete on public.sumit_connections
  for each row execute function private.sumit_connections_write();

create or replace function private.sumit_refresh_requests_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.connector_refresh_requests
    where id = old.id
      and provider = 'sumit';
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.connector_refresh_requests (company_id, provider, requested_at, claimed_at, forced)
    values (
      new.company_id,
      'sumit',
      coalesce(new.requested_at, pg_catalog.now()),
      new.claimed_at,
      false
    )
    returning id, requested_at into new.id, new.requested_at;
    return new;
  end if;

  update public.connector_refresh_requests
  set claimed_at = new.claimed_at,
      requested_at = coalesce(new.requested_at, requested_at)
  where id = old.id
    and provider = 'sumit';
  if not found then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function private.sumit_refresh_requests_write() from public, anon, authenticated;
grant execute on function private.sumit_refresh_requests_write() to service_role;

create trigger sumit_refresh_requests_write
  instead of insert or update or delete on public.sumit_refresh_requests
  for each row execute function private.sumit_refresh_requests_write();

-- ON CONFLICT cannot target a view. This writes connector_connections.
create or replace function public.replace_sumit_connection(
  p_company uuid,
  p_sumit_company_id bigint,
  p_key_ciphertext text,
  p_key_nonce text,
  p_dek_ciphertext text,
  p_dek_nonce text,
  p_kek_version text,
  p_envelope_version text,
  p_validated boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous bigint;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or p_sumit_company_id is null or p_sumit_company_id <= 0 then
    raise exception 'company id is required';
  end if;
  if p_validated is not true then
    raise exception 'validation failed';
  end if;
  if p_envelope_version is distinct from '2' and p_envelope_version is distinct from '3' then
    raise exception 'envelope format is not accepted';
  end if;

  select nullif(c.settings->>'sumit_company_id', '')::bigint into previous
  from public.connector_connections c
  where c.company_id = p_company
    and c.provider = 'sumit'
  for update;

  if previous is null then
    select c.last_sumit_company_id into previous
    from public.companies c
    where c.id = p_company
    for update;
  end if;

  if previous is not null and previous is distinct from p_sumit_company_id then
    update public.review_queue q
    set status = 'skipped',
        resolved_at = pg_catalog.now()
    where q.company_id = p_company
      and q.status = 'open'
      and q.transaction_id in (
        select t.id
        from public.transactions t
        where t.company_id = p_company
          and t.source = 'sumit'
          and t.removed_at is null
      );

    update public.transactions t
    set removed_at = pg_catalog.now()
    where t.company_id = p_company
      and t.source = 'sumit'
      and t.removed_at is null;
  end if;

  insert into public.connector_connections (
    company_id, provider,
    key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
    kek_ref, kek_version, envelope_version,
    settings,
    last_error, reject_attempts, next_attempt_at, last_sync_at
  ) values (
    p_company,
    'sumit',
    private.bytea_from_hex(p_key_ciphertext),
    private.bytea_from_hex(p_key_nonce),
    private.bytea_from_hex(p_dek_ciphertext),
    private.bytea_from_hex(p_dek_nonce),
    'SUMIT_KEK',
    p_kek_version,
    p_envelope_version,
    jsonb_build_object('sumit_company_id', p_sumit_company_id),
    null,
    0,
    null,
    null
  )
  on conflict (company_id, provider) do update
  set key_ciphertext = excluded.key_ciphertext,
      key_nonce = excluded.key_nonce,
      dek_ciphertext = excluded.dek_ciphertext,
      dek_nonce = excluded.dek_nonce,
      kek_version = excluded.kek_version,
      envelope_version = excluded.envelope_version,
      settings = excluded.settings,
      last_error = null,
      reject_attempts = 0,
      next_attempt_at = null,
      last_sync_at = null;

  update public.companies
  set last_sumit_company_id = p_sumit_company_id
  where id = p_company;
end;
$$;

revoke all on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) to service_role;

create or replace function public.replace_connector_connection(
  p_company uuid,
  p_provider public.connector_provider,
  p_key_ciphertext text,
  p_key_nonce text,
  p_dek_ciphertext text,
  p_dek_nonce text,
  p_kek_version text,
  p_envelope_version text,
  p_validated boolean,
  p_settings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  kek text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_validated is not true then
    raise exception 'validation failed';
  end if;
  if p_envelope_version is distinct from '2' and p_envelope_version is distinct from '3' then
    raise exception 'envelope format is not accepted';
  end if;
  kek := case p_provider when 'sumit' then 'SUMIT_KEK' when 'mercury' then 'MERCURY_KEK' end;
  if p_provider = 'sumit' then
    perform public.replace_sumit_connection(
      p_company,
      (p_settings->>'sumit_company_id')::bigint,
      p_key_ciphertext,
      p_key_nonce,
      p_dek_ciphertext,
      p_dek_nonce,
      p_kek_version,
      p_envelope_version,
      true
    );
    return;
  end if;
  insert into public.connector_connections (
    company_id, provider,
    key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
    kek_ref, kek_version, envelope_version, settings
  ) values (
    p_company,
    p_provider,
    private.bytea_from_hex(p_key_ciphertext),
    private.bytea_from_hex(p_key_nonce),
    private.bytea_from_hex(p_dek_ciphertext),
    private.bytea_from_hex(p_dek_nonce),
    kek,
    p_kek_version,
    p_envelope_version,
    coalesce(p_settings, '{}'::jsonb)
  )
  on conflict (company_id, provider) do update
  set key_ciphertext = excluded.key_ciphertext,
      key_nonce = excluded.key_nonce,
      dek_ciphertext = excluded.dek_ciphertext,
      dek_nonce = excluded.dek_nonce,
      kek_version = excluded.kek_version,
      envelope_version = excluded.envelope_version,
      settings = excluded.settings,
      last_error = null,
      reject_attempts = 0,
      next_attempt_at = null,
      last_sync_at = null;
end;
$$;

revoke all on function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb) to service_role;

create or replace function public.disconnect_connector(p_provider public.connector_provider)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'authenticated'
     and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_provider = 'sumit' then
    update public.companies c
    set last_sumit_company_id = nullif(s.settings->>'sumit_company_id', '')::bigint
    from public.connector_connections s
    where c.id = cid
      and s.company_id = cid
      and s.provider = 'sumit';
  end if;
  delete from public.connector_connections
  where company_id = cid
    and provider = p_provider;
end;
$$;

revoke all on function public.disconnect_connector(public.connector_provider) from public, anon;
grant execute on function public.disconnect_connector(public.connector_provider) to authenticated, service_role;

create or replace function public.request_connector_refresh(p_provider public.connector_provider)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  recent timestamptz;
  queued timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'authenticated'
     and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select c.last_sync_at into recent
  from public.connector_connections c
  where c.company_id = cid
    and c.provider = p_provider;
  if recent is not null and recent > pg_catalog.now() - interval '60 seconds' then
    return recent;
  end if;
  insert into public.connector_refresh_requests (company_id, provider, forced)
  values (cid, p_provider, true)
  on conflict (company_id, provider) where claimed_at is null do nothing
  returning requested_at into queued;
  if queued is null then
    select r.requested_at into queued
    from public.connector_refresh_requests r
    where r.company_id = cid
      and r.provider = p_provider
      and r.claimed_at is null;
  end if;
  return queued;
end;
$$;

revoke all on function public.request_connector_refresh(public.connector_provider) from public, anon;
grant execute on function public.request_connector_refresh(public.connector_provider) to authenticated, service_role;

create or replace function public.set_import_from(p_provider public.connector_provider, p_from date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date;
begin
  if coalesce(auth.role(), '') is distinct from 'authenticated'
     and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  today := (pg_catalog.now() at time zone 'Asia/Jerusalem')::date;
  if p_from is not null and p_from > today then
    raise exception 'import date is after today';
  end if;
  update public.connector_connections
  set import_from = p_from
  where company_id = cid
    and provider = p_provider;
  if not found then
    raise exception 'connector is not connected';
  end if;
end;
$$;

revoke all on function public.set_import_from(public.connector_provider, date) from public, anon;
grant execute on function public.set_import_from(public.connector_provider, date) to authenticated, service_role;

create or replace function public.note_connector_rejection(
  p_company uuid,
  p_provider public.connector_provider,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempts integer;
  retry timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_code = 'auth' then
    update public.connector_connections
    set last_error = 'auth',
        next_attempt_at = null
    where company_id = p_company
      and provider = p_provider;
    if not found then
      raise exception 'connector is not connected';
    end if;
    return jsonb_build_object('code', 'auth');
  end if;
  if p_code is distinct from 'rejected' then
    raise exception 'unknown connector code';
  end if;
  update public.connector_connections
  set reject_attempts = reject_attempts + 1,
      last_error = 'rejected',
      next_attempt_at = pg_catalog.now() + (
        case least(greatest(reject_attempts + 1, 1), 5)
          when 1 then interval '5 minutes'
          when 2 then interval '15 minutes'
          when 3 then interval '1 hour'
          when 4 then interval '6 hours'
          else interval '24 hours'
        end
      )
  where company_id = p_company
    and provider = p_provider
  returning reject_attempts, next_attempt_at into attempts, retry;
  if attempts is null then
    raise exception 'connector is not connected';
  end if;
  return jsonb_build_object('code', 'rejected', 'attempts', attempts, 'retry_at', retry);
end;
$$;

revoke all on function public.note_connector_rejection(uuid, public.connector_provider, text) from public, anon, authenticated;
grant execute on function public.note_connector_rejection(uuid, public.connector_provider, text) to service_role;

create or replace function public.note_connector_failure(
  p_company uuid,
  p_provider public.connector_provider,
  p_code text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_code is distinct from 'auth'
     and p_code is distinct from 'rejected'
     and p_code is distinct from 'rate_limited'
     and p_code is distinct from 'transient'
     and p_code is distinct from 'sync_sweep_empty'
     and p_code is distinct from 'sync_sweep_suspicious'
     and p_code is distinct from 'sync_page_cap' then
    raise exception 'unknown connector failure';
  end if;
  retry := case
    when p_code in ('transient', 'rate_limited', 'sync_page_cap') then pg_catalog.now() + interval '15 minutes'
    else null
  end;
  update public.connector_connections
  set last_error = p_code,
      next_attempt_at = case when p_code = 'auth' then null else coalesce(retry, next_attempt_at) end
  where company_id = p_company
    and provider = p_provider;
  if not found then
    raise exception 'connector is not connected';
  end if;
  return retry;
end;
$$;

revoke all on function public.note_connector_failure(uuid, public.connector_provider, text) from public, anon, authenticated;
grant execute on function public.note_connector_failure(uuid, public.connector_provider, text) to service_role;

create or replace function public.stamp_connector_sync(
  p_company uuid,
  p_provider public.connector_provider
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  update public.connector_connections
  set last_sync_at = pg_catalog.now(),
      last_error = case when last_error like 'sync_sweep%' then last_error else null end,
      reject_attempts = 0,
      next_attempt_at = null,
      sync_claimed_at = null
  where company_id = p_company
    and provider = p_provider;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'could not stamp the sync';
  end if;
end;
$$;

revoke all on function public.stamp_connector_sync(uuid, public.connector_provider) from public, anon, authenticated;
grant execute on function public.stamp_connector_sync(uuid, public.connector_provider) to service_role;

create or replace function public.list_due_connector_refreshes(p_limit integer)
returns table (id bigint, company_id uuid, provider public.connector_provider)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  select r.id, r.company_id, r.provider
  from public.connector_refresh_requests r
  left join public.connector_connections c
    on c.company_id = r.company_id
   and c.provider = r.provider
  where r.claimed_at is null
    and (c.next_attempt_at is null or c.next_attempt_at <= pg_catalog.now())
    and c.last_error is distinct from 'auth'
  order by r.requested_at
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.list_due_connector_refreshes(integer) from public, anon, authenticated;
grant execute on function public.list_due_connector_refreshes(integer) to service_role;

create or replace function public.claim_connector_refreshes(p_limit integer)
returns table (id bigint, company_id uuid, provider public.connector_provider)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  with due as (
    select r.id
    from public.connector_refresh_requests r
    join public.connector_connections c
      on c.company_id = r.company_id
     and c.provider = r.provider
    where r.claimed_at is null
      and (c.next_attempt_at is null or c.next_attempt_at <= pg_catalog.now())
      and c.last_error is distinct from 'auth'
      and (c.sync_claimed_at is null or c.sync_claimed_at < pg_catalog.now() - interval '15 minutes')
    order by r.requested_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of r, c skip locked
  ),
  marked as (
    update public.connector_refresh_requests r
    set claimed_at = pg_catalog.now()
    from due
    where r.id = due.id
    returning r.id, r.company_id, r.provider
  ),
  stamped as (
    update public.connector_connections c
    set sync_claimed_at = pg_catalog.now()
    from marked m
    where c.company_id = m.company_id
      and c.provider = m.provider
  )
  select m.id, m.company_id, m.provider
  from marked m;
end;
$$;

revoke all on function public.claim_connector_refreshes(integer) from public, anon, authenticated;
grant execute on function public.claim_connector_refreshes(integer) to service_role;

create or replace function private.schedule_connector_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  sync_url text;
  existing_name text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'flow-connector-daily requires pg_cron';
  end if;

  foreach existing_name in array ARRAY['flow-sumit-daily', 'flow-sumit-drain', 'flow-connector-daily', 'flow-connector-drain']
  loop
    if exists (select 1 from cron.job j where j.jobname = existing_name) then
      perform cron.unschedule(existing_name);
    end if;
  end loop;

  perform cron.schedule(
    'flow-connector-daily',
    '0 3 * * *',
    $cron$
        insert into public.connector_refresh_requests (company_id, provider)
        select c.company_id, c.provider
        from public.connector_connections c
        where not exists (
          select 1 from public.connector_refresh_requests r
          where r.company_id = c.company_id
            and r.provider = c.provider
            and r.claimed_at is null
        );
      $cron$
  );

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'flow-connector-drain skipped: pg_net is missing';
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
    raise notice 'flow-connector-drain skipped: cron_secret is missing';
    return;
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'flow_sync_url' limit 1
    $sql$ into sync_url;
  exception
    when undefined_table or invalid_schema_name then
      sync_url := null;
  end;

  if sync_url is null or btrim(sync_url) = '' then
    raise notice 'flow-connector-drain skipped: flow_sync_url is missing';
    return;
  end if;

  perform cron.schedule(
    'flow-connector-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'flow_sync_url'
          limit 1
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
        from public.connector_refresh_requests r
        left join public.connector_connections c
          on c.company_id = r.company_id
         and c.provider = r.provider
        where r.claimed_at is null
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and c.last_error is distinct from 'auth'
      );
    $cron$
  );
end;
$$;

revoke all on function private.schedule_connector_jobs() from public, anon, authenticated;
grant execute on function private.schedule_connector_jobs() to service_role;

-- The copy above commits, so a local setting on its own statement is gone
-- before this call. One block keeps the role for the schedule.
do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_connector_jobs();
end
$schedule$;
