-- FLOW-1147 (the owner's pick of 2026-11-10, decision 0265): exact sums across months. A payment, or one part
-- of a split payment, may refund up to 3 bills of one property, currency and category dated within 62 days of
-- each other, not only of one month, when they add up to it exactly. And the bills the owner matched to a line
-- count toward it: what is left of the line (or of its part in their category) can refund the other bills, so
-- a payment that covers last month's bills and this month's is read whole. Still exact matches only. The body
-- is patched in place: each anchor must be found as many times as expected, or the migration fails.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

do $months$
declare
  def text;
  fn text := 'private.utility_refund_rows(uuid,date,uuid)';
  pair_anchor text := $a$        and b2.month = b1.month and b2.ord > b1.ord
$a$;
  triple_anchor text := $a$        and b3.month = b1.month and b3.ord > b2.ord
$a$;
  pays_anchor text := $a$    pays as materialized (
      -- The owner's note of 2026-11-10: a split line is matched by its parts (a rent payment with the water
      -- bill split off it), each part by its own amount, category and project; an unsplit line by its whole.
      select l.id, l.currency, l.project_id, l.category_id, l.doc_date, l.amount,
        (row_number() over ())::integer as pord
      from (
        select p.id, p.currency, p.project_id, p.category_id, p.doc_date, p.amount_original as amount
        from public.transactions p
        where p.company_id = p_company
          and p.direction = 'income'
          and p.removed_at is null
          and p.line_status = 'posted'
          and p.amount_original > 0
          and p.project_id is not null
          and p.category_id is not null
          and p.doc_date <= p_today
          and p.doc_date >= (select min(b.doc_date) from b) - 31
          and p.project_id in (select b.project_id from b)
          and not (p.id = any (owner_paid))
          and not exists (select 1 from private.split_parts x where x.transaction_id = p.id and not x.draft)
        union all
        select p.id, p.currency, coalesce(sp.project_id, p.project_id), sp.category_id, p.doc_date, sp.amount_minor
        from public.transactions p
        join private.split_parts sp on sp.transaction_id = p.id and sp.company_id = p_company and not sp.draft
        where p.company_id = p_company
          and p.direction = 'income'
          and p.removed_at is null
          and p.line_status = 'posted'
          and p.amount_original > 0
          and sp.amount_minor > 0
          and sp.category_id is not null
          and coalesce(sp.project_id, p.project_id) is not null
          and p.doc_date <= p_today
          and p.doc_date >= (select min(b.doc_date) from b) - 31
          and coalesce(sp.project_id, p.project_id) in (select b.project_id from b)
          and not (p.id = any (owner_paid))
      ) l
    )
$a$;
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, pair_anchor) <> 2 or pg_temp.anchor_count(def, triple_anchor) <> 1
    or pg_temp.anchor_count(def, pays_anchor) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  -- The pairs and triples: the bills of one property, currency and category within 62 days, not one month.
  def := replace(def, pair_anchor, $n$        and b2.doc_date <= b1.doc_date + 62 and b2.ord > b1.ord
$n$);
  def := replace(def, triple_anchor, $n$        and b3.doc_date <= b1.doc_date + 62 and b3.ord > b2.ord
$n$);
  def := replace(def, pays_anchor, $n$    -- FLOW-1147: the bills the owner matched to a line count toward it. Each candidate's amount is what is left
    -- of it after them (a part: the matched bills of its category), so the rest can refund the other bills.
    om as materialized (
      select closed_pay[u.ord] as pay_id, u.category_id, sum(u.amount)::bigint as amount
      from unnest(bills) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
      where closed[u.ord] = 'matched' and closed_pay[u.ord] is not null
      group by 1, 2
    ),
    pays as materialized (
      -- The owner's note of 2026-11-10: a split line is matched by its parts (a rent payment with the water
      -- bill split off it), each part by its own amount, category and project; an unsplit line by its whole.
      select l.id, l.currency, l.project_id, l.category_id, l.doc_date, l.amount,
        (row_number() over ())::integer as pord
      from (
        select p.id, p.currency, p.project_id, p.category_id, p.doc_date,
          p.amount_original - coalesce((select sum(m.amount) from om m where m.pay_id = p.id), 0) as amount
        from public.transactions p
        where p.company_id = p_company
          and p.direction = 'income'
          and p.removed_at is null
          and p.line_status = 'posted'
          and p.amount_original > 0
          and p.project_id is not null
          and p.category_id is not null
          and p.doc_date <= p_today
          and p.doc_date >= (select min(b.doc_date) from b) - 31
          and p.project_id in (select b.project_id from b)
          and not exists (select 1 from private.split_parts x where x.transaction_id = p.id and not x.draft)
        union all
        select p.id, p.currency, coalesce(sp.project_id, p.project_id), sp.category_id, p.doc_date,
          sp.amount_minor - coalesce((
            select sum(m.amount) from om m where m.pay_id = p.id and m.category_id = sp.category_id
          ), 0)
        from public.transactions p
        join private.split_parts sp on sp.transaction_id = p.id and sp.company_id = p_company and not sp.draft
        where p.company_id = p_company
          and p.direction = 'income'
          and p.removed_at is null
          and p.line_status = 'posted'
          and p.amount_original > 0
          and sp.amount_minor > 0
          and sp.category_id is not null
          and coalesce(sp.project_id, p.project_id) is not null
          and p.doc_date <= p_today
          and p.doc_date >= (select min(b.doc_date) from b) - 31
          and coalesce(sp.project_id, p.project_id) in (select b.project_id from b)
      ) l
      where l.amount > 0
    )
$n$);
  execute def;
end;
$months$;

drop function pg_temp.anchor_count(text, text);

commit;
