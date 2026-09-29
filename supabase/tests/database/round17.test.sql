-- Round 17: a six-way split keeps every share when the category changes.
-- This is the live case: one expense, six projects, a later category tap.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('r17_a', 'r17-a@test.flow');
end
$users$;

select tests.authenticate_as('r17_a');
select lives_ok($$select public.create_company('סבב 17', true)$$, 'owner creates a company');

create temp table r17 (label text primary key, id uuid);
grant all on r17 to authenticated, service_role;
insert into r17 (label, id) select 'company', id from public.companies;

select lives_ok($$select public.upsert_project(null, 'אלון', null, 'active')$$, 'owner opens אלון');
select lives_ok($$select public.upsert_project(null, 'נמל', null, 'active')$$, 'owner opens נמל');
select lives_ok($$select public.upsert_project(null, 'צפון', null, 'active')$$, 'owner opens צפון');
select lives_ok($$select public.upsert_project(null, 'דרום', null, 'active')$$, 'owner opens דרום');
select lives_ok($$select public.upsert_project(null, 'מזרח', null, 'active')$$, 'owner opens מזרח');
select lives_ok($$select public.upsert_project(null, 'מערב', null, 'active')$$, 'owner opens מערב');

insert into r17 (label, id)
select name, id from public.projects
where name in ('אלון', 'נמל', 'צפון', 'דרום', 'מזרח', 'מערב');
insert into r17 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r17 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, category_id
)
select id, 'expense', 'expense', 'shared', -377600, -320000, -57600, 'source',
  '2026-07-01', 'manual', 'r17:leasing', 'ליסינג לדוגמה',
  (select id from r17 where label = 'materials')
from r17 where label = 'company';
insert into r17 (label, id)
select 'leasing', id from public.transactions where idempotency_key = 'r17:leasing';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select
  (select id from r17 where label = 'company'),
  (select id from r17 where label = 'leasing'),
  p.id,
  s.share_bp,
  (-320000 * s.share_bp) / 10000
from (
  values
    ('אלון', 1667),
    ('נמל', 1667),
    ('צפון', 1667),
    ('דרום', 1667),
    ('מזרח', 1666),
    ('מערב', 1666)
) as s(name, share_bp)
join public.projects p on p.name = s.name;

select tests.authenticate_as('r17_a');
select lives_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid)',
    (select id from r17 where label = 'leasing'),
    (select id from r17 where label = 'haul')
  ),
  'a six-way split can change category'
);

select is(
  (select category_id from public.transactions where id = (select id from r17 where label = 'leasing')),
  (select id from r17 where label = 'haul'),
  'the category is the one the owner picked'
);
select is(
  (select user_assigned from public.transactions where id = (select id from r17 where label = 'leasing')),
  true,
  'the owner assigned the category'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r17 where label = 'leasing')),
  6,
  'all six shares stay'
);
select is(
  (select string_agg(share_bp::text, ',' order by share_bp, project_id::text)
    from public.allocations
    where transaction_id = (select id from r17 where label = 'leasing')),
  '1666,1666,1667,1667,1667,1667',
  'each share is the one that was saved'
);
select is(
  (select pnl_role::text from public.transactions where id = (select id from r17 where label = 'leasing')),
  'shared',
  'the row stays shared'
);
select is(
  (select project_id from public.transactions where id = (select id from r17 where label = 'leasing')),
  null,
  'a shared row still has no single project'
);

select * from finish();
rollback;
