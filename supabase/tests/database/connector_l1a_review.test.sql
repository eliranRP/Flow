-- L1a review. View masking and defaults, envelope replace, connector role
-- checks, the wrapper count, and pending lines out of the category and overhead sums.

begin;

select plan(43);

do $users$
begin
  perform tests.create_supabase_user('rev_a', 'rev-a@test.flow');
  perform tests.create_supabase_user('rev_b', 'rev-b@test.flow');
end
$users$;

create temp table rev (label text primary key, id uuid);
grant all on rev to authenticated;

select tests.authenticate_as('rev_a');
select lives_ok($$select public.create_company('ביקורת', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'אתר', null, 'active')$$, 'owner opens a project');
insert into rev (label, id) select 'a', id from public.companies;
insert into rev (label, id) select 'project', id from public.projects where name = 'אתר';
insert into rev (label, id)
select 'haul', id from public.categories where company_id = (select id from rev where label = 'a') and name = 'הובלה';

select tests.authenticate_as('rev_b');
select lives_ok($$select public.create_company('אחר', true)$$, 'the other owner creates a company');
insert into rev (label, id) select 'b', id from public.companies where name = 'אחר';

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

insert into public.sumit_connections (
  company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
)
select id, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '2'
from rev where label = 'a';

select is(
  (
    select provider::text || ':' || kek_ref || ':' || envelope_version || ':' || settings::text
      || ':' || account_labels::text || ':' || reject_attempts::text
      || ':' || coalesce(import_from::text, 'null') || ':' || coalesce(sync_cursor, 'null')
    from public.connector_connections
    where company_id = (select id from rev where label = 'a')
      and provider = 'sumit'
  ),
  'sumit:SUMIT_KEK:2:{}:[]:0:null:null',
  'an omitted view insert stores the SUMIT defaults'
);

update public.sumit_connections
set last_error = 'sumit_auth'
where company_id = (select id from rev where label = 'a');

select is(
  (
    select last_error
    from public.connector_connections
    where company_id = (select id from rev where label = 'a')
      and provider = 'sumit'
  ),
  'auth',
  'a view write stores auth'
);

insert into public.sumit_refresh_requests (company_id)
select id from rev where label = 'a';

select is(
  (
    select forced::text || ':' || (requested_at is not null)::text
    from public.connector_refresh_requests
    where company_id = (select id from rev where label = 'a')
      and provider = 'sumit'
      and claimed_at is null
  ),
  'false:true',
  'an omitted refresh insert is unforced and stamped'
);

select tests.authenticate_as('rev_a');

select is(
  (select last_error from public.sumit_connections),
  'sumit_auth',
  'the owner reads the translated error'
);

select throws_ok(
  $$select key_ciphertext from public.sumit_connections$$,
  '42501',
  null,
  'the owner cannot read the key'
);

select is(
  (
    select key_ciphertext is null and kek_version is null and envelope_version is null
    from private.sumit_connection_rows()
  ),
  true,
  'the owner session reads null secrets'
);

select tests.clear_authentication();

select throws_ok(
  $$select id from public.sumit_connections$$,
  '42501',
  null,
  'anon cannot read the connection view'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select throws_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 100, '\x01', '\x0201', '\x03', '\x0401', '1', '1', true)$$,
    (select id from rev where label = 'a')
  ),
  'P0001',
  'envelope format is not accepted',
  'replace_sumit_connection rejects format 1'
);

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 100, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true)$$,
    (select id from rev where label = 'a')
  ),
  'replace_sumit_connection accepts format 2'
);

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 100, '\x01', '\x0201', '\x03', '\x0401', '1', '3', true)$$,
    (select id from rev where label = 'a')
  ),
  'replace_sumit_connection accepts format 3'
);

select is(
  (
    select envelope_version
    from public.connector_connections
    where company_id = (select id from rev where label = 'a')
      and provider = 'sumit'
  ),
  '3',
  'the accepted replace stores format 3'
);

select throws_ok(
  format(
    $$select public.replace_connector_connection(%L::uuid, 'mercury', '\x01', '\x0201', '\x03', '\x0401', '1', '1', true, '{}'::jsonb)$$,
    (select id from rev where label = 'a')
  ),
  'P0001',
  'envelope format is not accepted',
  'replace_connector_connection rejects format 1'
);

select lives_ok(
  format(
    $$select public.replace_connector_connection(%L::uuid, 'mercury', '\x01', '\x0201', '\x03', '\x0401', '1', '2', true, '{}'::jsonb)$$,
    (select id from rev where label = 'a')
  ),
  'replace_connector_connection accepts format 2'
);

select lives_ok(
  format(
    $$select public.replace_connector_connection(%L::uuid, 'mercury', '\x01', '\x0201', '\x03', '\x0401', '1', '3', true, '{}'::jsonb)$$,
    (select id from rev where label = 'a')
  ),
  'replace_connector_connection accepts format 3'
);

select is(
  (
    select kek_ref || ':' || envelope_version
    from public.connector_connections
    where company_id = (select id from rev where label = 'a')
      and provider = 'mercury'
  ),
  'MERCURY_KEK:3',
  'the mercury replace stores its key name and format 3'
);

select tests.authenticate_as('rev_a');
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok(
  $$select public.disconnect_connector('sumit')$$,
  'P0001',
  'forbidden',
  'disconnect_connector rejects an empty role'
);

select throws_ok(
  $$select public.request_connector_refresh('sumit')$$,
  'P0001',
  'forbidden',
  'request_connector_refresh rejects an empty role'
);

select throws_ok(
  $$select public.set_import_from('sumit', '2020-01-01')$$,
  'P0001',
  'forbidden',
  'set_import_from rejects an empty role'
);

select tests.authenticate_as('rev_a');
select lives_ok(
  $$select public.set_import_from('sumit', '2020-01-01')$$,
  'the owner sets the import date'
);

select tests.authenticate_as('rev_b');
select lives_ok(
  $$select public.disconnect_connector('sumit')$$,
  'the other owner disconnects only their connector'
);
select throws_ok(
  $$select public.set_import_from('sumit', '2020-01-01')$$,
  'P0001',
  'connector is not connected',
  'the other owner cannot set this company''s import date'
);
select lives_ok(
  $$select public.request_connector_refresh('sumit')$$,
  'the other owner queues their own refresh'
);

reset role;

select is(
  (
    select count(*)::int
    from public.connector_connections
    where company_id = (select id from rev where label = 'a')
      and provider = 'sumit'
  ),
  1,
  'the other owner leaves this SUMIT connection'
);

select is(
  (
    select import_from
    from public.connector_connections
    where company_id = (select id from rev where label = 'a')
      and provider = 'sumit'
  ),
  '2020-01-01'::date,
  'the other owner leaves this import date'
);

select is(
  (
    select count(*)::int
    from public.connector_refresh_requests
    where company_id = (select id from rev where label = 'a')
      and claimed_at is null
  ),
  1,
  'the other owner does not open a second refresh for this company'
);

select tests.authenticate_as('rev_a');
select throws_ok(
  $$select * from public.party_external_refs$$,
  '42501',
  null,
  'authenticated cannot read party refs'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select is(
  public.upsert_sumit_documents(
    (select id from rev where label = 'a'),
    jsonb_build_array(jsonb_build_object(
      'idempotency_key', 'sumit:doc-9',
      'external_id', 'doc-9',
      'direction', 'expense',
      'doc_kind', 'expense',
      'amount_gross', -10000,
      'amount_net', -10000,
      'vat_amount', 0,
      'vat_status', 'unknown',
      'doc_date', '2026-10-01',
      'description', 'מסמך'
    ))
  ),
  1,
  'the wrapper returns the written count'
);

select is(
  public.upsert_sumit_documents(
    (select id from rev where label = 'a'),
    jsonb_build_array(jsonb_build_object(
      'idempotency_key', 'sumit:doc-9',
      'external_id', 'doc-9',
      'direction', 'expense',
      'doc_kind', 'expense',
      'amount_gross', -10000,
      'amount_net', -10000,
      'vat_amount', 0,
      'vat_status', 'unknown',
      'doc_date', '2026-10-01',
      'description', 'מסמך'
    ))
  ),
  1,
  'the wrapper counts an update'
);

select is(
  (select idempotency_key from public.transactions where external_id = 'doc-9'),
  'sumit:doc-9',
  'the wrapper stores the sumit key'
);

select is(
  (
    public.upsert_connector_lines(
      (select id from rev where label = 'a'),
      'sumit',
      jsonb_build_object(
        'lines', jsonb_build_array(jsonb_build_object(
          'source', 'sumit',
          'external_id', 'eng-1',
          'direction', 'expense',
          'line_status', 'posted',
          'doc_kind', 'expense',
          'pnl_role', 'project',
          'currency', 'ILS',
          'amount_original', 1000,
          'amount_negated', true,
          'doc_date', '2026-10-01',
          'description', 'מנוע',
          'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
          'provider_meta', '{}'::jsonb
        )),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  1,
  'a line with no key is inserted'
);

select is(
  (select idempotency_key from public.transactions where external_id = 'eng-1'),
  'sumit:eng-1',
  'the engine key is sumit and the external id'
);

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select id, 'expense', 'expense', 'project', 'posted',
  -7000, -7000, 0, 'unknown',
  current_date, 'manual', 'review:posted',
  (select id from rev where label = 'project'),
  (select id from rev where label = 'haul'),
  'נרשם'
from rev where label = 'a';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select id, 'expense', 'expense', 'project', 'pending',
  -3000, -3000, 0, 'unknown',
  current_date, 'manual', 'review:pending',
  (select id from rev where label = 'project'),
  (select id from rev where label = 'haul'),
  'ממתין'
from rev where label = 'a';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'income', 'invoice', null, 'posted',
  20000, 20000, 0, 'unknown',
  current_date, 'manual', 'review:income',
  (select id from rev where label = 'project'),
  'תקבול'
from rev where label = 'a';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'overhead', 'posted',
  -10000, -10000, 0, 'unknown',
  current_date, 'manual', 'review:overhead', 'כללי'
from rev where label = 'a';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'overhead', 'pending',
  -50000, -50000, 0, 'unknown',
  current_date, 'manual', 'review:overhead-pending', 'כללי ממתין'
from rev where label = 'a';

select tests.authenticate_as('rev_a');

select is(
  (
    public.list_project_category(
      (select id from rev where label = 'project'),
      (select id from rev where label = 'haul')
    ) ->> 'total_agorot'
  )::bigint,
  7000::bigint,
  'the category total skips the pending line'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.list_project_category(
        (select id from rev where label = 'project'),
        (select id from rev where label = 'haul')
      ) -> 'rows'
    ) row
    where row->>'description' = 'ממתין'
  ),
  'the category rows skip the pending line'
);

select is(
  (
    select share_agorot
    from private.overhead_share((select id from rev where label = 'project'))
  ),
  10000::bigint,
  'overhead share skips the pending line'
);

select is(
  (public.sumit_status() ->> 'sumit_company_id')::bigint,
  100::bigint,
  'status reads this company''s SUMIT id'
);

select is(
  public.sumit_status() ? 'settings',
  false,
  'status does not grant settings'
);

select tests.authenticate_as('rev_b');
select is(
  (public.sumit_status() ->> 'connected')::boolean,
  false,
  'the other owner does not see this company''s status'
);

reset role;

update public.transactions
set amount_gross = -2500, amount_net = -2500
where idempotency_key = 'review:posted';

select is(
  (select amount_original from public.transactions where idempotency_key = 'review:posted'),
  2500::bigint,
  'an update of the gross refills the original amount'
);

select ok(
  not has_function_privilege('authenticated', 'private.fill_amount_original()', 'execute')
  and has_function_privilege('service_role', 'private.fill_amount_original()', 'execute'),
  'authenticated cannot execute the amount trigger'
);

select is(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'sumit_status'
  ),
  true,
  'sumit_status is security definer'
);

select * from finish();
rollback;
