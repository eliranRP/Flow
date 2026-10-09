-- Round 20: approve_split_review closes the item and leaves the shares.

begin;

select plan(32);

do $users$
begin
  perform tests.create_supabase_user('r20_a', 'r20-a@test.flow');
  perform tests.create_supabase_user('r20_b', 'r20-b@test.flow');
end
$users$;

select tests.authenticate_as('r20_a');
select lives_ok($$select public.create_company('סבב 20', true)$$, 'owner creates a company');

create temp table r20 (label text primary key, id uuid);
grant all on r20 to anon, authenticated, service_role;
insert into r20 (label, id) select 'company', id from public.companies;

select lives_ok($$select public.upsert_project(null, 'אלון', null, 'active')$$, 'owner opens אלון');
select lives_ok($$select public.upsert_project(null, 'נמל', null, 'active')$$, 'owner opens נמל');

insert into r20 (label, id)
select name, id from public.projects where name in ('אלון', 'נמל');
insert into r20 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r20 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;
insert into public.suppliers (company_id, name, remembered_category_id)
select
  (select id from r20 where label = 'company'),
  'ליסינג לדוגמה',
  (select id from r20 where label = 'haul');
insert into r20 (label, id)
select 'supplier', id from public.suppliers where name = 'ליסינג לדוגמה';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'expense', 'expense', 'shared', (select id from r20 where label = 'supplier'),
  -236000, -200000, -36000, 'source',
  '2026-07-01', 'manual', 'r20:leasing', 'ליסינג לדוגמה',
  (select id from r20 where label = 'materials')
from r20 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id, project_id
)
select id, 'expense', 'expense', 'project',
  -118000, -100000, -18000, 'source',
  '2026-07-02', 'manual', 'r20:plain', 'הוצאה רגילה',
  (select id from r20 where label = 'materials'),
  (select id from r20 where label = 'אלון')
from r20 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'income', 'invoice', 'project', 118000, 100000, 18000, 'source',
  '2026-07-03', 'manual', 'r20:income', 'הכנסה',
  (select id from public.categories
    where company_id = (select id from r20 where label = 'company')
      and name = 'הכנסה מלקוחות' and kind = 'income')
from r20 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'expense', 'expense', 'shared', (select id from r20 where label = 'supplier'),
  -118000, -100000, -18000, 'source',
  '2026-07-04', 'manual', 'r20:open-shared', 'עלות בלי חלוקה',
  (select id from r20 where label = 'materials')
from r20 where label = 'company';

insert into r20 (label, id)
select 'leasing', id from public.transactions where idempotency_key = 'r20:leasing';
insert into r20 (label, id)
select 'plain', id from public.transactions where idempotency_key = 'r20:plain';
insert into r20 (label, id)
select 'income', id from public.transactions where idempotency_key = 'r20:income';
insert into r20 (label, id)
select 'open-shared', id from public.transactions where idempotency_key = 'r20:open-shared';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r20 where label = 'company'),
  (select id from r20 where label = 'leasing'),
  (select id from r20 where label = 'אלון'),
  7000, -140000;
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r20 where label = 'company'),
  (select id from r20 where label = 'leasing'),
  (select id from r20 where label = 'נמל'),
  3000, -60000;

insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r20 where label = 'company'), (select id from r20 where label = 'leasing'), 'open', 'missing_category';
insert into r20 (label, id)
select 'review', id from public.review_queue where transaction_id = (select id from r20 where label = 'leasing');

insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r20 where label = 'company'), (select id from r20 where label = 'plain'), 'open', 'suggested';
insert into r20 (label, id)
select 'plain-review', id from public.review_queue where transaction_id = (select id from r20 where label = 'plain');

insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r20 where label = 'company'), (select id from r20 where label = 'income'), 'open', 'suggested';
insert into r20 (label, id)
select 'income-review', id from public.review_queue where transaction_id = (select id from r20 where label = 'income');

insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r20 where label = 'company'), (select id from r20 where label = 'open-shared'), 'open', 'unallocated_shared';
insert into r20 (label, id)
select 'open-review', id from public.review_queue where transaction_id = (select id from r20 where label = 'open-shared');

select tests.clear_authentication();
select ok(
  not has_function_privilege('anon', 'public.approve_split_review(uuid)', 'execute'),
  'anon cannot execute approve_split_review'
);
select throws_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from r20 where label = 'review')),
  '42501',
  null,
  'anon cannot approve a split'
);

select tests.authenticate_as('r20_a');
select lives_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from r20 where label = 'review')),
  'the owner approves a categorised split'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'אלון')),
  7000,
  'approve leaves אלון basis points'
);
select is(
  (select amount_net from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'אלון')),
  -140000::bigint,
  'approve leaves אלון amount'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'נמל')),
  3000,
  'approve leaves נמל basis points'
);
select is(
  (select amount_net from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'נמל')),
  -60000::bigint,
  'approve leaves נמל amount'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r20 where label = 'leasing')),
  2,
  'approve leaves both shares'
);
select is(
  (select pnl_role::text from public.transactions where id = (select id from r20 where label = 'leasing')),
  'shared',
  'approve leaves the shared role'
);
select is(
  (select category_id from public.transactions where id = (select id from r20 where label = 'leasing')),
  (select id from r20 where label = 'materials'),
  'approve leaves the category'
);
select is(
  (select remembered_category_id from public.suppliers where id = (select id from r20 where label = 'supplier')),
  (select id from r20 where label = 'haul'),
  'approve does not write a supplier rule'
);
select is(
  (select status::text from public.review_queue where id = (select id from r20 where label = 'review')),
  'approved',
  'the review item is approved'
);
select ok(
  (select written_remembered_category_id is null from public.review_queue where id = (select id from r20 where label = 'review')),
  'approve records no supplier rule write'
);

select throws_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from r20 where label = 'income-review')),
  'P0001',
  'income is not split',
  'income is refused'
);
select throws_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from r20 where label = 'plain-review')),
  'P0001',
  'transaction is not split',
  'a row that is not split is refused'
);
select throws_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from r20 where label = 'open-review')),
  'P0001',
  'shared costs are split, not assigned to one project',
  'an unallocated shared cost is refused'
);

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'expense', 'expense', 'shared', (select id from r20 where label = 'supplier'),
  -236000, -200000, -36000, 'source',
  '2026-07-05', 'manual', 'r20:foreign', 'ליסינג זר',
  (select id from r20 where label = 'materials')
from r20 where label = 'company';
insert into r20 (label, id)
select 'foreign', id from public.transactions where idempotency_key = 'r20:foreign';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r20 where label = 'company'),
  (select id from r20 where label = 'foreign'),
  (select id from r20 where label = 'אלון'),
  6500, -130000;
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r20 where label = 'company'),
  (select id from r20 where label = 'foreign'),
  (select id from r20 where label = 'נמל'),
  3500, -70000;
insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r20 where label = 'company'), (select id from r20 where label = 'foreign'), 'open', 'missing_category';
insert into r20 (label, id)
select 'foreign-review', id from public.review_queue where transaction_id = (select id from r20 where label = 'foreign');

select tests.authenticate_as('r20_b');
select lives_ok($$select public.create_company('סבב 20 ב', true)$$, 'the other owner creates a company');
select throws_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from r20 where label = 'foreign-review')),
  'P0001',
  'review item not found',
  'a foreign company cannot approve the split'
);

reset role;
select is(
  (select status::text from public.review_queue where id = (select id from r20 where label = 'foreign-review')),
  'open',
  'the foreign attempt leaves the split review open'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r20 where label = 'foreign')
      and project_id = (select id from r20 where label = 'אלון')),
  6500,
  'the foreign attempt leaves אלון basis points'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r20 where label = 'foreign')
      and project_id = (select id from r20 where label = 'נמל')),
  3500,
  'the foreign attempt leaves נמל basis points'
);

-- Approve stored the snapshot and did not change the shares. Move them now, so a
-- reopen that ignores prior_allocations still shows 1111 and the test fails.
update public.allocations
set share_bp = 1111, amount_net = -111
where transaction_id = (select id from r20 where label = 'leasing')
  and project_id = (select id from r20 where label = 'אלון');
update public.transactions
set source = 'sumit'
where id = (select id from r20 where label = 'leasing');

select tests.authenticate_as('r20_a');
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'אלון')),
  1111,
  'the shares changed after approve, away from the snapshot'
);
select is(
  (select count(*)::int
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'id' = (select id::text from r20 where label = 'leasing')),
  0,
  'an approved sumit split stays off the automatic list; the owner filed it (FLOW-309)'
);
select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r20 where label = 'review')),
  'undo reopens the approved split'
);
select is(
  (select status::text from public.review_queue where id = (select id from r20 where label = 'review')),
  'open',
  'undo puts the split review back on the queue'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'אלון')),
  7000,
  'undo puts אלון basis points back'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'נמל')),
  3000,
  'undo puts נמל basis points back'
);
select is(
  (select amount_net from public.allocations
    where transaction_id = (select id from r20 where label = 'leasing')
      and project_id = (select id from r20 where label = 'אלון')),
  -140000::bigint,
  'undo puts אלון amount back from the snapshot'
);
select is(
  (select count(*)::int
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'id' = (select id::text from r20 where label = 'leasing')),
  0,
  'undo takes the split off שויכו היום'
);

select * from finish();

rollback;
