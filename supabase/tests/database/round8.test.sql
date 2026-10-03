-- Round 8: a category change keeps a split, a rejection increments once, a stamp clears the wait.

begin;

select plan(32);

do $users$
begin
  perform tests.create_supabase_user('r8_a', 'r8-a@test.flow');
  perform tests.create_supabase_user('r8_b', 'r8-b@test.flow');
end
$users$;

select tests.authenticate_as('r8_a');
select lives_ok($$select public.create_company('סבב 8', true)$$, 'owner creates a company');

create temp table r8 (label text primary key, id uuid);
grant all on r8 to authenticated, service_role;
insert into r8 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r8 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
insert into r8 (label, id) select 'beta', id from public.projects where name = 'ביתא';
insert into r8 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r8 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';
insert into r8 (label, id)
select 'income_cat', id from public.categories where name = 'תקבול מלקוח' and kind = 'income';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'shared', -100000, -100000, 0, 'unknown',
  '2026-09-04', 'manual', 'r8:shared', 'עלות משותפת'
from r8 where label = 'company';
insert into r8 (label, id)
select 'shared', id from public.transactions where idempotency_key = 'r8:shared';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from r8 where label = 'company'), (select id from r8 where label = 'shared'), id, 6000, -60000
from r8 where label = 'alpha';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from r8 where label = 'company'), (select id from r8 where label = 'shared'), id, 4000, -40000
from r8 where label = 'beta';

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version,
  reject_attempts, next_attempt_at
)
select id, 1, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2',
  3, now() + interval '2 hours'
from r8 where label = 'company';

select tests.authenticate_as('r8_a');
select lives_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid)',
    (select id from r8 where label = 'shared'),
    (select id from r8 where label = 'haul')
  ),
  'a shared cost can change category'
);

select is(
  (select category_id from public.transactions where id = (select id from r8 where label = 'shared')),
  (select id from r8 where label = 'haul'),
  'the category is the one the owner picked'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r8 where label = 'shared')),
  2,
  'the two shares stay'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r8 where label = 'shared')
      and project_id = (select id from r8 where label = 'alpha')),
  6000,
  'אלפא keeps 60%'
);
select is(
  (select share_bp from public.allocations
    where transaction_id = (select id from r8 where label = 'shared')
      and project_id = (select id from r8 where label = 'beta')),
  4000,
  'ביתא keeps 40%'
);
select is(
  (select pnl_role::text from public.transactions where id = (select id from r8 where label = 'shared')),
  'shared',
  'the row stays shared'
);
select is(
  (select project_id from public.transactions where id = (select id from r8 where label = 'shared')),
  null,
  'a shared row still has no single project'
);

reset role;
insert into r8 (label, id)
select 'undo', id from public.reassign_undo
where transaction_id = (select id from r8 where label = 'shared') and undone_at is null;

select tests.authenticate_as('r8_a');
select lives_ok(
  format('select public.undo_reassign(%L::uuid)', (select id from r8 where label = 'undo')),
  'undo restores the suggested default category'
);
select is(
  (select category_id from public.transactions where id = (select id from r8 where label = 'shared')),
  (select id from r8 where label = 'materials'),
  'the previous category is the suggested default'
);
select is(
  (select category_suggested from public.transactions where id = (select id from r8 where label = 'shared')),
  true,
  'undo restores the suggestion flag'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from r8 where label = 'shared')),
  2,
  'undo puts the same two shares back'
);

select throws_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid)',
    (select id from r8 where label = 'shared'),
    (select id from r8 where label = 'income_cat')
  ),
  'P0001',
  'category kind must match the direction',
  'an income category cannot label an expense'
);
select throws_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r8 where label = 'shared'),
    (select id from r8 where label = 'alpha'),
    (select id from r8 where label = 'haul')
  ),
  'P0001',
  'shared costs are split, not assigned to one project',
  'reassign still refuses a shared cost'
);

select tests.authenticate_as('r8_b');
select lives_ok($$select public.create_company('סבב 8 ב', true)$$, 'the other owner creates a company');
select throws_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid)',
    (select id from r8 where label = 'shared'),
    (select id from r8 where label = 'haul')
  ),
  'P0001',
  'transaction not found',
  'another owner cannot change the category'
);

select function_privs_are(
  'public', 'set_transaction_category', array['uuid', 'uuid', 'boolean'], 'anon', array[]::text[],
  'anon cannot set a category'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select lives_ok(
  format('select public.stamp_sumit_sync(%L::uuid)', (select id from r8 where label = 'company')),
  'a stamp clears a rejection'
);
select is(
  (select reject_attempts from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  0,
  'stamp resets the attempt count'
);
select is(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  null,
  'stamp clears the next attempt'
);

select lives_ok(
  format(
    $$select public.note_sumit_rejection(%L::uuid, 'sumit_rejected')$$,
    (select id from r8 where label = 'company')
  ),
  'a billing rejection is recorded'
);
select is(
  (select reject_attempts from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  1,
  'the first rejection is attempt 1'
);
select cmp_ok(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  '>',
  now(),
  'the next attempt is in the future'
);
select cmp_ok(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  '<',
  now() + interval '6 minutes',
  'the first wait is five minutes'
);

select lives_ok(
  format(
    $$select public.note_sumit_rejection(%L::uuid, 'sumit_auth')$$,
    (select id from r8 where label = 'company')
  ),
  'a bad key is recorded without a wait'
);
select is(
  (select last_error from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  'sumit_auth',
  'the connection asks for a reconnect'
);
select is(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  null,
  'auth does not schedule a retry'
);
select is(
  (select reject_attempts from public.sumit_connections where company_id = (select id from r8 where label = 'company')),
  1,
  'auth does not add an attempt'
);

select function_privs_are(
  'public', 'note_sumit_rejection', array['uuid', 'text'], 'anon', array[]::text[],
  'anon cannot note a rejection'
);
select function_privs_are(
  'public', 'list_due_refresh_requests', array['integer'], 'anon', array[]::text[],
  'anon cannot list the drain'
);

select * from finish();

rollback;
