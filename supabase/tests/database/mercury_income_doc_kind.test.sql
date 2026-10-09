-- 20261007010000_mercury_income_doc_kind: private.relabel_mercury_income() (decision 0097).
-- Synthetic data only.

begin;

select plan(26);

select tests.create_supabase_user('mi_a', 'mi-a@example.com');
select tests.create_supabase_user('mi_b', 'mi-b@example.com');

create temp table mi_ref (label text primary key, id uuid);
grant all on mi_ref to authenticated, service_role;

select tests.authenticate_as('mi_a');
select public.create_company('Sample Harbor Co', true);
select public.upsert_project(null, 'Sample Quay', null, 'active');
insert into mi_ref select 'a', id from public.companies where name = 'Sample Harbor Co';
insert into mi_ref select 'proj', id from public.projects where name = 'Sample Quay';
select tests.authenticate_as('mi_b');
select public.create_company('Sample Jetty Co', true);
insert into mi_ref select 'b', id from public.companies where name = 'Sample Jetty Co';
reset role;

create function pg_temp.mline(ext text, dir text, kind text, status text, amt bigint, descr text, mkind text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('source', 'mercury', 'external_id', ext, 'direction', dir, 'line_status', status, 'doc_kind', kind,
    'currency', 'USD', 'amount_original', amt, 'amount_negated', dir = 'expense' and kind = 'expense',
    'doc_date', '2026-09-10', 'cash_date', '2026-09-10', 'description', descr,
    'vat', jsonb_build_object('amount', 0, 'status', 'source'), 'provider_meta', jsonb_build_object('kind', mkind))
$$;

-- A Mercury sync. inc_kind 'receipt' is the code before 0097, 'invoice_receipt' the code after.
create function pg_temp.sync(co text, inc_kind text) returns void language plpgsql as $$
declare lines jsonb;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if co = 'a' then
    lines := jsonb_build_array(
      pg_temp.mline('mi-skip', 'income', inc_kind, 'posted', 120000, 'Sample deposit one', 'incomingDomesticWire'),
      pg_temp.mline('mi-appr', 'income', inc_kind, 'posted', 230000, 'Sample deposit two', 'incomingDomesticWire'),
      pg_temp.mline('mi-pend', 'income', inc_kind, 'pending', 34000, 'Sample deposit pending', 'incomingDomesticWire'),
      pg_temp.mline('mi-open', 'income', inc_kind, 'posted', 45000, 'Sample deposit open', 'checkDeposit'),
      pg_temp.mline('mi-exp', 'expense', 'expense', 'posted', 5600, 'Sample card spend', 'debitCardTransaction'),
      pg_temp.mline('mi-cred', 'expense', 'credit', 'posted', 700, 'Sample card refund', 'creditCardCredit'));
  else
    lines := jsonb_build_array(
      pg_temp.mline('mi-b-skip', 'income', inc_kind, 'posted', 99000, 'Sample other deposit', 'incomingDomesticWire'),
      -- The provider changes this line's amount after the skip, so its skip fingerprint is stale.
      pg_temp.mline('mi-b-stale', 'income', inc_kind, 'posted', case when inc_kind = 'receipt' then 88000 else 88500 end,
        'Sample stale deposit', 'incomingDomesticWire'));
  end if;
  perform public.upsert_connector_lines((select id from mi_ref where label = co), 'mercury',
    jsonb_build_object('lines', lines, 'removed_ids', '[]'::jsonb, 'complete', false), null, null);
  perform set_config('request.jwt.claims', null, true);
  perform set_config('request.jwt.claim.role', null, true);
end $$;

create function pg_temp.q(ext text) returns text language sql stable as $$
  select string_agg(q.status::text, ',' order by q.created_at, q.id)
  from public.review_queue q join public.transactions t on t.id = q.transaction_id where t.external_id = ext
$$;
create function pg_temp.kind(ext text) returns text language sql stable as $$
  select t.doc_kind::text from public.transactions t where coalesce(t.external_id, t.idempotency_key) = ext
$$;
create function pg_temp.open_id(ext text) returns uuid language sql stable as $$
  select q.id from public.review_queue q join public.transactions t on t.id = q.transaction_id
  where t.external_id = ext and q.status = 'open'
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- Before 0097: Mercury income stored as receipt, plus a SUMIT receipt and a manual receipt.
select pg_temp.sync('a', 'receipt');
select pg_temp.sync('b', 'receipt');
do $$ begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.upsert_connector_lines((select id from mi_ref where label = 'a'), 'sumit', jsonb_build_object('lines', jsonb_build_array(
    jsonb_build_object('source', 'sumit', 'external_id', '9001', 'direction', 'income', 'line_status', 'posted', 'doc_kind', 'receipt',
      'currency', 'ILS', 'amount_original', 11700, 'amount_negated', false, 'doc_date', '2026-09-11', 'description', 'Sample sumit receipt',
      'vat', jsonb_build_object('amount', 1700, 'status', 'source'))), 'removed_ids', '[]'::jsonb, 'complete', false), null, null);
  perform set_config('request.jwt.claims', null, true);
end $$;
insert into public.transactions (company_id, direction, doc_kind, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, source, idempotency_key, description)
select id, 'income', 'receipt', 'posted', 'ILS', 5000, 5000, 5000, 0, 'source', '2026-09-12', 'manual', 'mi:manual', 'Sample manual receipt'
from mi_ref where label = 'a';

-- The owners skip and approve through resolve_review, which stores the fingerprint.
select tests.authenticate_as('mi_a');
select public.resolve_review(pg_temp.open_id('mi-skip'), 'skipped');
select public.resolve_review(pg_temp.open_id('mi-appr'), 'approved', (select id from mi_ref where label = 'proj'),
  (select c.id from public.categories c where c.company_id = (select id from mi_ref where label = 'a') and c.kind = 'income' order by c.sort_order limit 1));
select tests.authenticate_as('mi_b');
select public.resolve_review(pg_temp.open_id('mi-b-skip'), 'skipped');
select public.resolve_review(pg_temp.open_id('mi-b-stale'), 'skipped');
reset role;
select set_config('request.jwt.claims', null, true);
-- One test transaction has one now(): age the review rows as if the skips happened earlier.
update public.review_queue set created_at = created_at - interval '1 hour'
where company_id in (select id from mi_ref);

-- Deploy window: the new mercury-sync runs for company B before the migration.
select pg_temp.sync('b', 'invoice_receipt');
select is(pg_temp.q('mi-b-skip'), 'skipped,open', 'window: a sync relabels a skipped line and queues it again');
select is(pg_temp.q('mi-b-stale'), 'skipped,open', 'window: a line the provider changed is queued again');

create temp table mi_result as select private.relabel_mercury_income() as r;
select is((select r from mi_result), '{"closed": 1, "refreshed": 3, "relabeled": 4}'::jsonb, 'relabel counts');

select is(pg_temp.kind('mi-skip') || ',' || pg_temp.kind('mi-appr') || ',' || pg_temp.kind('mi-pend') || ',' || pg_temp.kind('mi-open'),
  'invoice_receipt,invoice_receipt,invoice_receipt,invoice_receipt', 'Mercury income, posted and pending, is relabeled');
select is(pg_temp.kind('mi-exp') || ',' || pg_temp.kind('mi-cred'), 'expense,credit', 'Mercury expenses and expense credits stay');
select is(pg_temp.kind('9001'), 'receipt', 'a SUMIT receipt stays a receipt');
select is(pg_temp.kind('mi:manual'), 'receipt', 'a manual receipt stays a receipt');
select is(pg_temp.kind('mi-b-skip'), 'invoice_receipt', 'the other company''s Mercury income is relabeled');
select is(pg_temp.q('mi-b-skip'), 'skipped', 'window: the reopened row is closed again');
select is(pg_temp.q('mi-skip'), 'skipped', 'a skipped line stays skipped');
select is(pg_temp.q('mi-appr'), 'approved', 'an approved line stays approved');
select is(pg_temp.q('mi-pend'), 'open', 'a pending line keeps one open row');
select is(
  (select count(*)::integer from public.review_queue q join public.transactions t on t.id = q.transaction_id
   where t.source = 'mercury' and t.direction = 'income' and q.status = 'skipped'
     and q.doc_fingerprint = private.doc_fingerprint(t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id)),
  2,
  'the skip fingerprints match the relabeled lines, as sync_review_queue computes them'
);

-- After the migration, the new mercury-sync runs for both companies.
create temp table mi_before as select (select count(*) from public.review_queue) rq, (select count(*) from public.transactions) tx;
select pg_temp.sync('a', 'invoice_receipt');
select pg_temp.sync('b', 'invoice_receipt');
select is(pg_temp.q('mi-skip') || '|' || pg_temp.q('mi-b-skip'), 'skipped|skipped', 'a later sync does not reopen skipped lines');
select is(pg_temp.q('mi-appr') || '|' || pg_temp.q('mi-pend'), 'approved|open', 'a later sync keeps approved and pending as they were');
select is(pg_temp.q('mi-b-stale'), 'skipped,open', 'a line the provider changed stays queued (stale fingerprint)');
select is(
  (select jsonb_build_object('review', (select count(*) from public.review_queue) - rq, 'lines', (select count(*) from public.transactions) - tx) from mi_before),
  '{"review": 0, "lines": 0}'::jsonb,
  'a later sync adds no review rows and no lines'
);

select is(private.relabel_mercury_income(), '{"closed": 0, "refreshed": 0, "relabeled": 0}'::jsonb, 'running it again changes nothing');

select tests.authenticate_as('mi_a');
select is(
  (select (x ->> 'income_minor')::bigint from jsonb_array_elements(public.company_pnl((select id from mi_ref where label = 'a'), null, null, 'invoiced') -> 'by_currency') x where x ->> 'currency' = 'USD'),
  395000::bigint,
  'invoiced basis counts posted Mercury income'
);
reset role;

-- A Mercury income line stored with no category (no visible income default at the time).
-- The relabel's update runs transactions_fill_category like any later update or sync of the
-- line, so it gets the default as a suggestion, which review still asks about (0097).
update public.categories set hidden = true
where company_id = (select id from mi_ref where label = 'a') and kind = 'income' and is_default;
insert into public.transactions (company_id, direction, doc_kind, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, source, external_id, idempotency_key, description)
select id, 'income', 'receipt', 'posted', 'USD', 6100, 6100, 6100, 0, 'source', '2026-09-13', 'mercury', 'mi-uncat', 'mercury:mi-uncat', 'Sample uncategorized deposit'
from mi_ref where label = 'a';
update public.categories set hidden = false
where company_id = (select id from mi_ref where label = 'a') and kind = 'income' and is_default;
select is((select category_id from public.transactions where external_id = 'mi-uncat'), null::uuid, 'the line is stored with no category');
select is(private.relabel_mercury_income(), '{"closed": 0, "refreshed": 0, "relabeled": 1}'::jsonb, 'the relabel reaches the uncategorized line');
select is(
  (select t.category_suggested and c.is_default and not t.category_assigned and not t.user_assigned
   from public.transactions t join public.categories c on c.id = t.category_id where t.external_id = 'mi-uncat'),
  true,
  'the relabel gives the uncategorized line the default as a suggestion, not an assignment'
);

select ok(not has_function_privilege('anon', 'private.relabel_mercury_income()', 'execute'), 'anon cannot run the relabel');
select ok(not has_function_privilege('authenticated', 'private.relabel_mercury_income()', 'execute'), 'authenticated cannot run the relabel');
select ok(not has_function_privilege('service_role', 'private.relabel_mercury_income()', 'execute'), 'service_role cannot run the relabel');
select is((select prosecdef from pg_proc where oid = 'private.relabel_mercury_income()'::regprocedure), false, 'the relabel is security invoker');

select * from finish();

rollback;
