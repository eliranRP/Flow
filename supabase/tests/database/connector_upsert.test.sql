-- Connector upsert writes a posted line, skips a foreign source, and refuses a stale cursor.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('upsert_owner', 'upsert-owner@test.flow');
end
$users$;

select tests.authenticate_as('upsert_owner');
select lives_ok($$select public.create_company('מנוע', true)$$, 'owner creates a company');

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table upsert_co (id uuid);
insert into upsert_co (id)
select id from public.companies where name = 'מנוע' order by created_at desc limit 1;

select is(
  (
    public.upsert_connector_lines(
      (select id from upsert_co),
      'sumit',
      jsonb_build_object(
        'lines', jsonb_build_array(jsonb_build_object(
          'source', 'sumit',
          'external_id', 'l1a-posted',
          'direction', 'expense',
          'line_status', 'posted',
          'doc_kind', 'expense',
          'pnl_role', 'overhead',
          'currency', 'ILS',
          'amount_original', 10000,
          'amount_negated', true,
          'doc_date', '2026-10-01',
          'description', 'שורה',
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
  'a posted line is inserted'
);

select is(
  (
    select line_status::text || ':' || currency || ':' || amount_original::text
    from public.transactions
    where company_id = (select id from upsert_co) and external_id = 'l1a-posted'
  ),
  'posted:ILS:10000',
  'the row keeps posted status, currency, and the original amount'
);

select is(
  (
    public.upsert_connector_lines(
      (select id from upsert_co),
      'sumit',
      jsonb_build_object(
        'lines', jsonb_build_array(jsonb_build_object(
          'source', 'mercury',
          'external_id', 'not-sumit',
          'direction', 'expense',
          'line_status', 'posted',
          'doc_kind', 'expense',
          'currency', 'USD',
          'amount_original', 100,
          'amount_negated', true,
          'doc_date', '2026-10-01',
          'vat', jsonb_build_object('amount', 0, 'status', 'unknown')
        )),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).skipped,
  1,
  'a line from another source is skipped'
);

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version, sync_cursor
)
select id, 'sumit', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '2', '2', 'cursor-a'
from upsert_co;

select throws_ok(
  $$select public.upsert_connector_lines(
      (select id from upsert_co),
      'sumit',
      '{"lines":[],"removed_ids":[],"complete":false}'::jsonb,
      'cursor-b',
      'cursor-stale'
    )$$,
  'P0001',
  'sync_cursor_conflict',
  'a stale cursor is rejected'
);

select is(
  (select sync_cursor from public.connector_connections where company_id = (select id from upsert_co)),
  'cursor-a',
  'a rejected cursor leaves the stored cursor'
);

select is(
  (
    public.upsert_connector_lines(
      (select id from upsert_co),
      'sumit',
      '{"lines":[],"removed_ids":[],"complete":false}'::jsonb,
      'cursor-c',
      'cursor-a'
    )
  ).inserted,
  0,
  'a matching cursor is accepted'
);

select is(
  (select sync_cursor from public.connector_connections where company_id = (select id from upsert_co)),
  'cursor-c',
  'the accepted call stores the next cursor'
);

select tests.authenticate_as('upsert_owner');
select throws_ok(
  $$select public.upsert_connector_lines(
      (select id from upsert_co),
      'sumit',
      '{"lines":[],"removed_ids":[],"complete":false}'::jsonb,
      null,
      null
    )$$,
  '42501',
  null,
  'an owner cannot upsert connector lines'
);

select * from finish();
rollback;
