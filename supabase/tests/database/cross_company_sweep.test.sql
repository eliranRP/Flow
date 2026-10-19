-- Cross-company sweep (FLOW-929). Calls every function in public that authenticated can execute,
-- read from the catalog, as another company's owner (B), with company A's ids as arguments, and
-- proves that nothing of A's comes back, nothing of A's changes and nothing of A's is copied into
-- B's rows. B is swept twice: with B active, and sending A's id as the company header. A third pass
-- calls everything as a viewer of A and proves a viewer changes none of A's rows. A new function is
-- swept with no edit here. Every call runs in its own subtransaction that is always rolled back, so
-- calls cannot affect each other; A's rows are fingerprinted inside it, before the rollback, so a
-- write is caught and named per function. Allowlists and how to read a failure: CONTRIBUTING,
-- Database privileges. Invented names and figures only.

begin;

set local search_path = public, extensions;
set local statement_timeout = '180s';

-- Users: A's owner and a viewer of A (the victim's side), and B's owner (the attacker).
do $users$
begin
  perform tests.create_supabase_user('sweep_a_owner', 'sweep-a-owner@example.com');
  perform tests.create_supabase_user('sweep_a_viewer', 'sweep-a-viewer@example.com');
  perform tests.create_supabase_user('sweep_b_owner', 'sweep-b-owner@example.com');
end
$users$;

-- A's ids by kind, and B's.
create temp table sweep_ids (kind text primary key, id uuid not null);

create or replace function pg_temp.sid(p_kind text)
returns uuid
language sql
stable
as $$ select id from pg_temp.sweep_ids where kind = p_kind; $$;

create or replace function pg_temp.put(p_kind text, p_id uuid)
returns uuid
language sql
as $$ insert into pg_temp.sweep_ids (kind, id) values (p_kind, p_id) returning id; $$;

do $ids$
begin
  perform pg_temp.put('a_owner', tests.get_supabase_uid('sweep_a_owner'));
  perform pg_temp.put('a_viewer', tests.get_supabase_uid('sweep_a_viewer'));
  perform pg_temp.put('b_owner', tests.get_supabase_uid('sweep_b_owner'));
  perform pg_temp.put('company', tests.fixture_company('sweep_a_owner', 'Victim Sample Co'));
  perform pg_temp.put('b_company', tests.fixture_company('sweep_b_owner', 'Attacker Sample Co'));
end
$ids$;

-- A's books: every kind of row a company holds, written as postgres the way the fixtures write.
-- Every text of A's says "Victim", and A's amounts are distinctive, so check (b) can find them.
do $seed$
declare
  a uuid := pg_temp.sid('company');
  owner uuid := pg_temp.sid('a_owner');
  b_owner uuid := pg_temp.sid('b_owner');
  next_month text := to_char(current_date + interval '1 month', 'YYYY-MM');
  project uuid;
  project2 uuid;
  category uuid;
  category2 uuid;
  income_category uuid;
  supplier uuid;
  supplier2 uuid;
  customer uuid;
  line uuid;
  line2 uuid;
  invoice uuid;
  bank_in uuid;
  loan_line uuid;
  suggested uuid;
  loan uuid;
  loan2 uuid;
  token uuid;
  b_stale_token uuid;
  suggestion uuid;
  rule uuid;
  edit uuid;
begin
  project := pg_temp.put('project', tests.fixture_project(a, 'Victim Sample Project'));
  project2 := pg_temp.put('project2', tests.fixture_project(a, 'Victim Second Project'));
  category := pg_temp.put('category', tests.fixture_category(a, 'Victim Sample Category'));
  category2 := pg_temp.put('category2', tests.fixture_category(a, 'Victim Spare Category'));
  income_category := pg_temp.put('income_category', tests.fixture_category(a, 'Victim Income Category', 'income'));
  insert into public.suppliers (company_id, name) values (a, 'Victim Sample Supplier') returning id into supplier;
  insert into public.suppliers (company_id, name) values (a, 'Victim Other Supplier') returning id into supplier2;
  insert into public.customers (company_id, name) values (a, 'Victim Sample Customer') returning id into customer;
  perform pg_temp.put('supplier', supplier);
  perform pg_temp.put('supplier2', supplier2);
  perform pg_temp.put('customer', customer);

  line := pg_temp.put('line', tests.fixture_line(a, 'Victim expense line', 7654321, 'expense', project, category));
  line2 := pg_temp.put('line2', tests.fixture_line(a, 'Victim split line', 6543217, 'expense', project, category));
  invoice := pg_temp.put('invoice', tests.fixture_line(a, 'Victim invoice', 8765432, 'income', project,
    income_category, '2026-06-10', 'ILS', 'posted', 'manual', 'project', 'invoice'));
  bank_in := pg_temp.put('bank_in', tests.fixture_line(a, 'Victim bank deposit', 8765432, 'income', null, null,
    '2026-06-12', 'USD', 'posted', 'mercury', 'project', 'receipt'));
  loan_line := pg_temp.put('loan_line', tests.fixture_line(a, 'Victim loan payment', 5432176, 'expense'));
  suggested := pg_temp.put('suggested', tests.fixture_line(a, 'Victim suggested line', 4321765, 'expense',
    project, category, '2026-06-14', 'ILS', 'posted', 'sumit', 'project', 'receipt', true));
  update public.transactions set supplier_id = supplier where id in (line, line2, loan_line, suggested);
  update public.transactions set customer_id = customer where id = invoice;

  insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
  values (a, line, project, 10000, -7654321);
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
  values (a, line2, 1, category, project, 4000000), (a, line2, 2, category2, project2, 2543217);
  insert into public.overhead (company_id, transaction_id) values (a, line);
  insert into public.reassign_undo (company_id, transaction_id, prior_project_id, prior_user_assigned, prior_allocations)
  values (a, line, project2, true, '[]'::jsonb)
  returning id into token;
  perform pg_temp.put('reassign', token);
  insert into public.review_queue (company_id, transaction_id, status) values (a, suggested, 'open')
  returning id into token;
  perform pg_temp.put('review', token);

  insert into public.split_rules (company_id, supplier_id, method, label)
  values (a, supplier, 'manual', 'Victim split rule') returning id into rule;
  insert into public.split_rule_targets (company_id, rule_id, project_id, month, share_bp)
  values (a, rule, project, '2026-06-01', 10000);

  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months,
    start_date, payment_minor, escrow_minor, currency, project_id
  )
  values (a, 'Victim Sample Mortgage', 123456700, 61000, 360, '2026-01-01', 765432, 76543, 'ILS', project)
  returning id into loan;
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months,
    start_date, payment_minor, escrow_minor, currency
  )
  values (a, 'Victim Second Mortgage', 23456700, 52000, 240, '2026-02-01', 165432, 0, 'ILS')
  returning id into loan2;
  perform pg_temp.put('loan', loan);
  perform pg_temp.put('loan2', loan2);
  insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
  values (a, loan, '2026-06-01', 55000) returning id into token;
  perform pg_temp.put('loan_rate', token);
  insert into public.loan_splits (
    company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
  )
  select a, loan, loan_line, 'interest', 5432176, 5432176, c.id
  from public.categories c
  where c.company_id = a and c.kind = 'expense'
  order by c.sort_order
  limit 1;
  insert into private.loan_deletions (company_id, loan_id, user_id, snapshot)
  values (a, loan2, owner, '{"name": "Victim Deleted Mortgage"}'::jsonb);
  insert into private.category_deletions (company_id, category_id, snapshot)
  values (a, category2, '{"name": "Victim Deleted Category"}'::jsonb);
  insert into private.category_moves (company_id, from_id, into_id, moved)
  values (a, category2, category, '[]'::jsonb) returning id into token;
  perform pg_temp.put('move', token);

  insert into public.project_groups (company_id, name) values (a, 'Victim Sample Group') returning id into token;
  perform pg_temp.put('group', token);
  update public.projects set group_id = token where id = project;

  insert into public.recurring_matches (company_id, direction, party_id, match_party_id, same, set_by)
  values (a, 'expense', supplier, supplier2, true, owner);
  insert into public.recurring_overrides (company_id, direction, party_id, currency, recurring, pace, set_by)
  values (a, 'expense', supplier, 'ILS', true, 'month', owner);
  insert into public.recurring_dismissals (user_id, company_id, kind, alert_key)
  values (owner, a, 'missing', 'expense:' || supplier || ':ILS:' || next_month);
  insert into public.forecast_overrides (company_id, month, item_key, amount_minor)
  values (a, next_month, 'a-item-1', 7654321);
  insert into public.project_forecast_edits (
    company_id, project_id, kind, category_id, direction, amount_minor, pace, start_month, created_by
  )
  values (a, project, 'add', category, 'expense', 7654321, 'month', next_month, owner)
  returning id into edit;
  perform pg_temp.put('edit', edit);
  insert into public.forecast_line_matches (company_id, edit_id, month, transaction_id, expected_minor)
  values (a, edit, next_month, line, 7654321);
  insert into public.invoice_paid_marks (company_id, transaction_id, marked_by) values (a, invoice, owner);
  insert into public.invoice_payment_links (company_id, transaction_id, bank_transaction_id, linked_by)
  values (a, invoice, bank_in, owner);
  insert into public.invoice_match_dismissals (company_id, transaction_id, bank_transaction_id, dismissed_by)
  values (a, invoice, bank_in, owner);

  insert into public.connector_connections (
    company_id, provider, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version
  )
  values (a, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, 'MERCURY_KEK', '1', '1');
  insert into public.connector_refresh_requests (company_id, provider) values (a, 'mercury');
  insert into public.connector_skips (company_id, provider, external_id, reason)
  values (a, 'mercury', 'victim-skip-1', 'Victim skip reason');
  insert into public.party_external_refs (company_id, provider, kind, external_id, supplier_id)
  values (a, 'mercury', 'supplier', 'victim-counterparty-1', supplier);
  insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
  values (a, 'jev', true, 'shadow', 0.9);

  insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
  values (
    a, suggested,
    jsonb_build_object('project', jsonb_build_object('choice', project), 'category', jsonb_build_object('choice', category)),
    0.9, 'victim-model', 'victim-model'
  )
  returning id into suggestion;
  insert into public.jev_outcomes (company_id, transaction_id, suggestion_id, model_version, confidence, review_status)
  values (a, suggested, suggestion, 'victim-model', 0.9, 'approved')
  on conflict do nothing;
  insert into public.jev_prefills (company_id, transaction_id, project_id, category_id)
  values (a, suggested, project, category);
  insert into public.jev_line_failures (company_id, transaction_id, model_version, retry_after)
  values (a, line2, 'victim-model', now() + interval '1 day');
  insert into public.jev_usage (company_id, run_id, reserved) values (a, gen_random_uuid(), 3);

  insert into public.company_invites (company_id, email, role, invited_by)
  values (a, 'victim-invitee@example.com', 'editor', owner) returning id into token;
  perform pg_temp.put('invite', token);
  insert into public.company_members (company_id, user_id, role) values (a, pg_temp.sid('a_viewer'), 'viewer');
  insert into public.active_companies (user_id, company_id) values (owner, a);
  insert into public.setup_states (user_id, company_id, state) values (owner, a, '{"victim": true}'::jsonb);
  insert into public.audit_log (company_id, actor_id, action, entity)
  values (a, owner, 'insert', 'transactions');

  -- A's flow-mcp token and its writes, batches, jobs and idempotency rows.
  insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
  values (owner, a, 'hash-sweep-victim', 'kid', array['read', 'write']::text[], '2099-01-01')
  returning id into token;
  perform pg_temp.put('a_token', token);
  insert into private.mcp_writes (token_id, user_id, project_id, kind, company_id)
  values (token, owner, project, 'project', a);
  insert into private.mcp_writes (token_id, user_id, category_id, kind, company_id)
  values (token, owner, category, 'category', a);
  insert into private.mcp_batches (token_id, user_id, company_id, idempotency_key)
  values (token, owner, a, 'a-batch-key-1');
  insert into private.mcp_sync_jobs (token_id, user_id, company_id, state, started_at)
  values (token, owner, a, 'running', now()) returning id into suggestion;
  perform pg_temp.put('job', suggestion);
  insert into private.mcp_idempotency (token_id, idempotency_key, request_hash, response)
  values (token, 'a-key-1', 'hash', '{"victim": true}'::jsonb);

  -- B once edited A's books with a token of its own and has since left: its old token and writes
  -- still name A (the shape of the fixed mcp_undo leak). Nothing B calls now may reach them.
  insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
  values (b_owner, a, 'hash-sweep-b-stale', 'kid', array['read', 'write']::text[], '2099-01-01')
  returning id into b_stale_token;
  insert into private.mcp_writes (token_id, user_id, project_id, kind, company_id)
  values (b_stale_token, b_owner, project2, 'project', a);
  insert into private.mcp_writes (token_id, user_id, loan_id, kind, company_id)
  values (b_stale_token, b_owner, loan, 'loan', a);
  insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, company_id)
  values (b_stale_token, b_owner, category, 'category_name', '{"before": "Victim Old Name", "after": "x"}'::jsonb, a);
end
$seed$;

-- B's own books, so its functions run their normal paths, and the tokens each pass calls flow-mcp
-- functions with. The viewer's token names A and has write scope: the database must still refuse.
do $seed_b$
declare
  b uuid := pg_temp.sid('b_company');
  b_owner uuid := pg_temp.sid('b_owner');
  project uuid;
  token uuid;
begin
  project := tests.fixture_project(b, 'Attacker Project');
  perform tests.fixture_line(b, 'Attacker line', 1000, 'expense', project, null);
  insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
  values (b_owner, b, 'hash-sweep-b', 'kid', array['read', 'write']::text[], '2099-01-01')
  returning id into token;
  perform pg_temp.put('b_token', token);
  insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
  values (pg_temp.sid('a_viewer'), pg_temp.sid('company'), 'hash-sweep-viewer', 'kid',
    array['read', 'write']::text[], '2099-01-01')
  returning id into token;
  perform pg_temp.put('viewer_token', token);
end
$seed_b$;

-- B's past seat in A: as an editor of A, with its old token, B set and reset A's forecast through
-- flow-mcp, then left A. Those writes keep A's override rows in their prior; replaying their undo
-- from B must not copy them into B (the mcp_undo leak fixed in #732).
do $stale$
declare
  a uuid := pg_temp.sid('company');
  b_owner uuid := pg_temp.sid('b_owner');
  stale uuid := (select c.id from private.mcp_credentials c where c.token_hash = 'hash-sweep-b-stale');
  next_month text := to_char(current_date + interval '1 month', 'YYYY-MM');
  r jsonb;
begin
  insert into public.company_members (company_id, user_id, role) values (a, b_owner, 'editor');
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', b_owner, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', stale)::text, true);
  perform set_config('request.jwt.claim.sub', b_owner::text, true);
  perform set_config('role', 'authenticated', true);
  r := public.mcp_set_forecast_item('sweep-stale-1', next_month, 'a-item-2', '{"amount_minor": 6543217}'::jsonb);
  assert r->>'ok' = 'true', 'stale forecast item: ' || r::text;
  r := public.mcp_reset_forecast('sweep-stale-2', next_month);
  assert r->>'ok' = 'true', 'stale forecast reset: ' || r::text;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.company_members where company_id = a and user_id = b_owner;
  insert into public.forecast_overrides (company_id, month, item_key, amount_minor)
  values (a, next_month, 'a-item-1', 7654321);
end
$stale$;

-- A's fingerprint: one entry per table in public and private with a company_id (from the catalog),
-- plus A's companies row: the row count and an md5 of the ordered rows. Built once as one query.
create temp table sweep_tables as
select format('%I.%I', n.nspname, c.relname) as rel, 'company_id' as col
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where a.attname = 'company_id' and not a.attisdropped
  and c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
union all
select 'public.companies', 'id';

create temp table sweep_sql (q text);
insert into sweep_sql
select 'select array[' || string_agg(
  format('(select count(*) || '':'' || md5(coalesce(string_agg(t::text, '','' order by t::text), '''')) from %s t where t.%I = $1)', rel, col),
  ', ' order by rel) || ']'
from sweep_tables;

create or replace function pg_temp.fingerprint(p_company uuid)
returns text[]
language plpgsql
as $$
declare
  result text[];
begin
  execute (select q from pg_temp.sweep_sql where q like 'select array%') into result using p_company;
  return result;
end;
$$;

-- One assertion per table below, so the plan reads the catalog too.
select plan(11 + (select count(*)::integer from sweep_tables));

-- All of one company's rows as text, to find A's data copied into B's books.
insert into sweep_sql
select 'select concat_ws('' | '', ' || string_agg(
  format('(select string_agg(t::text, '','') from %s t where t.%I = $1)', rel, col), ', ' order by rel) || ')'
from sweep_tables;

create or replace function pg_temp.company_text(p_company uuid)
returns text
language plpgsql
as $$
declare
  result text;
begin
  execute (select q from pg_temp.sweep_sql where q like 'select concat_ws%') into result using p_company;
  return result;
end;
$$;

create temp table sweep_baseline as
select array_agg(rel order by rel) as rels, pg_temp.fingerprint(pg_temp.sid('company')) as fp
from sweep_tables;

-- Every uuid in A's rows (ids, keys, actors), less B's own ids that A's rows name (B's old token).
create temp table sweep_a_uuids (id uuid primary key);
do $uuids$
declare
  t record;
begin
  for t in
    select st.rel, st.col, a.attname
    from sweep_tables st
    join pg_attribute a on a.attrelid = st.rel::regclass and a.atttypid = 'uuid'::regtype
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format(
      'insert into pg_temp.sweep_a_uuids select distinct %I from %s where %I = $1 and %I is not null on conflict do nothing',
      t.attname, t.rel, t.col, t.attname)
    using pg_temp.sid('company');
  end loop;
  insert into pg_temp.sweep_a_uuids values (pg_temp.sid('a_owner')), (pg_temp.sid('a_viewer')) on conflict do nothing;
  delete from pg_temp.sweep_a_uuids
  where id in (select s.id from pg_temp.sweep_ids s where s.kind like 'b\_%');
  delete from pg_temp.sweep_a_uuids u
  where u.id in (select c.id from private.mcp_credentials c where c.user_id = pg_temp.sid('b_owner'));
end
$uuids$;

-- A's distinctive seeded text and figures. A figure only counts when no hex digit or dash touches
-- it, so it never matches inside a uuid.
create or replace function pg_temp.has_a_text(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text ~* 'victim'
    or p_text ~ '(^|[^0-9a-f-])-?(7654321|6543217|8765432|5432176|4321765|123456700)([^0-9a-f]|$)';
$$;

-- An A id for a hint (an argument name, a function name or an undo kind), or null.
create or replace function pg_temp.hint_id(p_hint text)
returns uuid
language sql
stable
as $$
  select pg_temp.sid(case
    when p_hint ~ 'invite' then 'invite'
    when p_hint ~ 'member|user' then 'a_viewer'
    when p_hint ~ 'loan_rate' then 'loan_rate'
    when p_hint ~ 'loan' then 'loan'
    when p_hint ~ 'move' then 'move'
    when p_hint ~ 'job' then 'job'
    when p_hint ~ 'group' then 'group'
    when p_hint ~ 'match_party' then 'supplier2'
    when p_hint ~ 'party|supplier' then 'supplier'
    when p_hint ~ 'invoice' then 'invoice'
    when p_hint ~ 'review|anomal' then 'suggested'
    when p_hint ~ 'reassign' then 'reassign'
    when p_hint ~ 'parent|into' then 'category2'
    when p_hint ~ 'categor' then 'category'
    when p_hint ~ 'project_forecast|forecast_edit' then 'edit'
    when p_hint ~ 'project' then 'project'
    when p_hint ~ 'company|cash_basis|jev_mode|index_rate|currency|forecast' then 'company'
    when p_hint ~ 'transaction|line|payment|split|document|manual|from' then 'line'
  end);
$$;

-- Arguments that need a shape the name rules below can't guess. Each row is one call; a function
-- with no row is called once. mcp_undo is called once per undo kind (read from mcp_writes' check),
-- each with the A id that kind names, so every branch reaches its company check.
create temp table sweep_variants (fn text, args jsonb);
insert into sweep_variants (fn, args)
select 'mcp_undo', jsonb_build_object(
  'p_kind', quote_literal(k),
  'p_id', quote_literal(coalesce(pg_temp.hint_id(k), pg_temp.sid('line'))) || '::uuid')
from (
  select distinct (regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''::text', 'g'))[1] as k
  from pg_constraint
  where conname = 'mcp_writes_kind_check'
) kinds;
-- And once per write B left in A, with the write's own id and with the row it names.
insert into sweep_variants (fn, args)
select 'mcp_undo', jsonb_build_object('p_kind', quote_literal(w.kind), 'p_id', quote_literal(x.id) || '::uuid')
from private.mcp_writes w
cross join lateral (values (w.id), (coalesce(w.project_id, w.category_id, w.loan_id, w.transaction_id))) x(id)
where w.user_id = pg_temp.sid('b_owner') and w.company_id = pg_temp.sid('company') and x.id is not null;
insert into sweep_variants (fn, args) values
  ('move_category_lines', jsonb_build_object('p_from', quote_literal(pg_temp.sid('category2')) || '::uuid')),
  ('mcp_move_category_lines', jsonb_build_object('p_from', quote_literal(pg_temp.sid('category2')) || '::uuid')),
  ('delete_company', jsonb_build_object('p_confirm', quote_literal('Victim Sample Co'))),
  ('set_cash_basis', jsonb_build_object('p_basis', quote_literal('paid'))),
  ('mcp_set_cash_basis', jsonb_build_object('p_basis', quote_literal('paid'))),
  ('dismiss_recurring_alert', jsonb_build_object('p_kind', quote_literal('missing'))),
  ('undismiss_recurring_alert', jsonb_build_object('p_kind', quote_literal('missing'))),
  ('dismiss_recurring_alert', jsonb_build_object('p_kind', quote_literal('change'),
    'p_key', quote_literal(pg_temp.sid('line')::text))),
  ('mcp_add_loan', jsonb_build_object('p_kind', quote_literal('amortizing'))),
  ('mcp_undo_batch', jsonb_build_object('p_batch_key', quote_literal('a-batch-key-1'))),
  ('mcp_create_categories', jsonb_build_object('p_items', quote_literal('[{"name": "Sweep Name", "kind": "expense"}]') || '::jsonb')),
  ('mcp_create_projects', jsonb_build_object('p_items', quote_literal('[{"name": "Sweep Name"}]') || '::jsonb'));
-- p_patch takes a different shape per function: try both a forecast patch and a rename.
insert into sweep_variants (fn, args)
select distinct p.proname, jsonb_build_object('p_patch', quote_literal(v) || '::jsonb')
from pg_proc p
cross join (values ('{"amount_minor": 100}'), ('{"name": "Sweep Name"}')) x(v)
where p.pronamespace = 'public'::regnamespace and 'p_patch' = any (p.proargnames);

-- One argument's SQL literal, by its type and name, preferring A's ids.
create or replace function pg_temp.arg_literal(p_fn text, p_arg text, p_type oid)
returns text
language plpgsql
stable
as $$
declare
  n text := regexp_replace(p_arg, '^p_', '');
  t text := format_type(p_type, null);
  next_month date := (date_trunc('month', current_date) + interval '1 month')::date;
  ids jsonb := (select jsonb_object_agg(kind, id) from pg_temp.sweep_ids);
  v text;
begin
  if t = 'uuid' then
    v := coalesce(
      pg_temp.hint_id(n),
      case when n = 'id' then pg_temp.hint_id(p_fn) end,
      pg_temp.sid('line'))::text;
  elsif t = 'uuid[]' then
    v := case
      when n ~ 'loan' or p_fn ~ 'loan' then format('{%s,%s}', ids->>'loan', ids->>'loan2')
      else format('{%s,%s,%s,%s}', ids->>'line', ids->>'line2', ids->>'invoice', ids->>'suggested')
    end;
  elsif t = 'date' then
    v := case
      when n = 'from' then '2020-01-01'
      when n = 'to' then '2030-12-31'
      when n = 'today' then current_date::text
      when n = 'month' then next_month::text
      else '2026-06-10'
    end;
  elsif t in ('integer', 'smallint') then
    v := case n
      when 'year' then '2026' when 'months' then '12' when 'limit' then '50' when 'offset' then '0'
      when 'day' then '10' when 'window_days' then '30' when 'term_months' then '360'
      when 'amortization_months' then '360' when 'interest_only_months' then '0'
      when 'annual_rate_ppm' then '50000' when 'margin_ppm' then '1000'
      else '1'
    end;
  elsif t = 'bigint' then
    v := case when n in ('amount_min', 'amount_max') then null else '100' end;
  elsif t = 'numeric' then
    v := case when n = 'threshold' then '0.9' else '1' end;
  elsif t = 'boolean' then
    v := 'true';
  elsif t = 'txn_direction' then
    v := 'expense';
  elsif t = 'connector_provider' then
    v := 'mercury';
  elsif t = 'jsonb' then
    v := case n
      when 'items' then jsonb_build_array(jsonb_build_object(
        'transaction_id', ids->'line', 'id', ids->'line', 'project_id', ids->'project',
        'category_id', ids->'category', 'in_pnl', false, 'in_cash', false, 'share_bp', 10000))::text
      when 'shares' then jsonb_build_array(jsonb_build_object('project_id', ids->'project', 'share_bp', 10000))::text
      when 'parts' then jsonb_build_array(jsonb_build_object(
        'category_id', ids->'category', 'project_id', ids->'project', 'amount_minor', 100,
        'part', 'interest', 'percent', 100))::text
      when 'rows' then jsonb_build_array(jsonb_build_object(
        'key', 'k1', 'amount_minor', 100, 'date', '2026-06-10', 'transaction_id', ids->'line'))::text
      when 'edit' then jsonb_build_object(
        'kind', 'add', 'category_id', ids->'category', 'direction', 'expense', 'amount_minor', 100,
        'pace', 'month')::text
      when 'document' then jsonb_build_object(
        'name', 'sweep.pdf', 'mime', 'application/pdf', 'sha256', repeat('a', 64), 'bytes', 100)::text
      when 'undo' then jsonb_build_object('project_id', ids->'project', 'edits', '[]'::jsonb)::text
      else '{}'
    end;
  elsif t = 'text' then
    v := case
      when n = 'idempotency_key' then 'sweep-key-1'
      when n = 'batch_key' then 'sweep-batch-1'
      when n = 'basis' then 'invoiced'
      when n = 'month' then to_char(next_month, 'YYYY-MM')
      when n = 'currency' then 'ILS'
      when n = 'direction' then 'expense'
      when n = 'kind' then 'expense'
      when n = 'key' then 'expense:' || (ids->>'supplier') || ':ILS:' || to_char(next_month, 'YYYY-MM')
      when n = 'email' then 'sweep-invitee@example.com'
      when n = 'role' then 'editor'
      when n in ('name', 'group_name') then 'Sweep Name'
      when n = 'group_by' then 'category'
      when n in ('group_key', 'category') then ids->>'category'
      when n = 'project' then ids->>'project'
      when n = 'item_key' then 'a-item-1'
      when n = 'row_key' then 'sweep-row'
      when n = 'side' then 'out'
      when n = 'scope' then 'all'
      when n = 'query' then null
      when n = 'method' then 'cash'
      when n = 'cheque_number' then '123'
      when n = 'mode' then 'shadow'
      when n = 'provider' then 'jev'
      when n = 'pace' then 'month'
      when n = 'rate_index' then 'il_prime'
      when n = 'set' then 'general'
      when n = 'action' then 'approved'
      when n = 'status' then 'active'
      when n = 'sha256' then repeat('a', 64)
      when n = 'endpoint' then 'https://fcm.googleapis.com/fcm/send/sweep-example'
      when n = 'p256dh' then repeat('p', 87)
      when n = 'auth' then 'sweepAuthExample123'
      else 'Sweep text'
    end;
  else
    v := null;
  end if;
  return quote_nullable(v) || '::' || format_type(p_type, null);
end;
$$;

-- One call, as p_user with p_company as the active company (the x-flow-company header) and, for a
-- flow-mcp function, p_token's claims. The call always rolls back; its outcome, what it returned,
-- which of A's tables it changed and, in B's passes, any of A's ids or text now in B's own rows (all
-- read before the rollback) are recorded in sweep_calls.
create temp table sweep_calls (
  pass text, fn text, sig text, call text, outcome text, err text, result text,
  leaked_ids uuid[], leaked_text boolean, changed text[], copied_ids uuid[], copied_text boolean, ms numeric
);

create or replace function pg_temp.sweep_call(
  p_pass text, p_user uuid, p_company uuid, p_token uuid, p_fn text, p_sig text, p_call text
)
returns void
language plpgsql
as $$
declare
  res text;
  fp text[];
  outcome text := 'ok';
  err text;
  started timestamptz := clock_timestamp();
  base pg_temp.sweep_baseline%rowtype;
  changed text[];
  copied text;
begin
  select * into base from pg_temp.sweep_baseline;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', p_user, 'role', 'authenticated', 'aal', 'aal1',
      'mcp_tid', case when p_fn like 'mcp\_%' then p_token end)::text, true);
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.headers', jsonb_build_object('x-flow-company', p_company)::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_call into res;
    perform set_config('role', 'postgres', true);
    fp := pg_temp.fingerprint(pg_temp.sid('company'));
    if p_pass like 'b%' then
      copied := pg_temp.company_text(pg_temp.sid('b_company'));
    end if;
    raise exception 'sweep rollback' using errcode = 'SWP01';
  exception
    when sqlstate 'SWP01' then
      null;
    when others then
      outcome := 'error';
      err := sqlstate || ' ' || sqlerrm;
  end;
  if fp is not null then
    select array_agg(base.rels[i] order by i) into changed
    from generate_subscripts(base.fp, 1) i
    where base.fp[i] is distinct from fp[i];
  end if;
  insert into pg_temp.sweep_calls
  select p_pass, p_fn, p_sig, p_call, outcome, err, res,
    (select array_agg(u.id order by u.id) from pg_temp.sweep_a_uuids u where strpos(res, u.id::text) > 0),
    coalesce(pg_temp.has_a_text(res), false),
    changed,
    (select array_agg(u.id order by u.id) from pg_temp.sweep_a_uuids u where strpos(copied, u.id::text) > 0),
    coalesce(pg_temp.has_a_text(copied), false),
    round(extract(epoch from clock_timestamp() - started) * 1000, 1);
end;
$$;

-- Every function in public that authenticated can execute, definer and invoker, read from the
-- catalog, less the ones skipped below.
create temp table sweep_skip (sig text primary key, why text not null);

create temp view sweep_targets as
select p.oid, p.proname::text as fn, p.oid::regprocedure::text as sig,
  format('select coalesce(string_agg(x::text, %L), %L) from %I.%I(%%s) as x', ' | ', '', n.nspname, p.proname) as tmpl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and has_function_privilege('authenticated', p.oid, 'execute')
  and p.oid::regprocedure::text not in (select sig from pg_temp.sweep_skip);

create or replace function pg_temp.sweep(p_pass text, p_user uuid, p_company uuid, p_token uuid, p_only text default null)
returns void
language plpgsql
as $$
declare
  f record;
  v record;
  args text;
begin
  for f in select * from pg_temp.sweep_targets t where p_only is null or t.fn ~ p_only order by t.sig loop
    for v in
      select sv.args from pg_temp.sweep_variants sv where sv.fn = f.fn
      union all
      select '{}'::jsonb where not exists (select 1 from pg_temp.sweep_variants sv where sv.fn = f.fn)
    loop
      select coalesce(string_agg(coalesce(v.args->>a.n, pg_temp.arg_literal(f.fn, a.n, a.t)), ', ' order by a.i), '')
      into args
      from pg_proc p,
        unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) with ordinality as a(n, t, i)
      where p.oid = f.oid;
      perform pg_temp.sweep_call(p_pass, p_user, p_company, p_token, f.fn, f.sig, format(f.tmpl, args));
    end loop;
  end loop;
end;
$$;

-- (c) The allowlists. Keep them minimal: each entry says why.
--
-- Functions skipped by the sweep: none today. A function that can't be called generically goes here
-- with the reason; the coverage assertion counts it out, and the list fails when one is gone.
-- insert into sweep_skip (sig, why) values ('example(uuid)', 'why it cannot be called generically');
--
-- Functions that may return an A id the caller supplied, and only that: an id B already holds is no
-- leak. Any other A id, or any of A's text or figures, in what they return still fails check (b).
create temp table sweep_echo (fn text primary key, why text not null);
insert into sweep_echo (fn, why) values
  ('dismiss_recurring_alert', 'returns the alert key it was given, which embeds the id; the dismissal is the caller''s own row in its own company'),
  ('undismiss_recurring_alert', 'returns the alert key it was given, which embeds the id'),
  ('expected_months', 'echoes p_project_id beside an empty schedule'),
  ('mcp_assign_expenses', 'per-item envelope names the item''s transaction_id with "refused"'),
  ('mcp_set_lines_cash', 'per-item envelope names the item''s transaction_id with an error code'),
  ('mcp_set_lines_pnl', 'per-item envelope names the item''s transaction_id with an error code');

-- Rows a viewer of A may change through a function: the viewer's own per-user rows, which carry A's
-- company_id but belong to the user (user_id), not to the company's books.
create temp table sweep_viewer_writes (fn text, rel text, why text not null, primary key (fn, rel));
insert into sweep_viewer_writes (fn, rel, why) values
  ('switch_company', 'public.active_companies', 'the viewer''s own active-company row (user_id = viewer)'),
  ('dismiss_recurring_alert', 'public.recurring_dismissals', 'the viewer hides an alert for itself only (user_id = viewer)');

-- Positive controls: as A's owner, the detectors must see A's data and A's write.
select pg_temp.sweep_call('control', pg_temp.sid('a_owner'), pg_temp.sid('company'), pg_temp.sid('a_token'),
  'get_project', 'get_project(uuid)',
  format('select coalesce(string_agg(x::text, %L), %L) from public.get_project(%L::uuid) as x', ' | ', '', pg_temp.sid('project')));
select pg_temp.sweep_call('control', pg_temp.sid('a_owner'), pg_temp.sid('company'), pg_temp.sid('a_token'),
  'rename_category', 'rename_category(uuid,text)',
  format('select coalesce(string_agg(x::text, %L), %L) from public.rename_category(%L::uuid, %L) as x', ' | ', '', pg_temp.sid('category'), 'Sweep Name'));

select ok(
  (select bool_and(leaked_text and cardinality(leaked_ids) > 0) from sweep_calls where pass = 'control' and fn = 'get_project'),
  'control: check (b) sees A''s ids and text when A''s owner reads A''s project'
);
select ok(
  (select bool_and('public.categories' = any (changed)) from sweep_calls where pass = 'control' and fn = 'rename_category'),
  'control: check (a) sees A''s owner rename A''s category'
);

-- The sweep. Pass b: B's owner, B active. Pass b_hint: B's owner sending A's id as the company
-- header, which a client controls. Pass viewer: A's viewer, A active, with a write-scope token for A.
select pg_temp.sweep('b', pg_temp.sid('b_owner'), pg_temp.sid('b_company'), pg_temp.sid('b_token'));
select pg_temp.sweep('b_hint', pg_temp.sid('b_owner'), pg_temp.sid('company'), pg_temp.sid('b_token'));
select pg_temp.sweep('viewer', pg_temp.sid('a_viewer'), pg_temp.sid('company'), pg_temp.sid('viewer_token'));

select diag(format('%s: %s calls to %s functions, %s returned, %s raised, %s ms',
  pass, count(*), count(distinct sig), count(*) filter (where outcome = 'ok'),
  count(*) filter (where outcome = 'error'), round(sum(ms))))
from sweep_calls
where pass <> 'control'
group by pass
order by pass;

-- The seed fills every table it fingerprints, so the sweep has something to steal in each. A new
-- table with a company_id needs a row of A's in the seed above.
select is(
  (select coalesce(array_agg(t.rel order by t.rel), '{}')
   from sweep_tables t, generate_subscripts((select fp from sweep_baseline), 1) i
   where (select rels[i] from sweep_baseline) = t.rel
     and (select fp[i] from sweep_baseline) like '0:%'
     and t.rel <> 'public.company_viewers'),
  '{}'::text[],
  'A''s seed has rows in every table with a company_id (company_viewers is for demo companies only)'
);

-- (d) Coverage: every function in the catalog is called in every pass, except the skipped ones.
select is(
  (select count(distinct sig)::integer from sweep_calls where pass = p),
  (select count(*)::integer from pg_proc pr
   where pr.pronamespace = 'public'::regnamespace and pr.prokind = 'f'
     and has_function_privilege('authenticated', pr.oid, 'execute'))
  - (select count(*)::integer from sweep_skip),
  format('pass %s calls every function authenticated can execute, less the %s skipped', p, (select count(*) from sweep_skip))
)
from unnest(array['b', 'b_hint', 'viewer']) p;

-- A call that failed because the sweep built it wrong never reached the function's own checks.
select is(
  (select coalesce(array_agg(distinct fn || ' ' || left(err, 60) order by fn || ' ' || left(err, 60)), '{}')
   from sweep_calls where err ~ '^(42725|42883|42P18|42804|22P02|42601) '),
  '{}'::text[],
  'every call resolved its function and argument types'
);

-- (a) No call changed any of A's tables: one assertion per table, naming the functions that did.
select is(
  (select coalesce(array_agg(distinct c.pass || ':' || c.fn order by c.pass || ':' || c.fn), '{}')
   from sweep_calls c
   where c.pass <> 'control' and t.rel = any (c.changed)
     and not (c.pass = 'viewer' and exists (
       select 1 from sweep_viewer_writes w where w.fn = c.fn and w.rel = t.rel))),
  '{}'::text[],
  format('no call by B or by A''s viewer changed %s', t.rel)
)
from sweep_tables t
order by t.rel;

select is(
  pg_temp.fingerprint(pg_temp.sid('company')),
  (select fp from sweep_baseline),
  'A''s tables are unchanged after the sweep'
);

-- (b) Nothing B called returned A's ids, text or figures, or wrote them into B's own rows; an
-- echo-allowlisted function may return (or store) only the A ids it was given.
select is(
  (select coalesce(array_agg(distinct c.pass || ':' || c.fn order by c.pass || ':' || c.fn), '{}')
   from sweep_calls c
   where c.pass in ('b', 'b_hint')
     and (c.leaked_text or c.copied_text
       or exists (select 1 from unnest(c.leaked_ids || c.copied_ids) u where strpos(c.call, u::text) = 0)
       or (cardinality(c.leaked_ids || c.copied_ids) > 0 and c.fn not in (select fn from sweep_echo)))),
  '{}'::text[],
  'no function returned A''s data to B or copied it into B''s rows'
);

-- (c) Every allowlist entry names a function that exists and still needs its entry.
select is(
  (select coalesce(array_agg(x order by x), '{}') from (
     select 'skip:' || s.sig as x from sweep_skip s
     where not exists (select 1 from pg_proc pr where pr.pronamespace = 'public'::regnamespace
       and pr.oid::regprocedure::text = s.sig)
     union all
     select 'echo:' || e.fn from sweep_echo e
     where not exists (select 1 from sweep_targets t where t.fn = e.fn)
     union all
     select 'viewer:' || w.fn from sweep_viewer_writes w
     where not exists (select 1 from sweep_targets t where t.fn = w.fn)) missing),
  '{}'::text[],
  'every allowlisted or skipped function exists'
);
select is(
  (select coalesce(array_agg(x order by x), '{}') from (
     select 'echo:' || e.fn as x from sweep_echo e
     where not exists (select 1 from sweep_calls c
       where c.pass in ('b', 'b_hint') and c.fn = e.fn and cardinality(c.leaked_ids || c.copied_ids) > 0)
     union all
     select 'viewer:' || w.fn || ':' || w.rel from sweep_viewer_writes w
     where not exists (select 1 from sweep_calls c
       where c.pass = 'viewer' and c.fn = w.fn and w.rel = any (c.changed))) stale),
  '{}'::text[],
  'every allowlist entry is still needed'
);

select * from finish();
rollback;
