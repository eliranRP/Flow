-- Decision 0184: a bank line still pending at Mercury is stored as before, but no read shows it
-- and it waits in no review until it posts; then it is listed and queued once.
-- Invented data only. Amounts are cents.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('plh_owner', 'plh-owner@example.com');
end
$users$;

select tests.authenticate_as('plh_owner');
select public.create_company('Sample Pending Co', true);
select public.upsert_project(null, 'Sample Dock', null, 'active');

create temp table plh (label text primary key, id uuid);
grant all on plh to authenticated, service_role;
insert into plh (label, id) select 'co', id from public.companies where name = 'Sample Pending Co';
insert into plh (label, id) select 'dock', id from public.projects where name = 'Sample Dock';
reset role;
insert into plh (label, id)
select 'cat', c.id from public.categories c
where c.company_id = (select id from plh where label = 'co') and c.kind = 'expense' and not c.excluded_from_pnl
  and c.loan_part is null
order by c.sort_order, c.id
limit 1;

create function pg_temp.line(ext text, status text, d date) returns jsonb
language sql immutable as $$
  select jsonb_build_object('source', 'mercury', 'external_id', ext, 'direction', 'expense', 'line_status', status,
    'doc_kind', 'expense', 'currency', 'USD', 'amount_original', 30000, 'amount_negated', true,
    'doc_date', d, 'cash_date', case when status = 'posted' then d end, 'description', 'Sample Insurance',
    'counterparty', jsonb_build_object('name', 'Sample Insurance', 'kind', 'supplier'),
    'vat', jsonb_build_object('amount', 0, 'status', 'source'), 'provider_meta', jsonb_build_object('kind', 'debitCardTransaction'))
$$;

create function pg_temp.upsert(p_lines jsonb) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.upsert_connector_lines((select id from pg_temp.plh where label = 'co'), 'mercury',
    jsonb_build_object('lines', p_lines, 'removed_ids', '[]'::jsonb, 'complete', false), null, null);
end;
$$;

create function pg_temp.sync() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.sync_review_queue((select id from pg_temp.plh where label = 'co'));
end;
$$;

-- August posted; September still pending at the bank.
select pg_temp.upsert(jsonb_build_array(pg_temp.line('plh-aug', 'posted', '2026-08-05'), pg_temp.line('plh-sep', 'pending', '2026-09-05')));
reset role;
select set_config('request.jwt.claims', null, true);
insert into plh (label, id) select replace(external_id, 'plh-', 'txn_'), id from public.transactions where external_id like 'plh-%';
insert into plh (label, id) select 'supplier', supplier_id from public.transactions where external_id = 'plh-aug';
-- Both lines filed to the project with a guessed category, so each waits for review once posted.
update public.transactions
set project_id = (select id from plh where label = 'dock'), pnl_role = 'project',
  category_id = (select id from plh where label = 'cat'), category_suggested = true
where external_id like 'plh-%';
select pg_temp.sync();
reset role;
select set_config('request.jwt.claims', null, true);

select is(
  (select line_status::text from public.transactions where id = (select id from plh where label = 'txn_sep')),
  'pending', 'the pending line is stored as the sync wrote it');
select is(
  (select count(*)::integer from public.review_queue where transaction_id = (select id from plh where label = 'txn_sep')),
  0, 'the pending line is not queued');

-- A stray open row (from before 0184) on the pending line.
insert into public.review_queue (company_id, transaction_id, status, reason)
values ((select id from plh where label = 'co'), (select id from plh where label = 'txn_sep'), 'open', 'suggested');

select tests.authenticate_as('plh_owner');

select is(
  (select array_agg(x ->> 'transaction_id') from jsonb_array_elements(public.list_review()) x),
  array[(select id::text from plh where label = 'txn_aug')],
  'לאישור lists the posted line only, even with an open row on the pending one');
select is(
  (public.company_pnl((select id from plh where label = 'co'), null, null, 'cash') ->> 'review_count')::integer,
  1, 'the review count leaves the pending line out');
select is(
  (select array_agg(x ->> 'transaction_id') from jsonb_array_elements(public.project_waiting((select id from plh where label = 'dock'))) x),
  array[(select id::text from plh where label = 'txn_aug')],
  'the project''s waiting lines leave the pending line out');
select is(
  (public.get_project((select id from plh where label = 'dock'), 'cash') ->> 'pending_count')::integer,
  1, 'so does the project''s waiting count');
select is(
  (select array_agg(x ->> 'id') from jsonb_array_elements(public.get_project((select id from plh where label = 'dock'), 'cash') -> 'transactions') x),
  array[(select id::text from plh where label = 'txn_aug')],
  'the project''s transactions list leaves the pending line out');
select is(
  (select array_agg(x ->> 'id') from jsonb_array_elements(public.search_transactions('Sample Insurance') -> 'expenses') x),
  array[(select id::text from plh where label = 'txn_aug')],
  'search leaves the pending line out');
select is(
  (select count(*)::integer from jsonb_array_elements(public.search_transactions('Sample Insurance') -> 'months') m where m ->> 'month' = '2026-09'),
  0, 'search month totals leave the pending line out');
select is(public.get_transaction((select id from plh where label = 'txn_sep')), null, 'the pending line opened by id reads as not found');
select isnt(public.get_transaction((select id from plh where label = 'txn_aug')), null, 'the posted line opens');
select is(
  (select l.lines from jsonb_array_elements(public.list_categories()) c, lateral (select (c ->> 'lines')::integer as lines) l
   where c ->> 'id' = (select id::text from plh where label = 'cat')),
  1, 'the category''s line count leaves the pending line out');
select is(
  public.recurring_party_line('expense', (select id from plh where label = 'supplier'), 'USD', '2026-09-30'),
  (select id from plh where label = 'txn_aug'), 'the party''s latest line is the posted one');
select is(
  (select count(*)::integer from public.receipt_match(30000, '2026-09-05', 'Sample Insurance')),
  0, 'a receipt does not match the pending line');

reset role;
select is(
  (select jsonb_agg(c ->> 'id') from jsonb_array_elements(
    private.party_charges_json((select id from plh where label = 'co'), (select id from plh where label = 'txn_aug'), '2026-09-30') -> 'charges') c),
  jsonb_build_array((select id::text from plh where label = 'txn_aug')),
  'the party''s charges leave the pending line out');
select is(
  private.party_charges_json((select id from plh where label = 'co'), (select id from plh where label = 'txn_sep'), '2026-09-30'),
  null, 'the pending line has no charge history');
select is(
  (select fresh from private.push_fresh_lines(tests.get_supabase_uid('plh_owner'), '2000-01-01')),
  1, 'a new-lines push counts the posted line only');
select is(
  (select waiting from private.push_waiting_by_owner() where user_id = tests.get_supabase_uid('plh_owner')),
  1, 'the waiting push leaves the pending line out');

select pg_temp.sync();
reset role;
select set_config('request.jwt.claims', null, true);
select is(
  (select count(*)::integer from public.review_queue where transaction_id = (select id from plh where label = 'txn_sep')),
  0, 'the next sync removes the open row of the line still pending');

-- The bank posts September: the same id, posted.
select pg_temp.upsert(jsonb_build_array(pg_temp.line('plh-sep', 'posted', '2026-09-05')));
reset role;
select set_config('request.jwt.claims', null, true);
select is(
  (select count(*)::integer from public.review_queue where transaction_id = (select id from plh where label = 'txn_sep') and status = 'open'),
  1, 'once posted, the line is queued once');

select tests.authenticate_as('plh_owner');
select is(
  (select count(*)::integer from jsonb_array_elements(public.list_review()) x where x ->> 'transaction_id' = (select id::text from plh where label = 'txn_sep')),
  1, 'and לאישור lists it');
select isnt(public.get_transaction((select id from plh where label = 'txn_sep')), null, 'and it opens by id');
select is(
  (public.search_transactions('Sample Insurance') ->> 'total')::integer,
  2, 'and search finds it');

reset role;
select pg_temp.upsert(jsonb_build_array(pg_temp.line('plh-sep', 'posted', '2026-09-05')));
reset role;
select set_config('request.jwt.claims', null, true);
select is(
  (select count(*)::integer from public.review_queue where transaction_id = (select id from plh where label = 'txn_sep')),
  1, 'a later sync of the posted line does not queue it again');

select * from finish();
rollback;
