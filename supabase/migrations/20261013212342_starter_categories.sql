-- FLOW-406 server 3 (decision 0164): starter categories by field, picked once in setup.
-- 1. private.starter_categories(p_set) returns a set's rows: name, kind, parent name (null for a
--    top-level category) and sort order. The sets are 'rentals' (השכרת נכסים), 'renovation'
--    (שיפוצים ופליפים) and 'general' (כללי, the default seed's own names). packages/shared
--    (categories.ts) mirrors the keys and labels; its test reads this file.
-- 2. public.apply_starter_categories(p_set) lets the owner replace the default seed with a set.
--    It runs only while the company has no lines and every category is still a default one;
--    otherwise it raises starter_locked. The loan-part and kept-out defaults (תשלומי הלוואה,
--    ריבית משכנתא, מסים וביטוח, העברות) stay as they are, since loans and connectors find them;
--    the other defaults are replaced. The set's rows are defaults too, so a second pick in the
--    same setup replaces the first. The app records the pick in its setup state (decision 0163).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function private.starter_categories(p_set text)
returns table (name text, kind public.category_kind, parent_name text, sort_order integer)
language sql
immutable
set search_path = ''
as $$
  select v.name, v.kind::public.category_kind, v.parent_name, v.sort_order
  from (
    values
      -- השכרת נכסים
      ('rentals', 'אחזקה ותיקונים', 'expense', null, 1),
      ('rentals', 'אינסטלציה', 'expense', 'אחזקה ותיקונים', 2),
      ('rentals', 'עבודות חשמל', 'expense', 'אחזקה ותיקונים', 3),
      ('rentals', 'מיזוג וחימום', 'expense', 'אחזקה ותיקונים', 4),
      ('rentals', 'חשבונות', 'expense', null, 5),
      ('rentals', 'חשמל ומים', 'expense', 'חשבונות', 6),
      ('rentals', 'גז', 'expense', 'חשבונות', 7),
      ('rentals', 'אינטרנט', 'expense', 'חשבונות', 8),
      ('rentals', 'ניהול נכס', 'expense', null, 9),
      ('rentals', 'דמי ניהול', 'expense', 'ניהול נכס', 10),
      ('rentals', 'השמת שוכרים', 'expense', 'ניהול נכס', 11),
      ('rentals', 'ביטוח', 'expense', null, 12),
      ('rentals', 'מסי רכוש', 'expense', null, 13),
      ('rentals', 'אחר', 'expense', null, 14),
      ('rentals', 'שכירות', 'income', null, 1),
      ('rentals', 'הכנסה אחרת', 'income', null, 2),
      -- שיפוצים ופליפים
      ('renovation', 'חומרים', 'expense', null, 1),
      ('renovation', 'חומרי בניין', 'expense', 'חומרים', 2),
      ('renovation', 'ריצוף וחיפוי', 'expense', 'חומרים', 3),
      ('renovation', 'מטבח ואמבטיה', 'expense', 'חומרים', 4),
      ('renovation', 'קבלני משנה', 'expense', null, 5),
      ('renovation', 'חשמלאי', 'expense', 'קבלני משנה', 6),
      ('renovation', 'אינסטלטור', 'expense', 'קבלני משנה', 7),
      ('renovation', 'צבעי', 'expense', 'קבלני משנה', 8),
      ('renovation', 'עבודה', 'expense', null, 9),
      ('renovation', 'ציוד והשכרה', 'expense', null, 10),
      ('renovation', 'הובלה', 'expense', null, 11),
      ('renovation', 'היתרים ואגרות', 'expense', null, 12),
      ('renovation', 'ביטוח', 'expense', null, 13),
      ('renovation', 'אחר', 'expense', null, 14),
      ('renovation', 'הכנסה ממכירה', 'income', null, 1),
      ('renovation', 'הכנסה אחרת', 'income', null, 2),
      -- כללי: the default seed's names.
      ('general', 'חומרים', 'expense', null, 1),
      ('general', 'קבלני משנה', 'expense', null, 2),
      ('general', 'עבודה', 'expense', null, 3),
      ('general', 'ציוד והשכרה', 'expense', null, 4),
      ('general', 'הובלה', 'expense', null, 5),
      ('general', 'ביטוח', 'expense', null, 6),
      ('general', 'אחר', 'expense', null, 7),
      ('general', 'הכנסה מלקוחות', 'income', null, 1),
      ('general', 'הכנסה אחרת', 'income', null, 2)
  ) as v(set_key, name, kind, parent_name, sort_order)
  where v.set_key = p_set
  order by v.kind, v.sort_order;
$$;

revoke all on function private.starter_categories(text) from public, anon;
grant execute on function private.starter_categories(text) to authenticated, service_role;

create function public.apply_starter_categories(p_set text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid := private.current_company_id();
  added integer;
begin
  if company is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if private.company_role(company, auth.uid()) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from private.starter_categories(p_set)) then
    raise exception 'unknown_starter_set' using errcode = '22023';
  end if;

  perform 1 from public.companies c where c.id = company for update;

  if exists (select 1 from public.transactions t where t.company_id = company)
    or exists (select 1 from public.categories c where c.company_id = company and not c.is_default)
  then
    raise exception 'starter_locked' using errcode = '55000';
  end if;

  begin
    delete from public.categories c
    where c.company_id = company
      and c.loan_part is null
      and c.parent_id is not null;
    -- A default the owner moved out of the P&L by hand goes too when the set uses its name.
    delete from public.categories c
    where c.company_id = company
      and c.loan_part is null
      and (
        not c.excluded_from_pnl
        or exists (
          select 1 from private.starter_categories(p_set) s where s.kind = c.kind and s.name = c.name
        )
      );
  exception when foreign_key_violation then
    -- Something else already points at a default (a loan, a remembered supplier's split rule):
    -- the books have started, so the seed stays.
    raise exception 'starter_locked' using errcode = '55000';
  end;

  -- The kept defaults go after the set's rows of their kind, in their old order.
  update public.categories c
  set sort_order = s.top + r.n
  from (
    select k.id, row_number() over (partition by k.kind order by k.sort_order, k.name)::integer as n
    from public.categories k
    where k.company_id = company
  ) r, (
    select t.kind, max(t.sort_order) as top
    from private.starter_categories(p_set) t
    group by t.kind
  ) s
  where c.id = r.id and c.kind = s.kind;

  insert into public.categories (company_id, name, kind, sort_order, is_default)
  select company, s.name, s.kind, s.sort_order, true
  from private.starter_categories(p_set) s
  where s.parent_name is null;

  insert into public.categories (company_id, name, kind, sort_order, is_default, parent_id)
  select company, s.name, s.kind, s.sort_order, true, p.id
  from private.starter_categories(p_set) s
  join public.categories p
    on p.company_id = company and p.kind = s.kind and p.name = s.parent_name
  where s.parent_name is not null;

  select count(*) into added from private.starter_categories(p_set);

  return jsonb_build_object('set', p_set, 'categories', added);
end;
$$;

revoke all on function public.apply_starter_categories(text) from public, anon;
grant execute on function public.apply_starter_categories(text) to authenticated, service_role;

commit;
