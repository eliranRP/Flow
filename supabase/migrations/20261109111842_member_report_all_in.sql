-- FLOW-1124: the member report counts each property's all-in and each member's own loans.
--
-- 1. private.member_report_all_in(company, project): the property's all-in as its investment page counts
--    it (get_property_returns: the purchase, the renovation so far, and the holding costs the renovation
--    does not count), with its three parts; null parts while the purchase or the renovation is unknown.
-- 2. get_member_report returns each property's all-in, and the company's open loans (id, name, kind,
--    project, currency, balance), so the owner can say which a member gave the company.
-- 3. The setting's members take loan_ids: the company's loans that member gave. A loan belongs to one
--    member. The report repays them before it splits the equity, and adds each to its member's total.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- ===========================================================================
-- 1 the all-in
-- ===========================================================================

create function private.member_report_all_in(p_company_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r jsonb;
  purchase bigint;
  rehab bigint;
  holding bigint;
begin
  -- The caller (get_member_report) has checked the company; get_property_returns checks it again.
  r := public.get_property_returns(p_project_id);
  purchase := (r->'inputs'->>'purchase_minor')::bigint;
  rehab := (r->'inputs'->>'rehab_minor')::bigint;
  -- Signed as the lines: a cost is negative. The all-in counts it as a cost.
  holding := -coalesce((r->'deal'->>'holding_minor')::bigint, 0);
  return jsonb_build_object(
    'purchase_minor', purchase,
    'rehab_minor', rehab,
    'holding_minor', holding,
    'all_in_minor', case when purchase is not null and rehab is not null then purchase + rehab + holding end
  );
end;
$$;
revoke all on function private.member_report_all_in(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2 get_member_report
-- ===========================================================================

create or replace function public.get_member_report()
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
  yields jsonb;
  since date;
  loans jsonb;
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
    ) || private.member_report_all_in(cid, p.id) order by p.name), '[]'::jsonb)
  into props
  from public.projects p
  join public.companies c on c.id = p.company_id
  where p.company_id = cid
    and p.status = 'active'::public.project_status
    and p.id is distinct from c.overhead_project_id
    and (p.value_minor is not null or exists (
      select 1 from public.loans l
      where l.company_id = cid and l.project_id = p.id and l.status = 'open'::public.loan_status));
  -- FLOW-1119: the Treasury's yields from two weeks before the earliest date the report needs.
  select least(current_date, (
    select min(d) from (
      select (q->>'quoted_on')::date as d from jsonb_array_elements(coalesce(cfg->'quotes', '[]'::jsonb)) q
      union all select (cfg->>'quote_date')::date
    ) x)) - 14
  into since;
  select coalesce(jsonb_agg(jsonb_build_object('on_date', t.on_date, 'y5_ppm', t.y5_ppm, 'y10_ppm', t.y10_ppm)
    order by t.on_date), '[]'::jsonb)
  into yields
  from public.treasury_yields t
  where t.on_date between since and current_date;
  -- FLOW-1124: the company's open loans, so the owner can say which a member gave the company.
  select coalesce(jsonb_agg(jsonb_build_object(
      'loan_id', l.id,
      'name', l.name,
      'kind', l.kind,
      'project_id', l.project_id,
      'currency', l.currency,
      'balance_minor', coalesce(b.balance_minor, 0)::bigint
    ) order by (l.kind = 'demand'::public.loan_kind) desc, l.name, l.id), '[]'::jsonb)
  into loans
  from public.loans l
  left join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
  where l.company_id = cid and l.status = 'open'::public.loan_status;
  return jsonb_build_object(
    'config', cfg,
    'properties', props,
    'loans', loans,
    'treasury_yields', yields,
    -- FLOW-1122: when the Treasury's yields were last stored, and last asked for by hand.
    'treasury_fetched_at', (select max(t.fetched_at) from public.treasury_yields t),
    'treasury_requested_at', (select r.requested_at from private.treasury_refresh r where r.id),
    'can_edit', private.owner_company_id() is not distinct from cid
  );
end;
$$;

comment on function public.get_member_report() is
  'The member share report''s inputs: the setting (or null), each property''s value, selling cost, open loan balance and all-in (FLOW-1124), the company''s open loans, and the Treasury''s fetched yields. Decision 0263.';

-- ===========================================================================
-- 3 members' loan_ids
-- ===========================================================================

do $check$
declare
  def text;
  a_keys constant text := $a$where k not in ('name', 'ownership_bp'))$a$;
  a_total constant text := $a$      total := total + (item->>'ownership_bp')::bigint;$a$;
  a_unique constant text := $a$    if (select count(distinct lower(x->>'name')) from jsonb_array_elements(part) x) <> jsonb_array_length(part) then
      raise exception 'validation';
    end if;$a$;
begin
  def := pg_get_functiondef('private.member_report_check(uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_keys) <> 1 or pg_temp.anchor_count(def, a_total) <> 1
    or pg_temp.anchor_count(def, a_unique) <> 1
  then
    raise exception 'member_report_check is not the expected definition';
  end if;
  def := replace(def, a_keys, $n$where k not in ('name', 'ownership_bp', 'loan_ids'))$n$);
  -- Each of a member's loans is one of the company's loans, at most 50.
  def := replace(def, a_total, a_total || $n$
      if item ? 'loan_ids' and (
        jsonb_typeof(item->'loan_ids') <> 'array'
        or jsonb_array_length(item->'loan_ids') > 50
        or exists (
          select 1 from jsonb_array_elements(item->'loan_ids') x
          where jsonb_typeof(x) <> 'string'
            or (x #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or not exists (select 1 from public.loans l where l.id = (x #>> '{}')::uuid and l.company_id = p_company_id))
      ) then
        raise exception 'validation';
      end if;$n$);
  -- A loan belongs to one member, and is named once.
  def := replace(def, a_unique, a_unique || $n$
    if (select count(*) <> count(distinct x)
        from jsonb_array_elements(part) m, jsonb_array_elements(coalesce(m->'loan_ids', '[]'::jsonb)) x) then
      raise exception 'validation';
    end if;$n$);
  execute def;
end
$check$;

drop function pg_temp.anchor_count(text, text);

commit;
