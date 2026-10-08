-- FLOW-312 item 2. A split line whose amount changes on re-sync opens a split_mismatch
-- review; new parts, a cleared split or a matching amount close it; MCP split_line and undo
-- keep it in step. Invented data only. Amounts are cents.

begin;

-- The review follows the parts at commit (a deferred trigger); judge after each statement.
set constraints all immediate;

select plan(38);

do $users$
begin
  perform tests.create_supabase_user('lsr_owner', 'lsr-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lsr_owner'), 'Example Resync LLC', false);

create temp table lsr (label text primary key, id uuid);
grant all on lsr to authenticated, service_role;
insert into lsr (label, id) select 'co', id from public.companies where name = 'Example Resync LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from lsr where label = 'co'), 'North', 'active'),
  ((select id from lsr where label = 'co'), 'South', 'active');
insert into lsr (label, id) select lower(name), id from public.projects where name in ('North', 'South');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values
  ((select id from lsr where label = 'co'), 'Repairs', 'expense', 90, false),
  ((select id from lsr where label = 'co'), 'Supplies', 'expense', 91, false);
insert into lsr (label, id) select lower(name), id from public.categories
where name in ('Repairs', 'Supplies') and company_id = (select id from lsr where label = 'co');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select (select id from lsr where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  -10000, -10000, 10000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'lsr:' || k,
  (select id from lsr where label = 'north'), (select id from lsr where label = 'repairs'), 'lsr:' || k, true, false
from unnest(array['bill', 'busy', 'gone']) k;
insert into lsr (label, id) select replace(idempotency_key, 'lsr:', 'txn_'), id
from public.transactions where idempotency_key like 'lsr:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lsr_owner'), (select id from lsr where label = 'co'), 'hash-lsr-write', 'kid', array['write']::text[], '2099-01-01');
insert into lsr (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-lsr-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('lsr_owner');
  tid uuid;
begin
  select id into tid from pg_temp.lsr where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

create function pg_temp.parts(p_north bigint, p_south bigint) returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('category_id', (select id from lsr where label = 'repairs'),
      'project_id', (select id from lsr where label = 'north'), 'amount_minor', p_north),
    jsonb_build_object('category_id', (select id from lsr where label = 'supplies'),
      'project_id', (select id from lsr where label = 'south'), 'amount_minor', p_south)
  )
$$;
grant execute on function pg_temp.parts(bigint, bigint) to authenticated, service_role;

-- Open reviews of one line, as "reason" strings.
create function pg_temp.open_reviews(p_label text) returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(q.reason order by q.created_at), '[]'::jsonb)
  from public.review_queue q
  where q.transaction_id = (select id from lsr where label = p_label) and q.status = 'open'
$$;
grant execute on function pg_temp.open_reviews(text) to authenticated, service_role;

-- The bank sync rewrites the amount in place.
create function pg_temp.resync(p_label text, p_net bigint) returns void
language sql
as $$
  update public.transactions
  set amount_net = p_net, amount_gross = p_net, amount_original = abs(p_net)
  where id = (select id from lsr where label = p_label)
$$;

-- A matching split opens nothing.
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.save_line_split((select id from lsr where label = 'txn_bill'), pg_temp.parts(4000, 6000))$$,
  'the owner splits the line');
reset role;
select is(pg_temp.open_reviews('txn_bill'), '[]'::jsonb, 'a split that matches opens no review');

-- A re-sync that changes the amount opens one review, once.
select pg_temp.resync('txn_bill', -12000);
select is(pg_temp.open_reviews('txn_bill'), '["split_mismatch"]'::jsonb, 'a changed amount opens a split_mismatch review');
select is(
  (select jsonb_agg(amount_net) from private.pnl_lines where transaction_id = (select id from lsr where label = 'txn_bill')),
  '[-12000]'::jsonb, 'and the line counts whole meanwhile');
select pg_temp.resync('txn_bill', -13000);
select is(pg_temp.open_reviews('txn_bill'), '["split_mismatch"]'::jsonb, 'a second change keeps one review');

-- An amount that comes back closes it.
select pg_temp.resync('txn_bill', -10000);
select is(pg_temp.open_reviews('txn_bill'), '[]'::jsonb, 'an amount that matches again closes the review');
select is(
  (select count(*)::integer from public.review_queue where transaction_id = (select id from lsr where label = 'txn_bill')),
  0, 'and leaves no closed row behind');

-- The owner fixes the split while the review is open: allowed, and it closes the review.
select pg_temp.resync('txn_bill', -12000);
select is(pg_temp.open_reviews('txn_bill'), '["split_mismatch"]'::jsonb, 'the review is back');
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.save_line_split((select id from lsr where label = 'txn_bill'), pg_temp.parts(5000, 7000))$$,
  'a split_mismatch review does not block new parts');
reset role;
select is(pg_temp.open_reviews('txn_bill'), '[]'::jsonb, 'new parts that match close the review');
select is(
  (select jsonb_agg(amount_net order by amount_net) from private.pnl_lines where transaction_id = (select id from lsr where label = 'txn_bill')),
  '[-7000, -5000]'::jsonb, 'and the line counts by parts again');

-- Clearing the split closes it too.
select pg_temp.resync('txn_bill', -11000);
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.save_line_split((select id from lsr where label = 'txn_bill'), '[]'::jsonb)$$,
  'the owner clears the split');
reset role;
select is(pg_temp.open_reviews('txn_bill'), '[]'::jsonb, 'a cleared split closes the review');

-- MCP: split_line fixes the split; undo brings back the stale parts and the review.
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.save_line_split((select id from lsr where label = 'txn_bill'), pg_temp.parts(4000, 7000))$$,
  'split again');
reset role;
select pg_temp.resync('txn_bill', -12000);
select pg_temp.as_mcp();
select is(
  public.mcp_split_line('lsr-1', (select id from lsr where label = 'txn_bill'), pg_temp.parts(4000, 8000)) -> 'ok',
  'true'::jsonb, 'split_line is allowed on a split_mismatch review');
reset role;
select is(pg_temp.open_reviews('txn_bill'), '[]'::jsonb, 'and closes it');
select pg_temp.as_mcp();
select is(
  public.mcp_undo('lsr-u1', 'line_split', (select id from lsr where label = 'txn_bill')) -> 'ok',
  'true'::jsonb, 'undo the fix');
reset role;
select is(pg_temp.open_reviews('txn_bill'), '["split_mismatch"]'::jsonb, 'the stale parts are back with their review');

-- A line that already has another open review keeps that one only.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select (select id from lsr where label = 'co'), (select id from lsr where label = 'txn_busy'), o,
  (select id from lsr where label = c), null, a
from (values (1, 'repairs', 4000::bigint), (2, 'supplies', 6000::bigint)) v(o, c, a);
insert into public.review_queue (company_id, transaction_id, status, reason)
values ((select id from lsr where label = 'co'), (select id from lsr where label = 'txn_busy'), 'open', 'suggested');
select pg_temp.resync('txn_busy', -12000);
select is(pg_temp.open_reviews('txn_busy'), '["suggested"]'::jsonb, 'an open review of another reason is left alone');
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.resolve_review((select id from public.review_queue where transaction_id = (select id from lsr where label = 'txn_busy') and status = 'open'), 'skipped')$$,
  'the owner skips the other review');
reset role;
select is(pg_temp.open_reviews('txn_busy'), '["split_mismatch"]'::jsonb, 'then the mismatch gets its own review');
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.reopen_review((select id from public.review_queue where transaction_id = (select id from lsr where label = 'txn_busy') and reason = 'suggested'))$$,
  'the owner undoes the skip');
reset role;
select is(pg_temp.open_reviews('txn_busy'), '["suggested"]'::jsonb, 'the line is back to one open review');
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.resolve_review((select id from public.review_queue where transaction_id = (select id from lsr where label = 'txn_busy') and status = 'open'), 'skipped')$$,
  'and skips it again');
reset role;
select is(pg_temp.open_reviews('txn_busy'), '["split_mismatch"]'::jsonb, 'the mismatch review is back');

-- A skipped split_mismatch that is reopened after the parts were fixed does not stay open.
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.resolve_review((select id from public.review_queue where transaction_id = (select id from lsr where label = 'txn_busy') and status = 'open'), 'skipped')$$,
  'the owner skips the split_mismatch review');
reset role;
select is(pg_temp.open_reviews('txn_busy'), '[]'::jsonb, 'skipping it does not reopen it');
select pg_temp.resync('txn_busy', -10000);
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.reopen_review((select id from public.review_queue where transaction_id = (select id from lsr where label = 'txn_busy') and reason = 'split_mismatch'))$$,
  'the owner reopens it after the amount matches again');
reset role;
select is(pg_temp.open_reviews('txn_busy'), '[]'::jsonb, 'a reopened split_mismatch on matching parts closes at once');

-- Deferred: save_line_split is judged once, at commit (here, when constraints turn immediate).
select pg_temp.resync('txn_busy', -12000);
select is(pg_temp.open_reviews('txn_busy'), '["split_mismatch"]'::jsonb, 'the mismatch is open again');
set constraints all deferred;
select tests.authenticate_as('lsr_owner');
select lives_ok($$select public.save_line_split((select id from lsr where label = 'txn_busy'), pg_temp.parts(5000, 7000))$$,
  'new parts, deferred');
reset role;
select is(pg_temp.open_reviews('txn_busy'), '["split_mismatch"]'::jsonb, 'the review waits for commit');
set constraints all immediate;
select is(pg_temp.open_reviews('txn_busy'), '[]'::jsonb, 'and closes when the deferred check runs');

-- A removed line opens nothing.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select (select id from lsr where label = 'co'), (select id from lsr where label = 'txn_gone'), o,
  (select id from lsr where label = c), null, a
from (values (1, 'repairs', 4000::bigint), (2, 'supplies', 6000::bigint)) v(o, c, a);
update public.transactions set removed_at = now() where id = (select id from lsr where label = 'txn_gone');
select pg_temp.resync('txn_gone', -12000);
select is(pg_temp.open_reviews('txn_gone'), '[]'::jsonb, 'a removed line opens no review');

update public.transactions set removed_at = null where id = (select id from lsr where label = 'txn_gone');
select is(pg_temp.open_reviews('txn_gone'), '["split_mismatch"]'::jsonb, 'the line coming back opens its review');
update public.transactions set line_status = 'void' where id = (select id from lsr where label = 'txn_gone');
select is(pg_temp.open_reviews('txn_gone'), '[]'::jsonb, 'a voided line loses it');

-- The helper the backfill runs is idempotent.
select lives_ok($$select private.line_split_review_sync((select id from lsr where label = 'txn_bill'))$$,
  'the sync helper runs again on a flagged line');
select is(pg_temp.open_reviews('txn_bill'), '["split_mismatch"]'::jsonb, 'and still leaves one review');

select * from finish();
rollback;
