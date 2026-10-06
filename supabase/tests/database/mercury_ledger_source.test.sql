-- Mercury may write ledger lines. SUMIT still writes. The sweep stays sumit-only.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('mercury_owner', 'mercury-owner@test.flow');
end
$users$;

select tests.authenticate_as('mercury_owner');
select lives_ok($$select public.create_company('ספר מרקורי', true)$$, 'owner creates a company');

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table mercury_co (id uuid);
insert into mercury_co (id)
select id from public.companies where name = 'ספר מרקורי' order by created_at desc limit 1;

select is(
  (
    public.upsert_connector_lines(
      (select id from mercury_co),
      'mercury',
      jsonb_build_object(
        'lines', jsonb_build_array(
          jsonb_build_object(
            'source', 'mercury',
            'external_id', '11111111-1111-4111-8111-111111111111',
            'direction', 'income',
            'line_status', 'posted',
            'doc_kind', 'receipt',
            'currency', 'USD',
            'amount_original', 1234,
            'amount_negated', false,
            'doc_date', '2026-09-30',
            'cash_date', '2026-09-30',
            'description', 'Treasury interest',
            'vat', jsonb_build_object('amount', 0, 'status', 'source'),
            'counterparty', jsonb_build_object('name', 'Mercury Treasury', 'external_id', null, 'kind', 'customer'),
            'provider_meta', jsonb_build_object('kind', 'interestPosted', 'providerCategory', null)
          ),
          jsonb_build_object(
            'source', 'mercury',
            'external_id', 'mercury-keep',
            'direction', 'expense',
            'line_status', 'posted',
            'doc_kind', 'expense',
            'currency', 'USD',
            'amount_original', 500,
            'amount_negated', true,
            'doc_date', '2026-09-01',
            'description', 'A posted expense',
            'vat', jsonb_build_object('amount', 0, 'status', 'source'),
            'provider_meta', jsonb_build_object('kind', 'outgoingPayment')
          )
        ),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  2,
  'a mercury yield line and an expense insert'
);

do $$
begin
perform public.upsert_connector_lines(
  (select id from mercury_co),
  'mercury',
  jsonb_build_object(
    'lines', jsonb_build_array(
      jsonb_build_object(
        'source', 'mercury',
        'external_id', '11111111-1111-4111-8111-111111111111',
        'direction', 'income',
        'line_status', 'posted',
        'doc_kind', 'receipt',
        'currency', 'USD',
        'amount_original', 1234,
        'amount_negated', false,
        'doc_date', '2026-09-30',
        'cash_date', '2026-09-30',
        'description', 'Treasury interest',
        'vat', jsonb_build_object('amount', 0, 'status', 'source'),
        'provider_meta', jsonb_build_object('kind', 'interestPosted')
      )
    ),
    'removed_ids', '[]'::jsonb,
    'complete', true
  ),
  null,
  null
);
end
$$;

select is(
  (select source::text from public.transactions where company_id = (select id from mercury_co) and external_id = '11111111-1111-4111-8111-111111111111'),
  'mercury',
  'the yield row is a mercury source'
);

select is(
  (select currency from public.transactions where company_id = (select id from mercury_co) and external_id = '11111111-1111-4111-8111-111111111111'),
  'USD',
  'a mercury row stays in dollars'
);

select is(
  (select provider_meta from public.transactions where company_id = (select id from mercury_co) and external_id = '11111111-1111-4111-8111-111111111111'),
  '{"kind":"interestPosted"}'::jsonb,
  'provider_meta keeps the treasury type'
);

select is(
  (
    select count(*)::integer
    from public.transactions
    where company_id = (select id from mercury_co)
      and source::text = 'mercury'
      and removed_at is null
  ),
  2,
  'a complete mercury upsert does not sweep the other mercury row'
);

select is(
  (
    public.upsert_connector_lines(
      (select id from mercury_co),
      'sumit',
      jsonb_build_object(
        'lines', jsonb_build_array(
          jsonb_build_object(
            'source', 'sumit',
            'external_id', 'sumit-still',
            'direction', 'expense',
            'line_status', 'posted',
            'doc_kind', 'expense',
            'pnl_role', 'overhead',
            'currency', 'ILS',
            'amount_original', 500,
            'amount_negated', true,
            'doc_date', '2026-10-01',
            'description', 'סאמיט',
            'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
            'provider_meta', jsonb_build_object('kind', 'expense', 'providerCategory', 'Software')
          )
        ),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  1,
  'sumit still inserts'
);

select is(private.is_connector_source('mercury'), true, 'mercury is a connector source');
select is(private.is_connector_source('sumit'), true, 'sumit stays a connector source');

select * from finish();
rollback;
