-- FLOW-417 (decision 0172): Home shows what profit leaves out of the month's cash.
--
-- - private.cash_parts gains in_pnl, each part's place in the P&L (private.pnl_lines' own flag),
--   so a read can tell the cash that profit counts from the cash it leaves out (renovation kept
--   out of profit, owner's capital, loan principal).
-- - cash_months: each month and currency also carries not_in_profit_minor, the month's cash net
--   minus its profit, so "רווח החודש" and "לא נספר ברווח" add up to the month's figure, and
--   not_in_profit_categories, the cash in the view that the P&L leaves out, by category, signed
--   like net (money in positive), largest first. What the categories don't cover (VAT, a line
--   out of the view but in profit) is the difference between the two.
-- - cash_month_lines takes p_side 'not_in_profit': the month's lines in the view that the P&L
--   leaves out, amount positive on the row's side, as 'excluded' shows them.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (length(p_def) - length(replace(p_def, p_anchor, ''))) / nullif(length(p_anchor), 0);
$$;

-- The return table gains a column, so the function is dropped and made again. Only cash_months
-- and cash_month_lines call it, by name, at run time.
drop function private.cash_parts(uuid, text, date, date);

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
  in_cash boolean,
  in_pnl boolean
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
      l.in_pnl,
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
    x.in_cash,
    x.in_pnl
  from lines x;
$$;

revoke all on function private.cash_parts(uuid, text, date, date) from public, anon, authenticated;

do $months$
declare
  def text;
  cte_anchor text := E'  months as (\n    select m::date as month\n';
  json_anchor text := E'            ''excluded_out_minor'', coalesce(c.excluded_out_minor, 0)\n';
  kept_cte text := $a$  -- FLOW-417: the cash in the view that the P&L leaves out, by category.
  kept as (
    select
      date_trunc('month', p.month_date)::date as month,
      p.currency,
      coalesce(cat.name, '') as name,
      sum(p.amount_minor)::bigint as amount_minor
    from parts p
    left join public.categories cat on cat.id = p.category_id
    where p.in_cash and not p.in_pnl
    group by 1, 2, 3
  ),
$a$;
  kept_json text := $a$            'excluded_out_minor', coalesce(c.excluded_out_minor, 0),
            'not_in_profit_minor', coalesce(c.in_minor, 0) - coalesce(c.out_minor, 0) - coalesce(p.profit_minor, 0),
            'not_in_profit_categories', coalesce((
              select jsonb_agg(jsonb_build_object('name', kp.name, 'amount_minor', kp.amount_minor)
                order by abs(kp.amount_minor) desc, kp.name)
              from kept kp
              where kp.month = k.month and kp.currency = k.currency and kp.amount_minor <> 0
            ), '[]'::jsonb)
$a$;
begin
  def := pg_get_functiondef('public.cash_months(integer,date)'::regprocedure);
  if pg_temp.anchor_count(def, cte_anchor) <> 1 or pg_temp.anchor_count(def, json_anchor) <> 1 then
    raise exception 'cash_months is not the expected definition';
  end if;
  def := replace(def, cte_anchor, kept_cte || cte_anchor);
  def := replace(def, json_anchor, kept_json);
  execute def;
end;
$months$;

do $lines$
declare
  def text;
  check_anchor text := $a$p_side not in ('in', 'out', 'excluded')$a$;
  filter_anchor text := $a$(p_side = 'excluded' and not p.in_cash)$a$;
begin
  def := pg_get_functiondef('public.cash_month_lines(date,text,text,integer,integer)'::regprocedure);
  if pg_temp.anchor_count(def, check_anchor) <> 1 or pg_temp.anchor_count(def, filter_anchor) <> 1 then
    raise exception 'cash_month_lines is not the expected definition';
  end if;
  def := replace(def, check_anchor, $a$p_side not in ('in', 'out', 'excluded', 'not_in_profit')$a$);
  def := replace(def, filter_anchor, $a$(p_side = 'excluded' and not p.in_cash)
        or (p_side = 'not_in_profit' and p.in_cash and not p.in_pnl)$a$);
  execute def;
end;
$lines$;

commit;
