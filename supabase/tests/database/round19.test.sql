-- Round 19: collapse_split grants, company boundary, income, a finished
-- project, and an asymmetric undo. list_review names a split.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('r19_a', 'r19-a@test.flow');
  perform tests.create_supabase_user('r19_b', 'r19-b@test.flow');
end
$users$;

select tests.authenticate_as('r19_a');
select lives_ok($$select public.create_company('סבב 19', true)$$, 'owner creates a company');

create temp table r19 (label text primary key, id uuid);
grant all on r19 to authenticated, service_role;
insert into r19 (label, id) select 'company', id from public.companies;

select lives_ok($$select public.upsert_project(null, 'אלון', null, 'active')$$, 'owner opens אלון');
select lives_ok($$select public.upsert_project(null, 'נמל', null, 'active')$$, 'owner opens נמל');

insert into r19 (label, id)
select name, id from public.projects where name in ('אלון', 'נמל');
insert into r19 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'expense', 'expense', 'shared', -236000, -200000, -36000, 'source',
  '2026-07-01', 'manual', 'r19:leasing', 'ליסינג לדוגמה',
  (select id from r19 where label = 'materials')
from r19 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'income', 'income', 'project', 118000, 100000, 18000, 'source',
  '2026-07-03', 'manual', 'r19:income', 'הכנסה',
  (select id from public.categories where company_id = (select id from r19 where label = 'company') and name = 'תקבול מלקוח' and kind = 'income')
from r19 where label = 'company';

insert into r19 (label, id)
select 'leasing', id from public.transactions where idempotency_key = 'r19:leasing';
insert into r19 (label, id)
select 'income', id from public.transactions where idempotency_key = 'r19:income';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r19 where label = 'company'),
  (select id from r19 where label = 'leasing'),
  (select id from r19 where label = 'אלון'),
  7000,
  -140000;
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r19 where label = 'company'),
  (select id from r19 where label = 'leasing'),
  (select id from r19 where label = 'נמל'),
  3000,
  -60000;

insert into public.review_queue (company_id, transaction_id, status, reason)
select
  (select id from r19 where label = 'company'),
  (select id from r19 where label = 'leasing'),
  'open',
  'missing_category';

select tests.clear_authentication();
select ok(
  not has_function_privilege('anon', 'public.collapse_split(uuid, uuid)', 'execute'),
  'anon cannot execute collapse_split'
);
select throws_ok(
  format(
    'select public.collapse_split(%L::uuid, %L::uuid)',
    (select id from r19 where label = 'leasing'),
    (select id from r19 where label = 'נמל')
  ),
  '42501',
  null,
  'anon cannot collapse a split'
);

select tests.authenticate_as('r19_a');
select is(
  (public.list_review() -> 0 ->> 'pnl_role'),
  'shared',
  'list_review reports the split role'
);
select is(
  ((public.list_review() -> 0 ->> 'share_count')::int),
  2,
  'list_review reports the share count'
);

select lives_ok(
  format(
    $$insert into r19 (label, id)
      select 'undo', public.collapse_split(%L::uuid, %L::uuid)$$,
    (select id from r19 where label = 'leasing'),
    (select id from r19 where label = 'נמל')
  ),
  'the owner collapses the uneven split onto נמל'
);
select lives_ok(
  format(
    'select public.undo_reassign(%L::uuid)',
    (select id from r19 where label = 'undo')
  ),
  'undo restores the uneven split'
);
select is(
  (select share_bp from public.allocations where transaction_id = (select id from r19 where label = 'leasing') and project_id = (select id from r19 where label = 'אלון')),
  7000,
  'undo restores אלון basis points'
);
select is(
  (select amount_net from public.allocations where transaction_id = (select id from r19 where label = 'leasing') and project_id = (select id from r19 where label = 'אלון')),
  -140000::bigint,
  'undo restores אלון amount'
);
select is(
  (select share_bp from public.allocations where transaction_id = (select id from r19 where label = 'leasing') and project_id = (select id from r19 where label = 'נמל')),
  3000,
  'undo restores נמל basis points'
);
select is(
  (select amount_net from public.allocations where transaction_id = (select id from r19 where label = 'leasing') and project_id = (select id from r19 where label = 'נמל')),
  -60000::bigint,
  'undo restores נמל amount'
);
select is(
  (select pnl_role::text from public.transactions where id = (select id from r19 where label = 'leasing')),
  'shared',
  'undo restores the shared role'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r19 where label = 'leasing')),
  2,
  'undo restores both shares'
);

select throws_ok(
  format(
    'select public.collapse_split(%L::uuid, %L::uuid)',
    (select id from r19 where label = 'income'),
    (select id from r19 where label = 'נמל')
  ),
  'P0001',
  'income is not split',
  'income is refused'
);

select lives_ok($$select public.upsert_project(null, 'ישן', null, 'finished')$$, 'owner finishes a project');
insert into r19 (label, id)
select 'ישן', id from public.projects where name = 'ישן';
select throws_ok(
  format(
    'select public.collapse_split(%L::uuid, %L::uuid)',
    (select id from r19 where label = 'leasing'),
    (select id from r19 where label = 'ישן')
  ),
  'P0001',
  'project is finished',
  'a finished project is refused'
);

select tests.authenticate_as('r19_b');
select lives_ok($$select public.create_company('סבב 19 ב', true)$$, 'the other owner creates a company');
select lives_ok($$select public.upsert_project(null, 'זר', null, 'active')$$, 'the other owner opens a project');
insert into r19 (label, id)
select 'זר', id from public.projects where name = 'זר';

select tests.authenticate_as('r19_a');
select throws_ok(
  format(
    'select public.collapse_split(%L::uuid, %L::uuid)',
    (select id from r19 where label = 'leasing'),
    (select id from r19 where label = 'זר')
  ),
  'P0001',
  'project not found',
  'a foreign project is refused'
);

select tests.authenticate_as('r19_b');
select throws_ok(
  format(
    'select public.collapse_split(%L::uuid, %L::uuid)',
    (select id from r19 where label = 'leasing'),
    (select id from r19 where label = 'זר')
  ),
  'P0001',
  'transaction not found',
  'a foreign company cannot collapse the split'
);

select * from finish();

rollback;
