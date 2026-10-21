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
--    grants restated. connector_skips gets the slot too: a complete run replaces only its own
--    connection's skip records, not every Mercury connection's.
-- 4. replace_sumit_connection targets the new key; the daily refresh queues a company once however many
--    connections it has (the open-request index allows one per company and provider).
-- 5. connector_connection_status shows the new columns.
-- 6. The MCP tools (decision 0095): mcp_bank_connections (list_bank_connections), mcp_set_bank_accounts
--    (set_bank_accounts) and mcp_answer_bank_account (answer_bank_account), the writes through
--    set_mercury_accounts with the idempotency key, the owner check and undo kind bank_accounts. Undo
--    clears the cursor when what it puts back reads further back (private.mercury_accounts_reread,
--    the same rule set_mercury_accounts applies), so a restored account is not left with a gap.
-- The edge functions deploy before this file is pushed; until then they keep the single-connection
-- behaviour on the old schema (supabase/functions/_shared/connectors/mercury/legacy.ts).
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

alter table public.connector_skips
  add column slot smallint not null default 1;

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
      and s.slot = connector_connections.slot
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
  -- The skip records belong to one connection: a complete run replaces only its own.
  anchor := $a$      delete from public.connector_skips s
      where s.company_id = p_company
        and s.provider = p_provider;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1
     or pg_temp.anchor_count(def, $a$    insert into public.connector_skips (company_id, provider, external_id, reason)
    select distinct p_company, p_provider, x.external_id, x.reason$a$) <> 1
     or pg_temp.anchor_count(def, $a$          and s.reason = x.reason
      );$a$) <> 1 then
    raise exception 'upsert_connector_lines skips are not the expected definition';
  end if;
  def := replace(def, anchor, $n$      delete from public.connector_skips s
      where s.company_id = p_company
        and s.provider = p_provider
        and (p_slot is null or s.slot = p_slot);$n$);
  def := replace(def, $a$    insert into public.connector_skips (company_id, provider, external_id, reason)
    select distinct p_company, p_provider, x.external_id, x.reason$a$, $n$    insert into public.connector_skips (company_id, provider, external_id, reason, slot)
    select distinct p_company, p_provider, x.external_id, x.reason, coalesce(p_slot, 1::smallint)$n$);
  def := replace(def, $a$          and s.reason = x.reason
      );$a$, $n$          and s.reason = x.reason
          and s.slot = coalesce(p_slot, 1::smallint)
      );$n$);
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

-- Whether a Mercury connection's accounts after a change read further back than before, so its cursor
-- must go and the next sync reads back to them. The states are private.mcp_bank_accounts_state's
-- (below). An account synced before reads back further only from an earlier start; an account not
-- synced before from a start before today (today's lines are in the window every run re-reads), or
-- from the start. Shared by set_mercury_accounts and the undo of bank_accounts, so a restored
-- account is not left with a gap.
create or replace function private.mercury_accounts_reread(p_labels jsonb, p_before jsonb, p_after jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  today date := (pg_catalog.now() at time zone 'Asia/Jerusalem')::date;
  listed text[];
  before_ids text[];
  after_ids text[];
  id text;
  old_start date;
  new_start date;
begin
  if p_after->>'chosen' is distinct from 'true' then
    return false;
  end if;
  listed := array(
    select distinct e.value->>'id'
    from jsonb_array_elements(case when jsonb_typeof(p_labels) = 'array' then p_labels else '[]'::jsonb end) e
    where jsonb_typeof(e.value) = 'object' and length(coalesce(e.value->>'id', '')) between 1 and 128
  );
  before_ids := case
    when p_before->>'chosen' is distinct from 'true' then '{}'::text[]
    when jsonb_typeof(p_before->'sync_account_ids') = 'array'
      then array(select jsonb_array_elements_text(p_before->'sync_account_ids'))
    else listed
  end;
  after_ids := case
    when jsonb_typeof(p_after->'sync_account_ids') = 'array'
      then array(select jsonb_array_elements_text(p_after->'sync_account_ids'))
    else listed
  end;
  foreach id in array after_ids loop
    -- An account's start: its own (account_from), else the connection's; null is the start.
    new_start := coalesce(
      case when p_after->'account_from'->>id ~ '^\d{4}-\d{2}-\d{2}$' then (p_after->'account_from'->>id)::date end,
      (p_after->>'import_from')::date
    );
    if id = any (before_ids) then
      old_start := coalesce(
        case when p_before->'account_from'->>id ~ '^\d{4}-\d{2}-\d{2}$' then (p_before->'account_from'->>id)::date end,
        (p_before->>'import_from')::date
      );
      if (new_start is null and old_start is not null) or new_start < old_start then
        return true;
      end if;
    elsif new_start is null or new_start < today then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function private.mercury_accounts_reread(jsonb, jsonb, jsonb) from public, anon, authenticated;

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
  reread boolean;
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
  -- Reading back before what was read needs the whole window again.
  reread := private.mercury_accounts_reread(
    conn.account_labels,
    private.mcp_bank_accounts_state(conn),
    jsonb_build_object('chosen', true, 'sync_account_ids', to_jsonb(wanted), 'account_from', kept, 'import_from', to_jsonb(earliest))
  );

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

-- 6. The MCP tools for the same screens (decision 0095): list_bank_connections reads every Mercury
--    connection with its accounts and which of them sync; set_bank_accounts and answer_bank_account save
--    through set_mercury_accounts, so the rules stay in one place. Each write takes the idempotency key
--    and the write gate, is the owner's only (as the RPC is), and records undo kind bank_accounts with the
--    connection's id: undo puts the accounts, the skipped list and the starts back, a conflict once they
--    changed again, and the cursor cleared when what comes back reads further back. Lines already
--    imported stay, as they do when an account is unchecked in the app.

-- What a write changes on a connection, compared by undo.
create or replace function private.mcp_bank_accounts_state(p_row public.connector_connections)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'sync_account_ids', to_jsonb(p_row.sync_account_ids),
    'skip_account_ids', to_jsonb(p_row.skip_account_ids),
    'account_from', p_row.account_from,
    'import_from', to_jsonb(p_row.import_from),
    'chosen', p_row.accounts_chosen_at is not null
  );
$$;

revoke all on function private.mcp_bank_accounts_state(public.connector_connections) from public, anon, authenticated;

-- set_mercury_accounts' refusals as MCP envelopes.
create or replace function private.mcp_bank_refused(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message in (
      'choose at least one account',
      'account is not on this connection',
      'import date is invalid',
      'import date is after today'
    ) then private.mcp_error('validation', p_message)
    when p_message = 'connector is not connected' then private.mcp_error('not_found', 'bank connection not found')
    when p_message = 'no company' then private.mcp_error('forbidden', 'owner only')
    else private.mcp_refused(p_message)
  end;
$$;

revoke all on function private.mcp_bank_refused(text) from public, anon, authenticated;

-- Saves through set_mercury_accounts and logs the write. The caller holds the gate and the key.
create or replace function private.mcp_save_bank_accounts(
  p_token uuid,
  p_slot smallint,
  p_accounts text[],
  p_from text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.owner_company_id();
  before_row public.connector_connections%rowtype;
  after_row public.connector_connections%rowtype;
  saved jsonb;
begin
  select * into before_row
  from public.connector_connections c
  where c.company_id = cid and c.provider = 'mercury' and c.slot = p_slot
  for update;
  if not found then
    return private.mcp_error('not_found', 'bank connection not found');
  end if;
  saved := public.set_mercury_accounts(p_slot, p_accounts, p_from);
  select * into after_row
  from public.connector_connections c
  where c.company_id = cid and c.provider = 'mercury' and c.slot = p_slot;
  insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
  values (
    p_token, auth.uid(), 'bank_accounts', cid,
    jsonb_build_object(
      'connection_id', before_row.id,
      'slot', p_slot,
      'before', private.mcp_bank_accounts_state(before_row),
      'before_chosen_at', to_jsonb(before_row.accounts_chosen_at),
      'after', private.mcp_bank_accounts_state(after_row)
    ),
    clock_timestamp()
  );
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'id', before_row.id,
      'slot', p_slot,
      'account_ids', to_jsonb(array(select a from unnest(after_row.sync_account_ids) a order by a)),
      'skipped_account_ids', to_jsonb(array(select a from unnest(after_row.skip_account_ids) a order by a)),
      'added', saved->'added',
      'import_from', coalesce(saved->>'import_from', 'start'),
      'reread', saved->'reread',
      'undo_kind', 'bank_accounts'
    )
  );
end;
$$;

revoke all on function private.mcp_save_bank_accounts(uuid, smallint, text[], text) from public, anon, authenticated;

-- One connection as list_bank_connections gives it.
create or replace function private.mcp_bank_connection_json(p_row public.connector_connections)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with labels as (
    select distinct on (e.value->>'id') e.value->>'id' as id, e.value as v, e.ord as n
    from jsonb_array_elements(
        case when jsonb_typeof(p_row.account_labels) = 'array' then p_row.account_labels else '[]'::jsonb end
      ) with ordinality e(value, ord)
    where jsonb_typeof(e.value) = 'object' and length(coalesce(e.value->>'id', '')) between 1 and 128
    order by e.value->>'id', e.ord
  ),
  synced as (
    select case
      when p_row.accounts_chosen_at is null then '{}'::text[]
      else coalesce(p_row.sync_account_ids, array(select l.id from labels l))
    end as ids
  ),
  accounts as (
    select l.n, l.id,
      coalesce(nullif(btrim(l.v->>'label'), ''), 'Mercury') as name,
      case when l.v->>'last4' ~ '^[0-9]{4}$' then l.v->>'last4' end as last4,
      case when l.v->>'kind' in ('checking', 'savings', 'credit', 'treasury') then l.v->>'kind' else 'other' end as kind,
      case when jsonb_typeof(l.v->'balance_cents') = 'number' then l.v->'balance_cents' end as balance_minor,
      l.id = any (s.ids) as synced,
      l.id = any (p_row.skip_account_ids) as skipped
    from labels l
    cross join synced s
  )
  select jsonb_build_object(
    'id', p_row.id,
    'slot', p_row.slot,
    'provider', p_row.provider,
    'org_label', p_row.org_label,
    'connected', p_row.last_error is distinct from 'auth',
    'accounts_chosen', p_row.accounts_chosen_at is not null,
    'import_from', case when p_row.accounts_chosen_at is not null then coalesce(p_row.import_from::text, 'start') end,
    'last_sync_at', p_row.last_sync_at,
    'last_error', p_row.last_error,
    'syncing', p_row.sync_claimed_at is not null and p_row.sync_claimed_at > pg_catalog.now() - interval '10 minutes',
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'last4', a.last4,
          'kind', a.kind,
          'balance_minor', a.balance_minor,
          'synced', a.synced,
          'skipped', a.skipped,
          'new', p_row.accounts_chosen_at is not null and not a.synced and not a.skipped,
          'import_from', case when a.synced then coalesce(p_row.account_from->>a.id, p_row.import_from::text, 'start') end
        ) order by a.n)
      from accounts a
    ), '[]'::jsonb),
    'new_account_ids', coalesce((
      select jsonb_agg(a.id order by a.n)
      from accounts a
      where p_row.accounts_chosen_at is not null and not a.synced and not a.skipped
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.mcp_bank_connection_json(public.connector_connections) from public, anon, authenticated;

-- list_bank_connections: the company's Mercury connections by slot (any member reads them).
create or replace function public.mcp_bank_connections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('connections', coalesce((
    select jsonb_agg(private.mcp_bank_connection_json(c) order by c.slot)
    from public.connector_connections c
    where c.company_id = cid and c.provider = 'mercury'
  ), '[]'::jsonb));
end;
$$;

-- set_bank_accounts: the accounts a connection syncs (the app's step 3 and synced accounts list).
create or replace function public.mcp_set_bank_accounts(
  p_idempotency_key text,
  p_slot smallint,
  p_account_ids text[],
  p_from text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_slot is null
    or p_slot not between 1 and 9
    or p_account_ids is null
    or cardinality(p_account_ids) not between 1 and 200
    or exists (select 1 from unnest(p_account_ids) a where a is null or char_length(a) not between 1 and 128)
    or (p_from is not null and p_from <> 'start' and p_from !~ '^\d{4}-\d{2}-\d{2}$')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  if private.owner_company_id() is null then
    return private.mcp_error('forbidden', 'owner only');
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'bank_accounts|' || p_slot::text || '|'
    || array_to_string(array(select distinct a from unnest(p_account_ids) a order by a), ',')
    || '|' || coalesce(p_from, '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    response := private.mcp_save_bank_accounts(token, p_slot, p_account_ids, p_from);
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_bank_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- answer_bank_account: the answer to "ב־Mercury נפתח חשבון חדש" (כן, לסנכרן / לא), as the app gives it: yes
-- adds the account from the connection's own start, no leaves it out so it is not asked again.
create or replace function public.mcp_answer_bank_account(
  p_idempotency_key text,
  p_slot smallint,
  p_account_id text,
  p_sync boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  conn public.connector_connections%rowtype;
  state jsonb;
  account jsonb;
  wanted text[];
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_slot is null
    or p_slot not between 1 and 9
    or p_account_id is null
    or char_length(p_account_id) not between 1 and 128
    or p_sync is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  if private.owner_company_id() is null then
    return private.mcp_error('forbidden', 'owner only');
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'bank_answer|' || p_slot::text || '|' || p_account_id || '|' || p_sync::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    select * into conn
    from public.connector_connections c
    where c.company_id = private.owner_company_id() and c.provider = 'mercury' and c.slot = p_slot
    for update;
    if not found then
      response := private.mcp_error('not_found', 'bank connection not found');
    else
      state := private.mcp_bank_connection_json(conn);
      select e.value into account from jsonb_array_elements(state->'accounts') e where e.value->>'id' = p_account_id;
      if account is null then
        response := private.mcp_error('validation', 'account is not on this connection');
      elsif account->>'new' is distinct from 'true' then
        response := private.mcp_error('refused', 'account is not waiting for an answer');
      else
        wanted := array(
          select e.value->>'id' from jsonb_array_elements(state->'accounts') e where e.value->>'synced' = 'true'
        ) || case when p_sync then array[p_account_id] else '{}'::text[] end;
        response := private.mcp_save_bank_accounts(
          token, p_slot, wanted,
          case when p_sync then coalesce(conn.import_from::text, 'start') end
        );
      end if;
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_bank_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_bank_connections() from public, anon;
grant execute on function public.mcp_bank_connections() to authenticated, service_role;
revoke all on function public.mcp_set_bank_accounts(text, smallint, text[], text) from public, anon;
grant execute on function public.mcp_set_bank_accounts(text, smallint, text[], text) to authenticated, service_role;
revoke all on function public.mcp_answer_bank_account(text, smallint, text, boolean) from public, anon;
grant execute on function public.mcp_answer_bank_account(text, smallint, text, boolean) to authenticated, service_role;
comment on function public.mcp_bank_connections() is
  'FLOW-938 (decision 0203): MCP list_bank_connections, the Mercury connections, their accounts and which sync.';
comment on function public.mcp_set_bank_accounts(text, smallint, text[], text) is
  'FLOW-938 (decision 0203): MCP set_bank_accounts through set_mercury_accounts, with undo kind bank_accounts.';
comment on function public.mcp_answer_bank_account(text, smallint, text, boolean) is
  'FLOW-938 (decision 0203): MCP answer_bank_account, yes or no to a new Mercury account, with undo kind bank_accounts.';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The undo log takes the kind bank_accounts.
do $writes$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'line_amount'::text]$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'line_amount'::text, 'bank_accounts'::text]$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or pg_temp.anchor_count(def, $a$(kind = 'line_amount'::text)$a$) <> 1 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'bank_accounts'::text) AND (company_id IS NOT NULL) AND (prior ? 'connection_id'::text) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;
end
$writes$;

-- mcp_undo takes bank_accounts (id: the connection): the owner only; a connection whose accounts changed
-- since the write is a conflict; else the accounts, the skipped list and the starts from before go back.
do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$p_kind not in ('recurring_match', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kind list is not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('recurring_match', 'bank_accounts', $n$);

  anchor := $a$        or (p_kind = 'jev_mode' and w.kind = 'jev_mode' and w.company_id = p_id)
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo jev_mode lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor
    || $n$        or (p_kind = 'bank_accounts' and w.kind = 'bank_accounts' and w.prior->>'connection_id' = p_id::text)
$n$);

  anchor := $a$    elsif p_kind = 'jev_mode' then
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo jev_mode branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'bank_accounts' then
      -- FLOW-938. Lines already imported stay, as when an account is unchecked in the app.
      declare
        conn public.connector_connections%rowtype;
        b jsonb := rec.prior->'before';
        reread boolean;
      begin
        if private.owner_company_id() is distinct from cid then
          response := private.mcp_error('forbidden', 'owner only');
        else
          select * into conn
          from public.connector_connections c
          where c.id = p_id and c.company_id = cid and c.provider = 'mercury'
          for update;
          if not found then
            response := private.mcp_error('not_found', 'not found');
          elsif private.mcp_bank_accounts_state(conn) is distinct from rec.prior->'after' then
            response := private.mcp_error('conflict', 'conflict');
          else
            -- What comes back may read further back than what was read since (an account restored
            -- after its lines left the re-read window): the cursor goes, as set_mercury_accounts does.
            reread := private.mercury_accounts_reread(conn.account_labels, private.mcp_bank_accounts_state(conn), b);
            update public.connector_connections c
            set sync_account_ids = case when jsonb_typeof(b->'sync_account_ids') = 'array'
                  then array(select jsonb_array_elements_text(b->'sync_account_ids')) end,
                skip_account_ids = case when jsonb_typeof(b->'skip_account_ids') = 'array'
                  then array(select jsonb_array_elements_text(b->'skip_account_ids')) else '{}'::text[] end,
                account_from = case when jsonb_typeof(b->'account_from') = 'object' then b->'account_from' else '{}'::jsonb end,
                import_from = (b->>'import_from')::date,
                accounts_chosen_at = (rec.prior->>'before_chosen_at')::timestamptz,
                sync_cursor = case when reread then null else c.sync_cursor end
            where c.id = p_id and c.company_id = cid;
            update private.mcp_writes
            set undone_at = clock_timestamp()
            where id = rec.id and user_id = auth.uid() and undone_at is null;
            response := jsonb_build_object(
              'ok', true,
              'data', jsonb_build_object('kind', p_kind, 'id', p_id)
            );
          end if;
        end if;
      end;
$n$ || anchor);

  execute def;
end;
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
