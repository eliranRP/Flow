-- A SUMIT expense with a project and no category gets a category and stays approvable.

begin;

select plan(20);

do $users$
begin
  perform tests.create_supabase_user('r10_a', 'r10-a@test.flow');
end
$users$;

select tests.authenticate_as('r10_a');
select lives_ok($$select public.create_company('סבב 10', true)$$, 'owner creates a company');

create temp table r10 (label text primary key, id uuid);
grant all on r10 to authenticated, service_role;
insert into r10 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'שיפוץ דירה ביאליק 8 חולון', null, 'active')$$, 'owner opens the project');
insert into r10 (label, id) select 'project', id from public.projects where name = 'שיפוץ דירה ביאליק 8 חולון';
insert into r10 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r10 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';
insert into r10 (label, id)
select 'insurance', id from public.categories where name = 'ביטוח' and kind = 'expense';

reset role;
insert into public.suppliers (company_id, name)
select id, 'חומרי בניין השרון' from r10 where label = 'company';
insert into r10 (label, id)
select 'sharon', id from public.suppliers where name = 'חומרי בניין השרון';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, supplier_id, description
)
select c.id, 'expense', 'expense', 'project',
  -2596000, -2200000, -396000, 'source',
  '2026-04-12', 'sumit', 'r10:sharon', p.id, s.id, 'חומרי בניין השרון בע״מ'
from r10 c
join r10 p on p.label = 'project'
join r10 s on s.label = 'sharon'
where c.label = 'company';

select is(
  (select category_id from public.transactions where idempotency_key = 'r10:sharon'),
  (select id from r10 where label = 'materials'),
  'a supplier with no rule takes the default expense category'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r10:sharon'),
  true,
  'the filled category stays a suggestion'
);

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, supplier_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -100000, -100000, 0, 'unknown',
  '2026-04-01', 'manual', 'r10:history', p.id, s.id, h.id, true, 'הובלה קודמת'
from r10 c
join r10 p on p.label = 'project'
join r10 s on s.label = 'sharon'
join r10 h on h.label = 'haul'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, supplier_id, description
)
select c.id, 'expense', 'expense', 'project',
  -200000, -200000, 0, 'unknown',
  '2026-04-13', 'sumit', 'r10:from-history', p.id, s.id, 'עוד חומרים'
from r10 c
join r10 p on p.label = 'project'
join r10 s on s.label = 'sharon'
where c.label = 'company';

select is(
  (select category_id from public.transactions where idempotency_key = 'r10:from-history'),
  (select id from r10 where label = 'haul'),
  'history of an assigned category beats the default'
);

update public.suppliers
set remembered_category_id = (select id from r10 where label = 'insurance')
where id = (select id from r10 where label = 'sharon');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, supplier_id, description
)
select c.id, 'expense', 'expense', 'project',
  -300000, -300000, 0, 'unknown',
  '2026-04-14', 'sumit', 'r10:rule', p.id, s.id, 'לפי כלל'
from r10 c
join r10 p on p.label = 'project'
join r10 s on s.label = 'sharon'
where c.label = 'company';

select is(
  (select category_id from public.transactions where idempotency_key = 'r10:rule'),
  (select id from r10 where label = 'insurance'),
  'a supplier rule beats history'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r10:rule'),
  false,
  'a rule match is not marked as a suggestion'
);

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'shared',
  -400000, -400000, 0, 'unknown',
  '2026-04-15', 'sumit', 'r10:shared', 'עלות משותפת'
from r10 where label = 'company';

select is(
  (select category_id is not null from public.transactions where idempotency_key = 'r10:shared'),
  true,
  'a shared cost still receives a category'
);

update public.categories
set hidden = true
where company_id = (select id from r10 where label = 'company')
  and kind = 'expense';

insert into public.suppliers (company_id, name)
select id, 'ספק בלי קטגוריה' from r10 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, supplier_id, description
)
select c.id, 'expense', 'expense', 'project',
  -1000, -1000, 0, 'unknown',
  '2026-04-16', 'sumit', 'r10:none', s.id, 'אין קטגוריה'
from r10 c
join public.suppliers s on s.name = 'ספק בלי קטגוריה' and s.company_id = c.id
where c.label = 'company';

select is(
  (select category_id from public.transactions where idempotency_key = 'r10:none'),
  null,
  'with every expense category hidden, nothing is invented'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r10:none'),
  false,
  'a row with no category is not marked suggested'
);

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select lives_ok(
  format('select public.sync_review_queue(%L::uuid)', (select id from r10 where label = 'company')),
  'the queue sync runs'
);
select is(
  (select reason from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r10:sharon' and q.status = 'open'),
  'suggested',
  'a filled category stays in the queue as a suggestion'
);
select is(
  (select reason from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r10:shared' and q.status = 'open'),
  'unallocated_shared',
  'a shared cost is queued for a split, not as a single project'
);
select is(
  (select reason from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r10:none' and q.status = 'open'),
  'missing_category',
  'a row that still has no category stays missing'
);
select is(
  (select count(*)::int from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r10:rule' and q.status = 'open'),
  0,
  'a supplier rule does not enter the queue'
);

select ok(
  not has_column_privilege('authenticated', 'public.companies', 'id', 'UPDATE'),
  'authenticated cannot update companies.id'
);
select ok(
  not has_column_privilege('authenticated', 'public.companies', 'owner_id', 'UPDATE'),
  'authenticated cannot update companies.owner_id'
);
select ok(
  not has_column_privilege('authenticated', 'public.companies', 'created_at', 'UPDATE'),
  'authenticated cannot update companies.created_at'
);
select ok(
  not has_column_privilege('authenticated', 'public.companies', 'is_demo', 'UPDATE'),
  'authenticated cannot update companies.is_demo'
);
select ok(
  has_column_privilege('authenticated', 'public.companies', 'name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.companies', 'tax_id', 'UPDATE')
  and has_column_privilege('authenticated', 'public.companies', 'vat_rate_bp', 'UPDATE')
  and has_column_privilege('authenticated', 'public.companies', 'vat_registered', 'UPDATE')
  and has_column_privilege('authenticated', 'public.companies', 'after_overhead', 'UPDATE')
  and has_column_privilege('authenticated', 'public.companies', 'updated_at', 'UPDATE'),
  'authenticated keeps the company fields the screens write'
);

select * from finish();
rollback;
