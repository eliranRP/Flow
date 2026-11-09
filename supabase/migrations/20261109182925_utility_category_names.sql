-- FLOW-1141 (decision 0265, amended): the utility refunds find the rent and the bills' categories by part
-- of the name. FLOW-1134 looked the roots up by exact name (שכירות for income, חשבונות for the bills'
-- tree), so a chart that names them "הכנסות שכירות" or "12 חשבונות שוטפים" found no rent (every month read
-- no rent, rule 3 never matched) and no bills' tree. A root is now every category of the kind whose name
-- starts with p_root as a whole word, after an optional number and an optional הכנסות or הוצאות: "שכירות",
-- "הכנסות שכירות", "חשבונות" and "12 חשבונות שוטפים" are roots; "ביטול שכירות", "הכנסה משכירות מחסן" and
-- "שירותי הנהלת חשבונות" are not (the review of #1105). Every category under a root is taken with it, as
-- before. The signature, and so the callers and the revoke, stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

create or replace function private.utility_category_ids(p_company uuid, p_root text, p_kind public.category_kind)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  with recursive tree (id, depth) as (
    select c.id, 0 from public.categories c
    where c.company_id = p_company and c.kind = p_kind
      and c.name ~ ('^\s*(\d+\s+)?((הכנסות|הוצאות)\s+)?' || p_root || '(\s|$)')
    union
    select c.id, t.depth + 1 from public.categories c
    join tree t on c.parent_id = t.id
    where c.company_id = p_company and t.depth < 10
  )
  select coalesce(array_agg(distinct tree.id), '{}') from tree;
$$;

revoke all on function private.utility_category_ids(uuid, text, public.category_kind) from public, anon, authenticated;

commit;
