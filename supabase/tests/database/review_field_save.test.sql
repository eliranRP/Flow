-- A card-line pick writes one field and leaves the review open.

begin;

select plan(10);

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

select * from finish();
rollback;
