-- A project's category drill-down lists the rows of one currency: p_currency, else ILS when
-- the category has ILS rows on the project, else the first other currency (Production QA,
-- 2026-10-08: a USD company's drill-down was empty). Invented data only. @example.com only.

begin;

select plan(9);

select tests.create_supabase_user('pcc_owner', 'pcc-owner@example.com');

create temp table pcc (label text primary key, id uuid);
grant all on pcc to authenticated, service_role;

select tests.authenticate_as('pcc_owner');
select public.create_company('Example Currency Drill Co', true);
select public.upsert_project(null, 'Example Site', null, 'active');
select public.create_category('Example Materials', 'expense');
select public.create_category('Example Tools', 'expense');
reset role;
insert into pcc (label, id) select 'company', id from public.companies where name = 'Example Currency Drill Co';
insert into pcc (label, id) select 'project', id from public.projects where name = 'Example Site';
insert into pcc (label, id) select 'materials', id from public.categories where name = 'Example Materials';
insert into pcc (label, id) select 'tools', id from public.categories where name = 'Example Tools';

-- Materials: two USD lines only. Tools: one ILS line and one USD line.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description,
  project_id, category_id, pnl_role
)
select (select id from pcc where label = 'company'), 'expense', 'expense', 'posted', -v.amount, -v.amount, v.amount,
  0, 'unknown', v.day, v.currency, 'manual', v.key, v.key,
  (select id from pcc where label = 'project'), (select id from pcc where label = v.category), 'project'
from (values
  ('pcc:m1', 'materials', 'USD', 1000::bigint, '2026-05-01'::date),
  ('pcc:m2', 'materials', 'USD', 2500::bigint, '2026-05-02'::date),
  ('pcc:t1', 'tools', 'ILS', 700::bigint, '2026-05-03'::date),
  ('pcc:t2', 'tools', 'USD', 300::bigint, '2026-05-04'::date)
) as v(key, category, currency, amount, day);

select tests.authenticate_as('pcc_owner');
create temp table pcc_out as
select 'usd_only' as label, public.list_project_category(
  (select id from pcc where label = 'project'), (select id from pcc where label = 'materials')) as body
union all
select 'mixed', public.list_project_category(
  (select id from pcc where label = 'project'), (select id from pcc where label = 'tools'))
union all
select 'mixed_usd', public.list_project_category(
  (select id from pcc where label = 'project'), (select id from pcc where label = 'tools'), p_currency => 'usd')
union all
select 'eur', public.list_project_category(
  (select id from pcc where label = 'project'), (select id from pcc where label = 'tools'), p_currency => 'EUR');
reset role;

select is((select body->>'currency' from pcc_out where label = 'usd_only'), 'USD',
  'a category with USD rows only defaults to USD');
select is((select jsonb_array_length(body->'rows') from pcc_out where label = 'usd_only'), 2,
  'and lists both lines');
select is((select (body->>'total_agorot')::bigint from pcc_out where label = 'usd_only'), 3500::bigint,
  'with their total, as categories_by_currency sums it');
select is((select body->>'currency' from pcc_out where label = 'mixed'), 'ILS',
  'a category with ILS rows defaults to ILS');
select is((select body->'rows'->0->>'description' from pcc_out where label = 'mixed'), 'pcc:t1',
  'and lists only the ILS line');
select is((select body->>'currency' from pcc_out where label = 'mixed_usd'), 'USD',
  'p_currency picks USD, in any case');
select is((select body->'rows'->0->>'description' from pcc_out where label = 'mixed_usd'), 'pcc:t2',
  'and lists only the USD line');
select is((select jsonb_array_length(body->'rows') from pcc_out where label = 'eur'), 0,
  'a currency with no rows is empty');
select is(
  (select s->>'amount_minor' from jsonb_array_elements(
    (select public.get_project((select id from pcc where label = 'project'))->'categories_by_currency')) s
   where s->>'currency' = 'USD' and s->>'id' = (select id from pcc where label = 'materials')::text),
  '3500', 'get_project shows the same USD total');

select * from finish();
rollback;
