-- reassign_undo stays invisible to the owner. Catalogue flags are not the check.

begin;

select plan(3);

do $users$
begin
  perform tests.create_supabase_user('r10_rls', 'r10-rls@test.flow');
end
$users$;

select tests.authenticate_as('r10_rls');
select lives_ok($$select public.create_company('בידוד', true)$$, 'owner creates a company');

reset role;
insert into public.transactions (
  company_id, direction, doc_kind,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', -100, -100, 0, 'unknown',
  '2026-09-01', 'manual', 'r10:undo-row', 'שורה'
from public.companies
where name = 'בידוד';

insert into public.reassign_undo (
  company_id, transaction_id, prior_user_assigned, prior_allocations
)
select t.company_id, t.id, false, '[]'::jsonb
from public.transactions t
where t.idempotency_key = 'r10:undo-row';

select tests.authenticate_as('r10_rls');
select is(
  (select count(*)::int from public.reassign_undo),
  0,
  'an authenticated owner selects no undo rows'
);
select throws_ok(
  $$insert into public.reassign_undo (company_id, transaction_id, prior_user_assigned, prior_allocations)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', false, '[]'::jsonb)$$,
  '42501',
  null,
  'an authenticated owner cannot insert an undo row'
);

select * from finish();
rollback;
