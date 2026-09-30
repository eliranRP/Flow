-- Round 21: list_review reports category_suggested and project_suggested.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('r21_a', 'r21-a@test.flow');
end
$users$;

select tests.authenticate_as('r21_a');
select lives_ok($$select public.create_company('סבב 21', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'אלון', null, 'active')$$, 'owner opens אלון');
select lives_ok($$select public.upsert_project(null, 'נמל', null, 'active')$$, 'owner opens נמל');

create temp table r21 (label text primary key, id uuid);
grant all on r21 to anon, authenticated, service_role;
insert into r21 (label, id) select 'company', id from public.companies;
insert into r21 (label, id)
select name, id from public.projects where name in ('אלון', 'נמל');
insert into r21 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;
insert into public.suppliers (company_id, name, remembered_category_id)
select
  (select id from r21 where label = 'company'),
  'ספק עם כלל',
  (select id from r21 where label = 'materials');
insert into r21 (label, id)
select 'rule-supplier', id from public.suppliers where name = 'ספק עם כלל';

insert into public.suppliers (company_id, name, remembered_project_id)
select
  (select id from r21 where label = 'company'),
  'ספק עם פרויקט',
  (select id from r21 where label = 'נמל');
insert into r21 (label, id)
select 'project-supplier', id from public.suppliers where name = 'ספק עם פרויקט';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, project_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project', (select id from r21 where label = 'אלון'),
  -118000, -100000, -18000, 'source',
  '2026-08-01', 'manual', 'r21:guess', 'ניחוש'
from r21 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, project_id, category_id, user_assigned,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project',
  (select id from r21 where label = 'אלון'),
  (select id from r21 where label = 'materials'),
  true,
  -118000, -100000, -18000, 'source',
  '2026-08-02', 'manual', 'r21:owned', 'שלי'
from r21 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project', (select id from r21 where label = 'rule-supplier'),
  -118000, -100000, -18000, 'source',
  '2026-08-03', 'manual', 'r21:rule-category', 'כלל קטגוריה'
from r21 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id, project_id, category_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project',
  (select id from r21 where label = 'project-supplier'),
  (select id from r21 where label = 'נמל'),
  (select id from r21 where label = 'materials'),
  -118000, -100000, -18000, 'source',
  '2026-08-04', 'manual', 'r21:rule-project', 'כלל פרויקט'
from r21 where label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'suggested'
from public.transactions t
where t.idempotency_key like 'r21:%';

select tests.authenticate_as('r21_a');

select is(
  (select (elem->>'category_suggested')::boolean
   from jsonb_array_elements(public.list_review()) elem
   where elem->>'description' = 'ניחוש'),
  true,
  'a filled category is a suggestion'
);
select is(
  (select (elem->>'project_suggested')::boolean
   from jsonb_array_elements(public.list_review()) elem
   where elem->>'description' = 'ניחוש'),
  true,
  'a project that nobody assigned is a suggestion'
);
select is(
  (select (elem->>'category_suggested')::boolean
   from jsonb_array_elements(public.list_review()) elem
   where elem->>'description' = 'שלי'),
  false,
  'a category the owner assigned is not a suggestion'
);
select is(
  (select (elem->>'project_suggested')::boolean
   from jsonb_array_elements(public.list_review()) elem
   where elem->>'description' = 'שלי'),
  false,
  'a project the owner assigned is not a suggestion'
);
select is(
  (select (elem->>'category_suggested')::boolean
   from jsonb_array_elements(public.list_review()) elem
   where elem->>'description' = 'כלל קטגוריה'),
  false,
  'a category from the supplier rule is not a suggestion'
);
select is(
  (select (elem->>'project_suggested')::boolean
   from jsonb_array_elements(public.list_review()) elem
   where elem->>'description' = 'כלל פרויקט'),
  false,
  'a project the supplier rule remembers is not a suggestion'
);

select * from finish();

rollback;
