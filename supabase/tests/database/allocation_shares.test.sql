-- Allocation shares must total 10000, including after a transaction_id change.

begin;

select plan(3);

do $users$
begin
  perform tests.create_supabase_user('alloc_owner');
end
$users$;

insert into public.companies (owner_id, name)
values (tests.get_supabase_uid('alloc_owner'), 'הקצאה');

insert into public.projects (company_id, name)
select id, 'פרויקט א' from public.companies where name = 'הקצאה';
insert into public.projects (company_id, name)
select id, 'פרויקט ב' from public.companies where name = 'הקצאה';

insert into public.transactions (
  company_id, direction, doc_kind,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 10000, 10000, 0, 'unknown',
  '2026-04-01', 'manual', 'alloc-1', 'ראשון'
from public.companies where name = 'הקצאה';

insert into public.transactions (
  company_id, direction, doc_kind,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 10000, 10000, 0, 'unknown',
  '2026-04-01', 'manual', 'alloc-2', 'שני'
from public.companies where name = 'הקצאה';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select c.id, t.id, p.id, 6000, 6000
from public.companies c
join public.transactions t on t.company_id = c.id and t.idempotency_key = 'alloc-1'
join public.projects p on p.company_id = c.id and p.name = 'פרויקט א'
where c.name = 'הקצאה';

select throws_ok(
  $$set constraints all immediate$$,
  '23514',
  NULL,
  'a partial allocation does not pass'
);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select c.id, t.id, p.id, 4000, 4000
from public.companies c
join public.transactions t on t.company_id = c.id and t.idempotency_key = 'alloc-1'
join public.projects p on p.company_id = c.id and p.name = 'פרויקט ב'
where c.name = 'הקצאה';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select c.id, t.id, p.id, 10000, 10000
from public.companies c
join public.transactions t on t.company_id = c.id and t.idempotency_key = 'alloc-2'
join public.projects p on p.company_id = c.id and p.name = 'פרויקט ב'
where c.name = 'הקצאה';

select lives_ok($$set constraints all immediate$$, 'balanced shares pass');

select throws_ok(
  $$update public.allocations
    set transaction_id = (
      select t.id
      from public.transactions t
      join public.companies c on c.id = t.company_id
      where t.idempotency_key = 'alloc-2'
        and c.name = 'הקצאה'
    )
    where company_id = (select id from public.companies where name = 'הקצאה')
      and share_bp = 6000$$,
  '23514',
  NULL,
  'moving an allocation checks the old and the new transaction'
);

select * from finish();

rollback;
