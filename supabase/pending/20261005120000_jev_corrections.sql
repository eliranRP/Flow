-- Jev corrections. Not applied. Not in supabase/migrations.lock.
-- The app does not call record_jev_correction yet. That write is a follow-up.
-- The migration slot is taken. Move this after 20261003180000 once the slot is free. Decision 0084.

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  suggestion_id uuid not null,
  action text not null,
  suggested_project_id uuid,
  suggested_category_id uuid,
  chosen_project_id uuid,
  chosen_category_id uuid,
  created_at timestamptz not null default now(),
  constraint corrections_action_chk check (action in ('confirm', 'fix')),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade,
  foreign key (suggestion_id)
    references public.tag_suggestions (id)
    on delete cascade
);

comment on table public.corrections is
  'One Jev confirm or fix per tap. Members read. Writes go through record_jev_correction. Decision 0084.';

alter table public.corrections enable row level security;

create policy corrections_member_select on public.corrections
  for select to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.corrections from public, anon, authenticated;
grant select on public.corrections to authenticated;

create or replace function public.record_jev_correction(
  p_transaction_id uuid,
  p_suggestion_id uuid,
  p_action text,
  p_suggested_project_id uuid,
  p_suggested_category_id uuid,
  p_chosen_project_id uuid,
  p_chosen_category_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  inserted uuid;
begin
  if p_action is distinct from 'confirm' and p_action is distinct from 'fix' then
    raise exception 'validation';
  end if;
  if p_transaction_id is null or p_suggestion_id is null then
    raise exception 'validation';
  end if;
  cid := private.current_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.transactions t
    where t.id = p_transaction_id and t.company_id = cid
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.tag_suggestions s
    where s.id = p_suggestion_id and s.company_id = cid and s.transaction_id = p_transaction_id
  ) then
    raise exception 'validation';
  end if;

  insert into public.corrections (
    company_id, transaction_id, suggestion_id, action,
    suggested_project_id, suggested_category_id, chosen_project_id, chosen_category_id
  ) values (
    cid, p_transaction_id, p_suggestion_id, p_action,
    p_suggested_project_id, p_suggested_category_id, p_chosen_project_id, p_chosen_category_id
  )
  returning id into inserted;
  return inserted;
end;
$$;

revoke all on function public.record_jev_correction(uuid, uuid, text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.record_jev_correction(uuid, uuid, text, uuid, uuid, uuid, uuid) to authenticated;
