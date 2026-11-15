-- FLOW-1163, the small leftovers of the refresh-queue task (the first part: 20261109222332).
--
-- 1. Mercury connect cleared the cursor and the owner's account choice, then stored the new key, as
--    two calls: a failure between them stopped the old connection (its key stayed, its cursor and
--    choice were gone). replace_connector_connection takes p_reset (and p_kept, the choices a new key of
--    the same organisation keeps) and does both in its one statement: a failing store leaves the old
--    connection's key, cursor and choices as they were. The new arguments have defaults, but a function
--    with a different argument list is another function, so the old one is dropped and made again with
--    the same privileges (service_role only). The edge function falls back to the two calls while this
--    file is not pushed (CI deploys the functions first): _shared/connectors/mercury/replace_key.ts.
--
-- 2. The claim window (10 minutes) is read from private.sync_claim_window() in the three places that
--    still wrote the literal: connector_connection_status (a security_invoker view, so the function is
--    granted to authenticated, like private.readable_company_id and the other pure private helpers),
--    sumit_status() and private.mcp_bank_connection_json. The edge side already says 10 (cron_claim.ts,
--    CLAIM_MS in both sync functions); nothing there changes.
--
-- 3. note_connector_rejection had no caller (not the edge functions, not the app, not another
--    function; flow-mcp reads the failure through note_connector_failure) and is dropped. Its two jobs
--    are note_connector_failure's: code 'auth' and code 'rejected' (with the same backoff).
--
-- 4. An auth stop clears only on a reconnect (replace_connector_connection, replace_sumit_connection).
--    Both sync functions read the stop before they run and refuse a stopped connection, so no sync
--    ever runs with the key that was found bad; a stamp that finds `auth` is a run that started before
--    the stop (or a legacy stamp of every slot) finishing after it, and it must not clear it. So:
--    stamp_connector_sync and stamp_sumit_sync keep `auth` (they still stamp the time, clear the
--    attempts and release the claim), and SUMIT's note_sync_failure and note_sumit_rejection keep it
--    and its empty retry time, as note_connector_failure does since the first part.
--
-- Rows: nothing is rewritten. Every function keeps its last grants, restated below.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- Replaces each anchor (found exactly once) in a function's definition and runs the result.
create or replace function pg_temp.patch(p_fn text, p_from text[], p_to text[])
returns void
language plpgsql
as $$
declare
  def text := pg_get_functiondef(p_fn::regprocedure);
  i integer;
begin
  for i in 1 .. cardinality(p_from) loop
    if pg_temp.anchor_count(def, p_from[i]) <> 1 then
      raise exception '% is not the expected definition (anchor %)', p_fn, i;
    end if;
    def := replace(def, p_from[i], p_to[i]);
  end loop;
  execute def;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. One window.
-- ---------------------------------------------------------------------------------------------
revoke all on function private.sync_claim_window() from public, anon, authenticated;
grant execute on function private.sync_claim_window() to authenticated, service_role;

do $view$
declare
  def text := pg_get_viewdef('public.connector_connection_status'::regclass);
  anchor text := '(now() - ''00:10:00''::interval)';
begin
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'connector_connection_status is not the expected definition';
  end if;
  def := rtrim(replace(def, anchor, '(now() - private.sync_claim_window())'), E';\n ');
  execute 'create or replace view public.connector_connection_status with (security_invoker = true) as ' || def;
end;
$view$;
-- create or replace view keeps the view's table privileges as they are.

select pg_temp.patch('public.sumit_status()',
  array[$a$c.sync_claimed_at > pg_catalog.now() - interval '10 minutes'$a$],
  array[$n$c.sync_claimed_at > pg_catalog.now() - private.sync_claim_window()$n$]);
revoke all on function public.sumit_status() from public, anon, authenticated;
grant execute on function public.sumit_status() to authenticated, service_role;

select pg_temp.patch('private.mcp_bank_connection_json(public.connector_connections)',
  array[$a$p_row.sync_claimed_at > pg_catalog.now() - interval '10 minutes'$a$],
  array[$n$p_row.sync_claimed_at > pg_catalog.now() - private.sync_claim_window()$n$]);
revoke all on function private.mcp_bank_connection_json(public.connector_connections) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. note_connector_rejection has no caller.
-- ---------------------------------------------------------------------------------------------
drop function public.note_connector_rejection(uuid, public.connector_provider, text);

-- ---------------------------------------------------------------------------------------------
-- 4. An auth stop clears only on a reconnect.
-- ---------------------------------------------------------------------------------------------
select pg_temp.patch('public.stamp_connector_sync(uuid, public.connector_provider, smallint)',
  array[$a$last_error = case when last_error like 'sync_sweep%' then last_error else null end,$a$],
  array[$n$last_error = case when last_error = 'auth' or last_error like 'sync_sweep%' then last_error else null end,$n$]);
revoke all on function public.stamp_connector_sync(uuid, public.connector_provider, smallint) from public, anon, authenticated;
grant execute on function public.stamp_connector_sync(uuid, public.connector_provider, smallint) to service_role;

select pg_temp.patch('public.stamp_sumit_sync(uuid)',
  array[$a$last_error = case when last_error like 'sync_sweep%' then last_error else null end,$a$],
  array[$n$last_error = case when last_error = 'sumit_auth' or last_error like 'sync_sweep%' then last_error else null end,$n$]);
revoke all on function public.stamp_sumit_sync(uuid) from public, anon, authenticated;
grant execute on function public.stamp_sumit_sync(uuid) to service_role;

select pg_temp.patch('public.note_sync_failure(uuid, text)',
  array[$a$set last_error = p_code,
      next_attempt_at = retry$a$],
  array[$n$set last_error = case when last_error = 'sumit_auth' then last_error else p_code end,
      next_attempt_at = case when last_error = 'sumit_auth' then null else retry end$n$]);
revoke all on function public.note_sync_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.note_sync_failure(uuid, text) to service_role;

select pg_temp.patch('public.note_sumit_rejection(uuid, text)',
  array[$a$last_error = 'sumit_rejected',
      next_attempt_at = now() + ($a$,
        $a$        end
      )
  where company_id = p_company
  returning$a$],
  array[$n$last_error = case when last_error = 'sumit_auth' then last_error else 'sumit_rejected' end,
      next_attempt_at = case when last_error = 'sumit_auth' then null else now() + ($n$,
        $n$        end
      ) end
  where company_id = p_company
  returning$n$]);
revoke all on function public.note_sumit_rejection(uuid, text) from public, anon, authenticated;
grant execute on function public.note_sumit_rejection(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. Reset and store in one statement.
-- ---------------------------------------------------------------------------------------------
drop function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb, smallint);

create function public.replace_connector_connection(
  p_company uuid,
  p_provider public.connector_provider,
  p_key_ciphertext text,
  p_key_nonce text,
  p_dek_ciphertext text,
  p_dek_nonce text,
  p_kek_version text,
  p_envelope_version text,
  p_validated boolean,
  p_settings jsonb,
  p_slot smallint default null::smallint,
  p_reset boolean default false,
  p_kept jsonb default null::jsonb
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
  -- p_reset: a key for other accounts must not resume the old accounts' cursor, so the cursor goes with
  -- the old key, in this statement. The owner's choices go too (the accounts are chosen again), unless
  -- p_kept names the ones the new key keeps: {sync_account_ids, skip_account_ids, account_from}.
  insert into public.connector_connections (
    company_id, provider,
    key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
    kek_ref, kek_version, envelope_version, settings, slot
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
    coalesce(p_settings, '{}'::jsonb),
    coalesce(p_slot, 1)
  )
  on conflict (company_id, provider, slot) do update
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
      last_sync_at = null,
      sync_cursor = case when p_reset is true then null else public.connector_connections.sync_cursor end,
      accounts_chosen_at = case
        when p_reset is true and p_kept is null then null
        else public.connector_connections.accounts_chosen_at
      end,
      sync_account_ids = case
        when p_reset is not true then public.connector_connections.sync_account_ids
        when p_kept is null or jsonb_typeof(p_kept->'sync_account_ids') is distinct from 'array' then null
        else array(select pg_catalog.jsonb_array_elements_text(p_kept->'sync_account_ids'))
      end,
      skip_account_ids = case
        when p_reset is not true then public.connector_connections.skip_account_ids
        when p_kept is null or jsonb_typeof(p_kept->'skip_account_ids') is distinct from 'array' then '{}'::text[]
        else array(select pg_catalog.jsonb_array_elements_text(p_kept->'skip_account_ids'))
      end,
      account_from = case
        when p_reset is not true then public.connector_connections.account_from
        when p_kept is null or jsonb_typeof(p_kept->'account_from') is distinct from 'object' then '{}'::jsonb
        else p_kept->'account_from'
      end;
end;
$$;

revoke all on function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb, smallint, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.replace_connector_connection(uuid, public.connector_provider, text, text, text, text, text, text, boolean, jsonb, smallint, boolean, jsonb) to service_role;

-- The helpers are session-wide: a later migration in the same session can make its own.
drop function pg_temp.patch(text, text[], text[]);
drop function pg_temp.anchor_count(text, text);

commit;
