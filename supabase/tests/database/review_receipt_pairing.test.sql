-- FLOW-309, option A (decision 0164). A connector invoice and its receipt are one review card:
-- the receipt waits with its invoice, follows its filing, and undo takes both back. Invented data
-- only. Amounts are agorot.

begin;

select plan(44);

do $users$
begin
  perform tests.create_supabase_user('rrp_owner', 'rrp-owner@example.com');
end
$users$;

create temp table rrp (label text primary key, id uuid);
grant all on rrp to authenticated, service_role;

insert into rrp (label, id) values ('co', tests.fixture_company('rrp_owner', 'Example Pairing LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rrp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into rrp (label, id) values
  ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor')),
  ('meadow', tests.fixture_project(pg_temp.id('co'), 'Meadow')),
  ('works', tests.fixture_category(pg_temp.id('co'), 'Works in', 'income')),
  ('other_in', tests.fixture_category(pg_temp.id('co'), 'Other in', 'income'));

-- A SUMIT income document. p_link is the invoice's external id on a receipt.
create or replace function pg_temp.doc(
  p_label text, p_kind text, p_ext text, p_link text, p_amount bigint, p_date date
)
returns uuid
language plpgsql
as $$
declare
  line uuid;
begin
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, external_id, linked_external_id, description,
    user_assigned, category_assigned, category_suggested
  ) values (
    pg_temp.id('co'), 'income', p_kind::public.doc_kind, 'posted', 'ILS',
    p_amount, p_amount, p_amount, 0, 'source',
    p_date, case when p_kind = 'invoice' then null else p_date end, 'sumit', 'rrp:' || p_label, p_ext, p_link,
    'Example customer ' || p_label,
    false, false, false
  )
  returning id into line;
  insert into pg_temp.rrp (label, id) values (p_label, line);
  return line;
end;
$$;

create or replace function pg_temp.sync()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.sync_review_queue(pg_temp.id('co'));
end;
$$;
grant execute on function pg_temp.sync() to service_role;

create or replace function pg_temp.sync_count()
returns integer
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return public.sync_review_queue(pg_temp.id('co'));
end;
$$;
grant execute on function pg_temp.sync_count() to service_role;

create or replace function pg_temp.open_rows(p_label text)
returns integer
language sql
as $$
  select count(*)::integer from public.review_queue q
  where q.transaction_id = pg_temp.id(p_label) and q.status = 'open';
$$;
grant execute on function pg_temp.open_rows(text) to authenticated, service_role;

create or replace function pg_temp.open_row(p_label text)
returns uuid
language sql
as $$
  select q.id from public.review_queue q
  where q.transaction_id = pg_temp.id(p_label) and q.status = 'open'
  order by q.created_at desc limit 1;
$$;
grant execute on function pg_temp.open_row(text) to authenticated, service_role;

create or replace function pg_temp.project_of(p_label text)
returns uuid
language sql
as $$ select t.project_id from public.transactions t where t.id = pg_temp.id(p_label); $$;
grant execute on function pg_temp.project_of(text) to authenticated, service_role;

create or replace function pg_temp.category_of(p_label text)
returns uuid
language sql
as $$ select t.category_id from public.transactions t where t.id = pg_temp.id(p_label); $$;
grant execute on function pg_temp.category_of(text) to authenticated, service_role;

create or replace function pg_temp.review_item(p_label text)
returns jsonb
language sql
as $$
  select e.value from jsonb_array_elements(public.list_review()) e
  where e.value->>'transaction_id' = pg_temp.id(p_label)::text;
$$;
grant execute on function pg_temp.review_item(text) to authenticated;

-- 1. An invoice paid in full, an invoice paid in part, and a receipt with no invoice.
select pg_temp.doc('inv_a', 'invoice', 'ext-a', null, 1180000, '2026-10-05');
select pg_temp.doc('rec_a', 'receipt', 'ext-ra', 'ext-a', 1180000, '2026-10-12');
select pg_temp.doc('inv_b', 'invoice', 'ext-b', null, 500000, '2026-10-06');
select pg_temp.doc('rec_b', 'receipt', 'ext-rb', 'ext-b', 200000, '2026-10-07');
select pg_temp.doc('rec_lone', 'receipt', 'ext-rl', 'ext-none', 90000, '2026-10-08');

select pg_temp.sync();
reset role;
-- The receipt's own category before pairing (the insert fills a guess).
insert into rrp (label, id) values ('rec_a_category', pg_temp.category_of('rec_a'));

select is(pg_temp.open_rows('inv_a'), 1, 'the invoice waits for review');
select is(pg_temp.open_rows('rec_a'), 0, 'its receipt gets no card of its own');
select is(pg_temp.open_rows('rec_b'), 0, 'a part payment waits with its invoice too');
select is(pg_temp.open_rows('rec_lone'), 1, 'a receipt with no invoice keeps its own card');
select is(pg_temp.sync_count(), 0, 'a second sync adds no row for a waiting receipt');
reset role;

select tests.authenticate_as('rrp_owner');
select is(
  (select count(*)::integer from jsonb_array_elements(public.list_review())),
  3, 'list_review: the two invoices and the lone receipt');
select is(
  jsonb_array_length(pg_temp.review_item('inv_a')->'receipts'), 1,
  'the invoice item carries its receipt');
select is(
  pg_temp.review_item('inv_a')->'receipts'->0->>'transaction_id', pg_temp.id('rec_a')::text,
  'the receipt is named by its line');
select is((pg_temp.review_item('inv_a')->>'paid')::boolean, true, 'a receipt for the whole invoice: paid');
select is(pg_temp.review_item('inv_a')->>'paid_on', '2026-10-12', 'paid_on is the receipt date');
select is((pg_temp.review_item('inv_b')->>'paid')::boolean, false, 'a part payment is not paid');
select is(pg_temp.review_item('rec_lone')->'receipts', '[]'::jsonb, 'any other item has no receipts');
select is(pg_temp.review_item('rec_lone')->>'paid_on', null, 'and no paid_on');
select is(
  (pg_temp.review_item('inv_a')->>'auto_approved_today')::integer, 0,
  'a receipt waiting with its invoice is not counted as filed automatically today');

-- 2. One approval files both.
select is(
  public.approve_review_item(pg_temp.open_row('inv_a'), pg_temp.id('harbor'), pg_temp.id('works'))->>'ok',
  'true', 'the owner approves the invoice');
reset role;
select is(pg_temp.project_of('rec_a'), pg_temp.id('harbor'), 'the receipt takes the invoice''s project');
select is(pg_temp.category_of('rec_a'), pg_temp.id('works'), 'and its category');
select is(
  (select q.paired_with from public.review_queue q
   where q.transaction_id = pg_temp.id('rec_a') and q.status = 'approved'),
  (select q.id from public.review_queue q
   where q.transaction_id = pg_temp.id('inv_a') and q.status = 'approved'),
  'the receipt''s approved row is paired with the invoice''s');

-- A sync after the approval changes nothing.
select pg_temp.sync();
reset role;
select is(pg_temp.open_rows('rec_a'), 0, 'a later sync does not queue the receipt');

-- 3. Undo takes both back.
select tests.authenticate_as('rrp_owner');
select public.reopen_review(
  (select q.id from public.review_queue q where q.transaction_id = pg_temp.id('inv_a') and q.status = 'approved'));
reset role;
select is(pg_temp.project_of('rec_a'), null::uuid, 'undo puts the receipt''s project back');
select is(pg_temp.category_of('rec_a'), pg_temp.id('rec_a_category'), 'and its category');
select is(
  (select count(*)::integer from public.review_queue q where q.transaction_id = pg_temp.id('rec_a')),
  0, 'the receipt''s paired row is gone');
select pg_temp.sync();
reset role;
select is(pg_temp.open_rows('rec_a'), 0, 'the receipt waits with its reopened invoice');

-- 4. A skipped invoice keeps its receipt out of review; reopening the skip brings one card.
select tests.authenticate_as('rrp_owner');
select public.resolve_review(pg_temp.open_row('inv_b'), 'skipped');
reset role;
select pg_temp.sync();
reset role;
select is(pg_temp.open_rows('rec_b'), 0, 'a skipped invoice''s receipt is not queued');
select tests.authenticate_as('rrp_owner');
select is(
  (select count(*)::integer from jsonb_array_elements(public.list_skipped_review())),
  1, 'only the invoice is on the skipped list');
reset role;

-- 5. A receipt that arrives after its invoice was approved follows it.
select tests.authenticate_as('rrp_owner');
select public.approve_review_item(pg_temp.open_row('inv_a'), pg_temp.id('meadow'), pg_temp.id('works'));
reset role;
select pg_temp.doc('rec_a2', 'receipt', 'ext-ra2', 'ext-a', 10000, '2026-10-14');
select pg_temp.sync();
reset role;
select is(pg_temp.open_rows('rec_a2'), 0, 'a late receipt gets no card');
select is(pg_temp.project_of('rec_a2'), pg_temp.id('meadow'), 'it takes the approved invoice''s project');
select is(
  (select q.status::text from public.review_queue q where q.transaction_id = pg_temp.id('rec_a2')),
  'approved', 'with an approved row paired with the invoice''s');

-- 6. A change to the filed invoice moves its receipts; its undo moves them back.
select tests.authenticate_as('rrp_owner');
select set_config('rrp.undo', public.reassign_transaction(pg_temp.id('inv_a'), pg_temp.id('harbor'), pg_temp.id('other_in'))::text, true);
reset role;
select is(pg_temp.project_of('rec_a'), pg_temp.id('harbor'), 'a change from the transaction screen moves the receipt');
select is(pg_temp.category_of('rec_a2'), pg_temp.id('other_in'), 'and the late one');
select tests.authenticate_as('rrp_owner');
select public.undo_reassign(current_setting('rrp.undo')::uuid);
reset role;
select is(pg_temp.project_of('rec_a2'), pg_temp.id('meadow'), 'its undo moves them back');

-- 7. A receipt the owner filed on their own keeps that filing.
select pg_temp.doc('inv_c', 'invoice', 'ext-c', null, 300000, '2026-10-09');
select pg_temp.doc('rec_c', 'receipt', 'ext-rc', 'ext-c', 300000, '2026-10-10');
update public.transactions
set project_id = pg_temp.id('meadow'), category_id = pg_temp.id('other_in'),
    user_assigned = true, category_assigned = true, project_assigned = true
where id = pg_temp.id('rec_c');
select pg_temp.sync();
reset role;
select tests.authenticate_as('rrp_owner');
select public.approve_review_item(pg_temp.open_row('inv_c'), pg_temp.id('harbor'), pg_temp.id('works'));
reset role;
select is(pg_temp.project_of('rec_c'), pg_temp.id('meadow'), 'the owner''s own filing of a receipt stays');

-- 8. An invoice filed without review moves its waiting receipt with no review row.
select pg_temp.doc('rec_d', 'receipt', 'ext-rd', 'ext-d', 70000, '2026-10-11');
select pg_temp.sync();
reset role;
select is(pg_temp.open_rows('rec_d'), 1, 'before its invoice arrives, the receipt has its own card');
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, external_id, description,
  project_id, category_id, user_assigned, category_assigned, project_assigned
) values (
  pg_temp.id('co'), 'income', 'invoice', 'posted', 'ILS',
  70000, 70000, 70000, 0, 'source',
  '2026-10-10', 'sumit', 'rrp:inv_d', 'ext-d', 'Example customer inv_d',
  pg_temp.id('harbor'), pg_temp.id('works'), false, false, false
);
select is(pg_temp.open_rows('rec_d'), 0, 'a filed invoice takes its receipt out of review');
select is(pg_temp.project_of('rec_d'), pg_temp.id('harbor'), 'and files it the same way');

-- 9. A receipt a rule filed keeps its filing when its invoice is filed without the owner, and
-- moves when the owner approves the invoice.
select pg_temp.doc('rec_e', 'receipt', 'ext-re', 'ext-e', 40000, '2026-10-12');
update public.transactions set project_id = pg_temp.id('meadow') where id = pg_temp.id('rec_e');
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, external_id, description,
  project_id, category_id, user_assigned, category_assigned, project_assigned
) values (
  pg_temp.id('co'), 'income', 'invoice', 'posted', 'ILS',
  40000, 40000, 40000, 0, 'source',
  '2026-10-11', 'sumit', 'rrp:inv_e', 'ext-e', 'Example customer inv_e',
  pg_temp.id('harbor'), pg_temp.id('works'), false, false, false
);
select pg_temp.sync();
reset role;
select is(pg_temp.project_of('rec_e'), pg_temp.id('meadow'), 'a receipt a rule filed keeps its filing');

select pg_temp.doc('inv_f', 'invoice', 'ext-f', null, 60000, '2026-10-12');
select pg_temp.doc('rec_f', 'receipt', 'ext-rf', 'ext-f', 60000, '2026-10-13');
update public.transactions set project_id = pg_temp.id('meadow') where id = pg_temp.id('rec_f');
select pg_temp.sync();
reset role;
select tests.authenticate_as('rrp_owner');
select public.approve_review_item(pg_temp.open_row('inv_f'), pg_temp.id('harbor'), pg_temp.id('works'));
reset role;
select is(pg_temp.project_of('rec_f'), pg_temp.id('harbor'), 'the owner''s approval of the invoice moves it');

-- 10. A skipped invoice the owner files another way stops holding its receipt.
select pg_temp.doc('inv_g', 'invoice', 'ext-g', null, 80000, '2026-10-12');
select pg_temp.doc('rec_g', 'receipt', 'ext-rg', 'ext-g', 80000, '2026-10-13');
select pg_temp.sync();
reset role;
select tests.authenticate_as('rrp_owner');
select public.resolve_review(pg_temp.open_row('inv_g'), 'skipped');
select public.reassign_transaction(pg_temp.id('inv_g'), pg_temp.id('harbor'), pg_temp.id('works'));
reset role;
select pg_temp.sync();
reset role;
select is(pg_temp.project_of('rec_g'), pg_temp.id('harbor'), 'a skipped invoice filed later moves its receipt');
select is(pg_temp.open_rows('rec_g'), 0, 'and the receipt waits for nothing');

-- 11. A receipt the owner refiles after the joint approval is theirs.
select pg_temp.doc('inv_h', 'invoice', 'ext-h', null, 90000, '2026-10-12');
select pg_temp.doc('rec_h', 'receipt', 'ext-rh', 'ext-h', 90000, '2026-10-13');
select pg_temp.sync();
reset role;
select tests.authenticate_as('rrp_owner');
select public.approve_review_item(pg_temp.open_row('inv_h'), pg_temp.id('harbor'), pg_temp.id('works'));
select public.reassign_transaction(pg_temp.id('rec_h'), pg_temp.id('meadow'), pg_temp.id('works'));
select public.reassign_transaction(pg_temp.id('inv_h'), pg_temp.id('harbor'), pg_temp.id('other_in'));
reset role;
select is(pg_temp.project_of('rec_h'), pg_temp.id('meadow'), 'a later change to the invoice leaves the refiled receipt');
select is(pg_temp.category_of('rec_h'), pg_temp.id('works'), 'and its category');
select tests.authenticate_as('rrp_owner');
select public.reopen_review(
  (select q.id from public.review_queue q where q.transaction_id = pg_temp.id('inv_h') and q.status = 'approved'));
reset role;
select is(pg_temp.project_of('rec_h'), pg_temp.id('meadow'), 'undo of the invoice leaves it too');


-- 12. A category deleted under a paired receipt is not the owner refiling it: the next approval
-- of the invoice still moves it.
insert into rrp (label, id) values ('spare', tests.fixture_category(pg_temp.id('co'), 'Spare in', 'income'));
select pg_temp.doc('inv_j', 'invoice', 'ext-j', null, 50000, '2026-10-12');
select pg_temp.doc('rec_j', 'receipt', 'ext-rj', 'ext-j', 50000, '2026-10-13');
select pg_temp.sync();
reset role;
select tests.authenticate_as('rrp_owner');
select public.approve_review_item(pg_temp.open_row('inv_j'), pg_temp.id('harbor'), pg_temp.id('spare'));
select public.delete_category(pg_temp.id('spare')) is not null;
select public.approve_review_item(pg_temp.open_row('inv_j'), pg_temp.id('harbor'), pg_temp.id('other_in'));
reset role;
select is(pg_temp.category_of('rec_j'), pg_temp.id('other_in'), 'after a category delete the receipt still follows the approval');
select ok(
  (select q.paired_with is not null from public.review_queue q
   where q.transaction_id = pg_temp.id('rec_j') and q.status in ('approved', 'changed')
   order by q.created_at desc limit 1),
  'and stays paired');

select * from finish();
rollback;
