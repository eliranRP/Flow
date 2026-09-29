-- reopen_review restores the prior category. The fill trigger clears
-- category_suggested when that category is non-null and different, and it
-- recomputes the flag only when the restored category is null.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('r12_a', 'r12-a@test.flow');
end
$users$;

select tests.authenticate_as('r12_a');
select lives_ok($$select public.create_company('סבב 12', true)$$, 'owner creates a company');

create temp table r12 (label text primary key, id uuid);
grant all on r12 to authenticated, service_role;
insert into r12 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r12 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
insert into r12 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r12 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -900, -900, 0, 'unknown',
  '2026-09-04', 'manual', 'r12:distinct', p.id, 'קטגוריה מוצעת'
from r12 c
join r12 p on p.label = 'alpha'
where c.label = 'company';

insert into r12 (label, id)
select 'filled', category_id from public.transactions where idempotency_key = 'r12:distinct';

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r12:distinct'),
  true,
  'a category Flow filled starts as a suggestion'
);

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'suggested'
from public.transactions t
where t.idempotency_key = 'r12:distinct';
insert into r12 (label, id)
select 'distinct_review', id from public.review_queue
where transaction_id = (select id from public.transactions where idempotency_key = 'r12:distinct');

select tests.authenticate_as('r12_a');
select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, false)',
    (select id from r12 where label = 'distinct_review'),
    (select id from r12 where label = 'alpha'),
    (select id from r12 where label = (
      case
        when (select id from r12 where label = 'filled') = (select id from r12 where label = 'haul')
        then 'materials'
        else 'haul'
      end
    ))
  ),
  'approve replaces the suggested category with a different one'
);
select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r12 where label = 'distinct_review')),
  'reopen restores the earlier category'
);
select is(
  (select category_id from public.transactions where idempotency_key = 'r12:distinct'),
  (select id from r12 where label = 'filled'),
  'reopen puts the earlier category back'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r12:distinct'),
  false,
  'a non-null restored category clears category_suggested'
);

reset role;
update public.categories
set is_default = false
where company_id = (select id from r12 where label = 'company')
  and kind = 'expense';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -400, -400, 0, 'unknown',
  '2026-09-05', 'manual', 'r12:empty', p.id, 'בלי קטגוריה'
from r12 c
join r12 p on p.label = 'alpha'
where c.label = 'company';

select ok(
  (select category_id is null from public.transactions where idempotency_key = 'r12:empty'),
  'with no default, the row stays uncategorised'
);

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.idempotency_key = 'r12:empty';
insert into r12 (label, id)
select 'empty_review', id from public.review_queue
where transaction_id = (select id from public.transactions where idempotency_key = 'r12:empty');

select tests.authenticate_as('r12_a');
select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, false)',
    (select id from r12 where label = 'empty_review'),
    (select id from r12 where label = 'alpha'),
    (select id from r12 where label = 'materials')
  ),
  'approve assigns a category while none was stored'
);

reset role;
update public.categories
set is_default = true
where id = (select id from r12 where label = 'haul');

select tests.authenticate_as('r12_a');
select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r12 where label = 'empty_review')),
  'reopen onto a null category runs the fill trigger'
);
select is(
  (select category_id from public.transactions where idempotency_key = 'r12:empty'),
  (select id from r12 where label = 'haul'),
  'the trigger fills the default category on reopen'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r12:empty'),
  true,
  'a category filled on reopen stays a suggestion'
);

select * from finish();
rollback;
