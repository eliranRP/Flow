-- Round 18: collapsing a split moves the full net onto one project,
-- drops the shared-cost note on the projects that lost the share,
-- and undo puts the shares back.

begin;

select plan(35);

do $users$
begin
  perform tests.create_supabase_user('r18_a', 'r18-a@test.flow');
end
$users$;

select tests.authenticate_as('r18_a');
select lives_ok($$select public.create_company('סבב 18', true)$$, 'owner creates a company');

create temp table r18 (label text primary key, id uuid);
grant all on r18 to authenticated, service_role;
insert into r18 (label, id) select 'company', id from public.companies;

select lives_ok($$select public.upsert_project(null, 'אלון', null, 'active')$$, 'owner opens אלון');
select lives_ok($$select public.upsert_project(null, 'נמל', null, 'active')$$, 'owner opens נמל');

insert into r18 (label, id)
select name, id from public.projects where name in ('אלון', 'נמל');
insert into r18 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id, project_id
)
select id, 'expense', 'expense', 'project', -59000, -50000, -9000, 'source',
  '2026-07-02', 'manual', 'r18:direct', 'חומר ישיר',
  (select id from r18 where label = 'materials'),
  (select id from r18 where label = 'אלון')
from r18 where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'expense', 'expense', 'shared', -236000, -200000, -36000, 'source',
  '2026-07-01', 'manual', 'r18:leasing', 'ליסינג לדוגמה',
  (select id from r18 where label = 'materials')
from r18 where label = 'company';

insert into r18 (label, id)
select 'leasing', id from public.transactions where idempotency_key = 'r18:leasing';
insert into r18 (label, id)
select 'direct', id from public.transactions where idempotency_key = 'r18:direct';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r18 where label = 'company'),
  (select id from r18 where label = 'leasing'),
  p.id,
  5000,
  -100000
from public.projects p
where p.name in ('אלון', 'נמל');

insert into public.review_queue (company_id, transaction_id, status, reason)
select
  (select id from r18 where label = 'company'),
  (select id from r18 where label = 'leasing'),
  'open',
  'unallocated_shared';

select tests.authenticate_as('r18_a');

select is(
  (select pnl_role::text from public.transactions where id = (select id from r18 where label = 'leasing')),
  'shared',
  'the expense starts shared'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r18 where label = 'leasing')),
  2,
  'two shares are stored'
);
select is(
  ((public.get_project((select id from r18 where label = 'אלון')))->>'direct_agorot')::bigint,
  50000::bigint,
  'אלון direct total is only its own expense'
);
select is(
  ((public.get_project((select id from r18 where label = 'אלון')))->>'shared_agorot')::bigint,
  100000::bigint,
  'אלון shared total is its half'
);
select is(
  (
    select bool_or((cat->>'has_shared_share')::boolean)
    from jsonb_array_elements((public.get_project((select id from r18 where label = 'אלון')))->'categories') cat
  ),
  true,
  'אלון shows the shared-cost note'
);
select is(
  ((public.get_project((select id from r18 where label = 'נמל')))->>'direct_agorot')::bigint,
  0::bigint,
  'נמל has no direct expense yet'
);
select is(
  ((public.get_project((select id from r18 where label = 'נמל')))->>'shared_agorot')::bigint,
  100000::bigint,
  'נמל shared total is its half'
);
select is(
  (
    select bool_or((cat->>'has_shared_share')::boolean)
    from jsonb_array_elements((public.get_project((select id from r18 where label = 'נמל')))->'categories') cat
  ),
  true,
  'נמל shows the shared-cost note'
);

select lives_ok(
  format(
    $$insert into r18 (label, id)
      select 'undo', public.collapse_split(%L::uuid, %L::uuid)$$,
    (select id from r18 where label = 'leasing'),
    (select id from r18 where label = 'נמל')
  ),
  'the owner collapses the split onto נמל'
);

select is(
  (select pnl_role::text from public.transactions where id = (select id from r18 where label = 'leasing')),
  'project',
  'the row is a project expense'
);
select is(
  (select project_id from public.transactions where id = (select id from r18 where label = 'leasing')),
  (select id from r18 where label = 'נמל'),
  'the whole expense sits on נמל'
);
select is(
  (select category_id from public.transactions where id = (select id from r18 where label = 'leasing')),
  (select id from r18 where label = 'materials'),
  'the category stays'
);
select is(
  (select user_assigned from public.transactions where id = (select id from r18 where label = 'leasing')),
  true,
  'the owner assigned the project'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r18 where label = 'leasing')),
  1,
  'the other share lines are gone'
);
select is(
  (select share_bp from public.allocations where transaction_id = (select id from r18 where label = 'leasing')),
  10000,
  'the remaining share is the full amount'
);
select is(
  (select amount_net from public.allocations where transaction_id = (select id from r18 where label = 'leasing')),
  -200000::bigint,
  'the share is the full net, with no remainder'
);
select is(
  (select count(*)::int from public.allocations
    where transaction_id = (select id from r18 where label = 'leasing')
      and project_id = (select id from r18 where label = 'אלון')),
  0,
  'אלון no longer has a share of this expense'
);
select is(
  ((public.get_project((select id from r18 where label = 'נמל')))->>'direct_agorot')::bigint,
  200000::bigint,
  'נמל direct total is the full expense'
);
select is(
  ((public.get_project((select id from r18 where label = 'נמל')))->>'shared_agorot')::bigint,
  0::bigint,
  'נמל shared total is gone'
);
select is(
  (
    select bool_or((cat->>'has_shared_share')::boolean)
    from jsonb_array_elements((public.get_project((select id from r18 where label = 'נמל')))->'categories') cat
  ),
  false,
  'נמל drops the shared-cost note'
);
select is(
  ((public.get_project((select id from r18 where label = 'אלון')))->>'direct_agorot')::bigint,
  50000::bigint,
  'אלון direct total stays its own expense'
);
select is(
  ((public.get_project((select id from r18 where label = 'אלון')))->>'shared_agorot')::bigint,
  0::bigint,
  'אלון shared total is gone'
);
select is(
  (
    select bool_or((cat->>'has_shared_share')::boolean)
    from jsonb_array_elements((public.get_project((select id from r18 where label = 'אלון')))->'categories') cat
  ),
  false,
  'אלון drops the shared-cost note'
);
select is(
  (select status::text from public.review_queue where transaction_id = (select id from r18 where label = 'leasing')),
  'changed',
  'the open shared review is closed as changed'
);

select lives_ok(
  format(
    'select public.undo_reassign(%L::uuid)',
    (select id from r18 where label = 'undo')
  ),
  'undo puts the split back'
);

select is(
  (select pnl_role::text from public.transactions where id = (select id from r18 where label = 'leasing')),
  'shared',
  'undo restores the shared role'
);
select is(
  (select project_id from public.transactions where id = (select id from r18 where label = 'leasing')),
  null,
  'undo clears the single project'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r18 where label = 'leasing')),
  2,
  'undo restores both shares'
);
select is(
  (select status::text from public.review_queue where transaction_id = (select id from r18 where label = 'leasing')),
  'open',
  'undo reopens the shared review'
);
select is(
  ((public.get_project((select id from r18 where label = 'אלון')))->>'shared_agorot')::bigint,
  100000::bigint,
  'undo puts אלון share back on the shared total'
);
select is(
  (
    select bool_or((cat->>'has_shared_share')::boolean)
    from jsonb_array_elements((public.get_project((select id from r18 where label = 'נמל')))->'categories') cat
  ),
  true,
  'undo brings the shared-cost note back'
);

select throws_ok(
  format(
    'select public.collapse_split(%L::uuid, %L::uuid)',
    (select id from r18 where label = 'direct'),
    (select id from r18 where label = 'נמל')
  ),
  'P0001',
  'transaction is not split',
  'a project expense is not collapsed'
);

select * from finish();
rollback;
