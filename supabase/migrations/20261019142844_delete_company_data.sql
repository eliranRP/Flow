-- The danger zone: the owner deletes their company and all of its data (decision 0194).
-- Decision 0193 took DELETE on public.companies away from clients; this is the confirmed action
-- that replaces it.
-- - public.delete_company(p_company_id, p_confirm): owner only, through private.team_owner_company()
--   like the team RPCs (an editor or a viewer gets 'forbidden' 42501, a user with no company of
--   their own gets 'no company'). p_company_id must be the request's company, as in rename_company.
--   p_confirm, trimmed the way company names are, must equal the company's name exactly, else
--   'confirmation_mismatch' (22023) and nothing changes.
-- - Deleting the company row cascades to every table with a foreign key to companies, and from
--   there to the rows that hang off them (mcp_idempotency through mcp_credentials, for one).
-- - Six tables carry a company_id with no foreign key to companies: private.mcp_writes,
--   private.mcp_batches and private.mcp_sync_jobs (they cascade through mcp_credentials), and
--   public.jev_outcomes, public.jev_prefills and public.jev_line_failures (through transactions).
--   They are cleared by company_id after the cascade as well, so a row whose token or line
--   belongs elsewhere, or one a cascade trigger (jev_outcome_sync) writes, cannot outlive it.
-- - private.mcp_rate has no foreign key at all: the company's token counters are deleted first.
-- - Nothing else holds company data: vault holds only platform secrets (cron_secret,
--   flow_sync_url, jev_api_key), connector keys are envelope-encrypted in connector_connections,
--   and no storage bucket exists. The auth user, their push subscriptions and their notification
--   preferences are the user's, not the company's, and stay.
begin;
set local lock_timeout = '5s';

create or replace function public.delete_company(p_company_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  current_name text;
  tokens uuid[];
begin
  cid := private.team_owner_company();
  if p_company_id is null or p_company_id is distinct from cid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select c.name into current_name
  from public.companies c
  where c.id = cid and c.owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if private.trim_name(p_confirm) is distinct from current_name then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;

  select coalesce(array_agg(cred.id), '{}') into tokens
  from private.mcp_credentials cred
  where cred.company_id = cid;
  delete from private.mcp_rate r where r.subject_kind = 'token' and r.subject_id = any (tokens);

  delete from public.companies c where c.id = cid;

  delete from private.mcp_writes w where w.company_id = cid;
  delete from private.mcp_batches b where b.company_id = cid;
  delete from private.mcp_sync_jobs j where j.company_id = cid;
  delete from public.jev_outcomes o where o.company_id = cid;
  delete from public.jev_prefills p where p.company_id = cid;
  delete from public.jev_line_failures f where f.company_id = cid;

  return jsonb_build_object('id', cid, 'name', current_name, 'deleted', true);
end;
$$;

revoke all on function public.delete_company(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.delete_company(uuid, text) to authenticated;

comment on function public.delete_company(uuid, text) is
  'Decision 0194: the owner deletes the company and all of its data, after typing its name. The user stays.';

commit;
