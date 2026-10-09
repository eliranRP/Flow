-- Round 7: shared costs stay on Split, a 100% allocation, undo of a split, income, cross-tenant undo, anon.

begin;

select plan(20);

do $users$
begin
  perform tests.create_supabase_user('r7_a', 'r7-a@test.flow');
  perform tests.create_supabase_user('r7_b', 'r7-b@test.flow');
end
$users$;

select tests.authenticate_as('r7_a');
select lives_ok($$select public.create_company('סבב 7', true)$$, 'owner creates a company');

create temp table r7 (label text primary key, id uuid);
grant all on r7 to authenticated, service_role;
insert into r7 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r7 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
insert into r7 (label, id) select 'beta', id from public.projects where name = 'ביתא';
insert into r7 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r7 (label, id)
select 'income_cat', id from public.categories where name = 'הכנסה מלקוחות' and kind = 'income';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'shared', -100000, -100000, 0, 'unknown',
  '2026-09-04', 'manual', 'r7:shared', 'עלות משותפת'
from r7 where label = 'company';
insert into r7 (label, id)
select 'shared', id from public.transactions where idempotency_key = 'r7:shared';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from r7 where label = 'company'), (select id from r7 where label = 'shared'), id, 6000, -60000
from r7 where label = 'alpha';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from r7 where label = 'company'), (select id from r7 where label = 'shared'), id, 4000, -40000
from r7 where label = 'beta';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project', -200000, -200000, 0, 'unknown',
  '2026-09-05', 'manual', 'r7:queue', a.id, m.id, 'ממתין לפיצול'
from r7 c
join r7 a on a.label = 'alpha'
join r7 m on m.label = 'materials'
where c.label = 'company';
insert into r7 (label, id)
select 'queue', id from public.transactions where idempotency_key = 'r7:queue';
insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r7 where label = 'company'), id, 'open', 'unallocated_shared'
from r7 where label = 'queue';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project', -80000, -80000, 0, 'unknown',
  '2026-09-06', 'manual', 'r7:split', a.id, 'פיצול קודם'
from r7 c
join r7 a on a.label = 'alpha'
where c.label = 'company';
insert into r7 (label, id)
select 'split', id from public.transactions where idempotency_key = 'r7:split';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from r7 where label = 'company'), (select id from r7 where label = 'split'), id, 5000, -40000
from r7 where label = 'alpha';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from r7 where label = 'company'), (select id from r7 where label = 'split'), id, 5000, -40000
from r7 where label = 'beta';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'income', 'invoice', null, 500000, 500000, 0, 'unknown',
  '2026-09-07', 'manual', 'r7:income', 'הכנסה'
from r7 where label = 'company';
insert into r7 (label, id)
select 'income', id from public.transactions where idempotency_key = 'r7:income';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project', -30000, -30000, 0, 'unknown',
  '2026-09-08', 'manual', 'r7:plain', a.id, 'הוצאה רגילה'
from r7 c
join r7 a on a.label = 'alpha'
where c.label = 'company';
insert into r7 (label, id)
select 'plain', id from public.transactions where idempotency_key = 'r7:plain';

select tests.authenticate_as('r7_a');
select throws_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r7 where label = 'shared'),
    (select id from r7 where label = 'alpha'),
    (select id from r7 where label = 'materials')
  ),
  'P0001',
  'shared costs are split, not assigned to one project',
  'a shared row is split, not assigned to one project'
);
select throws_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r7 where label = 'queue'),
    (select id from r7 where label = 'beta'),
    (select id from r7 where label = 'materials')
  ),
  'P0001',
  'shared costs are split, not assigned to one project',
  'an open unallocated_shared item is split, not assigned'
);

select lives_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r7 where label = 'split'),
    (select id from r7 where label = 'beta'),
    (select id from r7 where label = 'materials')
  ),
  'an expense that is not shared can be reassigned'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r7 where label = 'split')),
  1,
  'reassignment leaves one allocation'
);
select is(
  (select share_bp from public.allocations where transaction_id = (select id from r7 where label = 'split')),
  10000,
  'that allocation is 100 percent'
);

reset role;
insert into r7 (label, id)
select 'undo', id from public.reassign_undo
where transaction_id = (select id from r7 where label = 'split') and undone_at is null;
select tests.authenticate_as('r7_a');

select lives_ok(
  format('select public.undo_reassign(%L::uuid)', (select id from r7 where label = 'undo')),
  'undo restores the split'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r7 where label = 'split')),
  2,
  'undo puts both shares back'
);

select throws_ok(
  format(
    'select public.reassign_transaction(%L::uuid, null, %L::uuid)',
    (select id from r7 where label = 'income'),
    (select id from r7 where label = 'income_cat')
  ),
  'P0001',
  'project and category are required',
  'income with a P&L category is not reassigned without a project'
);
select lives_ok(
  format(
    'select public.reassign_transaction(%L::uuid, null, %L::uuid)',
    (select id from r7 where label = 'income'),
    (select c.id from public.categories c
      where c.company_id = (select company_id from public.transactions where id = (select id from r7 where label = 'income'))
        and c.kind = 'income' and c.excluded_from_pnl
      order by c.sort_order limit 1)
  ),
  'income with an off-P&L category is reassigned without a project'
);
select lives_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r7 where label = 'income'),
    (select id from r7 where label = 'beta'),
    (select id from r7 where label = 'income_cat')
  ),
  'income is reassigned with a project'
);
select is(
  (select project_id from public.transactions where id = (select id from r7 where label = 'income')),
  (select id from r7 where label = 'beta'),
  'income keeps the picked project'
);
select is(
  (select category_id from public.transactions where id = (select id from r7 where label = 'income')),
  (select id from r7 where label = 'income_cat'),
  'income keeps the income category'
);

select lives_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r7 where label = 'plain'),
    (select id from r7 where label = 'beta'),
    (select id from r7 where label = 'materials')
  ),
  'a plain expense is reassigned so another owner can try to undo it'
);
reset role;
insert into r7 (label, id)
select 'plain_undo', id from public.reassign_undo
where transaction_id = (select id from r7 where label = 'plain') and undone_at is null;

select tests.authenticate_as('r7_b');
select lives_ok($$select public.create_company('סבב 7 ב', true)$$, 'the other owner creates a company');
select throws_ok(
  format('select public.undo_reassign(%L::uuid)', (select id from r7 where label = 'plain_undo')),
  'P0001',
  'undo not found',
  'another owner cannot undo the reassignment'
);

select function_privs_are(
  'public',
  'reassign_transaction',
  array['uuid', 'uuid', 'uuid'],
  'anon',
  array[]::text[],
  'anon cannot reassign a transaction'
);
select function_privs_are(
  'public',
  'undo_reassign',
  array['uuid'],
  'anon',
  array[]::text[],
  'anon cannot undo a reassignment'
);

select * from finish();

rollback;
