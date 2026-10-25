-- Cross-company sweep (FLOW-929). Calls every function in public that authenticated can execute,
-- read from the catalog, as another company's owner (B) with company A's ids as arguments, and
-- proves that nothing of A's comes back (in a result or an error), nothing of A's changes, nothing of
-- A's is copied into B's rows or the outbound HTTP queue, no answer B gets changes when A's company is
-- deleted, and every failure is a company refusal that A's owner does not meet with the same call (a
-- reach pass). B is swept three times: with B active, sending A's id as the company header, and with
-- B's old flow-mcp token for A. A viewer pass proves a viewer changes none of A's rows. A new function
-- is swept with no edit here. Every call runs in its own subtransaction that is always rolled back;
-- A's rows are fingerprinted inside it, before the rollback, so a write is named per function.
-- Allowlists and how to read a failure: CONTRIBUTING, Database privileges. Invented names and figures
-- only.

begin;

set local search_path = public, extensions;
set local statement_timeout = '180s';

-- Users: A's owner and a viewer of A (the victim's side), and B's owner (the attacker).
do $users$
begin
  perform tests.create_supabase_user('sweep_a_owner', 'sweep-a-owner@example.com');
  perform tests.create_supabase_user('sweep_a_viewer', 'sweep-a-viewer@example.com');
  perform tests.create_supabase_user('sweep_b_owner', 'sweep-b-owner@example.com');
  -- A's invitee: the invite functions key on the caller's email.
  perform tests.create_supabase_user('sweep_invitee', 'victim-invitee@example.com');
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
  perform pg_temp.put('invitee', tests.get_supabase_uid('sweep_invitee'));
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
    'google', now(), now(), now()
  from auth.users u
  -- B and the viewer have a confirmed email too, so the invite functions reach the email comparison
  -- for them rather than stopping at "no confirmed email".
  where u.id in (pg_temp.sid('invitee'), pg_temp.sid('b_owner'), pg_temp.sid('a_viewer'));
  perform pg_temp.put('company', tests.fixture_company('sweep_a_owner', 'Victim Sample Co'));
  perform pg_temp.put('b_company', tests.fixture_company('sweep_b_owner', 'Attacker Sample Co'));
  -- The viewer owns a company of its own, so only the company header puts it in A.
  perform pg_temp.put('v_company', tests.fixture_company('sweep_a_viewer', 'Viewer Own Co'));
end
$ids$;

-- A's books: every kind of row a company holds, written as postgres the way the fixtures write.
-- Every text of A's says "Victim", and A's amounts are distinctive, so check (b) can find them.
-- Dates follow current_date, so date-windowed functions keep finding A's rows.
do $seed$
declare
  a uuid := pg_temp.sid('company');
  owner uuid := pg_temp.sid('a_owner');
  b_owner uuid := pg_temp.sid('b_owner');
  next_month text := to_char(current_date + interval '1 month', 'YYYY-MM');
  d date := current_date - 12;
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

  line := pg_temp.put('line', tests.fixture_line(a, 'Victim expense line', 7654321, 'expense', project, category, d));
  line2 := pg_temp.put('line2', tests.fixture_line(a, 'Victim split line', 6543217, 'expense', project, category, d));
  invoice := pg_temp.put('invoice', tests.fixture_line(a, 'Victim invoice', 8765432, 'income', project,
    income_category, d, 'ILS', 'posted', 'manual', 'project', 'invoice'));
  bank_in := pg_temp.put('bank_in', tests.fixture_line(a, 'Victim bank deposit', 8765432, 'income', null, null,
    d + 2, 'USD', 'posted', 'mercury', 'project', 'receipt'));
  loan_line := pg_temp.put('loan_line', tests.fixture_line(a, 'Victim loan payment', 5432176, 'expense', null, null, d));
  suggested := pg_temp.put('suggested', tests.fixture_line(a, 'Victim suggested line', 4321765, 'expense',
    project, category, d + 4, 'ILS', 'posted', 'sumit', 'project', 'receipt', true));
  update public.transactions set supplier_id = supplier where id in (line, line2, loan_line, suggested);
  update public.transactions set customer_id = customer, external_id = 'victim-inv-1' where id = invoice;
  -- An open invoice and the deposit that pays it, for the link and dismiss functions.
  perform pg_temp.put('invoice_open', tests.fixture_line(a, 'Victim open invoice', 3217654, 'income', project,
    income_category, d, 'USD', 'posted', 'manual', 'project', 'invoice'));
  perform pg_temp.put('bank_in2', tests.fixture_line(a, 'Victim second deposit', 3217654, 'income', null, null,
    d + 3, 'USD', 'posted', 'mercury', 'project', 'receipt'));
  update public.transactions set customer_id = customer, external_id = 'victim-inv-2' where id = pg_temp.sid('invoice_open');
  update public.transactions set customer_id = customer where id in (bank_in, pg_temp.sid('bank_in2'));

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
  insert into public.review_queue (company_id, transaction_id, status) values (a, line2, 'approved')
  returning id into token;
  perform pg_temp.put('review_done', token);

  insert into public.split_rules (company_id, supplier_id, method, label)
  values (a, supplier, 'manual', 'Victim split rule') returning id into rule;
  insert into public.split_rule_targets (company_id, rule_id, project_id, month, share_bp)
  values (a, rule, project, date_trunc('month', current_date)::date, 10000);

  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months,
    start_date, payment_minor, escrow_minor, currency, project_id
  )
  values (a, 'Victim Sample Mortgage', 123456700, 61000, 360, '2026-01-01', 765432, 76543, 'ILS', project)
  returning id into loan;
  update public.loans set rate_index = 'il_prime', rate_margin_ppm = 1000 where id = loan;
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
  -- FLOW-941: two chosen Mercury connections and a transfer between them (out on one, in on the other).
  update public.connector_connections set account_labels = '[{"id": "victim-acct-1"}]', org_label = 'Victim Harbor LLC',
    accounts_chosen_at = now(), sync_account_ids = array['victim-acct-1'] where company_id = a and provider = 'mercury';
  insert into public.connector_connections (company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
    kek_ref, kek_version, envelope_version, account_labels, accounts_chosen_at)
  values (a, 'mercury', 2, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '1', '[{"id": "victim-acct-2"}]', now());
  perform pg_temp.put('xfer_out', tests.fixture_line(a, 'Victim transfer out', 2345671, 'expense', null, null, d + 5, 'USD', 'posted', 'mercury', null, 'expense'));
  perform pg_temp.put('xfer_in', tests.fixture_line(a, 'Victim transfer in', 2345671, 'income', null, null, d + 6, 'USD', 'posted', 'mercury', null, 'invoice_receipt'));
  update public.transactions set provider_meta = jsonb_build_object('account_id', case when id = pg_temp.sid('xfer_out') then 'victim-acct-1' else 'victim-acct-2' end)
  where id in (pg_temp.sid('xfer_out'), pg_temp.sid('xfer_in'));
  insert into public.transfer_matches (company_id, out_transaction_id, in_transaction_id, same, set_by) values (a, pg_temp.sid('xfer_out'), pg_temp.sid('line'), false, owner);
  insert into public.connector_refresh_requests (company_id, provider) values (a, 'mercury');
  -- FLOW-957: a note and a file of A's owner on A's line, and Mercury's note on it.
  insert into public.transaction_notes (company_id, transaction_id, source, author_id, body)
  values (a, pg_temp.sid('line'), 'flow', owner, 'Victim sample note');
  perform pg_temp.put('note', (select n.id from public.transaction_notes n where n.company_id = a and n.source = 'flow'));
  insert into public.transaction_notes (company_id, transaction_id, source, body)
  values (a, pg_temp.sid('line'), 'mercury', 'Victim mercury note');
  insert into public.transaction_files (company_id, transaction_id, note_id, source, storage_path, file_name, mime, bytes, uploaded_by)
  values (a, pg_temp.sid('line'), pg_temp.sid('note'), 'flow', a::text || '/' || pg_temp.sid('line')::text || '/victim.pdf',
    'victim-receipt.pdf', 'application/pdf', 4321, owner);
  perform pg_temp.put('file', (select f.id from public.transaction_files f where f.company_id = a));
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
  insert into public.company_invites (company_id, email, role, invited_by, status, decided_by, decided_at)
  values (a, 'victim-invitee@example.com', 'viewer', owner, 'declined', pg_temp.sid('invitee'), now())
  returning id into token;
  perform pg_temp.put('invite_declined', token);
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
  insert into private.mcp_writes (token_id, user_id, category_id, kind, company_id, transaction_id, prior) -- FLOW-955: and three of Jev's bookings of A's suggested line (the jev name rule) waiting in לאישור, so A's reach calls approve_jev_booking and undo_jev_booking.
  values (token, owner, category, 'category', a, null, null), (token, owner, null, 'line_split', a, suggested, '{"before": [], "written": [], "user_assigned": false, "category_suggested": false}'), (token, owner, null, 'line_split', a, suggested, '{"before": [], "written": [], "user_assigned": false, "category_suggested": false}'), (token, owner, null, 'line_split', a, suggested, '{"before": [], "written": [], "user_assigned": false, "category_suggested": false}');
  -- A rename A's owner can undo, so the reach pass proves mcp_undo's lookup finds a real write.
  insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, company_id)
  values (token, owner, category, 'category_name',
    '{"before": "Victim Old Category", "after": "Victim Sample Category"}'::jsonb, a);
  insert into private.mcp_batches (token_id, user_id, company_id, idempotency_key)
  values (token, owner, a, 'a-batch-key-1') returning id into suggestion;
  perform pg_temp.put('batch', suggestion);
  insert into private.mcp_sync_jobs (token_id, user_id, company_id, state, started_at)
  values (token, owner, a, 'running', now()) returning id into suggestion;
  perform pg_temp.put('job', suggestion);
  insert into private.mcp_idempotency (token_id, idempotency_key, request_hash, response)
  values (token, 'a-key-1', 'hash', '{"victim": true}'::jsonb);
  insert into private.mcp_rate (subject_id, subject_kind, bucket, window_start, hits)
  values (token, 'token', 'write', date_trunc('minute', now()), 1);
  -- A's users' own rows, with no company_id: fingerprinted by user.
  insert into public.notification_prefs (user_id, new_transaction) values (owner, true);
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (owner, 'https://fcm.googleapis.com/fcm/send/victim-example', repeat('v', 87), 'victimAuthExample1');
  insert into private.invite_sends (user_id) values (owner);

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

-- A's owner deletes a loan and a category through the app, so each has a real deletion to restore.
do $gone$
declare
  a uuid := pg_temp.sid('company');
  owner uuid := pg_temp.sid('a_owner');
  gone uuid;
  cat uuid;
begin
  insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months,
    start_date, payment_minor, escrow_minor, currency)
  values (a, 'Victim Gone Mortgage', 3456700, 40000, 120, '2026-03-01', 34567, 0, 'ILS')
  returning id into gone;
  perform pg_temp.put('loan_gone', gone);
  cat := pg_temp.put('category_gone', tests.fixture_category(a, 'Victim Gone Category'));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.delete_loan(gone);
  perform public.delete_category(cat);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$gone$;

-- What the sweep fingerprints, read from the catalog: every table in public and private with a
-- company_id (A's rows), A's companies row, and the tables with no company_id that hold rows of A's
-- users or of their tokens (not B's old token, which names A but is B's). $1 is A's company; $2 is a user whose own rows are left out (the viewer's, in
-- sweep_user_rows tables only), or null.
create temp table sweep_tables (rel text primary key, filter text not null);
insert into sweep_tables
select format('%I.%I', n.nspname, c.relname), 't.company_id = $1'
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where a.attname = 'company_id' and not a.attisdropped
  and c.relkind in ('r', 'p') and n.nspname in ('public', 'private');
insert into sweep_tables values
  ('public.companies', 't.id = $1'),
  ('public.notification_prefs', 't.user_id in (select s.id from pg_temp.sweep_ids s where s.kind in (''a_owner'', ''a_viewer''))'),
  ('public.push_subscriptions', 't.user_id in (select s.id from pg_temp.sweep_ids s where s.kind in (''a_owner'', ''a_viewer''))'),
  ('private.invite_sends', 't.user_id in (select s.id from pg_temp.sweep_ids s where s.kind in (''a_owner'', ''a_viewer''))'),
  ('private.mcp_idempotency', 't.token_id in (select s.id from pg_temp.sweep_ids s where s.kind in (''a_token'', ''viewer_token''))'),
  ('private.mcp_rate', 't.subject_id in (select s.id from pg_temp.sweep_ids s
     where s.kind in (''a_token'', ''viewer_token'', ''a_owner'', ''a_viewer''))');

-- A viewer's own per-user rows, which may carry A's company_id but belong to the user, not to A's
-- books. Only the viewer pass leaves them out, and only the rows whose user_id is the viewer's: a
-- viewer that changes the owner's row in one of these tables still fails.
create temp table sweep_user_rows (rel text primary key, why text not null);
insert into sweep_user_rows values
  ('public.active_companies', 'switch_company records the viewer''s own active company'),
  ('public.recurring_dismissals', 'a viewer hides a recurring alert for itself only'),
  ('public.notification_prefs', 'a viewer sets its own notification preferences'),
  ('public.push_subscriptions', 'a viewer subscribes its own device');

create temp table sweep_sql (name text primary key, q text not null);
insert into sweep_sql
select 'fingerprint', 'select array[' || string_agg(format(
  '(select count(*) || '':'' || md5(coalesce(string_agg(t::text, '','' order by t::text), '''')) from %s t where %s%s)',
  t.rel, t.filter,
  case when u.rel is not null then ' and ($2::uuid is null or t.user_id is distinct from $2)' else '' end),
  ', ' order by t.rel) || ']'
from sweep_tables t left join sweep_user_rows u on u.rel = t.rel;
-- All of one company's rows as text, plus the outbound HTTP queue, to find A's data copied into B.
insert into sweep_sql
select 'company_text', 'select concat_ws('' | '', ' || string_agg(
  format('(select string_agg(t::text, '','') from %s t where %s)', rel, filter), ', ' order by rel)
  || case when to_regclass('net.http_request_queue') is not null
       then ', (select string_agg(concat_ws('' '', q.url, q.headers::text, encode(q.body, ''escape'')), '','')
         from net.http_request_queue q)' else '' end || ')'
from sweep_tables
where filter = 't.company_id = $1';

create or replace function pg_temp.fingerprint(p_company uuid, p_exclude uuid default null)
returns text[]
language plpgsql
as $$
declare
  result text[];
begin
  execute (select q from pg_temp.sweep_sql where name = 'fingerprint') into result using p_company, p_exclude;
  return result;
end;
$$;

create or replace function pg_temp.company_text(p_company uuid)
returns text
language plpgsql
as $$
declare
  result text;
begin
  execute (select q from pg_temp.sweep_sql where name = 'company_text') into result using p_company;
  return result;
end;
$$;

-- One assertion per table below, so the plan reads the catalog too.
select plan(19 + (select count(*)::integer from sweep_tables));

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
    select st.rel, st.filter, a.attname
    from sweep_tables st
    join pg_attribute a on a.attrelid = st.rel::regclass and a.atttypid = 'uuid'::regtype
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format(
      'insert into pg_temp.sweep_a_uuids select distinct t.%I from %s t where %s and t.%I is not null on conflict do nothing',
      t.attname, t.rel, t.filter, t.attname)
    using pg_temp.sid('company');
  end loop;
  insert into pg_temp.sweep_a_uuids values (pg_temp.sid('a_owner')), (pg_temp.sid('a_viewer')) on conflict do nothing;
  delete from pg_temp.sweep_a_uuids
  where id in (select s.id from pg_temp.sweep_ids s where s.kind like 'b\_%' or s.kind = 'v_company');
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
    or p_text ~ '(^|[^0-9a-f-])-?(7654321|6543217|8765432|5432176|4321765|3217654|123456700)([^0-9a-f]|$)';
$$;

-- What a call returned, for the differential check, with only the values that may differ between
-- two runs masked: uuids that are not A's (new ids each run) and times at or after the call began
-- (clock_timestamp() values). now() is the same in both runs and stays. Residual risk: every
-- timestamp in this seed is the transaction's now(), so one of A's that leaked would be equal in
-- both runs; it would still carry A's ids or text to the leak scan. A value drawn from a sequence
-- also differs between runs: that fails the check loudly (a false positive, never a miss).
create or replace function pg_temp.normalized(p_text text, p_since timestamptz)
returns text
language plpgsql
stable
as $$
declare
  out text := coalesce(p_text, '');
  m text;
begin
  for m in select distinct x[1] from regexp_matches(out, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') x loop
    if not exists (select 1 from pg_temp.sweep_a_uuids u where u.id = m::uuid) then
      out := replace(out, m, 'U');
    end if;
  end loop;
  for m in select distinct x[1] from regexp_matches(out,
      '(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?|Z)?)', 'g') x loop
    begin
      if m::timestamptz >= p_since then
        out := replace(out, m, 'T');
      end if;
    exception
      when others then
        null;
    end;
  end loop;
  return out;
end;
$$;

-- The failures in what a call raised or returned: the error, a {ok:false} envelope's code and
-- message, and each {ok:false} item of a batch's results. Empty for a clean success.
create or replace function pg_temp.failures(p_result text, p_err text)
returns text[]
language plpgsql
immutable
as $$
declare
  j jsonb;
  out text[] := '{}';
begin
  if p_err is not null then
    return array[p_err];
  end if;
  begin
    j := p_result::jsonb;
  exception
    when others then
      return out;
  end;
  if jsonb_typeof(j) <> 'object' then
    return out;
  end if;
  if j->>'ok' = 'false' then
    out := out || ('envelope ' || coalesce(j->'error'->>'code', '?') || ' ' || coalesce(j->'error'->>'message', ''));
  end if;
  if jsonb_typeof(j->'data'->'results') = 'array' then
    select out || coalesce(array_agg('item ' || coalesce(e->>'code', e->'error'->>'code', '?')), '{}')
    into out
    from jsonb_array_elements(j->'data'->'results') e
    where e->>'ok' = 'false';
  end if;
  return out;
end;
$$;

-- A failure that is the function's company check refusing: SQLSTATE 42501 or P0002, a raised
-- message that is only "<thing> not found", "forbidden" or "no company", or an envelope or batch
-- item whose code is refused, not_found or forbidden.
create or replace function pg_temp.is_refusal(p_failure text)
returns boolean
language sql
immutable
as $$
  select p_failure ~ '^(42501|P0002) '
    or p_failure ~ '^P0001 ([a-z]+ )*(not found|forbidden|no company)$'
    or p_failure ~ '^(envelope|item) (refused|not_found|forbidden)( |$)';
$$;

-- An A id for a hint (an argument name, a function name or an undo kind), or null. A function that
-- needs a particular line gets the one with data behind it (a loan payment, a split, an invoice).
create or replace function pg_temp.hint_id(p_hint text, p_fn text default '')
returns uuid
language sql
stable
as $$
  select pg_temp.sid(case
    when p_hint ~ '(^|_)note(_|$)' then 'note'
    when p_hint ~ '(^|_)file_(id|remove)$' then 'file'
    when p_hint ~ 'transaction' and p_fn ~ 'loan' then 'loan_line'
    when p_hint ~ '^id$' and p_fn ~ '_transaction' then 'line'
    when p_hint ~ '^id$' and p_fn ~ 'party_charges' then 'line'
    when p_hint ~ 'transaction|^id$' and p_fn ~ 'invoice_paid' then 'invoice'
    when p_hint ~ 'transaction' and p_fn ~ 'invoice' then 'bank_in2'
    when p_hint ~ 'invoice' and p_fn ~ 'link|dismiss' then 'invoice_open'
    when p_hint ~ 'transaction|^id$' and p_fn ~ 'split' and p_fn !~ 'assign|review' then 'line2'
    when p_hint ~ 'transaction' and p_fn ~ 'jev' then 'suggested'
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
    when p_hint ~ 'review' then 'review'
    when p_hint ~ 'anomal' then 'suggested'
    when p_hint ~ 'reassign' then 'reassign'
    when p_hint ~ 'parent' then 'category2'
    when p_hint ~ 'categor|into' then 'category'
    when p_hint ~ 'project_forecast|forecast_edit' then 'edit'
    when p_hint ~ 'project' then 'project'
    when p_hint ~ 'company|cash_basis|jev_mode|index_rate|currency|forecast' then 'company'
    when p_hint ~ 'transaction|line|payment|split|document|manual|from' then 'line'
  end);
$$;

-- Arguments the name rules below can't guess, chosen so A has data behind each. Each row is one
-- call; a function with no row is called once. mcp_undo is called once per undo kind (read from
-- mcp_writes' check), with the A id that kind names, and once per write B left in A.
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
insert into sweep_variants (fn, args)
select 'mcp_undo', jsonb_build_object('p_kind', quote_literal(w.kind), 'p_id', quote_literal(x.id) || '::uuid')
from private.mcp_writes w
cross join lateral (values (w.id), (coalesce(w.project_id, w.category_id, w.loan_id, w.transaction_id))) x(id)
where w.user_id = pg_temp.sid('b_owner') and w.company_id = pg_temp.sid('company') and x.id is not null;

create or replace function pg_temp.lit(p_value anyelement)
returns text
language sql
immutable
as $$ select quote_literal(p_value) || '::' || pg_typeof(p_value)::text; $$;

do $variants$
declare
  ids jsonb := (select jsonb_object_agg(kind, id) from pg_temp.sweep_ids);
  sug date := (select t.doc_date from public.transactions t where t.id = pg_temp.sid('suggested'));
begin
  insert into pg_temp.sweep_variants (fn, args) values
    ('move_category_lines', jsonb_build_object('p_from', pg_temp.lit(pg_temp.sid('category2')))),
    ('merge_category', jsonb_build_object('p_from', pg_temp.lit(pg_temp.sid('category2')))),
    ('restore_loan', jsonb_build_object('p_loan_id', pg_temp.lit(pg_temp.sid('loan_gone')))),
    ('restore_category', jsonb_build_object('p_category_id', pg_temp.lit(pg_temp.sid('category_gone')))),
    ('reopen_review', jsonb_build_object('p_id', pg_temp.lit(pg_temp.sid('review_done')))),
    ('reopen_invite', jsonb_build_object('p_invite_id', pg_temp.lit(pg_temp.sid('invite_declined')))),
    ('mcp_move_category_lines', jsonb_build_object('p_from', pg_temp.lit(pg_temp.sid('category2')))),
    ('mcp_set_bank_accounts', jsonb_build_object('p_account_ids', pg_temp.lit(array['victim-acct-1']::text[]), 'p_from', 'null::text')),
    ('answer_transfer_match', jsonb_build_object('p_out_transaction_id', pg_temp.lit(pg_temp.sid('xfer_out')), 'p_in_transaction_id', pg_temp.lit(pg_temp.sid('xfer_in')))),
    ('mcp_answer_transfer_match', jsonb_build_object('p_out_transaction_id', pg_temp.lit(pg_temp.sid('xfer_out')), 'p_in_transaction_id', pg_temp.lit(pg_temp.sid('xfer_in')))),
    ('delete_company', jsonb_build_object('p_confirm', pg_temp.lit('Victim Sample Co'::text))),
    ('set_cash_basis', jsonb_build_object('p_basis', pg_temp.lit('paid'::text))),
    ('mcp_set_cash_basis', jsonb_build_object('p_basis', pg_temp.lit('paid'::text))),
    ('dismiss_recurring_alert', jsonb_build_object('p_kind', pg_temp.lit('missing'::text))),
    ('undismiss_recurring_alert', jsonb_build_object('p_kind', pg_temp.lit('missing'::text))),
    ('dismiss_recurring_alert', jsonb_build_object('p_kind', pg_temp.lit('change'::text),
      'p_key', pg_temp.lit((ids->>'line')::text))),
    ('mcp_add_loan', jsonb_build_object('p_kind', pg_temp.lit('amortizing'::text))),
    ('mcp_undo_batch', jsonb_build_object('p_batch_key', pg_temp.lit(ids->>'batch'))),
    ('mcp_create_categories', jsonb_build_object('p_items', pg_temp.lit('[{"name": "Sweep Name", "kind": "expense"}]'::jsonb))),
    ('mcp_create_projects', jsonb_build_object('p_items', pg_temp.lit('[{"name": "Sweep Name"}]'::jsonb))),
    ('mcp_set_lines_cash', jsonb_build_object('p_items', pg_temp.lit(jsonb_build_array(
      jsonb_build_object('transaction_id', ids->'line', 'in_cash', false))))),
    ('mcp_set_lines_pnl', jsonb_build_object('p_items', pg_temp.lit(jsonb_build_array(
      jsonb_build_object('transaction_id', ids->'line', 'in_pnl', false))))),
    -- A's suggested line is a posted, non-manual expense: its amount, date and payee match it.
    ('receipt_match', jsonb_build_object('p_amount_minor', pg_temp.lit(4321765::bigint),
      'p_doc_date', pg_temp.lit(sug), 'p_payee', pg_temp.lit('Victim suggested line'::text))),
    ('match_lines', jsonb_build_object('p_rows', pg_temp.lit(jsonb_build_array(
      jsonb_build_object('date', sug, 'amount_minor', -4321765, 'ref', 'Victim suggested line'),
      jsonb_build_object('date', current_date - 12, 'amount_minor', -7654321)))));
end
$variants$;

-- FLOW-948/950: mcp_book_line gets a balanced set of legs on the victim's own bank and category accounts, so B's call is a real cross-company refusal (not an argument-shape error) and A's owner's reach call is a legitimate booking; once on A's line (p_transaction_id by the name rules, the line's own date, currency and description) and once as a new line.
insert into pg_temp.sweep_variants (fn, args) select 'mcp_book_line', b.args || v.extra from (values (jsonb_build_object('p_doc_date', 'null::date', 'p_currency', 'null::text', 'p_description', 'null::text')), (jsonb_build_object('p_transaction_id', 'null::uuid'))) v(extra), (select jsonb_build_object('p_direction', pg_temp.lit('expense'::text), 'p_doc_date', pg_temp.lit(current_date), 'p_currency', pg_temp.lit('USD'::text), 'p_description', pg_temp.lit('Sweep booking'::text), 'p_legs', pg_temp.lit(jsonb_build_array(jsonb_build_object('account_id', (select id from public.accounts where company_id = pg_temp.sid('company') and category_id is null and name = 'Bank/Clearing'), 'amount_minor', -1000), jsonb_build_object('account_id', (select id from public.accounts where company_id = pg_temp.sid('company') and category_id is not null and type = 'expense' and not excluded_from_pnl order by name limit 1), 'amount_minor', 1000)))) as args) b;

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
      pg_temp.hint_id(n, p_fn),
      case when n = 'id' then pg_temp.hint_id(p_fn, p_fn) end,
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
      when n = 'month' then next_month::text
      else current_date::text
    end;
  elsif t in ('integer', 'smallint') then
    v := case n
      when 'year' then extract(year from current_date)::text when 'months' then '12' when 'limit' then '50'
      when 'offset' then '0' when 'day' then '10' when 'window_days' then '30' when 'term_months' then '360'
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
    v := case
      when n = 'patch' and p_fn ~ 'forecast' then '{"amount_minor": 100}'
      when n = 'patch' and p_fn ~ 'investment' then '{"purchase_minor": 100}'
      when n = 'patch' then '{"name": "Sweep Name"}'
      when n = 'items' then jsonb_build_array(jsonb_build_object(
        'transaction_id', ids->'line', 'project_id', ids->'project', 'category_id', ids->'category'))::text
      when n = 'shares' then jsonb_build_array(
        jsonb_build_object('project_id', ids->'project', 'share', 50),
        jsonb_build_object('project_id', ids->'project2', 'share', 50))::text
      when n = 'parts' and p_fn ~ 'loan' then jsonb_build_array(
        jsonb_build_object('part', 'interest', 'amount_minor', 5432176))::text
      when n = 'parts' then jsonb_build_array(
        jsonb_build_object('category_id', ids->'category', 'project_id', ids->'project', 'amount_minor', 4000000),
        jsonb_build_object('category_id', ids->'category2', 'project_id', ids->'project2', 'rest', true))::text
      when n = 'edit' then jsonb_build_object(
        'kind', 'add', 'category_id', ids->'category', 'direction', 'expense', 'amount_minor', 100,
        'pace', 'month')::text
      when n = 'document' then jsonb_build_object(
        'name', 'sweep.pdf', 'mime', 'application/pdf', 'sha256', repeat('a', 64), 'bytes', 100)::text
      when n = 'undo' then jsonb_build_object('project_id', ids->'project', 'edits', '[]'::jsonb)::text
      else '{}'
    end;
  elsif t = 'text' then
    v := case
      -- A's own keys, sent with B's tokens: they are stored per token, so they must not replay.
      when n = 'idempotency_key' then 'a-key-1'
      when n = 'batch_key' then ids->>'batch'
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

-- One call. It runs as p_user with p_header as the x-flow-company header and, for a flow-mcp
-- function, p_token's claims, and always rolls back. Before the rollback it reads A's fingerprint
-- (less p_exclude's own rows) and, in B's passes, B's rows. In B's passes the same call runs again
-- with A's company deleted, also rolled back: a result that depends on A's data (a sum, a count, a
-- converted amount) differs. Everything is recorded in sweep_calls.
create temp table sweep_calls (
  pass text, fn text, sig text, call text, outcome text, err text, result text,
  leaked_ids uuid[], leaked_text boolean, changed text[], copied_ids uuid[], copied_text boolean,
  failures text[], differs boolean, ms numeric
);

create or replace function pg_temp.act_as(p_user uuid, p_header uuid, p_token uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', p_token)::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.headers', jsonb_build_object('x-flow-company', p_header)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.sweep_call(
  p_pass text, p_user uuid, p_header uuid, p_token uuid, p_fn text, p_sig text, p_call text,
  p_exclude uuid, p_base text[], p_b boolean
)
returns void
language plpgsql
as $$
declare
  token uuid := case when p_fn like 'mcp\_%' then p_token end;
  -- The reach pass sends its own idempotency key: a-key-1 is stored for A's token already.
  run text := case when p_pass = 'reach' then replace(p_call, '''a-key-1''::text', '''reach-key-1''::text') else p_call end;
  res text;
  err text;
  res2 text;
  err2 text;
  fp text[];
  copied text;
  seen text;
  echo text;
  leaked uuid[];
  changed text[];
  started timestamptz := clock_timestamp();
begin
  begin
    perform pg_temp.act_as(p_user, p_header, token);
    execute run into res;
    perform set_config('role', 'postgres', true);
    fp := pg_temp.fingerprint(pg_temp.sid('company'), p_exclude);
    if p_b then
      copied := pg_temp.company_text(pg_temp.sid('b_company'));
    end if;
    raise exception 'sweep rollback' using errcode = 'SWP01';
  exception
    when sqlstate 'SWP01' then
      null;
    when others then
      err := sqlstate || ' ' || sqlerrm;
  end;
  if p_b then
    begin
      delete from public.companies where id = pg_temp.sid('company');
      perform pg_temp.act_as(p_user, p_header, token);
      execute run into res2;
      raise exception 'sweep rollback' using errcode = 'SWP01';
    exception
      when sqlstate 'SWP01' then
        null;
      when others then
        err2 := sqlstate || ' ' || sqlerrm;
    end;
  end if;
  if fp is not null then
    select array_agg((select rels[i] from pg_temp.sweep_baseline) order by i) into changed
    from generate_subscripts(p_base, 1) i
    where p_base[i] is distinct from fp[i];
  end if;
  seen := concat_ws(' ', res, err);
  leaked := (select array_agg(u.id order by u.id) from pg_temp.sweep_a_uuids u where strpos(seen, u.id::text) > 0);
  -- An echo-allowlisted function may give back the argument values it was given: each text
  -- argument, and each string or number inside a jsonb argument, is cut from what it returned.
  if p_fn in (select e.fn from pg_temp.sweep_echo e) then
    for echo in
      select replace(m[1], '''''', '''') from regexp_matches(p_call, '''((?:[^'']|'''')*)''::text', 'g') m
      union
      select v #>> '{}'
      from regexp_matches(p_call, '''((?:[^'']|'''')*)''::jsonb', 'g') m,
        jsonb_path_query(replace(m[1], '''''', '''')::jsonb, 'strict $.**') v
      where jsonb_typeof(v) in ('string', 'number')
    loop
      if length(echo) >= 4 then
        seen := replace(seen, echo, '');
      end if;
    end loop;
  end if;
  insert into pg_temp.sweep_calls
  select p_pass, p_fn, p_sig, p_call, case when err is null then 'ok' else 'error' end, err, res,
    leaked,
    pg_temp.has_a_text(seen),
    changed,
    (select array_agg(u.id order by u.id) from pg_temp.sweep_a_uuids u where strpos(copied, u.id::text) > 0),
    coalesce(pg_temp.has_a_text(copied), false),
    pg_temp.failures(res, err),
    p_b and pg_temp.normalized(concat_ws(' | ', res, err), started)
      <> pg_temp.normalized(concat_ws(' | ', res2, err2), started),
    round(extract(epoch from clock_timestamp() - started) * 1000, 1);
end;
$$;

-- Every function in public that authenticated can execute, definer and invoker, read from the
-- catalog, less the ones skipped below. Only public: PostgREST serves the schemas in config.toml's
-- api.schemas (public and graphql_public), so a client can't call a function in private or tests
-- even where a grant exists.
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

create or replace function pg_temp.sweep(
  p_pass text, p_user uuid, p_header uuid, p_token uuid, p_exclude uuid, p_b boolean
)
returns void
language plpgsql
as $$
declare
  base text[] := pg_temp.fingerprint(pg_temp.sid('company'), p_exclude);
  f record;
  v record;
  args text;
begin
  for f in select * from pg_temp.sweep_targets t order by t.sig loop
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
      if p_pass = 'reach' and f.fn in (select r.fn from pg_temp.sweep_reach_as r) then
        perform pg_temp.sweep_call(p_pass, pg_temp.sid('invitee'), null, null, f.fn, f.sig, format(f.tmpl, args),
          p_exclude, base, p_b);
      else
        perform pg_temp.sweep_call(p_pass, p_user, p_header, p_token, f.fn, f.sig, format(f.tmpl, args),
          p_exclude, base, p_b);
      end if;
    end loop;
  end loop;
end;
$$;

-- (c) The allowlists. Keep them minimal: each entry says why, and a stale or missing one fails.
-- sweep_skip: functions that can't be called generically. None today.
--
-- sweep_echo: functions that may give back what the caller gave them (A ids, or for match_lines the
-- rows it was asked to match), and nothing else of A's.
create temp table sweep_echo (fn text primary key, why text not null);
insert into sweep_echo (fn, why) values
  ('dismiss_recurring_alert', 'returns the alert key it was given, which embeds the id; the dismissal is the caller''s own row in its own company'),
  ('undismiss_recurring_alert', 'returns the alert key it was given, which embeds the id'),
  ('expected_months', 'echoes p_project_id beside an empty schedule'),
  ('match_lines', 'echoes each bank row it was given beside its candidates, which come from the caller''s company'),
  ('mcp_assign_expenses', 'per-item envelope names the item''s transaction_id with "refused"'),
  ('mcp_set_lines_cash', 'per-item envelope names the item''s transaction_id with "refused"'),
  ('mcp_set_lines_pnl', 'per-item envelope names the item''s transaction_id with "refused"');

-- sweep_fail_ok: failures in B's passes, by function and message, that are not worded as a company
-- refusal, and why each is one anyway (or why the function takes nothing of A's).
create temp table sweep_fail_ok (fn text, pattern text, why text not null, primary key (fn, pattern));
insert into sweep_fail_ok (fn, pattern, why) values
  ('delete_transaction', '^P0001 only a manual entry can be deleted$', 'its not-found: the delete matches id, company and source together'),
  ('reorder_loans', '^P0001 validation$', 'the ids must be exactly the caller''s loans, and A''s are not'),
  ('mcp_reorder_loans', '^envelope validation ', 'the ids must be exactly the caller''s loans, and A''s are not'),
  ('apply_starter_categories', '^55000 starter_locked$', 'takes no id; B''s own company already has lines'),
  ('set_import_from', '^P0001 connector is not connected$', 'takes no id; B''s own company has no connector'),
  ('set_mercury_accounts', '^P0001 connector is not connected$', 'takes only a slot of the caller''s own company; B''s has no Mercury connection');

-- The reach pass makes every call again as A's owner (A's token for flow-mcp), so a refusal in B's
-- passes proves the company check ran: A's owner must not be refused the same way. The invite
-- functions key on the caller's email, so A's invitee makes them instead.
create temp table sweep_reach_as (fn text primary key, why text not null);
insert into sweep_reach_as (fn, why) values
  ('accept_invite', 'acts on an invite to the caller''s email'),
  ('decline_invite', 'acts on an invite to the caller''s email'),
  ('mark_invite_seen', 'acts on an invite to the caller''s email'),
  ('reopen_invite', 'reopens an invite the caller declined');

-- Refusals A's owner meets too, by function and message, and why each still proves nothing leaks.
-- An entry never covers a call matching unless_call: there, A's owner must not be refused.
create temp table sweep_reach_ok (
  fn text, pattern text, unless_call text, why text not null, primary key (fn, pattern)
);
insert into sweep_reach_ok (fn, pattern, unless_call, why) values
  ('mcp_undo', '^envelope not_found ',
    format('''category_name'', %L::uuid', pg_temp.sid('category')),
    'it finds only the caller''s own writes: A''s owner has one (a category rename, which must undo) but none of most kinds and none of B''s; B''s writes in A are checked by the write and copy scans'),
  ('apply_starter_categories', '^55000 starter_locked$', null, 'takes no id; every company in the seed has lines');

-- Positive controls: each detector fires on a case built to trip it.
select pg_temp.sweep_call('control', pg_temp.sid('a_owner'), pg_temp.sid('company'), null, 'get_project', 'read',
  format('select public.get_project(%L::uuid)::text', pg_temp.sid('project')), null, null, false);
select pg_temp.sweep_call('control', pg_temp.sid('a_owner'), pg_temp.sid('company'), null, 'rename_category', 'write',
  format('select public.rename_category(%L::uuid, %L)::text', pg_temp.sid('category'), 'Sweep Name'),
  null, (select fp from sweep_baseline), false);
select pg_temp.sweep_call('control', pg_temp.sid('b_owner'), pg_temp.sid('b_company'), null, 'upsert_project', 'copy',
  'select public.upsert_project(null::uuid, ''Victim copy'', null::bigint, null::text, null::text)::text',
  null, (select fp from sweep_baseline), true);
select pg_temp.sweep_call('control', pg_temp.sid('b_owner'), pg_temp.sid('b_company'), null, 'cast', 'error',
  'select (''Victim Sample Project'')::integer::text', null, null, false);
select pg_temp.sweep_call('control', pg_temp.sid('a_viewer'), pg_temp.sid('company'), null, 'get_home', 'header_a',
  'select public.get_home()::text', null, null, false);
select pg_temp.sweep_call('control', pg_temp.sid('a_viewer'), pg_temp.sid('v_company'), null, 'get_home', 'header_v',
  'select public.get_home()::text', null, null, false);
select pg_temp.sweep_call('control', pg_temp.sid('a_owner'), pg_temp.sid('company'), null, 'get_home', 'differs',
  'select public.get_home()::text', null, (select fp from sweep_baseline), true);

create or replace function pg_temp.control(p_sig text)
returns pg_temp.sweep_calls
language sql
as $$ select * from pg_temp.sweep_calls where pass = 'control' and sig = p_sig; $$;

select ok((pg_temp.control('read')).leaked_text and cardinality((pg_temp.control('read')).leaked_ids) > 0,
  'control: A''s owner reading A''s project trips the leak scan (text and ids)');
select ok('public.categories' = any ((pg_temp.control('write')).changed),
  'control: A''s owner renaming A''s category trips the write scan');
select ok((pg_temp.control('copy')).copied_text,
  'control: A''s name written into B''s rows trips the copy scan');
select ok((pg_temp.control('error')).leaked_text
    and not pg_temp.is_refusal((pg_temp.control('error')).failures[1]),
  'control: A''s text in an error message trips the leak scan, and the error is not a refusal');
select ok((pg_temp.control('header_a')).leaked_text and not (pg_temp.control('header_v')).leaked_text,
  'control: the x-flow-company header picks the company (A''s name only with A''s id)');
select ok((pg_temp.control('differs')).differs,
  'control: a result built from A''s rows changes when A is deleted');
select ok(
  not pg_temp.is_refusal((pg_temp.failures('{"ok": false, "error": {"code": "validation"}}', null))[1])
  and not pg_temp.is_refusal((pg_temp.failures('{"ok": true, "data": {"results": [{"ok": false, "code": "validation"}]}}', null))[1])
  and pg_temp.is_refusal((pg_temp.failures('{"ok": false, "error": {"code": "not_found"}}', null))[1])
  and pg_temp.is_refusal((pg_temp.failures('{"ok": true, "data": {"results": [{"ok": false, "code": "refused"}]}}', null))[1])
  and cardinality(pg_temp.failures('{"ok": true, "data": {"results": [{"ok": true}]}}', null)) = 0,
  'control: envelopes and batch items are parsed, and only company refusals count as refusals'
);

-- The sweep. b: B's owner, B active. b_hint: B's owner sending A's id as the company header, which
-- a client controls. b_stale: B's owner with its old token for A as the flow-mcp claim. viewer: A's
-- viewer, A active by the header, with a write-scope token for A; its own per-user rows are left out.
select pg_temp.sweep('b', pg_temp.sid('b_owner'), pg_temp.sid('b_company'), pg_temp.sid('b_token'), null, true);
select pg_temp.sweep('b_hint', pg_temp.sid('b_owner'), pg_temp.sid('company'), pg_temp.sid('b_token'), null, true);
select pg_temp.sweep('b_stale', pg_temp.sid('b_owner'), pg_temp.sid('b_company'),
  (select c.id from private.mcp_credentials c where c.token_hash = 'hash-sweep-b-stale'), null, true);
select pg_temp.sweep('viewer', pg_temp.sid('a_viewer'), pg_temp.sid('company'), pg_temp.sid('viewer_token'),
  pg_temp.sid('a_viewer'), false);
select pg_temp.sweep('reach', pg_temp.sid('a_owner'), pg_temp.sid('company'), pg_temp.sid('a_token'), null, false);

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
  (select coalesce(array_agg(b.rels[i] order by b.rels[i]), '{}')
   from sweep_baseline b, generate_subscripts(b.fp, 1) i
   where b.fp[i] like '0:%' and b.rels[i] <> 'public.company_viewers'),
  '{}'::text[],
  'A''s seed has rows in every table the sweep fingerprints (company_viewers is for demo companies only)'
);

-- (d) Coverage: every function in the catalog is called in every pass, except the skipped ones.
select is(
  (select count(distinct sig)::integer from sweep_calls where pass = p),
  (select count(*)::integer from pg_proc pr
   where pr.pronamespace = 'public'::regnamespace and pr.prokind = 'f'
     and has_function_privilege('authenticated', pr.oid, 'execute'))
  - (select count(*)::integer from sweep_skip),
  format('pass %s calls every function in public that authenticated can execute, less the %s skipped',
    p, (select count(*) from sweep_skip))
)
from unnest(array['b', 'b_hint', 'b_stale', 'viewer']) p;

-- Every failure in B's passes is the function refusing another company's ids. A validation error,
-- a wrong-shape argument or a call the sweep built wrong never reached the company check.
select is(
  (select coalesce(array_agg(distinct c.fn || ': ' || left(f, 70) order by c.fn || ': ' || left(f, 70)), '{}')
   from sweep_calls c, unnest(c.failures) f
   where c.pass in ('b', 'b_hint', 'b_stale') and not pg_temp.is_refusal(f)
     and not exists (select 1 from sweep_fail_ok o where o.fn = c.fn and f ~ o.pattern)),
  '{}'::text[],
  'every failure in B''s passes is a company refusal'
);

-- Every refusal in B's passes is one A's owner (or invitee) does not meet with the same call: the
-- company check, not a missing row or a bad argument, is what refused B.
select is(
  (select coalesce(array_agg(distinct c.fn || ': ' || left(array_to_string(c.failures, ';'), 60)
     order by c.fn || ': ' || left(array_to_string(c.failures, ';'), 60)), '{}')
   from sweep_calls c
   join sweep_calls o on o.pass = 'reach' and o.sig = c.sig and o.call = c.call
   where c.pass in ('b', 'b_hint', 'b_stale') and cardinality(c.failures) > 0
     and pg_temp.normalized(array_to_string(o.failures, ';'), 'infinity')
       = pg_temp.normalized(array_to_string(c.failures, ';'), 'infinity')
     and not exists (select 1 from sweep_reach_ok r
       where r.fn = c.fn and array_to_string(c.failures, ';') ~ r.pattern
         and (r.unless_call is null or strpos(c.call, r.unless_call) = 0))),
  '{}'::text[],
  'A''s owner is not refused the same way for any call B''s passes were refused'
);

-- (a) No call changed any of A's tables: one assertion per table, naming the functions that did.
select is(
  (select coalesce(array_agg(distinct c.pass || ':' || c.fn order by c.pass || ':' || c.fn), '{}')
   from sweep_calls c
   where c.pass in ('b', 'b_hint', 'b_stale', 'viewer') and t.rel = any (c.changed)),
  '{}'::text[],
  format('no call by B or by A''s viewer changed A''s rows in %s', t.rel)
)
from sweep_tables t
order by t.rel;

select is(
  pg_temp.fingerprint(pg_temp.sid('company')),
  (select fp from sweep_baseline),
  'A''s tables are unchanged after the sweep'
);

-- (b) Nothing B called returned or raised A's ids, text or figures, or wrote them into B's rows; an
-- echo-allowlisted function may give back only what it was given.
select is(
  (select coalesce(array_agg(distinct c.pass || ':' || c.fn order by c.pass || ':' || c.fn), '{}')
   from sweep_calls c
   where c.pass in ('b', 'b_hint', 'b_stale')
     and (c.leaked_text or c.copied_text
       or exists (select 1 from unnest(c.leaked_ids || c.copied_ids) u where strpos(c.call, u::text) = 0)
       or (cardinality(c.leaked_ids || c.copied_ids) > 0 and c.fn not in (select fn from sweep_echo)))),
  '{}'::text[],
  'no function returned A''s data to B, raised it in an error, or copied it into B''s rows'
);

-- Nothing B called gave a different answer with A's company deleted: no sum, count or amount B
-- gets back is built from A's rows.
select is(
  (select coalesce(array_agg(distinct c.pass || ':' || c.fn order by c.pass || ':' || c.fn), '{}')
   from sweep_calls c where c.pass in ('b', 'b_hint', 'b_stale') and c.differs),
  '{}'::text[],
  'no result B gets depends on A''s rows'
);

-- (c) Every allowlist entry names something that exists, and still needs its entry.
select is(
  (select coalesce(array_agg(x order by x), '{}') from (
     select 'skip:' || s.sig as x from sweep_skip s
     where not exists (select 1 from pg_proc pr where pr.pronamespace = 'public'::regnamespace
       and pr.oid::regprocedure::text = s.sig)
     union all
     select 'echo:' || e.fn from sweep_echo e where not exists (select 1 from sweep_targets t where t.fn = e.fn)
     union all
     select 'fail:' || f.fn from sweep_fail_ok f where not exists (select 1 from sweep_targets t where t.fn = f.fn)
     union all
     select 'reach:' || r.fn from (select fn from sweep_reach_ok union select fn from sweep_reach_as) r
     where not exists (select 1 from sweep_targets t where t.fn = r.fn)
     union all
     select 'user_rows:' || u.rel from sweep_user_rows u
     where not exists (select 1 from sweep_tables t where t.rel = u.rel)
       or not exists (select 1 from pg_attribute a where a.attrelid = u.rel::regclass and a.attname = 'user_id')) missing),
  '{}'::text[],
  'every allowlisted or skipped function, and every per-user table, exists'
);
select is(
  (select coalesce(array_agg(x order by x), '{}') from (
     select 'echo:' || e.fn as x from sweep_echo e
     where not exists (select 1 from sweep_calls c
       where c.pass in ('b', 'b_hint', 'b_stale') and c.fn = e.fn
         and (cardinality(c.leaked_ids || c.copied_ids) > 0 or pg_temp.has_a_text(c.result)))
     union all
     select 'fail:' || f.fn from sweep_fail_ok f
     where not exists (select 1 from sweep_calls c, unnest(c.failures) x
       where c.pass in ('b', 'b_hint', 'b_stale') and c.fn = f.fn and x ~ f.pattern)
     union all
     select 'reach:' || r.fn from sweep_reach_ok r
     where not exists (select 1 from sweep_calls c
       join sweep_calls o on o.pass = 'reach' and o.sig = c.sig and o.call = c.call
       where c.pass in ('b', 'b_hint', 'b_stale') and c.fn = r.fn
         and array_to_string(o.failures, ';') ~ r.pattern)) stale),
  '{}'::text[],
  'every allowlist entry is still needed'
);

select * from finish();
rollback;
