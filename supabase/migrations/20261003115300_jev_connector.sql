-- Jev connector plumbing. Decision 0083.
-- The connector is off until a member enables it. J-1 does not label a line.
-- tag_suggestions is written by the service role (the future worker). Members read.
-- The API key stays in Vault as jev_api_key. anon and authenticated cannot read it.

create table public.company_integrations (
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null,
  enabled boolean not null default false,
  mode text not null default 'shadow',
  threshold numeric not null default 0.90,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, provider),
  constraint company_integrations_provider_chk check (provider = 'jev'),
  constraint company_integrations_mode_chk check (mode in ('shadow', 'auto')),
  constraint company_integrations_threshold_chk check (threshold >= 0 and threshold <= 1)
);

comment on table public.company_integrations is
  'Optional connectors. A missing row is off. Jev defaults to disabled and shadow. Decision 0083.';

comment on column public.company_integrations.provider is
  'jev is the only provider in this migration.';

comment on column public.company_integrations.mode is
  'shadow keeps the line in the review queue. auto is stored for the tagging job and is not applied here.';

comment on column public.company_integrations.threshold is
  'Confidence from 0 to 1. Default 0.90. The tagging job reads it. This migration does not apply it.';

create trigger company_integrations_touch
  before update on public.company_integrations
  for each row execute function private.touch_updated_at();

create table public.tag_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  answers jsonb not null,
  confidence numeric not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  unique (transaction_id, model_version),
  constraint tag_suggestions_answers_object_chk check (jsonb_typeof(answers) = 'object'),
  constraint tag_suggestions_confidence_chk check (confidence >= 0 and confidence <= 1),
  constraint tag_suggestions_model_version_chk check (char_length(btrim(model_version)) between 1 and 64),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

comment on table public.tag_suggestions is
  'One Jev labelling per bank line and model version. Amounts, VAT, and dates are not stored here. Decision 0083.';

comment on column public.tag_suggestions.answers is
  'Per-question answer and probabilities. A JSON object. Null probabilities stay inside the object.';

comment on column public.tag_suggestions.model_version is
  'The model that produced the row, pinned by the client to jev-1.13.0 until a later decision moves it.';

create index tag_suggestions_company_idx on public.tag_suggestions (company_id);

alter table public.company_integrations enable row level security;
alter table public.tag_suggestions enable row level security;

create policy company_integrations_member_select on public.company_integrations
  for select to authenticated
  using (company_id = (select private.current_company_id()));

create policy tag_suggestions_member_select on public.tag_suggestions
  for select to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.company_integrations from public, anon, authenticated;
revoke all on public.tag_suggestions from public, anon, authenticated;

grant select on public.company_integrations to authenticated;
grant select on public.tag_suggestions to authenticated;

grant select, insert, update, delete on public.company_integrations to service_role;
grant select, insert, update, delete on public.tag_suggestions to service_role;

-- Members turn the connector on or off. The company comes from the session.
-- A null mode or threshold keeps the stored value, or the column default on insert.
create or replace function public.set_company_integration(
  p_enabled boolean,
  p_mode text default null,
  p_threshold numeric default null,
  p_provider text default 'jev'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  stored public.company_integrations%rowtype;
  next_mode text;
  next_threshold numeric;
begin
  if p_enabled is null or p_provider is distinct from 'jev' then
    raise exception 'validation';
  end if;
  if p_mode is not null and p_mode not in ('shadow', 'auto') then
    raise exception 'validation';
  end if;
  if p_threshold is not null and (p_threshold < 0 or p_threshold > 1) then
    raise exception 'validation';
  end if;

  cid := private.current_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into stored
  from public.company_integrations
  where company_id = cid and provider = p_provider;

  next_mode := coalesce(p_mode, stored.mode, 'shadow');
  next_threshold := coalesce(p_threshold, stored.threshold, 0.90);

  insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
  values (cid, p_provider, p_enabled, next_mode, next_threshold)
  on conflict (company_id, provider) do update
    set enabled = excluded.enabled,
        mode = excluded.mode,
        threshold = excluded.threshold
  returning * into stored;

  return jsonb_build_object(
    'company_id', stored.company_id,
    'provider', stored.provider,
    'enabled', stored.enabled,
    'mode', stored.mode,
    'threshold', stored.threshold
  );
end;
$$;

revoke all on function public.set_company_integration(boolean, text, numeric, text) from public, anon;
grant execute on function public.set_company_integration(boolean, text, numeric, text) to authenticated;

comment on function public.set_company_integration(boolean, text, numeric, text) is
  'Member write for company_integrations. The company is private.current_company_id(). Decision 0083.';

-- Vault secret name jev_api_key. Scope: the TypeSafe API bearer key, one project-wide secret.
-- Not a per-company key, not the SUMIT key, and not an Edge Function env var.
create or replace function public.read_jev_api_key()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'missing_jev_api_key';
  end if;
  select s.decrypted_secret into secret
  from vault.decrypted_secrets s
  where s.name = 'jev_api_key'
  limit 1;
  if secret is null or btrim(secret) = '' then
    raise exception 'missing_jev_api_key';
  end if;
  return secret;
end;
$$;

revoke all on function public.read_jev_api_key() from public, anon, authenticated;
grant execute on function public.read_jev_api_key() to service_role;

comment on function public.read_jev_api_key() is
  'Service-role read of Vault secret jev_api_key. A missing secret fails closed. Decision 0083.';

do $vault_revoke$
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'revoke all on table vault.decrypted_secrets from public, anon, authenticated';
  end if;
  if to_regclass('vault.secrets') is not null then
    execute 'revoke all on table vault.secrets from public, anon, authenticated';
  end if;
end
$vault_revoke$;
