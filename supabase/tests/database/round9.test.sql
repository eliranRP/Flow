-- A category save closes only a missing category. A new SUMIT company retires the previous ledger.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('r9_a', 'r9-a@test.flow');
end
$users$;

select tests.authenticate_as('r9_a');
select lives_ok($$select public.create_company('סבב 9', true)$$, 'owner creates a company');

create temp table r9 (label text primary key, id uuid);
grant all on r9 to authenticated, service_role;
insert into r9 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r9 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
insert into r9 (label, id) select 'beta', id from public.projects where name = 'ביתא';
insert into r9 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'shared', -100000, -100000, 0, 'unknown',
  '2026-09-04', 'sumit', 'r9:missing', 'בלי קטגוריה'
from r9 where label = 'company';
insert into r9 (label, id)
select 'missing', id from public.transactions where idempotency_key = 'r9:missing';
insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r9 where label = 'company'), id, 'open', 'missing_category'
from r9 where label = 'missing';
insert into r9 (label, id)
select 'missing_review', id from public.review_queue
where transaction_id = (select id from r9 where label = 'missing') and reason = 'missing_category';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, description
)
select c.id, 'expense', 'expense', 'shared', -80000, -80000, 0, 'unknown',
  '2026-09-05', 'sumit', 'r9:shared', (select id from r9 where label = 'haul'), 'עלות משותפת'
from r9 c where c.label = 'company';
insert into r9 (label, id)
select 'shared', id from public.transactions where idempotency_key = 'r9:shared';
insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r9 where label = 'company'), id, 'open', 'unallocated_shared'
from r9 where label = 'shared';
insert into r9 (label, id)
select 'shared_review', id from public.review_queue
where transaction_id = (select id from r9 where label = 'shared') and reason = 'unallocated_shared';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project', -1000, -1000, 0, 'unknown',
  '2026-09-06', 'manual', 'r9:manual', 'ידני'
from r9 where label = 'company';

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version,
  reject_attempts, next_attempt_at, last_sync_at, last_error
)
select id, 100, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2',
  4, now() + interval '6 hours', now() - interval '1 day', 'sumit_rejected'
from r9 where label = 'company';

select tests.authenticate_as('r9_a');
select throws_ok(
    $$select public.replace_sumit_connection(
    '00000000-0000-0000-0000-000000000001'::uuid, 1, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true
  )$$,
  '42501',
  null,
  'an owner cannot replace the SUMIT connection'
);
select function_privs_are(
  'public', 'replace_sumit_connection',
  array['uuid', 'bigint', 'text', 'text', 'text', 'text', 'text', 'text', 'boolean'],
  'anon', array[]::text[],
  'anon cannot replace the SUMIT connection'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 100, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true)$$,
    (select id from r9 where label = 'company')
  ),
  'connecting the same SUMIT company resets the backoff'
);
select is(
  (select reject_attempts from public.sumit_connections where company_id = (select id from r9 where label = 'company')),
  0,
  'connect clears the attempt count'
);
select is(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from r9 where label = 'company')),
  null,
  'connect clears the retry clock'
);
select is(
  (select last_sync_at from public.sumit_connections where company_id = (select id from r9 where label = 'company')),
  null,
  'connect clears the last sync'
);
select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r9 where label = 'company')
      and source = 'sumit' and removed_at is null),
  2,
  'the same SUMIT company keeps its ledger'
);

select tests.authenticate_as('r9_a');
select lives_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid)',
    (select id from r9 where label = 'missing'),
    (select id from r9 where label = 'haul')
  ),
  'a missing category can be saved'
);
select is(
  (select status::text from public.review_queue where id = (select id from r9 where label = 'missing_review')),
  'changed',
  'the missing-category item closes'
);
select is(
  (select count(*)::int from public.review_queue
    where transaction_id = (select id from r9 where label = 'missing')
      and reason = 'unallocated_shared' and status = 'open'),
  1,
  'an unsplit shared cost opens an unallocated item'
);

reset role;
select is(
  (select prior_review_id from public.reassign_undo
    where transaction_id = (select id from r9 where label = 'missing') and undone_at is null),
  (select id from r9 where label = 'missing_review'),
  'undo remembers the closed review item'
);
insert into r9 (label, id)
select 'undo', id from public.reassign_undo
where transaction_id = (select id from r9 where label = 'missing') and undone_at is null;

select tests.authenticate_as('r9_a');
select lives_ok(
  format('select public.undo_reassign(%L::uuid)', (select id from r9 where label = 'undo')),
  'undo reopens the missing category'
);
select is(
  (select status::text from public.review_queue where id = (select id from r9 where label = 'missing_review')),
  'open',
  'the missing-category item is open again'
);
select is(
  (select count(*)::int from public.review_queue
    where transaction_id = (select id from r9 where label = 'missing')
      and reason = 'unallocated_shared' and status = 'open'),
  0,
  'undo removes the follow-up unallocated item'
);

select lives_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid)',
    (select id from r9 where label = 'shared'),
    (select id from r9 where label = 'haul')
  ),
  'an unallocated shared cost can still change category'
);
select is(
  (select status::text from public.review_queue where id = (select id from r9 where label = 'shared_review')),
  'open',
  'the unallocated shared item stays open'
);
select is(
  (select status::text from public.review_queue where id = (select id from r9 where label = 'missing_review')),
  'open',
  'the other open item is left alone'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 200, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true)$$,
    (select id from r9 where label = 'company')
  ),
  'a new SUMIT company retires the previous ledger'
);
select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r9 where label = 'company')
      and source = 'sumit' and removed_at is null),
  0,
  'SUMIT rows from the previous company are retired'
);
select is(
  (select removed_at is null from public.transactions where idempotency_key = 'r9:manual'),
  true,
  'a manual row stays'
);
select is(
  (select count(*)::int from public.review_queue
    where company_id = (select id from r9 where label = 'company') and status = 'open'),
  0,
  'open reviews on the retired ledger are closed'
);

select * from finish();
rollback;
