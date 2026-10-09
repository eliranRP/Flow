-- FLOW-506: the first-run setup flags (skips, run and resume stamps, the closed card) move from
-- localStorage to one row per owner and company, so a new phone does not restart the run.
-- The state is the design jsonb the app already keeps (decision 0089); the app writes the whole
-- object and the last write wins. Only the owner reads or writes their own row: a viewer never
-- runs setup. Before a company exists the app keeps the flags in localStorage as before.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create table public.setup_states (
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id),
  constraint setup_states_state_object check (jsonb_typeof(state) = 'object'),
  constraint setup_states_state_size check (pg_column_size(state) <= 4096)
);

create index setup_states_company_idx on public.setup_states (company_id);

alter table public.setup_states enable row level security;
create policy setup_states_owner_select on public.setup_states
  for select to authenticated
  using (user_id = (select auth.uid()) and company_id = (select private.current_company_id()));
create policy setup_states_owner_insert on public.setup_states
  for insert to authenticated
  with check (user_id = (select auth.uid()) and company_id = (select private.current_company_id()));
create policy setup_states_owner_update on public.setup_states
  for update to authenticated
  using (user_id = (select auth.uid()) and company_id = (select private.current_company_id()))
  with check (user_id = (select auth.uid()) and company_id = (select private.current_company_id()));
revoke all on public.setup_states from public, anon, authenticated;
grant select, insert, update on public.setup_states to authenticated;
grant select, insert, update, delete on public.setup_states to service_role;

commit;
