-- FLOW-404 follow-up (decision 0143, amended). A project's investment figures are in the
-- project's own currency, not always shekels: a USD company's property is bought, valued and
-- financed in dollars, and Flow has no company currency yet (FLOW-504).
-- 1. projects.investment_currency (default ILS); the figure columns become *_minor.
-- 2. set_project_investment takes currency; get_project's investment works in that currency:
--    rehab_minor, loan_balance_minor and both equities, other currencies listed apart.
-- 3. mcp_undo's project_investment branch puts the currency back too.
-- Nothing has been deployed with the *_agorot names, so they are renamed in place.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

alter table public.projects rename column purchase_agorot to purchase_minor;
alter table public.projects rename column arv_agorot to arv_minor;
alter table public.projects rename column value_agorot to value_minor;
alter table public.projects rename constraint projects_purchase_agorot_check to projects_purchase_minor_check;
alter table public.projects rename constraint projects_arv_agorot_check to projects_arv_minor_check;
alter table public.projects rename constraint projects_value_agorot_check to projects_value_minor_check;
alter table public.projects
  add column investment_currency text not null default 'ILS'
    constraint projects_investment_currency_check check (investment_currency ~ '^[A-Z]{3}$');

comment on column public.projects.purchase_minor is
  'What the property cost to buy, in minor units of investment_currency, as the owner typed it. Null until set. Decision 0143.';
comment on column public.projects.arv_minor is
  'The after-repair value, in minor units of investment_currency. Null until set. Decision 0143.';
comment on column public.projects.value_minor is
  'What the property is worth today, in minor units of investment_currency. Null until set. Decision 0143.';
comment on column public.projects.value_date is
  'When value_minor was last estimated. Decision 0143.';
comment on column public.projects.investment_currency is
  'The currency of the investment figures, rehab and equity on this project (default ILS). Decision 0143.';

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
    'value_date', p.value_date
  )
  from public.projects p
  where p.id = p_project_id and p.company_id = p_company_id;
$$;

create or replace function private.project_investment(p_company_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  p record;
  cur text;
  rehab bigint;
  rehab_other jsonb;
  loan_balance bigint;
  loan_other jsonb;
begin
  select pr.investment_currency, pr.purchase_minor, pr.arv_minor, pr.value_minor, pr.value_date into p
  from public.projects pr
  where pr.id = p_project_id and pr.company_id = p_company_id;
  if not found then
    return null;
  end if;
  cur := p.investment_currency;

  with costs as (
    select l.currency, l.amount_net
    from private.pnl_lines l
    left join public.categories c on c.id = l.category_id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.kind = 'expense'
      and l.pnl_role = 'project'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
    union all
    select l.currency, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from public.allocations a
    join private.pnl_lines l on l.transaction_id = a.transaction_id
    left join public.categories c on c.id = l.category_id
    where a.project_id = p_project_id
      and l.company_id = p_company_id
      and l.kind = 'expense'
      and l.pnl_role = 'shared'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
  ),
  by_currency as (
    select x.currency, (-sum(x.amount_net))::bigint as amount_minor
    from costs x
    group by x.currency
  )
  select
    coalesce((select b.amount_minor from by_currency b where b.currency = cur), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('currency', b.currency, 'amount_minor', b.amount_minor) order by b.currency)
      from by_currency b
      where b.currency <> cur and b.amount_minor <> 0
    ), '[]'::jsonb)
  into rehab, rehab_other;

  select coalesce(sum(b.balance_minor), 0)::bigint into loan_balance
  from public.loans l
  join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
  where l.company_id = p_company_id
    and l.project_id = p_project_id
    and l.status = 'open'::public.loan_status
    and l.currency = cur;

  select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'balance_minor', x.balance_minor)
           order by x.currency), '[]'::jsonb)
  into loan_other
  from (
    select l.currency, sum(b.balance_minor)::bigint as balance_minor
    from public.loans l
    join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.status = 'open'::public.loan_status
      and l.currency <> cur
    group by l.currency
    having sum(b.balance_minor) <> 0
  ) x;

  return jsonb_build_object(
    'currency', cur,
    'purchase_minor', p.purchase_minor,
    'arv_minor', p.arv_minor,
    'value_minor', p.value_minor,
    'value_date', p.value_date,
    'rehab_minor', rehab,
    'rehab_other_currencies', rehab_other,
    'loan_balance_minor', loan_balance,
    'loan_balance_other_currencies', loan_other,
    'forced_equity_minor', case when rehab_other = '[]'::jsonb then p.arv_minor - p.purchase_minor - rehab end,
    'current_equity_minor', case when loan_other = '[]'::jsonb then p.value_minor - loan_balance end
  );
end;
$$;

-- Sets the investment figures of one project (owner only). p_patch holds any of
-- purchase_minor, arv_minor, value_minor (whole minor units of the project's investment
-- currency, 0 or more), value_date (YYYY-MM-DD) and currency (three capital letters, not null); a key left out keeps its figure, a null clears it. Anything else, or an empty
-- patch, is 'validation'. Returns the figures before and after.
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
    if k in ('purchase_minor', 'arv_minor', 'value_minor') then
      if jsonb_typeof(v) <> 'null'
         and (jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,15}$')
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
      investment_currency = case when p_patch ? 'currency' then p_patch->>'currency' else p.investment_currency end
  where p.id = p_project_id and p.company_id = cid;

  after := private.project_figures(cid, p_project_id);
  return jsonb_build_object('before', before, 'after', after);
end;
$$;

comment on function public.set_project_investment(uuid, jsonb) is
  'Sets a project''s investment currency, purchase, ARV and value (owner only); a key left out keeps its figure, a null clears it. Decision 0143.';

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$        set purchase_agorot = (rec.prior->'before'->>'purchase_agorot')::bigint,
            arv_agorot = (rec.prior->'before'->>'arv_agorot')::bigint,
            value_agorot = (rec.prior->'before'->>'value_agorot')::bigint,
            value_date = (rec.prior->'before'->>'value_date')::date$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo project_investment branch is not the expected definition';
  end if;
  execute replace(def, anchor, $n$        set purchase_minor = (rec.prior->'before'->>'purchase_minor')::bigint,
            arv_minor = (rec.prior->'before'->>'arv_minor')::bigint,
            value_minor = (rec.prior->'before'->>'value_minor')::bigint,
            value_date = (rec.prior->'before'->>'value_date')::date,
            investment_currency = coalesce(rec.prior->'before'->>'currency', 'ILS')$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
