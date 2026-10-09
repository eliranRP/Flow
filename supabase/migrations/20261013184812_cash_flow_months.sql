-- FLOW-413 + FLOW-103, server PR 1: the monthly cash view (תזרים חודשי). Decision 0168.
--
-- Cash is every posted line's money in and out, by its parts, separate from the P&L:
-- - categories.in_cash (default true) and transactions.in_cash_override (null follows the
--   category) take a category or a line out of the view. They are separate from the P&L flags,
--   so loan principal, out of profit, is still money out.
-- - companies.cash_basis picks the month: 'paid' (the default) by the payment date, 'invoice'
--   by the document date, open invoices included.
-- - Amounts are gross (what moved in the bank), not net of VAT like the P&L.
-- - Transfers between the company's own accounts, credit card bill payments and money received
--   from a loan are out of the view by default.

begin;

set local lock_timeout = '5s';

alter table public.categories
  add column in_cash boolean not null default true;

comment on column public.categories.in_cash is
  'FLOW-413. False takes the category''s lines out of the cash view (תזרים). Separate from excluded_from_pnl. Decision 0168.';

alter table public.transactions
  add column in_cash_override boolean;

comment on column public.transactions.in_cash_override is
  'FLOW-413. Null follows the category''s in_cash; false takes the whole line out of the cash view, true keeps it in. Decision 0168.';

alter table public.companies
  add column cash_basis text not null default 'paid'
    constraint companies_cash_basis check (cash_basis in ('paid', 'invoice'));

comment on column public.companies.cash_basis is
  'FLOW-103. The cash view''s month: paid (the payment date) or invoice (the document date, open invoices included). Decision 0168.';

-- The categories that are out of cash by default, by name, like private.non_pnl_category.
create or replace function private.non_cash_category(p_kind public.category_kind, p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select exists (
    select 1
    from (
      values
        ('income', 'העברות'),
        ('income', 'internal transfers in'),
        ('income', 'loan proceeds'),
        ('income', 'כסף שהתקבל מהלוואות'),
        ('expense', 'העברות'),
        ('expense', 'internal transfers out'),
        ('expense', 'credit card payments')
    ) as d(kind, name)
    where d.kind = p_kind::text
      and private.pnl_name_key(d.name) = private.pnl_name_key(p_name)
  );
$$;

-- Money received from a loan is out of the P&L too, in Hebrew as in English.
create or replace function private.non_pnl_category(p_kind public.category_kind, p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select exists (
    select 1
    from (
      values
        ('income', 'loan proceeds'),
        ('income', 'כסף שהתקבל מהלוואות'),
        ('income', 'owner contributions'),
        ('income', 'security deposits received'),
        ('income', 'internal transfers in'),
        ('expense', 'loan principal'),
        ('expense', 'property purchase price'),
        ('expense', 'purchase deposits (earnest money)'),
        ('expense', 'purchase deposits'),
        ('expense', 'closing & acquisition costs'),
        ('expense', 'capex & rehab'),
        ('expense', 'furniture & fixtures'),
        ('expense', 'owner distributions'),
        ('expense', 'security deposits returned'),
        ('expense', 'credit card payments'),
        ('expense', 'internal transfers out'),
        ('expense', 'utility deposits')
    ) as d(kind, name)
    where d.kind = p_kind::text
      and private.pnl_name_key(d.name) = private.pnl_name_key(p_name)
  );
$$;

-- A new category with a non-cash name starts out of cash. A loan part's category stays in:
-- the whole loan payment is money out. A rename keeps the flag, as every rename path keeps
-- the P&L flag. A category restored from a snapshot taken before this column existed comes
-- back in cash (category_restore then puts back a snapshot's own setting).
create or replace function private.categories_default_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.in_cash := coalesce(new.in_cash, true);
  if new.loan_part is null and private.non_cash_category(new.kind, new.name) then
    new.in_cash := false;
  end if;
  return new;
end;
$$;

create trigger categories_default_cash
  before insert on public.categories
  for each row execute function private.categories_default_cash();

-- Every company gets an income category for money received from a loan, out of the P&L and
-- out of cash. Runs after companies_seed_categories (trigger names fire in order).
create or replace function private.seed_loan_money_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl, in_cash)
  select new.id, 'כסף שהתקבל מהלוואות', 'income',
    coalesce((select max(c.sort_order) + 1 from public.categories c where c.company_id = new.id and c.kind = 'income'), 1),
    true, true, false
  where not exists (
    select 1 from public.categories c
    where c.company_id = new.id
      and c.kind = 'income'
      and private.pnl_name_key(c.name) in (
        private.pnl_name_key('כסף שהתקבל מהלוואות'), private.pnl_name_key('loan proceeds')
      )
  );
  return new;
end;
$$;

create trigger companies_seed_categories_loan_money
  after insert on public.companies
  for each row execute function private.seed_loan_money_category();

revoke all on function private.non_cash_category(public.category_kind, text) from public, anon, authenticated;
revoke all on function private.categories_default_cash() from public, anon, authenticated;
revoke all on function private.seed_loan_money_category() from public, anon, authenticated;

-- Existing companies: the loan money category, and the transfer categories out of cash.
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl, in_cash)
select co.id, 'כסף שהתקבל מהלוואות', 'income',
  coalesce((select max(c.sort_order) + 1 from public.categories c where c.company_id = co.id and c.kind = 'income'), 1),
  true, true, false
from public.companies co
where not exists (
  select 1 from public.categories c
  where c.company_id = co.id
    and c.kind = 'income'
    and private.pnl_name_key(c.name) in (
      private.pnl_name_key('כסף שהתקבל מהלוואות'), private.pnl_name_key('loan proceeds')
    )
);

update public.categories c
set in_cash = false
where c.loan_part is null
  and c.in_cash
  and private.non_cash_category(c.kind, c.name);

-- The cash view's parts: private.pnl_lines' parts (loan split, line split, or the whole line,
-- each counted once), with
-- - month_date: the payment date on 'paid' (a line with none is cash on its document date,
--   except an open invoice or credit note, which is not cash yet); the document date on 'invoice';
-- - amount_minor: gross, signed like amount_net (income positive, expense negative). A line
--   split's parts share the VAT in proportion, rounded so they add up to the line's gross;
-- - in_cash: the line's override, else its category's flag (a guessed category does not take a
--   whole line out, as in the P&L).
-- Income lines follow the P&L's document rule, so an invoice and its receipt never both count.
create or replace function private.cash_parts(p_company uuid, p_basis text, p_from date, p_to date)
returns table (
  transaction_id uuid,
  part public.loan_split_part,
  currency text,
  kind text,
  category_id uuid,
  project_id uuid,
  pnl_role public.pnl_role,
  month_date date,
  amount_minor bigint,
  in_cash boolean
)
language sql
stable
set search_path = ''
as $$
  with dated as (
    select
      l.*,
      case
        when p_basis = 'invoice' then l.doc_date
        when l.cash_date is not null then l.cash_date
        when l.doc_kind in ('invoice', 'credit') then null
        else l.doc_date
      end as month_date
    from private.pnl_lines l
    where l.company_id = p_company
      and (
        l.kind = 'expense'
        or l.direction = 'expense'
        or (p_basis = 'paid' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (p_basis = 'invoice' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  -- The month depends on the line alone, so a line's parts are all in the range or all out.
  lines as (
    select
      l.transaction_id,
      l.part,
      l.currency,
      l.kind,
      l.category_id,
      l.project_id,
      l.pnl_role,
      l.amount_net,
      l.line_amount_net,
      t.amount_gross as line_gross,
      l.month_date,
      count(*) over (partition by l.transaction_id) as parts,
      coalesce(
        t.in_cash_override,
        not private.line_category_out(
          c.in_cash is false,
          t.category_suggested and l.category_id is not distinct from t.category_id,
          l.part
        )
      ) as in_cash,
      sum(l.amount_net) over (
        partition by l.transaction_id
        order by l.part nulls last, l.category_id, l.project_id, l.amount_net
        rows between unbounded preceding and current row
      ) as cum_net
    from dated l
    join public.transactions t on t.id = l.transaction_id
    left join public.categories c on c.id = l.category_id
    where l.month_date between p_from and p_to
  )
  select
    x.transaction_id,
    x.part,
    x.currency,
    x.kind,
    x.category_id,
    x.project_id,
    x.pnl_role,
    x.month_date,
    case
      -- A VAT-only document (net 0) is its gross.
      when x.line_amount_net = 0 then case when x.parts = 1 then x.line_gross else x.amount_net end
      when x.line_gross = x.line_amount_net then x.amount_net
      else private.div_half_even(x.cum_net * x.line_gross, x.line_amount_net)
        - private.div_half_even((x.cum_net - x.amount_net) * x.line_gross, x.line_amount_net)
    end::bigint,
    x.in_cash
  from lines x;
$$;

revoke all on function private.cash_parts(uuid, text, date, date) from public, anon, authenticated;

-- The months of the cash view, newest first, the current month included. Each month has one
-- row per currency (the base currency first, always present): נכנס (in_minor), יצא (out_minor),
-- net_minor, the month's profit on the P&L's invoiced basis (profit_minor, equal to
-- company_pnl's net_profit_minor), and what the view leaves out (excluded_*).
create or replace function public.cash_months(p_months integer default 6, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  this_month date;
  first_month date;
  last_day date;
  basis text;
  base text;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'validation';
  end if;
  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;

  this_month := date_trunc('month', today)::date;
  first_month := (this_month - make_interval(months => p_months - 1))::date;
  last_day := (this_month + interval '1 month' - interval '1 day')::date;

  with parts as (
    select * from private.cash_parts(cid, basis, first_month, last_day)
  ),
  cash as (
    select
      date_trunc('month', p.month_date)::date as month,
      p.currency,
      coalesce(sum(p.amount_minor) filter (where p.in_cash and p.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-p.amount_minor) filter (where p.in_cash and p.kind = 'expense'), 0)::bigint as out_minor,
      (count(distinct p.transaction_id) filter (where not p.in_cash))::integer as excluded_count,
      coalesce(sum(p.amount_minor) filter (where not p.in_cash and p.kind = 'income'), 0)::bigint as excluded_in_minor,
      coalesce(sum(-p.amount_minor) filter (where not p.in_cash and p.kind = 'expense'), 0)::bigint as excluded_out_minor
    from parts p
    group by 1, 2
  ),
  -- company_pnl's net profit on the invoiced basis, one month at a time.
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
  ),
  months as (
    select m::date as month
    from generate_series(this_month, first_month, interval '-1 month') m
  ),
  keys as (
    select m.month, base as currency from months m
    union
    select c.month, c.currency from cash c
    union
    select p.month, p.currency from profit p
  )
  select jsonb_build_object(
    'basis', basis,
    'base_currency', base,
    'months', (
      select jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM-DD'),
        'by_currency', (
          select jsonb_agg(jsonb_build_object(
            'currency', k.currency,
            'in_minor', coalesce(c.in_minor, 0),
            'out_minor', coalesce(c.out_minor, 0),
            'net_minor', coalesce(c.in_minor, 0) - coalesce(c.out_minor, 0),
            'profit_minor', coalesce(p.profit_minor, 0),
            'excluded_count', coalesce(c.excluded_count, 0),
            'excluded_in_minor', coalesce(c.excluded_in_minor, 0),
            'excluded_out_minor', coalesce(c.excluded_out_minor, 0)
          ) order by k.currency is distinct from base, k.currency)
          from keys k
          left join cash c on c.month = k.month and c.currency = k.currency
          left join profit p on p.month = k.month and p.currency = k.currency
          where k.month = m.month
        )
      ) order by m.month desc)
      from months m
    )
  ) into result;

  return result;
end;
$$;

-- The lines behind one month's נכנס ('in'), יצא ('out') or what the view leaves out
-- ('excluded'), newest first, in get_breakdown_lines' row shape. A line split's parts on the
-- same side show as one row; a loan payment shows a row per part (principal, interest,
-- escrow). amount_minor is positive money in on 'in', positive money out on 'out', and on
-- 'excluded' positive on the row's side ('in' or 'out').
create or replace function public.cash_month_lines(
  p_month date,
  p_side text,
  p_currency text default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  base text;
  month_start date;
  lim integer;
  off integer;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_month is null or p_side is null or p_side not in ('in', 'out', 'excluded') then
    raise exception 'validation';
  end if;
  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', p_month)::date;
  lim := least(greatest(coalesce(p_limit, 40), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);

  with r as (
    select
      p.*,
      case when p.kind = 'income' then 'in' else 'out' end as side,
      case when p.kind = 'income' then p.amount_minor else -p.amount_minor end as side_minor
    from private.cash_parts(cid, basis, month_start, (month_start + interval '1 month' - interval '1 day')::date) p
    where p.currency = coalesce(p_currency, base)
      and (
        (p_side = 'excluded' and not p.in_cash)
        or (p_side = 'in' and p.in_cash and p.kind = 'income')
        or (p_side = 'out' and p.in_cash and p.kind = 'expense')
      )
  ),
  merged as (
    select
      r.transaction_id,
      r.part,
      r.side,
      max(r.month_date) as month_date,
      sum(r.side_minor)::bigint as amount_minor,
      case when count(distinct r.category_id) = 1 and count(r.category_id) = count(*) then min(r.category_id::text)::uuid end as category_id,
      case when count(distinct r.project_id) = 1 and count(r.project_id) = count(*) then min(r.project_id::text)::uuid end as project_id
    from r
    group by r.transaction_id, r.part, r.side
  ),
  page as (
    select
      m.*,
      t.description,
      t.source,
      t.doc_date,
      sup.name as supplier_name,
      pr.name as project_name,
      c.name as category_name,
      row_number() over (order by m.month_date desc, m.transaction_id, m.part, m.side) as n
    from merged m
    join public.transactions t on t.id = m.transaction_id
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.projects pr on pr.id = m.project_id
    left join public.categories c on c.id = m.category_id
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', pg.transaction_id,
        'part', pg.part,
        'description', pg.description,
        'supplier_name', pg.supplier_name,
        'project_name', pg.project_name,
        'category_name', pg.category_name,
        'doc_date', pg.doc_date,
        'cash_month_date', pg.month_date,
        'currency', coalesce(p_currency, base),
        'amount_minor', pg.amount_minor,
        'side', pg.side,
        'shared', false,
        'source', pg.source,
        'kept_out', p_side = 'excluded'
      ) order by pg.n)
      from page pg
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim)
  ) into result;

  return result;
end;
$$;

-- A line's place in the cash view: its override, else in, out or mixed over its parts'
-- categories (a line split by category can be both). It is the line's switch, not a promise
-- the line shows this month: an income invoice is never cash on the paid basis.
create or replace function private.line_cash_state(p_transaction_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.in_cash_override is not null then case when t.in_cash_override then 'in' else 'out' end
    else coalesce(
      (
        select case
          when bool_and(x.in_cash) then 'in'
          when not bool_or(x.in_cash) then 'out'
          else 'mixed'
        end
        from (
          select not private.line_category_out(
            pc.in_cash is false,
            t.category_suggested and pl.category_id is not distinct from t.category_id,
            pl.part
          ) as in_cash
          from private.pnl_lines pl
          left join public.categories pc on pc.id = pl.category_id
          where pl.transaction_id = t.id
        ) x
        having count(*) > 0
      ),
      -- A pending line, which pnl_lines does not hold yet: its own category.
      case when private.line_category_out(c.in_cash is false, t.category_suggested, c.loan_part) then 'out' else 'in' end
    )
  end
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.id = p_transaction_id
    and (auth.role() = 'service_role' or t.company_id = private.readable_company_id());
$$;

revoke all on function private.line_cash_state(uuid) from public, anon, authenticated;
grant execute on function private.line_cash_state(uuid) to authenticated, service_role;

-- The owner's switches. Each returns the prior value, so the app's ביטול puts it back.
create or replace function public.set_category_cash(p_category_id uuid, p_in_cash boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior boolean;
begin
  -- An owner or an editor writes (decision 0167); a viewer member or the demo viewer is refused.
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_in_cash is null then
    raise exception 'validation';
  end if;
  select c.in_cash into prior
  from public.categories c
  where c.id = p_category_id and c.company_id = cid
  for update;
  if not found then
    raise exception 'category not found';
  end if;
  update public.categories
  set in_cash = p_in_cash
  where id = p_category_id and company_id = cid;
  return jsonb_build_object('id', p_category_id, 'in_cash', p_in_cash, 'prior_in_cash', prior);
end;
$$;

create or replace function public.set_transaction_cash(p_id uuid, p_in_cash boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior boolean;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select t.in_cash_override into prior
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  -- A loan payment can leave the view too: the P&L lock on loan lines is not the cash flag's.
  update public.transactions
  set in_cash_override = p_in_cash
  where id = p_id and company_id = cid;
  return jsonb_build_object(
    'id', p_id,
    'in_cash_override', p_in_cash,
    'prior_in_cash_override', prior,
    'cash_state', private.line_cash_state(p_id)
  );
end;
$$;

create or replace function public.set_cash_basis(p_basis text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior text;
begin
  -- A company setting, like the currency: the owner's only. An editor or a viewer is refused.
  cid := private.owner_company_id();
  if cid is null then
    if private.readable_company_id() is not null then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_basis is null or p_basis not in ('paid', 'invoice') then
    raise exception 'validation';
  end if;
  select c.cash_basis into prior
  from public.companies c
  where c.id = cid
  for update;
  update public.companies
  set cash_basis = p_basis
  where id = cid;
  return jsonb_build_object('basis', p_basis, 'prior_basis', prior);
end;
$$;

revoke all on function public.cash_months(integer, date) from public, anon;
revoke all on function public.cash_month_lines(date, text, text, integer, integer) from public, anon;
revoke all on function public.set_category_cash(uuid, boolean) from public, anon;
revoke all on function public.set_transaction_cash(uuid, boolean) from public, anon;
revoke all on function public.set_cash_basis(text) from public, anon;
grant execute on function public.cash_months(integer, date) to authenticated, service_role;
grant execute on function public.cash_month_lines(date, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.set_category_cash(uuid, boolean) to authenticated, service_role;
grant execute on function public.set_transaction_cash(uuid, boolean) to authenticated, service_role;
grant execute on function public.set_cash_basis(text) to authenticated, service_role;

-- The reads the switches need: list_categories returns in_cash, get_transaction the line's
-- override and cash_state; category_restore puts back in_cash.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.list_categories()'::regprocedure);
  anchor := $a$    'excluded_from_pnl', c.excluded_from_pnl,
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$    'in_cash', c.in_cash,
$n$);

  def := pg_get_functiondef('public.get_transaction(uuid)'::regprocedure);
  anchor := $a$    'pnl_state', private.line_pnl_state(t.id),
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_transaction is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$    'in_cash_override', t.in_cash_override,
    'cash_state', private.line_cash_state(t.id),
$n$);

  -- Undo of a delete puts back the owner's cash setting with the P&L one.
  def := pg_get_functiondef('private.category_restore(uuid, uuid)'::regprocedure);
  anchor := $a$  set excluded_from_pnl = (d.snapshot->'category'->>'excluded_from_pnl')::boolean
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'category_restore is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$    , in_cash = coalesce((d.snapshot->'category'->>'in_cash')::boolean, in_cash)
$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
