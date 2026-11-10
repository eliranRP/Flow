-- FLOW-1146 (the owner's note of 2026-11-10, decision 0265): a split payment counts by its parts. A property's
-- rent came in as one line, split in the books into the rent and the water bill the tenant paid with it; the
-- water bill stayed "not refunded" because the matching read only a line's whole amount and category. Now a
-- line with parts meets the bills by each part (its amount, its category, its project or the line's), and an
-- unsplit line by its whole, as before: still exact matches only. list_utility_months' rent lines carry their
-- parts, and a split line with a rent part counts as rent. The bodies are patched in place: each anchor must be
-- found exactly once, or the migration fails. The signatures and grants stay.
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

do $parts$
declare
  def text;
  fn text := 'private.utility_refund_rows(uuid,date,uuid)';
  pays_anchor text := $a$    pays as materialized (
      select p.id, p.currency, p.project_id, p.category_id, p.doc_date, p.amount_original as amount,
        (row_number() over ())::integer as pord
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
    )
$a$;
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, pays_anchor) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, pays_anchor, $n$    pays as materialized (
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
$n$);
  execute def;
end;
$parts$;

do $months$
declare
  def text;
  fn text := 'public.list_utility_months(uuid,date)';
  rent_anchor text := $a$        and t.category_id = any (rent)
$a$;
  line_anchor text := $a$              'party', r.party, 'category_name', r.category_name
$a$;
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, rent_anchor) <> 1 or pg_temp.anchor_count(def, line_anchor) <> 1 then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, rent_anchor, $n$        -- A split line counts when its own category or one of its parts is under the rent root.
        and (t.category_id = any (rent) or exists (
          select 1 from private.split_parts x
          where x.transaction_id = t.id and not x.draft and x.category_id = any (rent)
        ))
$n$);
  def := replace(def, line_anchor, $n$              'party', r.party, 'category_name', r.category_name,
              -- The owner's note of 2026-11-10: a split line's parts, so the sheet shows the rent and the bill
              -- the tenant paid with it.
              'parts', coalesce((
                select jsonb_agg(jsonb_build_object('category_name', pc.name, 'amount_minor', sp.amount_minor)
                  order by sp.ordinal)
                from private.split_parts sp
                left join public.categories pc on pc.id = sp.category_id and pc.company_id = cid
                where sp.transaction_id = r.id and sp.company_id = cid and not sp.draft
              ), '[]'::jsonb)
$n$);
  execute def;
end;
$months$;

drop function pg_temp.anchor_count(text, text);

commit;
