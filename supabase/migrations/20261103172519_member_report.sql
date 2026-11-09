-- FLOW-1117 (decision 0263): the member share report's data.
--
-- One company setting, public.member_reports.config, holds the report's inputs: the LLC's members and
-- their ownership (basis points that add up to 10000), the refinance assumptions (loan to value, closing
-- costs, term), the rate rule (the 5 or 10 year US Treasury yield plus a spread), the lender quotes and
-- the Treasury yields by date. get_member_report reads it with each property's value, value date,
-- selling cost and open loan balance; the share itself is computed in packages/shared/src/member-share.ts,
-- by the app and by MCP get_member_share alike. set_member_report (owner only) replaces the parts it
-- names; MCP set_member_report adds idempotency and undo kind member_report.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

create table public.member_reports (
  company_id uuid primary key references public.companies (id) on delete cascade,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now()
);
comment on table public.member_reports is
  'FLOW-1117: the member share report''s inputs, one row per company (members, assumptions, rate rule, quotes, yields). Decision 0263.';

alter table public.member_reports enable row level security;
create policy member_reports_select on public.member_reports
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
-- Writes go through set_member_report only.
revoke all on public.member_reports from public, anon, authenticated;
grant select on public.member_reports to authenticated;
grant select, insert, update, delete on public.member_reports to service_role;

-- True when v is a whole number in [lo, hi].
create function private.json_int_between(v jsonb, lo bigint, hi bigint)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is not null and jsonb_typeof(v) = 'number' and v::text ~ '^-?[0-9]{1,15}$'
    and v::text::bigint between lo and hi;
$$;

-- True when v is a calendar date written YYYY-MM-DD.
create function private.json_date(v jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if v is null or jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  return to_char((v #>> '{}')::date, 'YYYY-MM-DD') = (v #>> '{}');
exception when others then
  return false;
end;
$$;

-- True when v is a string of 1 to max characters after trimming.
create function private.json_text(v jsonb, max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is not null and jsonb_typeof(v) = 'string'
    and char_length(btrim(v #>> '{}')) between 1 and max
    and char_length(v #>> '{}') = char_length(btrim(v #>> '{}'));
$$;

-- Raises 'validation' unless the config is well formed for the company. Every part is optional.
create function private.member_report_check(p_company_id uuid, p_config jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  part jsonb;
  item jsonb;
  total bigint;
begin
  if jsonb_typeof(p_config) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_config) k
               where k not in ('members', 'assumptions', 'rate_rule', 'quotes', 'yields', 'quote_date'))
  then
    raise exception 'validation';
  end if;

  part := p_config->'members';
  if part is not null then
    if jsonb_typeof(part) <> 'array' or jsonb_array_length(part) > 20 then
      raise exception 'validation';
    end if;
    total := 0;
    for item in select x from jsonb_array_elements(part) x loop
      if jsonb_typeof(item) <> 'object'
        or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'ownership_bp'))
        or not private.json_text(item->'name', 60)
        or not private.json_int_between(item->'ownership_bp', 0, 10000)
      then
        raise exception 'validation';
      end if;
      total := total + (item->>'ownership_bp')::bigint;
    end loop;
    -- The members' ownership adds up to the whole company (100%), or there are none yet.
    if jsonb_array_length(part) > 0 and total <> 10000 then
      raise exception 'ownership must add up to 100%%';
    end if;
    if (select count(distinct lower(x->>'name')) from jsonb_array_elements(part) x) <> jsonb_array_length(part) then
      raise exception 'validation';
    end if;
  end if;

  part := p_config->'assumptions';
  if part is not null and (
    jsonb_typeof(part) <> 'object'
    or exists (select 1 from jsonb_object_keys(part) k where k not in ('ltv_bp', 'closing_bp', 'term_years'))
    or (part ? 'ltv_bp' and not private.json_int_between(part->'ltv_bp', 0, 10000))
    or (part ? 'closing_bp' and not private.json_int_between(part->'closing_bp', 0, 2000))
    or (part ? 'term_years' and not private.json_int_between(part->'term_years', 1, 40))
  ) then
    raise exception 'validation';
  end if;

  part := p_config->'rate_rule';
  if part is not null and (
    jsonb_typeof(part) <> 'object'
    or exists (select 1 from jsonb_object_keys(part) k where k not in ('tenor_years', 'spread_bp'))
    or (part ? 'tenor_years' and not (part->'tenor_years' in ('5'::jsonb, '10'::jsonb)))
    or (part ? 'spread_bp' and not private.json_int_between(part->'spread_bp', 0, 1000))
  ) then
    raise exception 'validation';
  end if;

  part := p_config->'quotes';
  if part is not null then
    if jsonb_typeof(part) <> 'array' or jsonb_array_length(part) > 50 then
      raise exception 'validation';
    end if;
    for item in select x from jsonb_array_elements(part) x loop
      if jsonb_typeof(item) <> 'object'
        or exists (select 1 from jsonb_object_keys(item) k
                   where k not in ('id', 'lender', 'rate_ppm', 'points_bp', 'quoted_on', 'loan_type', 'project_id'))
        or jsonb_typeof(item->'id') is distinct from 'string'
        or (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not private.json_text(item->'lender', 80)
        or not private.json_int_between(item->'rate_ppm', 1, 300000)
        or (item ? 'points_bp' and not private.json_int_between(item->'points_bp', 0, 1000))
        or not private.json_date(item->'quoted_on')
        or (item ? 'loan_type' and not (item->>'loan_type' in ('fixed', 'arm', 'dscr', 'other')
                                        and jsonb_typeof(item->'loan_type') = 'string'))
        or (item ? 'project_id' and jsonb_typeof(item->'project_id') <> 'null' and not (
              jsonb_typeof(item->'project_id') = 'string'
              and (item->>'project_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and exists (select 1 from public.projects p
                          where p.id = (item->>'project_id')::uuid and p.company_id = p_company_id)))
      then
        raise exception 'validation';
      end if;
    end loop;
    if (select count(distinct x->>'id') from jsonb_array_elements(part) x) <> jsonb_array_length(part) then
      raise exception 'validation';
    end if;
  end if;

  part := p_config->'yields';
  if part is not null then
    if jsonb_typeof(part) <> 'array' or jsonb_array_length(part) > 400 then
      raise exception 'validation';
    end if;
    for item in select x from jsonb_array_elements(part) x loop
      if jsonb_typeof(item) <> 'object'
        or exists (select 1 from jsonb_object_keys(item) k where k not in ('on_date', 'y5_ppm', 'y10_ppm', 'source'))
        or not private.json_date(item->'on_date')
        or (item ? 'y5_ppm' and jsonb_typeof(item->'y5_ppm') <> 'null' and not private.json_int_between(item->'y5_ppm', 0, 200000))
        or (item ? 'y10_ppm' and jsonb_typeof(item->'y10_ppm') <> 'null' and not private.json_int_between(item->'y10_ppm', 0, 200000))
        or (item ? 'source' and not (jsonb_typeof(item->'source') = 'string' and item->>'source' in ('treasury', 'manual')))
      then
        raise exception 'validation';
      end if;
    end loop;
    if (select count(distinct x->>'on_date') from jsonb_array_elements(part) x) <> jsonb_array_length(part) then
      raise exception 'validation';
    end if;
  end if;

  part := p_config->'quote_date';
  if part is not null and jsonb_typeof(part) <> 'null' and not private.json_date(part) then
    raise exception 'validation';
  end if;
end;
$$;
revoke all on function private.member_report_check(uuid, jsonb) from public, anon, authenticated;

-- The report's inputs (owner and viewers): the setting, or null before the first save, and each
-- property: a project with a value or an open loan, not the overhead project, not finished.
create function public.get_member_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cfg jsonb;
  props jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select r.config into cfg from public.member_reports r where r.company_id = cid;
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'name', p.name,
      'currency', p.investment_currency,
      'value_minor', p.value_minor,
      'value_date', p.value_date,
      'selling_cost_bp', p.selling_cost_bp,
      'loan_balance_minor', coalesce((
        select sum(b.balance_minor)
        from public.loans l
        join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
        where l.company_id = cid and l.project_id = p.id
          and l.status = 'open'::public.loan_status and l.currency = p.investment_currency), 0)::bigint,
      'loans_other_currency', exists (
        select 1
        from public.loans l
        join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
        where l.company_id = cid and l.project_id = p.id
          and l.status = 'open'::public.loan_status and l.currency <> p.investment_currency
          and b.balance_minor <> 0)
    ) order by p.name), '[]'::jsonb)
  into props
  from public.projects p
  join public.companies c on c.id = p.company_id
  where p.company_id = cid
    and p.status = 'active'::public.project_status
    and p.id is distinct from c.overhead_project_id
    and (p.value_minor is not null or exists (
      select 1 from public.loans l
      where l.company_id = cid and l.project_id = p.id and l.status = 'open'::public.loan_status));
  return jsonb_build_object(
    'config', cfg,
    'properties', props,
    'can_edit', private.current_company_id() is not distinct from cid
  );
end;
$$;
revoke all on function public.get_member_report() from public, anon, authenticated, service_role;
grant execute on function public.get_member_report() to authenticated;
comment on function public.get_member_report() is
  'The member share report''s inputs: the setting (or null) and each property''s value, selling cost and open loan balance. Decision 0263.';

-- Replaces the parts of the setting that p_patch names (owner only). Returns the company id, the
-- config after and the config before (null before the first save).
create function public.set_member_report(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior jsonb;
  next jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'validation';
  end if;
  perform 1 from public.companies c where c.id = cid for update;
  select r.config into prior from public.member_reports r where r.company_id = cid;
  next := coalesce(prior, '{}'::jsonb) || p_patch;
  -- A null part clears it.
  next := jsonb_strip_nulls(next);
  perform private.member_report_check(cid, next);
  insert into public.member_reports as r (company_id, config, updated_at)
  values (cid, next, now())
  on conflict (company_id) do update set config = excluded.config, updated_at = excluded.updated_at;
  return jsonb_build_object('id', cid, 'config', next, 'prior', prior);
end;
$$;
revoke all on function public.set_member_report(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_member_report(jsonb) to authenticated;
comment on function public.set_member_report(jsonb) is
  'Replaces the parts of the member share report''s setting that the patch names (owner only); a null part clears it. Decision 0263.';

create function public.mcp_set_member_report(p_idempotency_key text, p_patch jsonb)
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
  changed jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'member_report|' || md5(coalesce(p_patch::text, 'null'));
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    changed := public.set_member_report(p_patch);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
    values (
      token, auth.uid(), 'member_report', (changed->>'id')::uuid,
      jsonb_build_object('before', coalesce(changed->'prior', 'null'::jsonb), 'after', changed->'config'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', changed->>'id',
        'config', changed->'config',
        'prior', changed->'prior',
        'undo_kind', 'member_report'
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_set_member_report(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_member_report(text, jsonb) to authenticated;

-- private.mcp_writes and mcp_undo: the member_report kind puts the setting before back, unless it
-- changed since.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'land_account'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'member_report'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'member_report'::text) AND (company_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$, 'land_account', 'loan_closing_paid'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$, 'member_report'$n$);

  anchor := $a$        or (p_kind = 'land_account' and w.kind = 'land_account' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'member_report' and w.kind = 'member_report' and w.company_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'land_account' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo land_account branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'member_report' then
      -- FLOW-1117 (decision 0263): the setting before comes back unless it changed since.
      declare
        held jsonb;
      begin
        perform 1 from public.companies c where c.id = p_id and c.id = cid for update;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select r.config into held from public.member_reports r where r.company_id = cid;
          if held is distinct from rec.prior->'after' then
            response := private.mcp_error('conflict', 'conflict');
          else
            if jsonb_typeof(rec.prior->'before') = 'object' then
              update public.member_reports r
              set config = rec.prior->'before', updated_at = now()
              where r.company_id = cid;
            else
              delete from public.member_reports r where r.company_id = cid;
            end if;
            update private.mcp_writes
            set undone_at = clock_timestamp()
            where id = rec.id and user_id = auth.uid() and undone_at is null;
            response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
          end if;
        end if;
      end;
$n$ || anchor);
  execute def;
end
$kinds$;

drop function pg_temp.anchor_count(text, text);

commit;
