-- A same-category approval restores the suggestion on undo.
-- A guess already undone is put back when the review or the audit shows it.
-- A sync failure waits, so it cannot fill the drain page.

begin;

select plan(42);

do $users$
begin
  perform tests.create_supabase_user('r13_a', 'r13-a@test.flow');
  perform tests.create_supabase_user('r13_b', 'r13-b@test.flow');
end
$users$;

select tests.authenticate_as('r13_a');
select lives_ok($$select public.create_company('סבב 13', true)$$, 'owner creates a company');

create temp table r13 (label text primary key, id uuid);
grant all on r13 to authenticated, service_role;
insert into r13 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r13 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
insert into r13 (label, id) select 'beta', id from public.projects where name = 'ביתא';
select lives_ok($$select public.upsert_project(null, 'דלתא', null, 'active')$$, 'owner opens דלתא');
insert into r13 (label, id) select 'delta', id from public.projects where name = 'דלתא';
insert into r13 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r13 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -5000, -5000, 0, 'unknown',
  '2026-09-06', 'manual', 'r13:same', p.id, 'אותה קטגוריה'
from r13 c
join r13 p on p.label = 'alpha'
where c.label = 'company';

insert into r13 (label, id)
select 'same', id from public.transactions where idempotency_key = 'r13:same';
insert into r13 (label, id)
select 'filled', category_id from public.transactions where idempotency_key = 'r13:same';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'suggested'
from public.transactions t
where t.idempotency_key = 'r13:same';
insert into r13 (label, id)
select 'same_review', id from public.review_queue
where transaction_id = (select id from r13 where label = 'same');

select tests.authenticate_as('r13_a');
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'same')),
  true,
  'the filled category starts as a suggestion'
);
select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, false)',
    (select id from r13 where label = 'same_review'),
    (select id from r13 where label = 'alpha'),
    (select id from r13 where label = 'filled')
  ),
  'approve keeps the suggested category'
);
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'same')),
  false,
  'approving the guess confirms it'
);
select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r13 where label = 'same_review')),
  'reopen restores the guess'
);
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'same')),
  true,
  'reopen of the same category keeps the suggestion'
);
select is(
  ((public.get_project((select id from r13 where label = 'alpha')) ->> 'pending_count')::int),
  1,
  'the restored guess is waiting for approval'
);
select is(
  jsonb_array_length(public.get_project((select id from r13 where label = 'alpha')) -> 'categories'),
  0,
  'the restored guess is not named'
);

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -4000, -4000, 0, 'unknown',
  '2026-09-07', 'manual', 'r13:undo', p.id, 'ביטול שיוך'
from r13 c
join r13 p on p.label = 'beta'
where c.label = 'company';
insert into r13 (label, id)
select 'undo_txn', id from public.transactions where idempotency_key = 'r13:undo';
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'suggested'
from public.transactions t
where t.idempotency_key = 'r13:undo';

select tests.authenticate_as('r13_a');
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'undo_txn')),
  true,
  'the second guess starts suggested'
);
select lives_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r13 where label = 'undo_txn'),
    (select id from r13 where label = 'beta'),
    (select category_id from public.transactions where id = (select id from r13 where label = 'undo_txn'))
  ),
  'reassign keeps the suggested category'
);

reset role;
insert into r13 (label, id)
select 'undo_row', id from public.reassign_undo
where transaction_id = (select id from r13 where label = 'undo_txn') and undone_at is null;

select tests.authenticate_as('r13_a');
select lives_ok(
  format('select public.undo_reassign(%L::uuid)', (select id from r13 where label = 'undo_row')),
  'undo restores the guess'
);
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'undo_txn')),
  true,
  'undo of the same category keeps the suggestion'
);
select is(
  ((public.get_project((select id from r13 where label = 'beta')) ->> 'pending_count')::int),
  1,
  'the undone guess is waiting for approval'
);
select is(
  jsonb_array_length(public.get_project((select id from r13 where label = 'beta')) -> 'categories'),
  0,
  'the undone guess is not named'
);

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project',
  -2000, -2000, 0, 'unknown',
  '2026-09-08', 'manual', 'r13:kept', p.id, m.id, 'קטגוריה מאושרת'
from r13 c
join r13 p on p.label = 'alpha'
join r13 m on m.label = 'materials'
where c.label = 'company';
insert into r13 (label, id)
select 'kept', id from public.transactions where idempotency_key = 'r13:kept';

select tests.authenticate_as('r13_a');
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'kept')),
  false,
  'an explicit category starts confirmed'
);
select lives_ok(
  format(
    'select public.set_transaction_category(%L::uuid, %L::uuid)',
    (select id from r13 where label = 'kept'),
    (select id from r13 where label = 'haul')
  ),
  'the owner can change a confirmed category'
);

reset role;
insert into r13 (label, id)
select 'kept_undo', id from public.reassign_undo
where transaction_id = (select id from r13 where label = 'kept') and undone_at is null;

select tests.authenticate_as('r13_a');
select lives_ok(
  format('select public.undo_reassign(%L::uuid)', (select id from r13 where label = 'kept_undo')),
  'undo restores the confirmed category'
);
select is(
  (select category_id from public.transactions where id = (select id from r13 where label = 'kept')),
  (select id from r13 where label = 'materials'),
  'undo puts the confirmed category back'
);
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'kept')),
  false,
  'a confirmed category stays confirmed'
);

-- Rows already undone before the column existed.
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -3000, -3000, 0, 'unknown',
  '2026-09-09', 'manual', 'r13:stale', p.id, 'ניחוש שבוטל'
from r13 c
join r13 p on p.label = 'delta'
where c.label = 'company';
insert into r13 (label, id)
select 'stale', id from public.transactions where idempotency_key = 'r13:stale';

update public.transactions
set category_suggested = false
where id = (select id from r13 where label = 'stale');

insert into public.review_queue (
  company_id, transaction_id, status, reason, prior_project_id, prior_category_id, prior_pnl_role, prior_user_assigned
)
select t.company_id, t.id, 'open', 'suggested', t.project_id, t.category_id, 'project', false
from public.transactions t
where t.id = (select id from r13 where label = 'stale');
insert into r13 (label, id)
select 'stale_review', id from public.review_queue
where transaction_id = (select id from r13 where label = 'stale');

insert into public.reassign_undo (
  company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
  prior_user_assigned, prior_allocations, prior_review_id, undone_at
)
select t.company_id, t.id, t.project_id, t.category_id, 'project',
  false, '[]'::jsonb, (select id from r13 where label = 'stale_review'), now()
from public.transactions t
where t.id = (select id from r13 where label = 'stale');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project',
  -1500, -1500, 0, 'unknown',
  '2026-09-10', 'manual', 'r13:audit', p.id, m.id, 'לפי היומן'
from r13 c
join r13 p on p.label = 'delta'
join r13 m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project',
  -1600, -1600, 0, 'unknown',
  '2026-09-11', 'manual', 'r13:locked', p.id, m.id, 'מאושר'
from r13 c
join r13 p on p.label = 'delta'
join r13 m on m.label = 'materials'
where c.label = 'company';

update public.transactions
set user_assigned = true
where idempotency_key = 'r13:locked';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project',
  -1700, -1700, 0, 'unknown',
  '2026-09-12', 'manual', 'r13:mismatch', p.id, m.id, 'קטגוריה אחרת'
from r13 c
join r13 p on p.label = 'delta'
join r13 m on m.label = 'materials'
where c.label = 'company';

insert into public.audit_log (company_id, actor_id, action, entity, entity_id, meta)
select t.company_id, u.id, 'update', 'transactions', t.id,
  jsonb_build_object('category_suggested', true, 'category_id', t.category_id)
from public.transactions t
join auth.users u on u.email = 'r13-a@test.flow'
where t.idempotency_key in ('r13:audit', 'r13:locked');

insert into public.audit_log (company_id, actor_id, action, entity, entity_id, meta)
select t.company_id, u.id, 'update', 'transactions', t.id,
  jsonb_build_object(
    'category_suggested', true,
    'category_id', (select id from r13 where label = 'haul')
  )
from public.transactions t
join auth.users u on u.email = 'r13-a@test.flow'
where t.idempotency_key = 'r13:mismatch';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -1800, -1800, 0, 'unknown',
  '2026-09-13', 'manual', 'r13:later', p.id, 'אישור ישן'
from r13 c
join r13 p on p.label = 'delta'
where c.label = 'company';
insert into r13 (label, id)
select 'later', id from public.transactions where idempotency_key = 'r13:later';

update public.transactions
set user_assigned = true
where id = (select id from r13 where label = 'later');

insert into public.review_queue (
  company_id, transaction_id, status, reason,
  prior_project_id, prior_category_id, prior_pnl_role, prior_user_assigned, resolved_at
)
select t.company_id, t.id, 'approved', 'suggested',
  t.project_id, t.category_id, 'project', false, now()
from public.transactions t
where t.id = (select id from r13 where label = 'later');
insert into r13 (label, id)
select 'later_review', id from public.review_queue
where transaction_id = (select id from r13 where label = 'later');

select private.restore_undone_suggestions();

select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'stale')),
  true,
  'an undone guess is suggested again'
);
select is(
  (select prior_category_suggested from public.reassign_undo
    where transaction_id = (select id from r13 where label = 'stale')),
  true,
  'the undo row remembers that the category was a suggestion'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r13:audit'),
  true,
  'an audit row that records the suggestion restores it'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r13:locked'),
  false,
  'a confirmed row stays confirmed when the audit mentions an older guess'
);
select is(
  (select category_suggested from public.transactions where idempotency_key = 'r13:mismatch'),
  false,
  'an audit for a different category does not restore the flag'
);
select is(
  (select prior_category_suggested from public.review_queue where id = (select id from r13 where label = 'later_review')),
  true,
  'an approved suggestion remembers the flag for a later reopen'
);
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'later')),
  false,
  'the backfill leaves an approval in place'
);

select tests.authenticate_as('r13_a');
select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r13 where label = 'later_review')),
  'reopen of an old approval restores the guess'
);
select is(
  (select category_suggested from public.transactions where id = (select id from r13 where label = 'later')),
  true,
  'the old approval reopens as a suggestion'
);

select throws_ok(
  format(
    $$select public.note_sync_failure(%L::uuid, 'sync_failed')$$,
    (select id from r13 where label = 'company')
  ),
  '42501',
  'permission denied for function note_sync_failure',
  'an owner cannot record a sync failure'
);

reset role;
insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 13, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from r13 where label = 'company';

select tests.authenticate_as('r13_b');
select lives_ok($$select public.create_company('סבב 13 ב', true)$$, 'the other owner creates a company');
insert into r13 (label, id) select 'other', id from public.companies where name = 'סבב 13 ב';

reset role;
insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 14, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from r13 where label = 'other';

insert into public.sumit_refresh_requests (company_id, requested_at)
select id, '1960-01-01T00:00:00Z'::timestamptz from r13 where label = 'company';
insert into public.sumit_refresh_requests (company_id, requested_at)
select id, '1970-01-01T00:00:00Z'::timestamptz from r13 where label = 'other';

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select lives_ok(
  format(
    $$select public.note_sync_failure(%L::uuid, 'sync_failed')$$,
    (select id from r13 where label = 'company')
  ),
  'a sync failure is recorded'
);
select is(
  (select last_error from public.sumit_connections where company_id = (select id from r13 where label = 'company')),
  'sync_failed',
  'the connection stores sync_failed'
);
select cmp_ok(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from r13 where label = 'company')),
  '>',
  now(),
  'the next attempt is in the future'
);
select cmp_ok(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from r13 where label = 'company')),
  '<',
  now() + interval '16 minutes',
  'the wait is fifteen minutes'
);
select ok(
  not exists (
    select 1
    from public.list_due_refresh_requests(20) due
    where due.company_id = (select id from r13 where label = 'company')
  ),
  'a backed-off company is skipped'
);
select ok(
  exists (
    select 1
    from public.list_due_refresh_requests(20) due
    where due.company_id = (select id from r13 where label = 'other')
  ),
  'a newer due company is still returned'
);
select throws_ok(
  format(
    $$select public.note_sync_failure(%L::uuid, 'sumit_rejected')$$,
    (select id from r13 where label = 'company')
  ),
  'P0001',
  'unknown sync failure',
  'a billing rejection is not a drain backoff'
);

select function_privs_are(
  'public', 'note_sync_failure', array['uuid', 'text'], 'anon', array[]::text[],
  'anon cannot record a sync failure'
);
select function_privs_are(
  'public', 'note_sync_failure', array['uuid', 'text'], 'authenticated', array[]::text[],
  'authenticated cannot record a sync failure'
);

select * from finish();
rollback;
