-- FLOW-103, server (decision 0170): profit follows the company's date choice. The owner picked
-- "Payment date" (2026-10-10): companies.cash_basis is the one basis for the cash view and the
-- P&L, 'paid' as the P&L's cash and 'invoice' as its invoiced.
-- - private.pnl_basis(company, basis): a P&L read's basis. 'cash' or 'invoiced' is what the
--   caller asked; anything else (null, omitted) is the company's choice.
-- - get_dashboard, get_project_group, get_breakdown, get_breakdown_lines, get_profit_months and
--   list_project_category default p_basis to null, so a caller that omits it gets the company's
--   choice. get_project takes null the same way; the old one-argument get_project(p_id) stays the
--   invoiced basis it always was (nothing in the app or the MCP calls it).
-- - cash_months.profit_minor ("רווח החודש" on Home) follows the company's choice, as
--   get_profit_months does for the same month.
-- - company_pnl_basis(): the readable company's basis, for the MCP P&L tools' default.
-- Existing companies are already 'paid' (the column's default), so nothing is backfilled.

begin;

set local lock_timeout = '5s';

create or replace function private.pnl_basis(p_company uuid, p_basis text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_basis in ('cash', 'invoiced') then p_basis
    else coalesce((
      select case when c.cash_basis = 'invoice' then 'invoiced' else 'cash' end
      from public.companies c
      where c.id = p_company
    ), 'cash')
  end;
$$;

-- Invoker's rights: the caller reads only a company its own reads can see.
revoke all on function private.pnl_basis(uuid, text) from public, anon;
grant execute on function private.pnl_basis(uuid, text) to authenticated, service_role;

create or replace function public.company_pnl_basis()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.readable_company_id() is null then null
    else private.pnl_basis(private.readable_company_id(), null) end;
$$;

revoke all on function public.company_pnl_basis() from public, anon;
grant execute on function public.company_pnl_basis() to authenticated, service_role;

comment on function public.company_pnl_basis() is
  'FLOW-103: the readable company''s P&L basis, cash (payment date) or invoiced (invoice date), from companies.cash_basis; null without a company.';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $basis$
declare
  fn text;
  def text;
  normal text := $a$basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;$a$;
  cash_default text := $a$p_basis text DEFAULT 'cash'::text$a$;
begin
  -- The reads that pick their own basis: the company's choice when the caller names none.
  foreach fn in array array[
    'public.get_breakdown(text,date,date,text,text)',
    'public.get_breakdown_lines(text,text,text,text,date,date,text,boolean,integer,integer)',
    'public.get_profit_months(date,date,text,uuid)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, normal) <> 1 or pg_temp.anchor_count(def, cash_default) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, normal, 'basis := private.pnl_basis(cid, p_basis);');
    def := replace(def, cash_default, 'p_basis text DEFAULT NULL::text');
    execute def;
  end loop;

  fn := 'public.get_project(uuid,text,date,date)';
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, normal) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  execute replace(def, normal, 'basis := private.pnl_basis(cid, p_basis);');

  fn := 'public.list_project_category(uuid,uuid,integer,integer,date,date,text,text)';
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, $a$basis := case when p_basis = 'cash' then 'cash' else 'invoiced' end;$a$) <> 1
    or pg_temp.anchor_count(def, $a$p_basis text DEFAULT 'invoiced'::text$a$) <> 1
  then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, $a$basis := case when p_basis = 'cash' then 'cash' else 'invoiced' end;$a$, 'basis := private.pnl_basis(cid, p_basis);');
  def := replace(def, $a$p_basis text DEFAULT 'invoiced'::text$a$, 'p_basis text DEFAULT NULL::text');
  execute def;

  -- These two hand p_basis to company_pnl, which reads null as cash: resolve it first.
  foreach fn in array array[
    'public.get_dashboard(date,date,text)',
    'public.get_project_group(uuid,text,date,date)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, 'public.company_pnl(cid, p_from, p_to, p_basis)') <> 1
      or pg_temp.anchor_count(def, cash_default) <> 1
    then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, 'public.company_pnl(cid, p_from, p_to, p_basis)', 'public.company_pnl(cid, p_from, p_to, private.pnl_basis(cid, p_basis))');
    def := replace(def, cash_default, 'p_basis text DEFAULT NULL::text');
    execute def;
  end loop;
end;
$basis$;

-- "רווח החודש": the month's net profit on the company's basis, as get_profit_months counts it.
do $cash$
declare
  def text;
  old_profit text := $a$  -- company_pnl's net profit on the invoiced basis, one month at a time.
  profit as (
    select
      date_trunc('month', l.doc_date)::date as month,
      l.currency,
      sum(l.amount_net)::bigint as profit_minor
    from private.pnl_lines l
    where l.company_id = cid
      and l.in_pnl
      and l.doc_date between first_month and last_day
      and (
        l.kind = 'expense'
        or l.direction = 'expense'
        or l.doc_kind in ('invoice', 'credit', 'invoice_receipt')
      )
    group by 1, 2
  ),$a$;
  new_profit text := $a$  -- The month's net profit on the company's basis, as get_profit_months counts it.
  profit as (
    select
      date_trunc('month', case when l.kind = 'income' and pbasis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end)::date as month,
      l.currency,
      sum(l.amount_net)::bigint as profit_minor
    from private.pnl_lines l
    where l.company_id = cid
      and l.in_pnl
      and (pbasis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or l.direction = 'expense'
        or (pbasis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (pbasis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and private.pnl_in_range(l.kind, pbasis, l.doc_date, l.cash_date, first_month, last_day)
    group by 1, 2
  ),$a$;
begin
  def := pg_get_functiondef('public.cash_months(integer,date)'::regprocedure);
  if pg_temp.anchor_count(def, old_profit) <> 1
    or pg_temp.anchor_count(def, E'  basis text;\n') <> 1
    or pg_temp.anchor_count(def, E'  where c.id = cid;\n') <> 1
  then
    raise exception 'cash_months is not the expected definition';
  end if;
  def := replace(def, old_profit, new_profit);
  def := replace(def, E'  basis text;\n', E'  basis text;\n  pbasis text;\n');
  def := replace(def, E'  where c.id = cid;\n', E'  where c.id = cid;\n  pbasis := private.pnl_basis(cid, null);\n');
  execute def;
end;
$cash$;

comment on column public.companies.cash_basis is
  'FLOW-413/FLOW-103: the company''s one date choice. paid (default): the cash view and the P&L count a line by its payment date (the P&L''s cash basis); invoice: by its document date (the P&L''s invoiced basis). P&L reads called without a basis follow it.';

commit;
