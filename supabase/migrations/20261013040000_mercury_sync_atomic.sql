-- FLOW-509: Mercury sync hardening, database side.
-- 1. upsert_connector_lines writes the skip records (p_lines.skips) and the recheck stamps
--    (p_lines.checked) in the transaction that writes the lines, so a failed run leaves neither
--    half behind. A complete run replaces the provider's skips; any run adds only skips that are
--    not recorded yet, so a resumed or repeated run does not duplicate them. A caller that sends
--    neither key (sumit-sync) is unchanged. The function is patched in place, so its grants stay.
-- 2. The connector drain posts Mercury rows to Vault flow_mercury_sync_url when it is set. Until
--    it is set, the drain keeps the sumit-sync URL with the path swapped, so nothing stops.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)'::regprocedure);
  anchor := $a$  perform public.sync_review_queue(p_company);
  return result;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'upsert_connector_lines is not the expected definition';
  end if;
  execute replace(def, anchor, $n$  -- FLOW-509: skip records and recheck stamps commit with the lines.
  if jsonb_typeof(p_lines->'skips') = 'array' then
    if coalesce((p_lines->>'complete')::boolean, false) then
      delete from public.connector_skips s
      where s.company_id = p_company
        and s.provider = p_provider;
    end if;
    insert into public.connector_skips (company_id, provider, external_id, reason)
    select distinct p_company, p_provider, x.external_id, x.reason
    from (
      select nullif(left(item->>'external_id', 128), '') as external_id,
             left(item->>'reason', 64) as reason
      from jsonb_array_elements(p_lines->'skips') as item
      where jsonb_typeof(item) = 'object'
    ) x
    where coalesce(x.reason, '') <> ''
      and not exists (
        select 1
        from public.connector_skips s
        where s.company_id = p_company
          and s.provider = p_provider
          and s.external_id is not distinct from x.external_id
          and s.reason = x.reason
      );
  end if;

  if jsonb_typeof(p_lines->'checked') = 'array' then
    update public.transactions t
    set provider_meta = coalesce(t.provider_meta, '{}'::jsonb) || jsonb_build_object('checked_at', c.checked_at)
    from (
      select distinct on (item->>'external_id')
        item->>'external_id' as external_id,
        item->>'checked_at' as checked_at
      from jsonb_array_elements(p_lines->'checked') as item
      where jsonb_typeof(item) = 'object'
        and length(coalesce(item->>'external_id', '')) between 1 and 128
        and length(coalesce(item->>'checked_at', '')) between 1 and 40
      order by item->>'external_id', item->>'checked_at' desc
    ) c
    where t.company_id = p_company
      and t.source = source_value
      and t.external_id = c.external_id;
  end if;

  perform public.sync_review_queue(p_company);
  return result;$n$);

  def := pg_get_functiondef('private.schedule_connector_jobs()'::regprocedure);
  anchor := $a$            when 'mercury' then replace(decrypted_secret, '/sumit-sync', '/mercury-sync')$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'schedule_connector_jobs is not the expected definition';
  end if;
  execute replace(def, anchor, $n$            when 'mercury' then coalesce(
              (
                select nullif(btrim(m.decrypted_secret), '')
                from vault.decrypted_secrets m
                where m.name = 'flow_mercury_sync_url'
                limit 1
              ),
              replace(decrypted_secret, '/sumit-sync', '/mercury-sync')
            )$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

-- Reschedule the drain with the new command.
do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_connector_jobs();
end
$schedule$;

commit;
