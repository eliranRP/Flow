-- FLOW-504, server part (the owner chose "Company currency", no exchange rates). Decision 0146.
-- 1. companies.base_currency (ILS by default, any three-letter code). Existing companies whose
--    lines are all USD get USD. public.set_company_currency(currency) changes it (owner only);
--    MCP set_company_currency does the same with undo kind company_currency.
-- 2. The base currency leads where ILS led:
--    - company_pnl (get_dashboard, MCP get_totals, list_projects) returns base_currency, lists
--      by_currency base currency first, gives each by_currency row prev_* figures for the
--      period before, and orders projects by their base-currency figures;
--    - get_home returns base_currency and net_profit_minor in it;
--    - get_project returns base_currency and overhead_share_minor in it;
--    - get_profit_months always carries a base-currency row (it was ILS), lists it first, and
--      gives each month overhead_share_minor in it;
--    - mcp_company_loan_currency (the loan default) returns it;
--    - a new project's investment currency starts in it.
-- Nothing is converted: other currencies stay their own rows. The *_agorot fields stay ILS.
-- Existing functions are patched from their current definitions, with counted anchors, so
-- changes merged since stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

alter table public.companies
  add column base_currency text not null default 'ILS',
  add constraint companies_base_currency_check check (base_currency ~ '^[A-Z]{3}$');

comment on column public.companies.base_currency is
  'The company''s own currency: listed first and used for defaults. Nothing is converted to it. Decision 0146.';

-- A company whose lines are all in dollars is a dollar company (what the app guessed so far).
update public.companies c
set base_currency = 'USD'
where exists (select 1 from public.transactions t where t.company_id = c.id and t.removed_at is null)
  and not exists (
    select 1 from public.transactions t
    where t.company_id = c.id and t.removed_at is null and t.currency <> 'USD'
  );

-- Its projects with no investment figures yet follow it.
update public.projects p
set investment_currency = c.base_currency
from public.companies c
where c.id = p.company_id
  and c.base_currency <> 'ILS'
  and p.investment_currency = 'ILS'
  and p.purchase_minor is null
  and p.arv_minor is null
  and p.value_minor is null;

create function private.company_base_currency(p_company uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.base_currency from public.companies c where c.id = p_company), 'ILS');
$$;

revoke all on function private.company_base_currency(uuid) from public, anon;
grant execute on function private.company_base_currency(uuid) to authenticated, service_role;

-- A new project's investment currency starts in the company's currency. The column default
-- is ILS, so an ILS insert in a dollar company becomes USD; set_project_investment changes it.
create function private.projects_investment_currency_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.investment_currency = 'ILS' then
    new.investment_currency := private.company_base_currency(new.company_id);
  end if;
  return new;
end;
$$;

revoke all on function private.projects_investment_currency_default() from public, anon, authenticated, service_role;

create trigger projects_investment_currency_default
before insert on public.projects
for each row execute function private.projects_investment_currency_default();

-- The owner changes the company currency. Returns the currency before and after.
create function public.set_company_currency(p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  before text;
begin
  cid := private.current_company_id();
  if auth.uid() is null or cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'validation';
  end if;
  select c.base_currency into before
  from public.companies c
  where c.id = cid and c.owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.companies c set base_currency = p_currency where c.id = cid;
  return jsonb_build_object('id', cid, 'base_currency', p_currency, 'prior', before);
end;
$$;

revoke all on function public.set_company_currency(text) from public, anon, authenticated, service_role;
grant execute on function public.set_company_currency(text) to authenticated;
comment on function public.set_company_currency(text) is
  'Sets the company''s own currency (owner only). Nothing is converted. Decision 0146.';

create function public.mcp_set_company_currency(p_idempotency_key text, p_currency text)
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
    or p_currency is null
    or p_currency !~ '^[A-Z]{3}$'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'company_currency|' || p_currency;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    changed := public.set_company_currency(p_currency);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
    values (
      token, auth.uid(), 'company_currency', (changed->>'id')::uuid,
      jsonb_build_object('before', changed->>'prior', 'after', changed->>'base_currency'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', changed->>'id',
        'base_currency', changed->>'base_currency',
        'prior', changed->>'prior',
        'undo_kind', 'company_currency'
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

revoke all on function public.mcp_set_company_currency(text, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_company_currency(text, text) to authenticated;

-- The loan form's default: the company currency, no longer a guess from the lines.
create or replace function public.mcp_company_loan_currency()
returns text
language sql
stable
set search_path = ''
as $$
  select private.company_base_currency((select private.current_company_id()));
$$;

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.overhead_share_for: the same share in any one currency (the five-argument one stays
  -- ILS for the *_agorot fields).
  def := pg_get_functiondef('private.overhead_share_for(uuid,uuid,text,date,date)'::regprocedure);
  anchor := $a$private.overhead_share_for(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 or pg_temp.anchor_count(def, $a$l.currency = 'ILS'$a$) <> 2 then
    raise exception 'overhead_share_for is not the expected definition';
  end if;
  def := replace(def, anchor, $n$private.overhead_share_for(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date, p_currency text)$n$);
  def := replace(def, $a$l.currency = 'ILS'$a$, $n$l.currency = p_currency$n$);
  execute def;

  -- public.company_pnl.
  def := pg_get_functiondef('public.company_pnl(uuid,date,date,text)'::regprocedure);
  anchor := $a$    'basis', basis,
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl basis is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$    'base_currency', c.base_currency,
$n$);

  anchor := $a$  company_currency as ($a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl company_currency is not the expected definition';
  end if;
  def := replace(def, anchor, $n$  prev_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as expense_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as expense_net
      from income_all i
      where i.in_prev and i.in_pnl
      union all
      select e.currency, 0::bigint, e.amount_net
      from expense_all e
      where e.in_prev and e.in_pnl
    ) parts
    group by parts.currency
  ),
$n$ || anchor);

  anchor := $a$        'unassigned_expense_minor', coalesce(un.unassigned_expense_minor, 0)
      ) order by k.currency)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl by_currency is not the expected definition';
  end if;
  def := replace(def, anchor, $n$        'unassigned_expense_minor', coalesce(un.unassigned_expense_minor, 0),
        'prev_income_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) end,
        'prev_expense_minor', case when p_from is null then null else coalesce(pv.expense_minor, 0) end,
        'prev_net_profit_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) - coalesce(pv.expense_minor, 0) end
      ) order by k.currency is distinct from c.base_currency, k.currency)$n$);

  anchor := $a$      left join unassigned_by_currency un on un.currency = k.currency
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl unassigned join is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$      left join prev_currency pv on pv.currency = k.currency
$n$);

  anchor := $a$            ) order by pc.currency)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl project by_currency is not the expected definition';
  end if;
  def := replace(def, anchor, $n$            ) order by pc.currency is distinct from c.base_currency, pc.currency)$n$);

  anchor := $a$        order by (abs(r.income_net) + abs(r.direct_net)) desc, r.name$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl project order is not the expected definition';
  end if;
  def := replace(def, anchor, $n$        order by coalesce((
          select abs(pc.income_net) + abs(pc.direct_net)
          from project_currency pc
          where pc.project_id = r.id and pc.currency = c.base_currency
        ), 0) desc, r.name$n$);
  execute def;

  -- public.get_home.
  def := pg_get_functiondef('public.get_home()'::regprocedure);
  anchor := $a$        'is_demo', c.is_demo$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 or pg_temp.anchor_count(def, $a$      'is_demo', false$a$) <> 1 then
    raise exception 'get_home is not the expected definition';
  end if;
  def := replace(def, anchor, $n$        'base_currency', c.base_currency,
        'net_profit_minor', coalesce((
          select sum(
            case
              when l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')) then l.amount_net
              when l.kind = 'expense' then l.amount_net
              else 0
            end
          )::bigint
          from (select * from private.pnl_lines u where not u.unpaid) l
          where l.company_id = c.id
            and l.in_pnl
            and l.currency = c.base_currency
        ), 0),
$n$ || anchor);
  def := replace(def, $a$      'is_demo', false$a$, $n$      'base_currency', 'ILS',
      'net_profit_minor', 0,
      'is_demo', false$n$);
  execute def;

  -- public.get_project: the overhead share in the company currency.
  def := pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure);
  anchor := $a$    'overhead_weighted', coalesce(available, false),
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_project overhead is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$    'base_currency', private.company_base_currency(cid),
    'overhead_share_minor', (
      select case when s.available then coalesce(s.share_agorot, 0) else null end
      from private.overhead_share_for(cid, p_id, basis, p_from, p_to, private.company_base_currency(cid)) s
    ),
$n$);
  execute def;

  -- public.get_profit_months: the company currency's row is always there and comes first.
  def := pg_get_functiondef('public.get_profit_months(date,date,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, $a$(select 'ILS'::text as currency union$a$) <> 1
    or pg_temp.anchor_count(def, $a$where k.currency = 'ILS' or s.month is not null$a$) <> 1
    or pg_temp.anchor_count(def, $a$order by c.currency <> 'ILS', c.currency$a$) <> 1
    or pg_temp.anchor_count(def, $a$order by t.currency <> 'ILS', t.currency$a$) <> 1
    or pg_temp.anchor_count(def, $a$    where p_project_id is not null
  )
$a$) <> 1
    or pg_temp.anchor_count(def, $a$        'overhead_share_agorot', case when coalesce(o.available, false) then coalesce(o.share_agorot, 0) else null end
$a$) <> 1
    or pg_temp.anchor_count(def, $a$      left join overhead o on o.month = m.month
$a$) <> 1
    or pg_temp.anchor_count(def, $a$    'basis', basis,
$a$) <> 1
  then
    raise exception 'get_profit_months is not the expected definition';
  end if;
  def := replace(def, $a$(select 'ILS'::text as currency union$a$, $n$(select private.company_base_currency(cid) as currency union$n$);
  def := replace(def, $a$where k.currency = 'ILS' or s.month is not null$a$, $n$where k.currency = private.company_base_currency(cid) or s.month is not null$n$);
  def := replace(def, $a$order by c.currency <> 'ILS', c.currency$a$, $n$order by c.currency <> private.company_base_currency(cid), c.currency$n$);
  def := replace(def, $a$order by t.currency <> 'ILS', t.currency$a$, $n$order by t.currency <> private.company_base_currency(cid), t.currency$n$);
  def := replace(def, $a$    where p_project_id is not null
  )
$a$, $n$    where p_project_id is not null
  ),
  overhead_base as (
    select m.month, o.available, o.share_agorot
    from months m
    cross join lateral private.overhead_share_for(cid, p_project_id, basis, m.mfrom, m.mto, private.company_base_currency(cid)) o
    where p_project_id is not null
  )
$n$);
  def := replace(def, $a$        'overhead_share_agorot', case when coalesce(o.available, false) then coalesce(o.share_agorot, 0) else null end
$a$, $n$        'overhead_share_agorot', case when coalesce(o.available, false) then coalesce(o.share_agorot, 0) else null end,
        'overhead_share_minor', case when coalesce(ob.available, false) then coalesce(ob.share_agorot, 0) else null end
$n$);
  def := replace(def, $a$      left join overhead o on o.month = m.month
$a$, $n$      left join overhead o on o.month = m.month
      left join overhead_base ob on ob.month = m.month
$n$);
  def := replace(def, $a$    'basis', basis,
$a$, $n$    'basis', basis,
    'base_currency', private.company_base_currency(cid),
$n$);
  execute def;

  -- private.mcp_writes: the company_currency kind.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'category_move'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'company_currency'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'category_move'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'company_currency'::text) AND (company_id IS NOT NULL) AND (prior ? 'before'::text))))$n$;

  -- public.mcp_undo: company_currency puts back the currency before, unless it changed since.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'category_delete', 'category_move'
    )$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'category_delete', 'category_move', 'company_currency'
    )$n$);

  anchor := $a$        or (p_kind = 'category_move' and w.kind = 'category_move' and w.category_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'company_currency' and w.kind = 'company_currency' and w.company_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'overhead_project' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo overhead_project branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'company_currency' then
      select c.base_currency into cur_name
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_name is distinct from rec.prior->>'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.companies c
        set base_currency = rec.prior->>'before'
        where c.id = p_id and c.id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
$n$ || anchor);
  execute def;
end
$patch$;

revoke all on function private.overhead_share_for(uuid, uuid, text, date, date, text) from public, anon;
grant execute on function private.overhead_share_for(uuid, uuid, text, date, date, text) to authenticated, service_role;

drop function pg_temp.anchor_count(text, text);

commit;
