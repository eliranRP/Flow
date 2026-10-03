-- A card-line pick writes one field and leaves the review open.

begin;

select plan(34);

do $users$
begin
  perform tests.create_supabase_user('field_a', 'field-a@test.flow');
end
$users$;

select tests.authenticate_as('field_a');
select lives_ok($$select public.create_company('שדה', true)$$, 'owner creates a company');

create temp table field_save (label text primary key, id uuid);
grant all on field_save to authenticated, service_role;
insert into field_save (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'הרצל', null, 'active')$$, 'owner opens a project');
insert into field_save (label, id) select 'project', id from public.projects where name = 'הרצל';
insert into field_save (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into field_save (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-29', 'manual', 'field:both', p.id, m.id, 'ספק השדה', true
from field_save c
join field_save p on p.label = 'project'
join field_save m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', 'overhead',
  -10000, -10000, 0, 'unknown',
  '2026-09-29', 'manual', 'field:none', 'בלי פרויקט', false
from field_save c
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.idempotency_key in ('field:both', 'field:none');

insert into field_save (label, id)
select 'both_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'field:both';

insert into field_save (label, id)
select 'none_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'field:none';

select tests.authenticate_as('field_a');

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', null, %L::uuid, true, false)',
    (select id from field_save where label = 'both_review'),
    (select id from field_save where label = 'haul')
  ),
  'a category-only save does not require the project argument to resolve'
);

select is(
  (select status from public.review_queue where id = (select id from field_save where label = 'both_review')),
  'open'::public.review_status,
  'the review stays open'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'field:both'),
  (select id from field_save where label = 'haul'),
  'the category changed'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'field:both'),
  (select id from field_save where label = 'project'),
  'the project was left alone'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', null, %L::uuid, true, false)',
    (select id from field_save where label = 'none_review'),
    (select id from field_save where label = 'materials')
  ),
  'a category can be saved when the card has no project'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'field:none'),
  null,
  'the empty project stays empty'
);

select is(
  (select status from public.review_queue where id = (select id from field_save where label = 'none_review')),
  'open'::public.review_status,
  'a category-only card stays in the queue'
);

select function_privs_are(
  'public', 'resolve_review', array['uuid', 'text', 'uuid', 'uuid', 'boolean', 'boolean'], 'anon', array[]::text[],
  'anon cannot resolve a review'
);

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', 'shared',
  -10000, -10000, 0, 'unknown',
  '2026-09-29', 'manual', 'field:unallocated', 'משותפת בלי חלוקה', false
from field_save c
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'shared',
  -10000, -10000, 0, 'unknown',
  '2026-09-29', 'manual', 'field:shared', p.id, 'עלות משותפת', false
from field_save c
join field_save p on p.label = 'project'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', 'overhead',
  -10000, -10000, 0, 'unknown',
  '2026-09-29', 'manual', 'field:overhead', 'תקורה', false
from field_save c
where c.label = 'company';

insert into public.overhead (company_id, transaction_id)
select t.company_id, t.id
from public.transactions t
where t.idempotency_key = 'field:overhead';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-27', 'manual', 'field:guess-project', p.id, m.id, 'ניחוש פרויקט', false
from field_save c
join field_save p on p.label = 'project'
join field_save m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-26', 'manual', 'field:guess-category', p.id, m.id, 'ניחוש קטגוריה', false
from field_save c
join field_save p on p.label = 'project'
join field_save m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-25', 'manual', 'field:category-flag', p.id, m.id, 'דגל קטגוריה', false
from field_save c
join field_save p on p.label = 'project'
join field_save m on m.label = 'materials'
where c.label = 'company';

-- An insert with a category clears the guess. Put it back so a later field save can keep it.
update public.transactions
set category_suggested = true
where idempotency_key in ('field:guess-project', 'field:guess-category');

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open',
  case t.idempotency_key
    when 'field:unallocated' then 'unallocated_shared'
    else 'missing_category'
  end
from public.transactions t
where t.idempotency_key in (
  'field:unallocated', 'field:shared', 'field:overhead',
  'field:guess-project', 'field:guess-category', 'field:category-flag'
);

insert into field_save (label, id)
select 'unallocated_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'field:unallocated';

insert into field_save (label, id)
select 'shared_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'field:shared';

insert into field_save (label, id)
select 'overhead_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'field:overhead';

insert into field_save (label, id)
select 'guess_project_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'field:guess-project';

insert into field_save (label, id)
select 'guess_category_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'field:guess-category';

select tests.authenticate_as('field_a');

select throws_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', %L::uuid, null, true, false)',
    (select id from field_save where label = 'unallocated_review'),
    (select id from field_save where label = 'project')
  ),
  'P0001',
  'shared costs are split, not assigned to one project',
  'a project pick on an unallocated shared cost raises'
);

select throws_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', %L::uuid, null, true, false)',
    (select id from field_save where label = 'shared_review'),
    (select id from field_save where label = 'project')
  ),
  'P0001',
  'shared costs are split, not assigned to one project',
  'a project pick on a shared cost raises'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', %L::uuid, null, true, false)',
    (select id from field_save where label = 'overhead_review'),
    (select id from field_save where label = 'project')
  ),
  'a project pick on overhead leaves the review open'
);

select is(
  (select count(*)::int from public.overhead o
    join public.transactions t on t.id = o.transaction_id
    where t.idempotency_key = 'field:overhead'),
  0,
  'the overhead row is removed'
);

select is(
  (select pnl_role from public.transactions where idempotency_key = 'field:overhead'),
  'project'::public.pnl_role,
  'overhead becomes a project cost'
);

select is(
  (select status from public.review_queue where id = (select id from field_save where label = 'overhead_review')),
  'open'::public.review_status,
  'the overhead card stays in the queue'
);

select is(
  (select project_assigned from public.transactions where idempotency_key = 'field:overhead'),
  true,
  'the picked project is the owner''s'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', %L::uuid, null, true, false)',
    (select id from field_save where label = 'guess_project_review'),
    (select id from field_save where label = 'project')
  ),
  'a project-only save leaves the category guess'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'field:guess-project'),
  true,
  'the category guess survives a project pick'
);

select is(
  (select user_assigned from public.transactions where idempotency_key = 'field:guess-project'),
  false,
  'a project pick does not mark the whole row'
);

select is(
  (select project_assigned from public.transactions where idempotency_key = 'field:guess-project'),
  true,
  'a project pick marks the project'
);

select is(
  (
    select (elem->>'project_suggested')::boolean
    from jsonb_array_elements(public.list_review()) elem
    where elem->>'description' = 'ניחוש פרויקט'
  ),
  false,
  'list_review does not call the picked project a guess'
);

select is(
  (
    select (elem->>'category_suggested')::boolean
    from jsonb_array_elements(public.list_review()) elem
    where elem->>'description' = 'ניחוש פרויקט'
  ),
  true,
  'list_review still reports the category guess'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', null, %L::uuid, true, false)',
    (select id from field_save where label = 'guess_category_review'),
    (select id from field_save where label = 'haul')
  ),
  'a category-only save leaves the project guess'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'field:guess-category'),
  (select id from field_save where label = 'haul'),
  'the category guess was replaced'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'field:guess-category'),
  false,
  'the picked category is the owner''s'
);

select is(
  (select user_assigned from public.transactions where idempotency_key = 'field:guess-category'),
  false,
  'a category pick does not mark the whole row'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'field:guess-category'),
  (select id from field_save where label = 'project'),
  'the project was left on the guess'
);

select is(
  (select project_assigned from public.transactions where idempotency_key = 'field:guess-category'),
  false,
  'a category pick does not own the project'
);

select is(
  (
    select (elem->>'project_suggested')::boolean
    from jsonb_array_elements(public.list_review()) elem
    where elem->>'description' = 'ניחוש קטגוריה'
  ),
  true,
  'list_review still reports the project guess'
);

select lives_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from public.transactions where idempotency_key = 'field:category-flag'),
    (select id from field_save where label = 'haul')
  ),
  'set_transaction_category can leave the review open'
);

select is(
  (
    select q.status
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'field:category-flag'
  ),
  'open'::public.review_status,
  'a category save with p_resolve false stays open'
);

select function_privs_are(
  'public', 'resolve_review', array['uuid', 'text', 'uuid', 'uuid', 'boolean', 'boolean'], 'authenticated', array['EXECUTE'],
  'authenticated can resolve a review'
);

select function_privs_are(
  'public', 'set_transaction_category', array['uuid', 'uuid', 'boolean'], 'authenticated', array['EXECUTE'],
  'authenticated can set a category'
);

select * from finish();
rollback;
