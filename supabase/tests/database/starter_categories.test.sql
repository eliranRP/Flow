-- FLOW-406 server 3 (decision 0164): starter categories and apply_starter_categories.
-- Invented data only.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('sc_owner', 'sc-owner@example.com');
  perform tests.create_supabase_user('sc_other', 'sc-other@example.com');
  perform tests.create_supabase_user('sc_editor', 'sc-editor@example.com');
  perform tests.create_supabase_user('sc_viewer', 'sc-viewer@example.com');
end
$users$;

create temp table sc (label text primary key, id uuid);
grant all on sc to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from sc where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Every category of a company as "kind:name>parent" (parent empty for a top-level one), in order.
create function pg_temp.shape(p_company uuid) returns text[] language sql stable security definer as $$
  select array_agg(c.kind || ':' || c.name || '>' || coalesce(p.name, '') order by c.kind, c.sort_order, c.name)
  from public.categories c
  left join public.categories p on p.id = c.parent_id
  where c.company_id = p_company;
$$;
grant execute on function pg_temp.shape(uuid) to authenticated, service_role;

create function pg_temp.category_id(p_company uuid, p_kind text, p_name text) returns uuid
language sql stable security definer as $$
  select c.id from public.categories c
  where c.company_id = p_company and c.kind::text = p_kind and c.name = p_name;
$$;
grant execute on function pg_temp.category_id(uuid, text, text) to authenticated, service_role;

select tests.authenticate_as('sc_other');
do $o$ begin perform public.create_company('Other Starter', true); end $o$;
insert into sc (label, id) select 'other', id from public.companies where name = 'Other Starter';

select tests.authenticate_as('sc_owner');
do $c$ begin perform public.create_company('Starter Books', true); end $c$;
insert into sc (label, id) select 'co', id from public.companies where name = 'Starter Books';
insert into sc (label, id) values
  ('interest', pg_temp.category_id(pg_temp.id('co'), 'expense', 'ריבית משכנתא')),
  ('transfers_in', pg_temp.category_id(pg_temp.id('co'), 'income', 'העברות'));

-- The sets (read as the test runner; the browser roles reach them only through apply).
reset role;
select is(
  (select count(*)::int from private.starter_categories('nope')),
  0,
  'an unknown set has no rows'
);
select is(
  (select count(*)::int from private.starter_categories('general') g
   where g.parent_name is not null),
  0,
  'the general set is flat'
);
select is(
  (select count(*)::int from (values ('rentals'), ('renovation')) s(k)
   cross join lateral private.starter_categories(s.k) c
   left join lateral (
     select true as found, p.parent_name from private.starter_categories(s.k) p
     where p.name = c.parent_name and p.kind = c.kind
   ) p on true
   where c.parent_name is not null and (p.found is null or p.parent_name is not null)),
  0,
  'each sub-category names a top-level parent of its kind in the same set'
);
select is(
  (select count(*)::int from (
     select s.k, c.kind, c.name from (values ('rentals'), ('renovation'), ('general')) s(k),
       private.starter_categories(s.k) c
     group by 1, 2, 3 having count(*) > 1) d),
  0,
  'no set repeats a name within a kind'
);
select is(
  (select count(*)::int from (values ('rentals'), ('renovation'), ('general')) s(k),
     private.starter_categories(s.k) c
   where c.name in ('תשלומי הלוואה', 'ריבית משכנתא', 'מסים וביטוח', 'העברות')
     or private.non_pnl_category(c.kind, c.name)),
  0,
  'no set names a kept default or a kept-out name'
);

-- Refusals.
select tests.authenticate_as('sc_owner');
select throws_ok(
  $$ select public.apply_starter_categories('nope') $$,
  '22023', 'unknown_starter_set',
  'an unknown set is refused'
);

-- Apply rentals.
select is(
  public.apply_starter_categories('rentals'),
  jsonb_build_object('set', 'rentals', 'categories', 16),
  'apply returns the set and its row count'
);
select is(
  pg_temp.shape(pg_temp.id('co')),
  array[
    'expense:אחזקה ותיקונים>', 'expense:אינסטלציה>אחזקה ותיקונים', 'expense:עבודות חשמל>אחזקה ותיקונים',
    'expense:מיזוג וחימום>אחזקה ותיקונים', 'expense:חשבונות>', 'expense:חשמל ומים>חשבונות',
    'expense:גז>חשבונות', 'expense:אינטרנט>חשבונות', 'expense:ניהול נכס>', 'expense:דמי ניהול>ניהול נכס',
    'expense:השמת שוכרים>ניהול נכס', 'expense:ביטוח>', 'expense:מסי רכוש>', 'expense:אחר>',
    'expense:תשלומי הלוואה>', 'expense:העברות>', 'expense:ריבית משכנתא>', 'expense:מסים וביטוח>',
    'income:שכירות>', 'income:הכנסה אחרת>', 'income:העברות>', 'income:כסף שהתקבל מהלוואות>'
  ],
  'the set replaces the seed, with sub-categories under their parents and the kept defaults after'
);
select is(
  pg_temp.category_id(pg_temp.id('co'), 'expense', 'ריבית משכנתא'),
  pg_temp.id('interest'),
  'a loan-part default keeps its id'
);
select is(
  pg_temp.category_id(pg_temp.id('co'), 'income', 'העברות'),
  pg_temp.id('transfers_in'),
  'a kept-out default keeps its id'
);
select is(
  (select count(*)::int from public.categories c
   where c.company_id = pg_temp.id('co') and not c.is_default),
  0,
  'the set''s rows are defaults'
);
select is(
  (select c.group_name from public.categories c
   where c.id = pg_temp.category_id(pg_temp.id('co'), 'expense', 'גז')),
  'חשבונות',
  'group_name follows the parent'
);
select is(
  (select c.excluded_from_pnl from public.categories c
   where c.id = pg_temp.category_id(pg_temp.id('co'), 'expense', 'ריבית משכנתא')),
  false,
  'the kept defaults keep their flags'
);
select is(
  (select c.excluded_from_pnl from public.categories c
   where c.id = pg_temp.category_id(pg_temp.id('co'), 'expense', 'תשלומי הלוואה')),
  true,
  'and principal stays kept out'
);

-- A second pick in the same setup replaces the first.
select is(
  public.apply_starter_categories('renovation'),
  jsonb_build_object('set', 'renovation', 'categories', 16),
  'a second pick applies'
);
select is(
  (select count(*)::int from public.categories c
   where c.company_id = pg_temp.id('co') and c.name in ('שכירות', 'אחזקה ותיקונים', 'גז')),
  0,
  'and the first pick''s rows are gone'
);
select is(
  (select count(*)::int from public.categories c
   where c.company_id = pg_temp.id('co') and c.parent_id = pg_temp.category_id(pg_temp.id('co'), 'expense', 'קבלני משנה')),
  3,
  'the second set''s sub-categories are in'
);
select is(
  (select array_agg(c.name order by c.sort_order) from public.categories c
   where c.company_id = pg_temp.id('co') and c.kind = 'income'),
  array['הכנסה ממכירה', 'הכנסה אחרת', 'העברות', 'כסף שהתקבל מהלוואות'],
  'the first income default is the set''s, so a new income line falls there'
);

-- Locks.
do $n$ begin perform public.create_category('Custom Fee', 'expense'); end $n$;
select throws_ok(
  $$ select public.apply_starter_categories('general') $$,
  '55000', 'starter_locked',
  'a category of the owner''s own locks the pick'
);
reset role;
delete from public.categories where company_id = pg_temp.id('co') and name = 'Custom Fee';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
) values (
  pg_temp.id('co'), 'expense', 'expense', 'project', 'posted', 'ILS',
  -100, -100, 100, 0, 'source', '2026-09-10', '2026-09-10', 'manual', 'sc:first-line', 'sc:first-line'
);
select tests.authenticate_as('sc_owner');
select throws_ok(
  $$ select public.apply_starter_categories('general') $$,
  '55000', 'starter_locked',
  'a line locks the pick'
);

-- Roles and tenants.
reset role;
insert into public.company_members (company_id, user_id, role) values
  (pg_temp.id('other'), tests.get_supabase_uid('sc_editor'), 'editor'),
  (pg_temp.id('other'), tests.get_supabase_uid('sc_viewer'), 'viewer');
select tests.authenticate_as('sc_editor');
select throws_ok(
  $$ select public.apply_starter_categories('general') $$,
  '42501', 'forbidden',
  'an editor cannot pick the starter set'
);
select tests.authenticate_as('sc_viewer');
select throws_ok(
  $$ select public.apply_starter_categories('general') $$,
  '42501', 'forbidden',
  'a viewer cannot either'
);
select tests.authenticate_as('sc_other');
select is(
  public.apply_starter_categories('general'),
  jsonb_build_object('set', 'general', 'categories', 9),
  'another owner applies to their own company'
);
reset role;
select is(
  (select count(*)::int from public.categories c
   where c.company_id = pg_temp.id('co') and c.name = 'הכנסה ממכירה'),
  1,
  'and the first company''s categories are untouched'
);

select * from finish();
rollback;
