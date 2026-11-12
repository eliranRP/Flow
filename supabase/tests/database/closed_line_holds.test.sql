-- FLOW-1166 part 2b: a sync change to a line in a closed period is held, not written
-- (20261112202048_closed_line_holds.sql). upsert_connector_lines runs as the service role with a
-- closed date set: a batch of several hundred lines holds exactly its closed changes and writes the
-- rest; an amount change, a pending line that posts, a void and a SUMIT removal are held; the same
-- values, a re-derived category or SUMIT section, and a new line dated in the closed month are not.
-- Each held change has one open review row (closed_month_change) and list_review carries it. The
-- owner leaves one (app and flow-mcp, with the undo); the same change does not reopen it, a different
-- one does. A close is refused while the period has open review lines; moving the date back is not,
-- and the next sync applies every held change (a left one too), the fetched line winning.
-- Invented names and figures, @example.com only. Dates follow current_date.

begin;

select plan(52);

do $users$
begin
  perform tests.create_supabase_user('ch_owner', 'ch-owner@example.com');
end
$users$;

create temp table ch (label text primary key, id uuid);
grant all on ch to authenticated, service_role;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.ch where label = p_label; $$;

-- The first day of the month k months from this one; the closed date is the last day of month -6.
create or replace function pg_temp.m1(k integer)
returns date language sql set search_path = '' as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date;
$$;
create or replace function pg_temp.closed()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-5) - 1; $$;
create or replace function pg_temp.shut()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-6) + 9; $$;
create or replace function pg_temp.open()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-3) + 9; $$;
create or replace function pg_temp.msg()
returns text language sql set search_path = '' as $$
  select 'the books are closed through ' || to_char(pg_temp.closed(), 'YYYY-MM-DD');
$$;

-- A bank line and a SUMIT document as the engines send them.
create or replace function pg_temp.ml(p_ext text, p_amount bigint, p_date date, p_status text default 'posted',
  p_hint text default null)
returns jsonb language sql set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'source', 'mercury', 'external_id', p_ext, 'direction', 'expense', 'line_status', p_status, 'doc_kind', 'expense',
    'pnl_role', 'overhead', 'currency', 'USD', 'amount_original', p_amount, 'amount_negated', true,
    'doc_date', p_date, 'description', 'Example bank line ' || p_ext, 'category_hint', p_hint,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb));
$$;
create or replace function pg_temp.sl(p_ext text, p_amount bigint, p_date date, p_section text default null)
returns jsonb language sql set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'source', 'sumit', 'external_id', p_ext, 'direction', 'expense', 'line_status', 'posted', 'doc_kind', 'expense',
    'pnl_role', case when p_section is null then 'overhead' else 'project' end, 'currency', 'ILS',
    'amount_original', p_amount, 'amount_negated', true, 'doc_date', p_date, 'description', 'Example document ' || p_ext,
    'project_hint', case when p_section is not null then jsonb_build_object('name', p_section) end,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb));
$$;

-- One sync run as the service role: its result as json.
create or replace function pg_temp.run(p_provider text, p_lines jsonb, p_removed jsonb default '[]'::jsonb,
  p_complete boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := to_jsonb(public.upsert_connector_lines(pg_temp.id('co'), p_provider::public.connector_provider,
    jsonb_build_object('lines', p_lines, 'removed_ids', p_removed, 'complete', p_complete), null, null));
  reset role;
  return r;
end; $$;

-- The owner, as the app or as flow-mcp.
create or replace function pg_temp.as_owner()
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('ch_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok'))::text, true);
end; $$;
create or replace function pg_temp.try(p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_owner();
  execute p_sql;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlerrm;
end; $$;
create or replace function pg_temp.ask(p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_owner();
  execute p_sql into r;
  reset role;
  return r;
end; $$;

create or replace function pg_temp.line(p_ext text)
returns public.transactions language sql set search_path = '' as $$
  select t.* from public.transactions t where t.company_id = pg_temp.id('co') and t.external_id = p_ext;
$$;
create or replace function pg_temp.hold(p_ext text)
returns private.closed_line_holds language sql set search_path = '' as $$
  select h.* from private.closed_line_holds h where h.transaction_id = (pg_temp.line(p_ext)).id;
$$;
-- The line's open review rows, as reason list.
create or replace function pg_temp.open_rows(p_ext text)
returns text[] language sql set search_path = '' as $$
  select coalesce(array_agg(coalesce(q.reason, '-') order by q.created_at), '{}')
  from public.review_queue q where q.transaction_id = (pg_temp.line(p_ext)).id and q.status = 'open';
$$;
create or replace function pg_temp.review_of(p_ext text)
returns uuid language sql set search_path = '' as $$
  select q.id from public.review_queue q
  where q.transaction_id = (pg_temp.line(p_ext)).id and q.reason = 'closed_month_change'
  order by q.created_at desc limit 1;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- The company, two categories, a flow-mcp credential.
insert into ch (label, id) values ('co', tests.fixture_company('ch_owner', 'Example Held Changes Co'));
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ch_owner'), pg_temp.id('co'), 'hash-ch-owner-0001', 'pepper-1',
  array['read', 'write'], now() + interval '90 days');
insert into ch (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-ch-owner-0001';
insert into ch (label, id) values
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('supplies', tests.fixture_category(pg_temp.id('co'), 'Example supplies', 'expense'));

-- ---------------------------------------------------------------------------------------------
-- The lines, synced before the close: 397 in an open month and seven in the closed one (three to
-- change, one to leave, one pending, one to void, one filed by a hint, one sent again as it is).
-- ---------------------------------------------------------------------------------------------
insert into res values ('first', pg_temp.run('mercury',
  (select jsonb_agg(pg_temp.ml('open-' || g, 1000 + g, pg_temp.open())) from generate_series(1, 397) g)
  || jsonb_build_array(
    pg_temp.ml('m-0', 5000, pg_temp.shut()), pg_temp.ml('m-1', 5100, pg_temp.shut()),
    pg_temp.ml('m-2', 5200, pg_temp.shut()), pg_temp.ml('m-left', 5300, pg_temp.shut()),
    pg_temp.ml('m-pend', 5400, pg_temp.shut(), 'pending'), pg_temp.ml('m-void', 5500, pg_temp.shut()),
    pg_temp.ml('m-cat', 5600, pg_temp.shut(), 'posted', 'Example repairs'), pg_temp.ml('m-same', 5700, pg_temp.shut()))));
insert into res values ('sumit_first', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-1', 7000, pg_temp.shut()), pg_temp.sl('s-2', 7100, pg_temp.shut(), 'Example Oak house'),
  pg_temp.sl('s-3', 7200, pg_temp.open())), '[]'::jsonb, true));
select is((select (r->>'inserted')::integer from res where label = 'first'), 405, 'the first sync inserts every line');

-- The owner's close, written directly (the queue has open lines: the setter's refusal is tested below).
update public.companies set books_closed_through = pg_temp.closed() where id = pg_temp.id('co');

-- ---------------------------------------------------------------------------------------------
-- Several hundred lines, three closed ones changed: the run completes and holds exactly three.
-- ---------------------------------------------------------------------------------------------
insert into res values ('big', pg_temp.run('mercury',
  (select jsonb_agg(pg_temp.ml('open-' || g, 2000 + g, pg_temp.open())) from generate_series(1, 397) g)
  || jsonb_build_array(pg_temp.ml('m-0', 6000, pg_temp.shut()), pg_temp.ml('m-1', 6100, pg_temp.shut()),
    pg_temp.ml('m-2', 6200, pg_temp.shut()))));
select is((select r - 'skipped' from res where label = 'big'),
  '{"inserted": 0, "updated": 397, "removed": 0, "held": 3}'::jsonb,
  'a batch of 400 lines updates the 397 open ones and holds the three closed ones (inserted, updated, removed, held)');
select is((select count(*)::integer from public.transactions where company_id = pg_temp.id('co')
  and external_id like 'open-%' and amount_original = 2000 + substr(external_id, 6)::integer), 397,
  'every open line carries its new amount');
select is((select array_agg(amount_original order by external_id) from public.transactions
  where company_id = pg_temp.id('co') and external_id in ('m-0', 'm-1', 'm-2')), array[5000, 5100, 5200]::bigint[],
  'the three closed lines keep their stored amounts');
select is((select count(*)::integer from private.closed_line_holds where company_id = pg_temp.id('co')), 3,
  'exactly three changes are held');
select is(((pg_temp.hold('m-0')).line->>'amount_original')::bigint, 6000::bigint,
  'the hold keeps the line exactly as the sync sent it');
select is((pg_temp.hold('m-0')).kind || ':' || (pg_temp.hold('m-0')).state || ':' || (pg_temp.hold('m-0')).provider,
  'update:held:mercury', 'an amount change is held as an update');

-- ---------------------------------------------------------------------------------------------
-- A pending line that posts, a void, a re-derived category, the same values, a new closed line.
-- ---------------------------------------------------------------------------------------------
insert into res values ('second', pg_temp.run('mercury', jsonb_build_array(
    pg_temp.ml('m-0', 6000, pg_temp.shut()), pg_temp.ml('m-left', 6300, pg_temp.shut()),
    pg_temp.ml('m-pend', 5400, pg_temp.shut()),
    pg_temp.ml('m-cat', 5600, pg_temp.shut(), 'posted', 'Example supplies'), pg_temp.ml('m-same', 5700, pg_temp.shut()),
    pg_temp.ml('m-new', 5800, pg_temp.shut())),
  '["m-void"]'::jsonb));
select is((select r - 'skipped' from res where label = 'second'),
  '{"inserted": 1, "updated": 2, "removed": 0, "held": 4}'::jsonb,
  'the second run inserts the new line, updates two and holds four');
select is((pg_temp.line('m-pend')).line_status::text || ':' || (pg_temp.hold('m-pend')).kind
  || ':' || ((pg_temp.hold('m-pend')).line->>'line_status'),
  'pending:update:posted', 'a pending line that posts in the closed month stays pending, the posting held');
select is((pg_temp.line('m-void')).line_status::text || ':' || coalesce((pg_temp.line('m-void')).removed_at::text, '-')
  || ':' || (pg_temp.hold('m-void')).kind || ':' || coalesce((pg_temp.hold('m-void')).line::text, '-'),
  'posted:-:void:-', 'a void in removed_ids is held, the line still posted');
select is((pg_temp.line('m-cat')).category_id, pg_temp.id('repairs'),
  'a re-derived category on a closed line keeps the stored one');
select ok((pg_temp.hold('m-cat')).transaction_id is null and (pg_temp.hold('m-same')).transaction_id is null,
  'neither the re-derived category nor the same values make a hold');
select is((pg_temp.line('m-new')).amount_original, 5800::bigint, 'a new line dated in the closed month is inserted');
select ok((pg_temp.hold('m-new')).transaction_id is null, 'and is not held');
select is((pg_temp.hold('m-0')).state, 'held', 're-sending the held values keeps one hold, still held');

-- SUMIT: every document every run. s-1 is gone (the sweep), s-2's section changed, s-3 is open.
insert into res values ('sumit_second', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-2', 7100, pg_temp.shut(), 'Example Pine house'), pg_temp.sl('s-3', 7250, pg_temp.open())),
  '[]'::jsonb, true));
select is((select r - 'skipped' from res where label = 'sumit_second'),
  '{"inserted": 0, "updated": 2, "removed": 0, "held": 1}'::jsonb, 'the SUMIT run removes nothing and holds one');
select is(coalesce((pg_temp.line('s-1')).removed_at::text, '-') || ':' || (pg_temp.hold('s-1')).kind
  || ':' || (pg_temp.hold('s-1')).provider, '-:remove:sumit', 'a SUMIT sweep removal of a closed document is held');
select is((select p.name from public.projects p where p.id = (pg_temp.line('s-2')).project_id), 'Example Oak house',
  'a re-derived SUMIT section on a closed line keeps the stored project');
select ok((pg_temp.hold('s-2')).transaction_id is null, 'with no hold');
select is((pg_temp.line('s-3')).amount_original, 7250::bigint, 'the open document takes its change');

-- A closed line paid in an open month, and a closed line whose supplier the sync re-derives: two new
-- lines dated in the closed month (let in), then sent again.
insert into res values ('cash_new', pg_temp.run('mercury', jsonb_build_array(
  pg_temp.ml('m-cash', 5900, pg_temp.shut()),
  pg_temp.ml('m-party', 5950, pg_temp.shut()) || jsonb_build_object('counterparty',
    jsonb_build_object('name', 'Example Supplier One', 'kind', 'supplier')))));
insert into ch (label, id) values ('party_one', (pg_temp.line('m-party')).supplier_id);
insert into res values ('cash_again', pg_temp.run('mercury', jsonb_build_array(
  pg_temp.ml('m-cash', 5900, pg_temp.shut()) || jsonb_build_object('cash_date', pg_temp.open()),
  pg_temp.ml('m-party', 5950, pg_temp.shut()) || jsonb_build_object('counterparty',
    jsonb_build_object('name', 'Example Supplier Two', 'kind', 'supplier')))));
select is((select r - 'skipped' from res where label = 'cash_again'),
  '{"inserted": 0, "updated": 2, "removed": 0, "held": 0}'::jsonb, 'neither a payment date in an open month nor a new supplier is held');
select is((pg_temp.line('m-cash')).cash_date, pg_temp.open(), 'a closed line takes a payment date in an open month');
select ok((pg_temp.line('m-party')).supplier_id = pg_temp.id('party_one') and pg_temp.id('party_one') is not null,
  'a re-derived supplier on a closed line keeps the stored one');

-- A sync or a job filing an open invoice: its receipt in the closed period keeps its filing, the open
-- one follows (bank lines here, stored before this transaction as a real sync finds them).
insert into ch (label, id) values
  ('oak', tests.fixture_project(pg_temp.id('co'), 'Example Oak project')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example rent', 'income')),
  ('inv', tests.fixture_line(pg_temp.id('co'), 'ch:inv', 50000, 'income', null, null, pg_temp.open(), 'USD', 'posted',
    'mercury', 'project', 'invoice')),
  ('rcpt_s', tests.fixture_line(pg_temp.id('co'), 'ch:rcpt-s', 20000, 'income', null, null, pg_temp.shut(), 'USD', 'posted',
    'mercury', 'project', 'receipt')),
  ('rcpt_o', tests.fixture_line(pg_temp.id('co'), 'ch:rcpt-o', 30000, 'income', null, null, pg_temp.open(), 'USD', 'posted',
    'mercury', 'project', 'receipt'));
update public.transactions set external_id = 'ch-inv-1', user_assigned = false, category_assigned = false,
  project_id = null, category_id = null where id = pg_temp.id('inv');
update public.transactions set linked_external_id = 'ch-inv-1', user_assigned = false, category_assigned = false,
  project_id = null, category_id = null, created_at = now() - interval '1 day'
where id in (pg_temp.id('rcpt_s'), pg_temp.id('rcpt_o'));
insert into ch (label, id) select 'rcpt_s_cat', t.category_id from public.transactions t where t.id = pg_temp.id('rcpt_s');
do $file$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.transactions set project_id = pg_temp.id('oak'), category_id = pg_temp.id('rent')
  where id = pg_temp.id('inv');
end
$file$;
select is(
  (select array_agg(coalesce(t.project_id::text, '-') || ':' || coalesce(t.category_id::text, '-') order by t.doc_date)
   from public.transactions t where t.id in (pg_temp.id('rcpt_s'), pg_temp.id('rcpt_o'))),
  array['-:' || coalesce(pg_temp.id('rcpt_s_cat')::text, '-'), pg_temp.id('oak') || ':' || pg_temp.id('rent')],
  'a non-person filing of an open invoice leaves its closed receipt and files the open one');

-- Jev leaves a line whose change is held.
do $jev$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into pg_temp.res values ('jev', public.jev_prefill(pg_temp.id('co'), (pg_temp.line('m-0')).id, null,
    pg_temp.id('supplies'), 'example-model', 0.9));
end
$jev$;
select is((select r->>'skipped' from res where label = 'jev') || ':' || ((pg_temp.line('m-0')).category_id
  is distinct from pg_temp.id('supplies'))::text, 'closed:true', 'Jev does not file a line whose change is held');

-- ---------------------------------------------------------------------------------------------
-- The review queue: one open row per held change, and list_review carries it.
-- ---------------------------------------------------------------------------------------------
select is((select array_agg(e || '=' || array_to_string(pg_temp.open_rows(e), ',') order by e)
  from unnest(array['m-0', 'm-1', 'm-2', 'm-left', 'm-pend', 'm-void', 's-1']) e),
  array['m-0=closed_month_change', 'm-1=closed_month_change', 'm-2=closed_month_change',
    'm-left=closed_month_change', 'm-pend=closed_month_change', 'm-void=closed_month_change', 's-1=closed_month_change'],
  'each held change has exactly one open review row, reason closed_month_change');
insert into res values ('list', pg_temp.ask('select public.list_review()'));
select is((select i->'held' from res, jsonb_array_elements(r) i where label = 'list'
    and i->>'transaction_id' = (pg_temp.line('m-0')).id::text),
  jsonb_build_object('kind', 'update', 'amount_minor', 6000, 'currency', 'USD', 'doc_date', pg_temp.shut(),
    'cash_date', null, 'line_status', 'posted', 'provider', 'mercury'),
  'list_review carries the held change');
select is((select i->'held'->>'kind' from res, jsonb_array_elements(r) i where label = 'list'
    and i->>'transaction_id' = (pg_temp.line('m-pend')).id::text), 'update',
  'the held posting of a pending line is listed too');
select is((select i->'held' from res, jsonb_array_elements(r) i where label = 'list'
    and i->>'transaction_id' = (pg_temp.line('m-void')).id::text),
  '{"kind": "void", "amount_minor": null, "currency": null, "doc_date": null, "cash_date": null, "line_status": null, "provider": "mercury"}'::jsonb,
  'a held void carries its kind only');
select is((select (r->>'total')::integer from (select pg_temp.ask('select public.list_review_page(500)') r) x)
  - (select jsonb_array_length(r) from res where label = 'list'), 0, 'list_review_page counts the same rows');

-- A person still cannot change a closed line (part 2a), nor close its held change's row as a review.
select is(pg_temp.try(format('select public.reassign_transaction(%L, null, %L)', (pg_temp.line('m-0')).id,
  pg_temp.id('supplies'))), pg_temp.msg(), 'a person''s edit of a closed line is still refused');
select is(pg_temp.try(format('select public.resolve_review(%L, %L)', pg_temp.review_of('m-0'), 'skipped')),
  pg_temp.msg(), 'an app that does not know the reason cannot close the row: refused with the closed date');

-- ---------------------------------------------------------------------------------------------
-- Leaving a held change: the app, then flow-mcp with its undo.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.leave_held_change(%L)', pg_temp.review_of('m-left'))), 'ok',
  'the owner leaves a held change');
select is((pg_temp.hold('m-left')).state || ':' || ((pg_temp.hold('m-left')).left_at is not null)::text
  || ':' || (select q.status::text from public.review_queue q where q.id = pg_temp.review_of('m-left')),
  'left:true:approved', 'the hold is left and its row approved');
select is(pg_temp.try(format('select public.leave_held_change(%L)', pg_temp.review_of('m-left'))),
  'review item not found', 'leaving it again finds nothing open');

insert into res values ('leave_mcp', pg_temp.ask(format('select public.mcp_leave_held_change(%L, %L::uuid)',
  'ch-leave-1', (pg_temp.line('m-1')).id)));
select is((select r->'data'->>'undo_kind' from res where label = 'leave_mcp'), 'held_change_left',
  'flow-mcp leaves a held change, with an undo');
select is((pg_temp.hold('m-1')).state, 'left', 'the hold is left');
insert into res values ('leave_undo', pg_temp.ask(format('select public.mcp_undo(%L, %L, %L::uuid)',
  'ch-leave-undo-1', 'held_change_left', (pg_temp.line('m-1')).id)));
select is((select r->>'ok' from res where label = 'leave_undo'), 'true', 'the leave is undone');
select is((pg_temp.hold('m-1')).state || ':' || array_to_string(pg_temp.open_rows('m-1'), ','),
  'held:closed_month_change', 'the hold is held again and its row reopened');
select is((select r->'error'->>'code' from (select pg_temp.ask(format('select public.mcp_leave_held_change(%L, %L::uuid)',
  'ch-leave-2', (pg_temp.line('m-same')).id)) r) x), 'refused', 'a line with no held change is refused');

-- The same change does not reopen a left row; a different one does.
insert into res values ('third', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-left', 6300, pg_temp.shut()))));
-- (A normal reason may queue the line again, as for any line; the held change's reason does not.)
select is((pg_temp.hold('m-left')).state || ':' || ('closed_month_change' = any (pg_temp.open_rows('m-left')))::text,
  'left:false', 'the same change sent again stays left and does not reopen its row');
insert into res values ('fourth', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-2', 6250, pg_temp.shut()))));
select is(pg_temp.try(format('select public.leave_held_change(%L)', pg_temp.review_of('m-2'))), 'ok',
  'the owner leaves m-2');
insert into res values ('fifth', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-2', 6400, pg_temp.shut()))));
select is((pg_temp.hold('m-2')).state || ':' || array_to_string(pg_temp.open_rows('m-2'), ',')
  || ':' || ((pg_temp.hold('m-2')).line->>'amount_original'),
  'held:closed_month_change:6400', 'a different change is held again and reopens a row');

-- The hold's state and left_at go together (decision 0266).
select throws_ok(format($$update private.closed_line_holds set state = 'left' where transaction_id = %L$$,
  (pg_temp.line('m-0')).id), '23514', null, 'a left hold with no left_at is refused');

-- ---------------------------------------------------------------------------------------------
-- The close waits for the open review lines; moving the date back does not.
-- ---------------------------------------------------------------------------------------------
insert into res values ('close_more', pg_temp.ask(format('select public.mcp_set_books_closed_through(%L, %L::date)',
  'ch-close-1', pg_temp.open())));
select is((select r->'error'->>'code' || ':' || (r->'error'->>'message') from res where label = 'close_more'),
  'refused:approve the open review lines first', 'a close with open review lines in the period is refused');
insert into res values ('reopen', pg_temp.ask(format('select public.mcp_set_books_closed_through(%L, %L::date)',
  'ch-close-2', pg_temp.m1(-9))));
select is((select r->>'ok' from res where label = 'reopen'), 'true', 'moving the closed date back is never refused by it');

-- ---------------------------------------------------------------------------------------------
-- The next syncs apply every held change, a left one too; a fetched line wins over its hold.
-- ---------------------------------------------------------------------------------------------
insert into res values ('replay', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-1', 6900, pg_temp.shut()))));
select is((select array_agg(e || '=' || (pg_temp.line(e)).amount_original order by e)
  from unnest(array['m-0', 'm-1', 'm-2', 'm-left']) e),
  array['m-0=6000', 'm-1=6900', 'm-2=6400', 'm-left=6300'],
  'the held amounts are applied (the left one too), and the fetched m-1 wins over its hold');
select is((pg_temp.line('m-pend')).line_status::text || ':' || (pg_temp.line('m-void')).line_status::text,
  'posted:void', 'the held posting and the held void are applied');
select is((select count(*)::integer from private.closed_line_holds where company_id = pg_temp.id('co') and provider = 'mercury'),
  0, 'every bank hold is applied and deleted');
select is((select count(*)::integer from public.review_queue q where q.company_id = pg_temp.id('co') and q.status = 'open'
  and q.reason = 'closed_month_change' and q.transaction_id in (select id from public.transactions where source = 'mercury')),
  0, 'and their review rows are closed in the same run');
insert into res values ('replay_sumit', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-2', 7100, pg_temp.shut(), 'Example Oak house'), pg_temp.sl('s-3', 7250, pg_temp.open())),
  '[]'::jsonb, true));
select ok((pg_temp.line('s-1')).removed_at is not null and (pg_temp.hold('s-1')).transaction_id is null
  and pg_temp.open_rows('s-1') = '{}', 'the held SUMIT removal is applied, its hold and row gone');
select is((select (r->>'removed')::integer from res where label = 'replay_sumit'), 1, 'and counted as removed');

select * from finish();
rollback;
