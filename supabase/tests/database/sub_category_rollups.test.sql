-- FLOW-406 server 1b (decision 0164): parent roll-ups in get_project, project_category_months,
-- get_breakdown and search_transactions. Every line still counts once by its own category.
-- Invented data only.

begin;

select plan(20);

select tests.create_supabase_user('ru_owner', 'ru-owner@example.com');
select tests.create_supabase_user('ru_other', 'ru-other@example.com');

create temp table ru (label text primary key, id uuid);
grant all on ru to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from ru where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select tests.authenticate_as('ru_other');
do $o$ begin perform public.create_company('Other Rollups', true); end $o$;

select tests.authenticate_as('ru_owner');
do $c$ begin perform public.create_company('Rollup Books', true); end $c$;
do $p$ begin perform public.upsert_project(null, 'Site Charlie', null, 'active'); end $p$;
insert into ru (label, id) select 'co', id from public.companies where name = 'Rollup Books';
insert into ru (label, id) select 'proj', id from public.projects where name = 'Site Charlie';
insert into ru (label, id) values
  ('bills', public.create_category('Bills', 'expense')),
  ('fees', public.create_category('Fees', 'expense'));
insert into ru (label, id) values
  ('water', public.create_category('Water', 'expense', pg_temp.id('bills'))),
  ('power', public.create_category('Power', 'expense', pg_temp.id('bills')));

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  pg_temp.id('co'), 'expense', 'expense', 'project', 'posted', 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source', v.d::date, v.d::date, 'manual', v.ikey,
  pg_temp.id('proj'), pg_temp.id(v.cat), v.ikey
from (values
  (-1000, '2026-08-10', 'ru:bills', 'bills'),
  (-2000, '2026-08-12', 'ru:water', 'water'),
  (-3000, '2026-09-14', 'ru:power', 'power'),
  (-500,  '2026-09-16', 'ru:fees',  'fees'),
  (-700,  '2026-10-05', 'ru:water-oct', 'water')
) as v(amount, d, ikey, cat);

select tests.authenticate_as('ru_owner');

-- get_project: the category rows stay one per category, each with its parent.
create temp table ru_proj as select public.get_project(pg_temp.id('proj'), 'invoiced') as body;
grant all on ru_proj to authenticated;
select is(
  (select jsonb_array_length(body->'categories_by_currency') from ru_proj),
  4,
  'the category rows stay one per category'
);
select is(
  (select sum((r->>'amount_minor')::bigint) from ru_proj, jsonb_array_elements(body->'categories_by_currency') r),
  7200::numeric,
  'and still add up to the project''s cost, each line once'
);
select is(
  (select r->>'parent_id' from ru_proj, jsonb_array_elements(body->'categories_by_currency') r
   where r->>'id' = pg_temp.id('water')::text),
  pg_temp.id('bills')::text,
  'a sub-category row names its parent'
);
select is(
  (select jsonb_array_length(body->'category_rollups_by_currency') from ru_proj),
  1,
  'one roll-up row, for the parent with sub-categories'
);
select is(
  (select r - 'name' - 'has_shared_share' from ru_proj, jsonb_array_elements(body->'category_rollups_by_currency') r),
  jsonb_build_object('currency', 'ILS', 'id', pg_temp.id('bills'), 'amount_minor', 6700,
    'own_amount_minor', 1000, 'children', 2),
  'the parent roll-up is its own lines plus its children''s, with its own part apart'
);
select is(
  (select (r->>'amount_agorot')::bigint from ru_proj, jsonb_array_elements(body->'category_rollups') r),
  6700::bigint,
  'the agorot roll-up matches'
);

-- project_category_months: parents[] sums the months.
create temp table ru_months as
  select public.project_category_months(pg_temp.id('proj'), 3, '2026-10-20') as body;
grant all on ru_months to authenticated;
select is(
  (select r->>'parent_id' from ru_months, jsonb_array_elements(body->'categories') r
   where r->>'id' = pg_temp.id('power')::text),
  pg_temp.id('bills')::text,
  'a monthly row names its parent'
);
select is(
  (select r - 'name' from ru_months, jsonb_array_elements(body->'parents') r),
  jsonb_build_object('id', pg_temp.id('bills'), 'currency', 'ILS', 'this_month_minor', 700,
    'own_this_month_minor', 0, 'children', 2, 'months_minor', jsonb_build_array(0, 3000, 3000)),
  'the parent''s months are summed month by month'
);
select is(
  (select jsonb_array_length(body->'parents') from ru_months),
  1,
  'a category with no sub-categories gets no parent row'
);

-- get_breakdown by parent.
create temp table ru_bd as select public.get_breakdown('expense', null, null, 'parent', 'invoiced') as body;
grant all on ru_bd to authenticated;
select is(
  (select jsonb_agg(jsonb_build_object('key', g->>'key', 'amount', g->'amount_minor', 'count', g->'count')
     order by g->>'key')
   from ru_bd, jsonb_array_elements(body->'groups') g),
  (select jsonb_agg(x order by x->>'key') from (values
    (jsonb_build_object('key', pg_temp.id('bills')::text, 'amount', 6700, 'count', 4)),
    (jsonb_build_object('key', pg_temp.id('fees')::text, 'amount', 500, 'count', 1))
  ) v(x)),
  'by parent, sub-categories fold into their parent'
);
select is(
  (select body->'totals' from ru_bd),
  public.get_breakdown('expense', null, null, 'category', 'invoiced')->'totals',
  'the totals are the same as by category'
);
select is(
  jsonb_array_length(public.get_breakdown_lines('expense', 'parent', pg_temp.id('bills')::text, 'ILS',
    null, null, 'invoiced', false, 40, 0)->'rows'),
  4,
  'the parent''s lines are its own and its children''s'
);
select is(
  (select (g->>'amount_minor')::bigint
   from jsonb_array_elements(public.get_breakdown('expense', null, null, 'category', 'invoiced')->'groups') g
   where g->>'key' = pg_temp.id('water')::text),
  2700::bigint,
  'by category, a sub-category is still its own row'
);

-- search_transactions.
select is(
  (public.search_transactions(p_category => pg_temp.id('bills')::text)->>'total')::int,
  4,
  'a parent finds its own and its children''s lines'
);
select is(
  (public.search_transactions(p_category => pg_temp.id('bills')::text, p_category_exact => true)->>'total')::int,
  1,
  'category_exact finds only its own'
);
select is(
  (public.search_transactions(p_category => pg_temp.id('water')::text)->>'total')::int,
  2,
  'a sub-category finds only its own'
);

-- Tenant isolation.
select tests.authenticate_as('ru_other');
select is(public.get_project(pg_temp.id('proj'), 'invoiced'), null, 'another company can''t read the project');
select is(
  private.category_rollup_rows((select body->'categories_by_currency' from ru_proj), 'amount_minor', pg_temp.id('co')),
  '[]'::jsonb,
  'the roll-up helper sees no other company''s categories'
);
select is(
  (public.search_transactions(p_category => pg_temp.id('bills')::text)->>'total')::int,
  0,
  'another company''s parent finds nothing'
);
select is(
  (select count(*)::int from jsonb_array_elements(
    public.get_breakdown('expense', null, null, 'parent', 'invoiced')->'groups')),
  0,
  'and its breakdown by parent is its own'
);

select * from finish();
rollback;
