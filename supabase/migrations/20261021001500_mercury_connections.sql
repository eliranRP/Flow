-- FLOW-938 (decision 0203): several Mercury connections per company, the accounts each one syncs,
-- and the date each account imports from.
--
-- 1. connector_connections gets a slot (1-9; SUMIT stays on 1) and its key becomes
--    (company_id, provider, slot). A Mercury connection also keeps:
--    - org_label: the organisation's name as Mercury lists it on its accounts.
--    - accounts_chosen_at: when the owner picked the accounts. A new connection syncs nothing until then.
--    - sync_account_ids: the accounts that sync (null: every account, the shape before this file).
--    - skip_account_ids: the accounts the owner left out, so they are not offered again as new.
--    - account_from: the import start of an account added after the connection's own start
--      ({account id: date}); import_from stays the earliest start of any synced account.
--    The rows already here keep syncing what they synced: chosen now, every listed account synced.
-- 2. set_mercury_accounts(slot, accounts, from): the owner saves a connection's accounts (connect step 3,
--    the edit list, and the answer to a new account). An account added with a start before today clears
--    the connection's cursor, so the next sync reads back to it; rows already in are updated, never doubled.
-- 3. A slot argument (default null: every row, as before) on upsert_connector_lines, stamp_connector_sync,
--    note_connector_failure, replace_connector_connection and disconnect_connector, so mercury-sync,
--    mercury-connect and the app address one connection. The functions are patched in place and their
--    grants restated.
-- 4. replace_sumit_connection targets the new key; the daily refresh queues a company once however many
--    connections it has (the open-request index allows one per company and provider).
-- 5. connector_connection_status shows the new columns.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

alter table public.connector_connections
  add column slot smallint not null default 1,
  add column org_label text,
  add column accounts_chosen_at timestamptz,
  add column sync_account_ids text[],
  add column skip_account_ids text[] not null default '{}'::text[],
  add column account_from jsonb not null default '{}'::jsonb,
  add constraint connector_connections_slot check (slot between 1 and 9 and (provider = 'mercury' or slot = 1)),
  add constraint connector_connections_org_label check (org_label is null or char_length(org_label) <= 300),
  add constraint connector_connections_account_lists check (
    coalesce(cardinality(sync_account_ids), 0) <= 200 and cardinality(skip_account_ids) <= 200
  ),
  add constraint connector_connections_account_from check (jsonb_typeof(account_from) = 'object');

alter table public.connector_connections drop constraint connector_connections_pkey;
alter table public.connector_connections add primary key (company_id, provider, slot);

-- The connections already syncing keep every account they list, and are not asked again.
update public.connector_connections c
set accounts_chosen_at = coalesce(c.created_at, pg_catalog.now()),
    sync_account_ids = (
      select array_agg(distinct e.value->>'id' order by e.value->>'id')
      from jsonb_array_elements(case when jsonb_typeof(c.account_labels) = 'array' then c.account_labels else '[]'::jsonb end) e
      where jsonb_typeof(e.value) = 'object' and length(coalesce(e.value->>'id', '')) between 1 and 128
    )
where c.provider = 'mercury';

grant select (slot, org_label, accounts_chosen_at, sync_account_ids, skip_account_ids, account_from)
  on public.connector_connections to authenticated;

create or replace view public.connector_connection_status
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
  ) as skip_count,
  (
    sync_claimed_at is not null
    and sync_claimed_at > pg_catalog.now() - interval '10 minutes'
  ) as syncing,
  slot,
  org_label,
  (accounts_chosen_at is not null) as accounts_chosen,
  sync_account_ids,
  skip_account_ids
from public.connector_connections;

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  head text;
  anchor text;
  slot_head text;
begin
  -- upsert_connector_lines: the cursor read and write belong to one connection.
  def := pg_get_functiondef('public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)'::regprocedure);
  head := 'p_expected_prev_cursor text)';
  anchor := $a$  from public.connector_connections c
  where c.company_id = p_company
    and c.provider = p_provider
  for update;$a$;
  slot_head := $a$    set sync_cursor = p_next_cursor,
        sync_claimed_at = null
    where company_id = p_company
      and provider = p_provider$a$;
  if pg_temp.anchor_count(def, head) <> 1 or pg_temp.anchor_count(def, anchor) <> 1
     or pg_temp.anchor_count(def, slot_head) <> 1 then
    raise exception 'upsert_connector_lines is not the expected definition';
  end if;
  def := replace(def, head, 'p_expected_prev_cursor text, p_slot smallint DEFAULT NULL::smallint)');
  def := replace(def, anchor, $n$  from public.connector_connections c
  where c.company_id = p_company
    and c.provider = p_provider
    and (p_slot is null or c.slot = p_slot)
  for update;$n$);
  def := replace(def, slot_head, slot_head || $n$
      and (p_slot is null or slot = p_slot)$n$);
  drop function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text);
  execute def;

  -- stamp_connector_sync and note_connector_failure: one connection's stamp and failure.
  def := pg_get_functiondef('public.stamp_connector_sync(uuid,public.connector_provider)'::regprocedure);
  head := 'p_provider connector_provider)';
  anchor := $a$  where company_id = p_company
    and provider = p_provider;$a$;
  if pg_temp.anchor_count(def, head) <> 1 or pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'stamp_connector_sync is not the expected definition';
  end if;
  def := replace(def, head, 'p_provider connector_provider, p_slot smallint DEFAULT NULL::smallint)');
  def := replace(def, anchor, $n$  where company_id = p_company
    and provider = p_provider
    and (p_slot is null or slot = p_slot);$n$);
  drop function public.stamp_connector_sync(uuid, public.connector_provider);
  execute def;

  def := pg_get_functiondef('public.note_connector_failure(uuid,public.connector_provider,text)'::regprocedure);
  head := 'p_code text)';
  if pg_temp.anchor_count(def, head) <> 1 or pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'note_connector_failure is not the expected definition';
  end if;
  def := replace(def, head, 'p_code text, p_slot smallint DEFAULT NULL::smallint)');
  def := replace(def, anchor, $n$  where company_id = p_company
    and provider = p_provider
    and (p_slot is null or slot = p_slot);$n$);
  drop function public.note_connector_failure(uuid, public.connector_provider, text);
  execute def;

  -- replace_connector_connection: a Mercury key goes into its slot.
  def := pg_get_functiondef('public.replace_connector_connection(uuid,public.connector_provider,text,text,text,text,text,text,boolean,jsonb)'::regprocedure);
  head := 'p_settings jsonb)';
  if pg_temp.anchor_count(def, head) <> 1
     or pg_temp.anchor_count(def, $a$    kek_ref, kek_version, envelope_version, settings
  ) values ($a$) <> 1
     or pg_temp.anchor_count(def, $a$    coalesce(p_settings, '{}'::jsonb)
  )$a$) <> 1
     or pg_temp.anchor_count(def, 'on conflict (company_id, provider) do update') <> 1 then
    raise exception 'replace_connector_connection is not the expected definition';
  end if;
  def := replace(def, head, 'p_settings jsonb, p_slot smallint DEFAULT NULL::smallint)');
  def := replace(def, $a$    kek_ref, kek_version, envelope_version, settings
  ) values ($a$, $n$    kek_ref, kek_version, envelope_version, settings, slot
  ) values ($n$);
  def := replace(def, $a$    coalesce(p_settings, '{}'::jsonb)
  )$a$, $n$    coalesce(p_settings, '{}'::jsonb),
    coalesce(p_slot, 1)
  )$n$);
  def := replace(def, 'on conflict (company_id, provider) do update', 'on conflict (company_id, provider, slot) do update');
  drop function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb);
  execute def;

  -- replace_sumit_connection: SUMIT's one row is on slot 1.
  def := pg_get_functiondef('public.replace_sumit_connection(uuid,bigint,text,text,text,text,text,text,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, 'on conflict (company_id, provider) do update') <> 1 then
    raise exception 'replace_sumit_connection is not the expected definition';
  end if;
  execute replace(def, 'on conflict (company_id, provider) do update', 'on conflict (company_id, provider, slot) do update');

  -- disconnect_connector: one Mercury connection, or (no slot) every connection of the provider.
  def := pg_get_functiondef('public.disconnect_connector(public.connector_provider)'::regprocedure);
  head := 'disconnect_connector(p_provider connector_provider)';
  anchor := $a$  delete from public.connector_connections
  where company_id = cid
    and provider = p_provider;$a$;
  if pg_temp.anchor_count(def, head) <> 1 or pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'disconnect_connector is not the expected definition';
  end if;
  def := replace(def, head, 'disconnect_connector(p_provider connector_provider, p_slot smallint DEFAULT NULL::smallint)');
  def := replace(def, anchor, $n$  delete from public.connector_connections
  where company_id = cid
    and provider = p_provider
    and (p_slot is null or slot = p_slot);$n$);
  drop function public.disconnect_connector(public.connector_provider);
  execute def;

  -- The daily refresh: one open request per company and provider, however many connections.
  def := pg_get_functiondef('private.schedule_connector_jobs()'::regprocedure);
  anchor := $a$        select c.company_id, c.provider
        from public.connector_connections c$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'schedule_connector_jobs is not the expected definition';
  end if;
  execute replace(def, anchor, $n$        select distinct c.company_id, c.provider
        from public.connector_connections c$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

revoke all on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text, smallint) from public, anon, authenticated;
grant execute on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text, smallint) to service_role;
revoke all on function public.stamp_connector_sync(uuid, public.connector_provider, smallint) from public, anon, authenticated;
grant execute on function public.stamp_connector_sync(uuid, public.connector_provider, smallint) to service_role;
revoke all on function public.note_connector_failure(uuid, public.connector_provider, text, smallint) from public, anon, authenticated;
grant execute on function public.note_connector_failure(uuid, public.connector_provider, text, smallint) to service_role;
revoke all on function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb, smallint) from public, anon, authenticated;
grant execute on function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb, smallint) to service_role;
revoke all on function public.disconnect_connector(public.connector_provider, smallint) from public, anon;
grant execute on function public.disconnect_connector(public.connector_provider, smallint) to authenticated, service_role;

-- The owner saves which accounts a Mercury connection syncs (p_accounts, at least one, each listed by
-- the connection) and where an account added now starts: p_from is 'start' (all Mercury keeps),
-- 'YYYY-MM-DD' (not after today), or null (the connection's first choice starts at the start; an
-- account added later starts today). Accounts already synced keep their start. Every listed account
-- left out is recorded as skipped, so it is not offered again as new.
create or replace function public.set_mercury_accounts(p_slot smallint, p_accounts text[], p_from text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  conn public.connector_connections%rowtype;
  today date := (pg_catalog.now() at time zone 'Asia/Jerusalem')::date;
  listed text[];
  wanted text[];
  previous text[];
  pick date;
  first_choice boolean;
  starts jsonb := '{}'::jsonb;
  earliest date;
  from_start boolean := false;
  reread boolean := false;
  added integer := 0;
  id text;
  acct_start date;
  kept jsonb := '{}'::jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'authenticated'
     and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  cid := private.owner_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select * into conn
  from public.connector_connections c
  where c.company_id = cid
    and c.provider = 'mercury'
    and c.slot = p_slot
  for update;
  if not found then
    raise exception 'connector is not connected';
  end if;

  listed := array(
    select distinct e.value->>'id'
    from jsonb_array_elements(case when jsonb_typeof(conn.account_labels) = 'array' then conn.account_labels else '[]'::jsonb end) e
    where jsonb_typeof(e.value) = 'object' and length(coalesce(e.value->>'id', '')) between 1 and 128
  );
  wanted := array(select distinct a from unnest(coalesce(p_accounts, '{}'::text[])) a where a is not null and a <> '');
  if cardinality(wanted) = 0 then
    raise exception 'choose at least one account';
  end if;
  if exists (select 1 from unnest(wanted) a where not (a = any (listed))) then
    raise exception 'account is not on this connection';
  end if;

  first_choice := conn.accounts_chosen_at is null;
  if p_from is null then
    pick := case when first_choice then null else today end;
  elsif p_from = 'start' then
    pick := null;
  elsif p_from ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      pick := p_from::date;
    exception when others then
      raise exception 'import date is invalid';
    end;
    if pick > today then
      raise exception 'import date is after today';
    end if;
  else
    raise exception 'import date is invalid';
  end if;

  previous := case when first_choice then '{}'::text[] else coalesce(conn.sync_account_ids, listed) end;
  foreach id in array wanted loop
    if id = any (previous) then
      acct_start := coalesce(
        case when conn.account_from->>id ~ '^\d{4}-\d{2}-\d{2}$' then (conn.account_from->>id)::date end,
        conn.import_from
      );
    else
      acct_start := pick;
      added := added + 1;
      -- Reading back before today needs the whole window again.
      if not first_choice and (pick is null or pick < today) then
        reread := true;
      end if;
    end if;
    if acct_start is null then
      from_start := true;
    else
      starts := starts || jsonb_build_object(id, acct_start);
      earliest := least(earliest, acct_start);
    end if;
  end loop;
  if from_start then
    earliest := null;
  end if;
  -- Only a start later than the connection's own is kept per account.
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) into kept
  from jsonb_each_text(starts) s
  where earliest is null or s.value::date > earliest;

  update public.connector_connections c
  set sync_account_ids = wanted,
      skip_account_ids = array(select a from unnest(listed) a where not (a = any (wanted)) order by a),
      account_from = kept,
      import_from = earliest,
      accounts_chosen_at = coalesce(c.accounts_chosen_at, pg_catalog.now()),
      sync_cursor = case when reread then null else c.sync_cursor end
  where c.company_id = cid
    and c.provider = 'mercury'
    and c.slot = p_slot;

  return jsonb_build_object(
    'slot', p_slot,
    'synced', cardinality(wanted),
    'added', added,
    'import_from', earliest,
    'reread', reread or first_choice
  );
end;
$$;

revoke all on function public.set_mercury_accounts(smallint, text[], text) from public, anon, authenticated;
grant execute on function public.set_mercury_accounts(smallint, text[], text) to authenticated, service_role;

comment on function public.set_mercury_accounts(smallint, text[], text) is
  'FLOW-938 (decision 0203): the owner saves which accounts one Mercury connection syncs and where an account added now starts.';

-- Reschedule the daily job with the new command.
do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_connector_jobs();
end
$schedule$;

commit;
