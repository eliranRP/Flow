-- FLOW-854: clients write loans, loan_rates, project_groups and setup_states only through functions.
-- authenticated keeps SELECT on the four tables (their select policies stay) and loses INSERT, UPDATE
-- and DELETE; their write policies go with the grants. The app's writes move onto five definers, each
-- with its own company check: private.current_company_id(), so an owner or an editor writes and a
-- viewer does not, and a row of another company is refused as 'forbidden' (42501), the refusal the
-- app already shows when a write matches no row. The tables' CHECKs and triggers still run inside
-- each function, so every write keeps the same rules and messages.
--
-- 1. create_loan(company, loan): the two new-loan forms (loans-host.tsx, setup/loan-entry.tsx). The
--    loan is a jsonb of the form's own fields only; any other key is 'validation' (22023). Returns the
--    new loan's id.
-- 2. update_loan(loan, patch): the loan page's patch and its undo (loan-detail-store.ts patchColumns)
--    and the loan match's fees category (loan-match-api.tsx). Only the keys the app patches are
--    accepted, and only the keys sent are written. Returns the loan's id.
-- 3. save_loan_rate(loan, day, rate, rate id): adds a rate row (one per loan and day: a second on the
--    same day replaces it), or with a rate id changes that row of the loan. Returns the row's id.
-- 4. delete_loan_rate(rate id): removes a rate row. Returns its id.
-- 5. save_setup_state(company, state): the caller's own setup flags for the company (one row per user
--    and company, the last write winning).
-- project_groups already has its RPCs (upsert_project_group, set_project_group; mcp_create_project_group
-- and its undo), and the loans delete goes through delete_loan; neither table is written directly by
-- a client, so their grants go with no new function. MCP writes all four through its own definers.

begin;

set local lock_timeout = '5s';

-- 1. create_loan
create function public.create_loan(p_company_id uuid, p_loan jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  r public.loans;
  rid uuid;
begin
  if cid is null or p_company_id is distinct from cid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_loan) is distinct from 'object' then
    raise exception 'validation' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_loan) k
    where k not in ('name', 'principal_minor', 'annual_rate_ppm', 'term_months', 'start_date', 'payment_minor',
      'escrow_minor', 'currency', 'kind', 'interest_only_months', 'amortization_months', 'project_id')
  ) then
    raise exception 'validation' using errcode = '22023';
  end if;
  r := jsonb_populate_record(null::public.loans, p_loan);
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor,
    currency, kind, interest_only_months, amortization_months, project_id
  )
  values (
    cid, r.name, r.principal_minor, r.annual_rate_ppm, r.term_months, r.start_date, r.payment_minor, r.escrow_minor,
    r.currency, coalesce(r.kind, 'amortizing'::public.loan_kind), r.interest_only_months, r.amortization_months,
    r.project_id
  )
  returning id into rid;
  return rid;
end;
$$;

revoke all on function public.create_loan(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_loan(uuid, jsonb) to authenticated;
comment on function public.create_loan(uuid, jsonb) is
  'FLOW-854: the app adds a loan to the caller''s company (owner or editor). Returns its id.';

-- 2. update_loan
create function public.update_loan(p_loan_id uuid, p_patch jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  sets text;
  rid uuid;
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.loans l where l.id = p_loan_id and l.company_id = cid;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'validation' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) k
    where k not in ('status', 'closed_on', 'refinanced_into_id', 'project_id', 'interest_category_id',
      'escrow_category_id', 'principal_category_id', 'fees_category_id', 'kind', 'interest_only_months',
      'amortization_months', 'term_months', 'payment_minor', 'escrow_minor')
  ) then
    raise exception 'validation' using errcode = '22023';
  end if;
  -- Only the keys sent are set, so a trigger on a column the patch leaves out does not fire.
  select string_agg(format('%1$I = r.%1$I', k), ', ' order by k) into sets
  from jsonb_object_keys(p_patch) k;
  if sets is null then
    return p_loan_id;
  end if;
  execute format(
    'update public.loans l set %s from jsonb_populate_record(null::public.loans, $1) r '
    'where l.id = $2 and l.company_id = $3 returning l.id',
    sets
  ) into rid using p_patch, p_loan_id, cid;
  if rid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return rid;
end;
$$;

revoke all on function public.update_loan(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_loan(uuid, jsonb) to authenticated;
comment on function public.update_loan(uuid, jsonb) is
  'FLOW-854: the app changes a loan of the caller''s company (owner or editor), only the columns its loan page patches. Returns its id.';

-- 3. save_loan_rate
create function public.save_loan_rate(
  p_loan_id uuid,
  p_effective_date date,
  p_annual_rate_ppm integer,
  p_loan_rate_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  rid uuid;
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.loans l where l.id = p_loan_id and l.company_id = cid;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_loan_rate_id is not null then
    update public.loan_rates r
    set effective_date = p_effective_date, annual_rate_ppm = p_annual_rate_ppm
    where r.id = p_loan_rate_id and r.loan_id = p_loan_id and r.company_id = cid
    returning r.id into rid;
    if rid is null then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    return rid;
  end if;
  insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
  values (cid, p_loan_id, p_effective_date, p_annual_rate_ppm)
  on conflict (loan_id, effective_date) do update set annual_rate_ppm = excluded.annual_rate_ppm
  returning id into rid;
  return rid;
end;
$$;

revoke all on function public.save_loan_rate(uuid, date, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_loan_rate(uuid, date, integer, uuid) to authenticated;
comment on function public.save_loan_rate(uuid, date, integer, uuid) is
  'FLOW-854: the app adds a rate row to a loan of the caller''s company (one per day), or changes one by its id. Returns the row''s id.';

-- 4. delete_loan_rate
create function public.delete_loan_rate(p_loan_rate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  rid uuid;
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.loan_rates r
  where r.id = p_loan_rate_id and r.company_id = cid
  returning r.id into rid;
  if rid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return rid;
end;
$$;

revoke all on function public.delete_loan_rate(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_loan_rate(uuid) to authenticated;
comment on function public.delete_loan_rate(uuid) is
  'FLOW-854: the app removes a rate row of a loan of the caller''s company. Returns its id.';

-- 5. save_setup_state
create function public.save_setup_state(p_company_id uuid, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  uid uuid := (select auth.uid());
begin
  if cid is null or uid is null or p_company_id is distinct from cid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.setup_states (user_id, company_id, state)
  values (uid, cid, p_state)
  on conflict (user_id, company_id) do update set state = excluded.state;
end;
$$;

revoke all on function public.save_setup_state(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_setup_state(uuid, jsonb) to authenticated;
comment on function public.save_setup_state(uuid, jsonb) is
  'FLOW-854: the caller''s own setup flags for their company (owner or editor), one row per user and company. Decision 0163.';

-- 6. The direct writes go: the grants and the policies that served them.
revoke insert, update, delete on public.loans from authenticated;
revoke insert, update, delete on public.loan_rates from authenticated;
revoke insert, update, delete on public.project_groups from authenticated;
revoke insert, update on public.setup_states from authenticated;

drop policy loans_insert on public.loans;
drop policy loans_update on public.loans;
drop policy loan_rates_insert on public.loan_rates;
drop policy loan_rates_update on public.loan_rates;
drop policy loan_rates_delete on public.loan_rates;
drop policy project_groups_insert on public.project_groups;
drop policy project_groups_update on public.project_groups;
drop policy project_groups_delete on public.project_groups;
drop policy setup_states_owner_insert on public.setup_states;
drop policy setup_states_owner_update on public.setup_states;

commit;
