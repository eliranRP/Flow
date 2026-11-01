-- FLOW-450 (decision 0244): a property's returns, the way Real Estate by the Numbers analyses a
-- rental, with the transactions behind every figure.
--
-- 1. Three new inputs: projects.units and projects.land_minor (set through set_project_investment,
--    undo kind project_investment as before) and companies.tax_bracket_bp (set_tax_bracket, MCP
--    set_tax_bracket with undo kind tax_bracket).
-- 2. public.project_values: the history of a project's value. A trigger on projects keeps it: the
--    value set for a date is kept, and a value for an earlier date drops the later ones (so an
--    undo leaves no value behind). Appreciation reads it.
-- 3. public.get_property_returns(project, from, to): the cash-flow statement, the four sources of
--    return, the equity figures and the metrics, each null with the missing input named when an
--    input is missing. Nothing is guessed.
-- 4. public.get_property_return_lines(project, line, ...): the lines behind one figure.
--
-- Which line a category feeds comes from what Flow stores: income → income; the principal,
-- interest and fees parts of a loan payment → loan payments; a category switched into rehab
-- (categories.rehab = true) → CapEx; kept out of the P&L → not counted; the rest → operating
-- expenses. A loan's escrow part (taxes and insurance) is an operating expense, as the book has it.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- ===========================================================================
-- 1 the inputs
-- ===========================================================================

alter table public.projects
  add column units integer,
  add column land_minor bigint,
  add constraint projects_units_check check (units is null or units between 1 and 9999),
  add constraint projects_land_check check (land_minor is null or land_minor >= 0);
comment on column public.projects.units is
  'FLOW-450: how many units the property has, for cash flow per unit. Null until the owner sets it.';
comment on column public.projects.land_minor is
  'FLOW-450: the land''s part of the purchase, in the investment currency. The building (purchase + rehab - land) is depreciated over 27.5 years for the tax savings. Null until set.';

alter table public.companies
  add column tax_bracket_bp integer,
  add constraint companies_tax_bracket_check check (tax_bracket_bp is null or tax_bracket_bp between 0 and 10000);
comment on column public.companies.tax_bracket_bp is
  'FLOW-450: the owner''s marginal tax bracket in basis points (2400 = 24%), for the tax savings of depreciation. Null until set.';

create or replace function private.project_figures(p_company_id uuid, p_project_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'currency', p.investment_currency,
    'purchase_minor', p.purchase_minor,
    'arv_minor', p.arv_minor,
    'value_minor', p.value_minor,
    'value_date', p.value_date,
    'units', p.units,
    'land_minor', p.land_minor
  )
  from public.projects p
  where p.id = p_project_id and p.company_id = p_company_id;
$$;

create or replace function public.set_project_investment(p_project_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  before jsonb;
  after jsonb;
  k text;
  v jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_project_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'validation';
  end if;
  for k, v in select e.key, e.value from jsonb_each(p_patch) e loop
    if k in ('purchase_minor', 'arv_minor', 'value_minor', 'land_minor') then
      if jsonb_typeof(v) <> 'null'
         and (jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,15}$')
      then
        raise exception 'validation';
      end if;
    elsif k = 'units' then
      if jsonb_typeof(v) <> 'null'
         and (jsonb_typeof(v) <> 'number' or v::text !~ '^[1-9][0-9]{0,3}$')
      then
        raise exception 'validation';
      end if;
    elsif k = 'value_date' then
      if jsonb_typeof(v) <> 'null' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'validation';
        end if;
        begin
          perform (v #>> '{}')::date;
        exception
          when datetime_field_overflow or invalid_datetime_format then
            raise exception 'validation';
        end;
      end if;
    elsif k = 'currency' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Z]{3}$' then
        raise exception 'validation';
      end if;
    else
      raise exception 'validation';
    end if;
  end loop;

  perform 1 from public.projects p where p.id = p_project_id and p.company_id = cid for update;
  if not found then
    raise exception 'project not found';
  end if;
  before := private.project_figures(cid, p_project_id);

  update public.projects p
  set purchase_minor = case when p_patch ? 'purchase_minor' then (p_patch->>'purchase_minor')::bigint else p.purchase_minor end,
      arv_minor = case when p_patch ? 'arv_minor' then (p_patch->>'arv_minor')::bigint else p.arv_minor end,
      value_minor = case when p_patch ? 'value_minor' then (p_patch->>'value_minor')::bigint else p.value_minor end,
      value_date = case when p_patch ? 'value_date' then (p_patch->>'value_date')::date else p.value_date end,
      units = case when p_patch ? 'units' then (p_patch->>'units')::integer else p.units end,
      land_minor = case when p_patch ? 'land_minor' then (p_patch->>'land_minor')::bigint else p.land_minor end,
      investment_currency = case when p_patch ? 'currency' then p_patch->>'currency' else p.investment_currency end
  where p.id = p_project_id and p.company_id = cid;

  after := private.project_figures(cid, p_project_id);
  return jsonb_build_object('before', before, 'after', after);
end;
$$;
comment on function public.set_project_investment(uuid, jsonb) is
  'Sets a project''s investment currency, purchase, ARV, value, units and land (owner only); a key left out keeps its figure, a null clears it. Decisions 0143 and 0244.';

-- mcp_undo project_investment puts back units and land too.
do $undo_inv$
declare
  def text;
  anchor constant text := $a$            investment_currency = coalesce(rec.prior->'before'->>'currency', 'ILS')$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo project_investment branch is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
            units = (rec.prior->'before'->>'units')::integer,
            land_minor = (rec.prior->'before'->>'land_minor')::bigint$n$);
end
$undo_inv$;

-- The tax bracket: owner only. Returns the bracket before and after.
create function public.set_tax_bracket(p_bp integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior integer;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_bp is not null and (p_bp < 0 or p_bp > 10000) then
    raise exception 'validation';
  end if;
  select c.tax_bracket_bp into prior from public.companies c where c.id = cid for update;
  update public.companies c set tax_bracket_bp = p_bp where c.id = cid;
  return jsonb_build_object('id', cid, 'tax_bracket_bp', p_bp, 'prior', prior);
end;
$$;
revoke all on function public.set_tax_bracket(integer) from public, anon, authenticated, service_role;
grant execute on function public.set_tax_bracket(integer) to authenticated;
comment on function public.set_tax_bracket(integer) is
  'Sets the owner''s marginal tax bracket in basis points (owner only; null clears it). Decision 0244.';

create function public.mcp_set_tax_bracket(p_idempotency_key text, p_bp integer)
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
    or (p_bp is not null and (p_bp < 0 or p_bp > 10000))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'tax_bracket|' || coalesce(p_bp::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    changed := public.set_tax_bracket(p_bp);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
    values (
      token, auth.uid(), 'tax_bracket', (changed->>'id')::uuid,
      jsonb_build_object('before', changed->'prior', 'after', changed->'tax_bracket_bp'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', changed->>'id',
        'tax_bracket_bp', changed->'tax_bracket_bp',
        'prior', changed->'prior',
        'undo_kind', 'tax_bracket'
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
revoke all on function public.mcp_set_tax_bracket(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_tax_bracket(text, integer) to authenticated;

-- private.mcp_writes and mcp_undo: the tax_bracket kind. The undo puts the bracket back unless it
-- changed since.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'company_currency'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'tax_bracket'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'tax_bracket'::text) AND (company_id IS NOT NULL) AND (prior ? 'before'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'company_currency'$a$;
  -- The kinds list names it once; the lookup and the branch name it with "p_kind = ".
  if pg_temp.anchor_count(def, $a$, 'company_currency'$a$) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, $a$, 'company_currency'$a$, $n$, 'company_currency', 'tax_bracket'$n$);

  anchor := $a$        or (p_kind = 'company_currency' and w.kind = 'company_currency' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'tax_bracket' and w.kind = 'tax_bracket' and w.company_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'company_currency' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo company_currency branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'tax_bracket' then
      -- FLOW-450 (decision 0244).
      declare
        held integer;
      begin
        select c.tax_bracket_bp into held
        from public.companies c
        where c.id = p_id and c.id = cid
        for update;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif held is distinct from (rec.prior->>'after')::integer then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.companies c
          set tax_bracket_bp = (rec.prior->>'before')::integer
          where c.id = p_id and c.id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        end if;
      end;
$n$ || anchor);
  execute def;
end
$kinds$;

-- ===========================================================================
-- 2 the value history
-- ===========================================================================

create table public.project_values (
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid not null,
  value_date date not null,
  value_minor bigint not null check (value_minor >= 0),
  created_at timestamptz not null default now(),
  primary key (project_id, value_date),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade
);
create index project_values_company_project_idx on public.project_values (company_id, project_id);
comment on table public.project_values is
  'FLOW-450: every value the owner gave a project, by its date. The project''s value today is the latest. Kept by a trigger on projects; decision 0244.';

alter table public.project_values enable row level security;
create policy project_values_select on public.project_values
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
revoke all on public.project_values from public, anon, authenticated;
grant select on public.project_values to authenticated;
grant select, insert, update, delete on public.project_values to service_role;

create function private.project_values_keep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.value_minor is null or new.value_date is null then
    -- The value was cleared (the owner, or an undo of the first value): the values on or after the
    -- one it had go too, so appreciation never reads a value the project no longer has.
    if tg_op = 'UPDATE' and old.value_date is not null then
      delete from public.project_values v
      where v.project_id = new.id and v.value_date >= old.value_date;
    end if;
    return new;
  end if;
  -- A value for a date replaces what was recorded on or after that date: an older date (an undo
  -- or a correction) leaves no later value behind.
  delete from public.project_values v
  where v.project_id = new.id and v.value_date > new.value_date;
  insert into public.project_values (company_id, project_id, value_date, value_minor)
  values (new.company_id, new.id, new.value_date, new.value_minor)
  on conflict (project_id, value_date) do update set value_minor = excluded.value_minor, created_at = now();
  return new;
end;
$$;
revoke all on function private.project_values_keep() from public, anon, authenticated;

create trigger projects_values_keep
  after insert or update of value_minor, value_date on public.projects
  for each row
  execute function private.project_values_keep();

insert into public.project_values (company_id, project_id, value_date, value_minor)
select p.company_id, p.id, p.value_date, p.value_minor
from public.projects p
where p.value_minor is not null and p.value_date is not null
on conflict do nothing;

-- ===========================================================================
-- 3 the lines behind a property's figures
-- ===========================================================================

-- The project's posted, paid lines in the period, its own and its share of shared ones, with the
-- statement line each feeds. p_from null reads all time (the rehab lines of the building cost).
create function private.property_lines(p_company_id uuid, p_project_id uuid, p_from date, p_to date)
returns table (
  transaction_id uuid,
  part text,
  category_id uuid,
  currency text,
  amount_minor bigint,
  line_date date,
  shared boolean,
  line text,
  in_rehab boolean
)
language sql
stable
set search_path = ''
as $$
  with own as (
    select l.transaction_id, l.part::text as part, l.category_id, l.currency, l.kind,
      l.amount_net::bigint as amount_minor, coalesce(l.cash_date, l.doc_date) as line_date, false as shared
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.pnl_role is distinct from 'shared'::public.pnl_role
      and not l.unpaid
    union all
    select l.transaction_id, l.part::text, l.category_id, l.currency, l.kind,
      coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)::bigint,
      coalesce(l.cash_date, l.doc_date), true
    from private.pnl_lines l
    cross join lateral (
      select a.amount_net from public.allocations a
      where a.transaction_id = l.transaction_id and a.project_id = p_project_id
      offset 0
    ) a
    where l.transaction_id = any(array(
        select a2.transaction_id from public.allocations a2
        where a2.company_id = p_company_id and a2.project_id = p_project_id
      ))
      and l.company_id = p_company_id
      and l.pnl_role = 'shared'::public.pnl_role
      and not l.unpaid
  )
  select o.transaction_id, o.part, o.category_id, o.currency, o.amount_minor, o.line_date, o.shared,
    case
      when o.kind = 'income' and coalesce(c.excluded_from_pnl, false) then 'not_counted'
      when o.kind = 'income' then 'income'
      when coalesce(c.loan_part::text, o.part) in ('principal', 'interest', 'fees') then 'debt_service'
      when c.rehab is true then 'capex'
      when coalesce(c.excluded_from_pnl, false) then 'not_counted'
      else 'opex'
    end,
    o.kind = 'expense' and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, o.part::public.loan_split_part))
  from own o
  left join public.categories c on c.id = o.category_id and c.company_id = p_company_id
  where o.amount_minor <> 0
    and (p_from is null or o.line_date between p_from and p_to);
$$;
revoke all on function private.property_lines(uuid, uuid, date, date) from public, anon;
grant execute on function private.property_lines(uuid, uuid, date, date) to authenticated, service_role;

-- ===========================================================================
-- 4 the returns
-- ===========================================================================

create function public.get_property_returns(p_project_id uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cid uuid;
  p record;
  cur text;
  d_from date;
  d_to date;
  days integer;
  inv jsonb;
  bracket integer;
  st jsonb;
  cats jsonb;
  income bigint;
  opex bigint;
  debt bigint;
  capex bigint;
  not_counted bigint;
  principal bigint;
  other_cur jsonb;
  noi bigint;
  cash_flow bigint;
  rehab bigint;
  borrowed bigint;
  borrowed_other boolean;
  money_in bigint;
  v_start record;
  v_end record;
  appreciation bigint;
  building bigint;
  dep_year bigint;
  tax bigint;
  total bigint;
  missing text[] := '{}';
  annual numeric;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  select pr.investment_currency, pr.purchase_minor, pr.arv_minor, pr.value_minor, pr.value_date,
    pr.units, pr.land_minor
  into p
  from public.projects pr
  where pr.id = p_project_id and pr.company_id = cid;
  if not found then
    return null;
  end if;
  cur := p.investment_currency;
  d_to := coalesce(p_to, (now() at time zone 'Asia/Jerusalem')::date);
  d_from := coalesce(p_from, (d_to - interval '1 year')::date + 1);
  days := d_to - d_from + 1;
  annual := 365.0 / days;
  inv := private.project_investment(cid, p_project_id);
  select c.tax_bracket_bp into bracket from public.companies c where c.id = cid;

  with l as (
    select * from private.property_lines(cid, p_project_id, d_from, d_to) x where x.currency = cur
  ),
  sums as (
    select l.line, sum(l.amount_minor)::bigint as amount_minor, count(distinct l.transaction_id)::integer as lines
    from l group by l.line
  ),
  by_cat as (
    select l.line, l.category_id, sum(l.amount_minor)::bigint as amount_minor,
      count(distinct l.transaction_id)::integer as lines
    from l group by l.line, l.category_id
  )
  select
    coalesce((select jsonb_object_agg(s.line, jsonb_build_object('amount_minor', s.amount_minor, 'lines', s.lines)) from sums s), '{}'::jsonb),
    coalesce((
      select jsonb_object_agg(g.line, g.rows)
      from (
        select b.line, jsonb_agg(jsonb_build_object(
          'category_id', b.category_id, 'name', c.name, 'amount_minor', b.amount_minor, 'lines', b.lines
        ) order by abs(b.amount_minor) desc, c.name nulls last) as rows
        from by_cat b
        left join public.categories c on c.id = b.category_id and c.company_id = cid
        group by b.line
      ) g
    ), '{}'::jsonb),
    coalesce((select sum(-l.amount_minor) from l where l.part = 'principal' and l.line = 'debt_service'), 0)::bigint
  into st, cats, principal;

  select coalesce(jsonb_agg(distinct x.currency), '[]'::jsonb) into other_cur
  from private.property_lines(cid, p_project_id, d_from, d_to) x
  where x.currency <> cur;

  income := coalesce((st->'income'->>'amount_minor')::bigint, 0);
  opex := coalesce((st->'opex'->>'amount_minor')::bigint, 0);
  debt := coalesce((st->'debt_service'->>'amount_minor')::bigint, 0);
  capex := coalesce((st->'capex'->>'amount_minor')::bigint, 0);
  not_counted := coalesce((st->'not_counted'->>'amount_minor')::bigint, 0);
  noi := income + opex;
  cash_flow := noi + debt + capex;

  -- Money in the deal: what the property cost (purchase + rehab so far) less what was borrowed
  -- for it. A refinanced loan counts once, through the loan that replaced it.
  rehab := case when inv->'rehab_other_currencies' = '[]'::jsonb then (inv->>'rehab_minor')::bigint end;
  select coalesce(sum(lo.principal_minor) filter (where lo.currency = cur), 0)::bigint,
    bool_or(lo.currency <> cur)
  into borrowed, borrowed_other
  from public.loans lo
  where lo.company_id = cid and lo.project_id = p_project_id and lo.refinanced_into_id is null;
  if p.purchase_minor is null then
    missing := array_append(missing, 'purchase');
  end if;
  money_in := case
    when p.purchase_minor is not null and rehab is not null and not coalesce(borrowed_other, false)
    then p.purchase_minor + rehab - borrowed
  end;

  -- Appreciation: the value at the end of the period less the value at its start, from the
  -- values the owner gave.
  select v.value_minor, v.value_date into v_end from public.project_values v
  where v.company_id = cid and v.project_id = p_project_id and v.value_date <= d_to
  order by v.value_date desc limit 1;
  select v.value_minor, v.value_date into v_start from public.project_values v
  where v.company_id = cid and v.project_id = p_project_id and v.value_date <= d_from
  order by v.value_date desc limit 1;
  if v_end.value_minor is null or p.value_minor is null then
    missing := array_append(missing, 'value');
  elsif v_start.value_minor is null then
    missing := array_append(missing, 'value_history');
  else
    appreciation := v_end.value_minor - v_start.value_minor;
  end if;

  -- Tax savings: the building (purchase + rehab - land) over 27.5 years, times the bracket, for
  -- the days of the period.
  if p.land_minor is null then
    missing := array_append(missing, 'land');
  end if;
  if bracket is null then
    missing := array_append(missing, 'tax_bracket');
  end if;
  if p.purchase_minor is not null and rehab is not null and p.land_minor is not null then
    building := greatest(p.purchase_minor + rehab - p.land_minor, 0);
    dep_year := private.div_half_even(building::numeric * 10, 275);
    if bracket is not null then
      tax := private.div_half_even(building::numeric * 10 * bracket * days, 275::numeric * 10000 * 365);
    end if;
  end if;
  if p.units is null then
    missing := array_append(missing, 'units');
  end if;

  total := cash_flow + principal + coalesce(appreciation, 0) + coalesce(tax, 0);

  return jsonb_build_object(
    'currency', cur,
    'from', d_from,
    'to', d_to,
    'days', days,
    'other_currencies', other_cur,
    'missing', to_jsonb(missing),
    'inputs', jsonb_build_object(
      'purchase_minor', p.purchase_minor,
      'arv_minor', p.arv_minor,
      'value_minor', p.value_minor,
      'value_date', p.value_date,
      'units', p.units,
      'land_minor', p.land_minor,
      'tax_bracket_bp', bracket,
      'rehab_minor', rehab,
      'borrowed_minor', borrowed,
      'loan_balance_minor', (inv->>'loan_balance_minor')::bigint,
      'value_start', case when v_start.value_minor is not null
        then jsonb_build_object('value_minor', v_start.value_minor, 'value_date', v_start.value_date) end,
      'value_end', case when v_end.value_minor is not null
        then jsonb_build_object('value_minor', v_end.value_minor, 'value_date', v_end.value_date) end
    ),
    'statement', jsonb_build_object(
      'income_minor', income,
      'opex_minor', opex,
      'noi_minor', noi,
      'debt_service_minor', debt,
      'capex_minor', capex,
      'cash_flow_minor', cash_flow,
      'not_counted_minor', not_counted,
      'lines', st,
      'by_category', cats
    ),
    'sources', jsonb_build_object(
      'cash_flow_minor', cash_flow,
      'principal_minor', principal,
      'appreciation_minor', appreciation,
      'tax_savings_minor', tax,
      'depreciation_year_minor', dep_year,
      'building_minor', building,
      'total_minor', total,
      'total_bp', case when money_in > 0 then round(total * annual * 10000 / money_in)::integer end
    ),
    'equity', jsonb_build_object(
      'equity_today_minor', (inv->>'current_equity_minor')::bigint,
      'forced_equity_minor', (inv->>'forced_equity_minor')::bigint,
      'money_in_minor', money_in
    ),
    'metrics', jsonb_build_object(
      'cash_on_cash_bp', case when money_in > 0 then round(cash_flow * annual * 10000 / money_in)::integer end,
      'cap_rate_bp', case when p.value_minor > 0 then round(noi * annual * 10000 / p.value_minor)::integer end,
      'dscr_milli', case when debt < 0 then round(noi * 1000.0 / -debt)::integer end,
      'cash_flow_per_unit_month_minor', case when p.units is not null
        then round(cash_flow * 365.0 / (p.units * days * 12))::bigint end
    )
  );
end;
$$;
revoke all on function public.get_property_returns(uuid, date, date) from public, anon;
grant execute on function public.get_property_returns(uuid, date, date) to authenticated, service_role;
comment on function public.get_property_returns(uuid, date, date) is
  'FLOW-450: a property''s cash-flow statement, sources of return, equity and metrics for a period (default the last 12 months), with the missing inputs named. Decision 0244.';

-- The lines behind one figure: income, opex, debt_service, capex, not_counted or principal for
-- the period, or rehab for all time (the building cost). Optionally one category.
create function public.get_property_return_lines(
  p_project_id uuid,
  p_line text,
  p_from date default null,
  p_to date default null,
  p_category_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cid uuid;
  cur text;
  d_from date;
  d_to date;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  -- Another company's project reads as not found before any argument is checked.
  select pr.investment_currency into cur from public.projects pr where pr.id = p_project_id and pr.company_id = cid;
  if cur is null then
    return null;
  end if;
  if p_line is null or p_line not in ('income', 'opex', 'debt_service', 'capex', 'not_counted', 'principal', 'rehab')
    or (p_from is null) <> (p_to is null) or p_from > p_to
    or p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0
  then
    raise exception 'validation' using errcode = '22023';
  end if;
  if p_line <> 'rehab' then
    d_to := coalesce(p_to, (now() at time zone 'Asia/Jerusalem')::date);
    d_from := coalesce(p_from, (d_to - interval '1 year')::date + 1);
  end if;

  with picked as (
    select x.*
    from private.property_lines(cid, p_project_id, d_from, d_to) x
    where x.currency = cur
      and case p_line
        when 'rehab' then x.in_rehab
        when 'principal' then x.line = 'debt_service' and x.part = 'principal'
        else x.line = p_line
      end
      and (p_category_id is null or x.category_id = p_category_id)
  ),
  per_line as (
    select k.transaction_id, k.category_id, bool_or(k.shared) as shared, max(k.line_date) as line_date,
      sum(k.amount_minor)::bigint as amount_minor, string_agg(distinct k.part, ',') as parts
    from picked k
    group by k.transaction_id, k.category_id
  ),
  page as (
    select r.*, t.description, sup.name as supplier_name, c.name as category_name
    from per_line r
    join public.transactions t on t.id = r.transaction_id and t.company_id = cid
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.categories c on c.id = r.category_id and c.company_id = cid
    order by r.line_date desc, r.transaction_id, r.category_id
    limit p_limit + 1 offset p_offset
  )
  select jsonb_build_object(
    'line', p_line,
    'currency', cur,
    'from', d_from,
    'to', d_to,
    'total_minor', (select coalesce(sum(r.amount_minor), 0)::bigint from per_line r),
    'count', (select count(*)::integer from per_line r),
    'has_more', (select count(*) from page) > p_limit,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', g.transaction_id,
        'description', g.description,
        'supplier_name', g.supplier_name,
        'category_id', g.category_id,
        'category_name', g.category_name,
        'date', g.line_date,
        'amount_minor', g.amount_minor,
        'parts', g.parts,
        'shared', g.shared
      ) order by g.line_date desc, g.transaction_id, g.category_id)
      from (select * from page order by line_date desc, transaction_id, category_id limit p_limit) g
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_property_return_lines(uuid, text, date, date, uuid, integer, integer) from public, anon;
grant execute on function public.get_property_return_lines(uuid, text, date, date, uuid, integer, integer) to authenticated, service_role;
comment on function public.get_property_return_lines(uuid, text, date, date, uuid, integer, integer) is
  'FLOW-450: the lines behind one of a property''s figures, newest first, in pages. Decision 0244.';

drop function pg_temp.anchor_count(text, text);

commit;
