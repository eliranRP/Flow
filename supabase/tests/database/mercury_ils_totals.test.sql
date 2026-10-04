-- Shekel totals ignore USD. A Mercury row keeps a null fx pair.
-- Pending income is queued and is not in the total. A zero-insert re-run does not wipe.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('ils_owner', 'ils-owner@test.flow');
end
$users$;

select tests.authenticate_as('ils_owner');
select lives_ok($$select public.create_company('ספר מטבע', true)$$, 'owner creates a company');

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table ils_co (id uuid);
insert into ils_co (id)
select id from public.companies where name = 'ספר מטבע' order by created_at desc limit 1;

select is(
  (
    public.upsert_connector_lines(
      (select id from ils_co),
      'sumit',
      jsonb_build_object(
        'lines', jsonb_build_array(jsonb_build_object(
          'source', 'sumit',
          'external_id', 'ils-income',
          'direction', 'income',
          'line_status', 'posted',
          'doc_kind', 'receipt',
          'currency', 'ILS',
          'amount_original', 5000,
          'amount_negated', false,
          'doc_date', '2026-09-01',
          'cash_date', '2026-09-01',
          'description', 'קבלה',
          'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
          'provider_meta', jsonb_build_object('kind', 'receipt')
        )),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  1,
  'an ILS receipt inserts'
);

select is(
  (
    public.upsert_connector_lines(
      (select id from ils_co),
      'mercury',
      jsonb_build_object(
        'lines', jsonb_build_array(
          jsonb_build_object(
            'source', 'mercury',
            'external_id', 'usd-income',
            'direction', 'income',
            'line_status', 'posted',
            'doc_kind', 'receipt',
            'currency', 'USD',
            'amount_original', 10000,
            'amount_negated', false,
            'doc_date', '2026-09-02',
            'cash_date', '2026-09-02',
            'description', 'Treasury interest',
            'category_hint', 'הכנסה אחרת',
            'vat', jsonb_build_object('amount', 0, 'status', 'source'),
            'provider_meta', jsonb_build_object('kind', 'interestPosted', 'checked_at', '2026-09-02T00:00:00.000Z')
          ),
          jsonb_build_object(
            'source', 'mercury',
            'external_id', 'usd-pending',
            'direction', 'income',
            'line_status', 'pending',
            'doc_kind', 'receipt',
            'currency', 'USD',
            'amount_original', 2500,
            'amount_negated', false,
            'doc_date', '2026-09-03',
            'description', 'Pending credit',
            'vat', jsonb_build_object('amount', 0, 'status', 'source'),
            'provider_meta', jsonb_build_object('kind', 'incomingDomesticWire')
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
  'a posted dollar receipt and a pending receipt insert'
);

select is(
  (public.company_pnl((select id from ils_co), null, null, 'cash') ->> 'income_agorot')::bigint,
  5000,
  'a 100 dollar receipt does not change the shekel income'
);

select is(
  (
    select (item ->> 'minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from ils_co), null, null, 'cash') -> 'other_currencies'
    ) item
    where item ->> 'currency' = 'USD'
  ),
  10000,
  'the dollar receipt is returned on its own'
);

select is(
  (
    select (item ->> 'count')::integer
    from jsonb_array_elements(
      public.company_pnl((select id from ils_co), null, null, 'cash') -> 'other_currencies'
    ) item
    where item ->> 'currency' = 'USD'
  ),
  1,
  'the pending dollar receipt is not in the dollar count'
);

select is(
  (
    select t.fx_rate is null and t.fx_rate_date is null
    from public.transactions t
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-income'
  ),
  true,
  'a mercury insert leaves the fx pair null'
);

select is(
  (
    select c.name
    from public.transactions t
    join public.categories c on c.id = t.category_id
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-income'
  ),
  'הכנסה אחרת',
  'treasury yield uses other income'
);

select is(
  (
    select q.reason
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-pending'
      and q.status = 'open'
  ),
  'pending_income',
  'pending mercury income is queued for review'
);

do $$
begin
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'source', 'mercury',
        'external_id', 'usd-income',
        'direction', 'income',
        'line_status', 'posted',
        'doc_kind', 'receipt',
        'currency', 'USD',
        'amount_original', 10000,
        'amount_negated', false,
        'doc_date', '2026-09-02',
        'cash_date', '2026-09-02',
        'description', 'Treasury interest',
        'category_hint', 'הכנסה אחרת',
        'vat', jsonb_build_object('amount', 0, 'status', 'source'),
        'provider_meta', jsonb_build_object('kind', 'interestPosted')
      )),
      'removed_ids', '[]'::jsonb,
      'complete', false
    ),
    null,
    null
  );
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object('lines', '[]'::jsonb, 'removed_ids', '[]'::jsonb, 'complete', true),
    null,
    null
  );
end
$$;

select is(
  (
    select count(*)::integer
    from public.transactions
    where company_id = (select id from ils_co)
      and source::text = 'mercury'
      and removed_at is null
  ),
  2,
  'a complete mercury re-run that inserts nothing new does not wipe'
);

select is(
  (
    select provider_meta ->> 'checked_at'
    from public.transactions
    where company_id = (select id from ils_co)
      and external_id = 'usd-income'
  ),
  '2026-09-02T00:00:00.000Z',
  'a later upsert keeps checked_at'
);

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, 'sumit', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '1', '3'
from ils_co;

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '3'
from ils_co;

insert into public.connector_refresh_requests (company_id, provider, forced)
select id, 'sumit', false from ils_co;

insert into public.connector_refresh_requests (company_id, provider, forced)
select id, 'mercury', false from ils_co;

select is(
  (select count(*)::integer from public.claim_connector_refreshes(20, 'mercury') where provider::text = 'mercury'),
  1,
  'the mercury claim takes the mercury row'
);

select is(
  (select count(*)::integer from public.connector_refresh_requests where provider::text = 'sumit' and claimed_at is null),
  1,
  'the mercury claim leaves the sumit row unclaimed'
);

select * from finish();
rollback;
