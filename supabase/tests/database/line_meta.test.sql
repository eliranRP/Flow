-- FLOW-304. The connector keeps only allowlisted bank metadata, and get_line_meta returns it
-- normalized to the line's own company. No number beyond a card's last 4.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('meta_owner', 'meta-owner@test.flow');
  perform tests.create_supabase_user('meta_other', 'meta-other@test.flow');
end
$users$;

select tests.authenticate_as('meta_owner');
select lives_ok($$select public.create_company('ספר מטא', true)$$, 'owner creates a company');
select tests.authenticate_as('meta_other');
select lives_ok($$select public.create_company('ספר אחר', true)$$, 'another owner creates a company');

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

create temp table meta_co (id uuid);
insert into meta_co (id)
select id from public.companies where name = 'ספר מטא' order by created_at desc limit 1;
grant select on meta_co to authenticated;

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version, account_labels, card_labels
)
select id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '3',
  '[{"id": "acct-1", "label": "Example Checking ••**** (1)", "last4": "1234"}]'::jsonb,
  '[{"last4": "4242", "label": "Example Utilities"}, {"last4": "1111", "label": "Example General"}]'::jsonb
from meta_co;

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table meta_line (line jsonb);
insert into meta_line (line) values
  (jsonb_build_object(
    'source', 'mercury', 'external_id', 'meta-card', 'direction', 'expense',
    'line_status', 'posted', 'doc_kind', 'expense', 'currency', 'USD',
    'amount_original', 5000, 'amount_negated', true,
    'doc_date', '2026-09-01', 'cash_date', '2026-09-01',
    'description', 'Example Office Suite',
    'vat', jsonb_build_object('amount', 0, 'status', 'source'),
    'counterparty', jsonb_build_object('name', 'Example Office Suite', 'external_id', null, 'kind', 'supplier'),
    'provider_meta', jsonb_build_object(
      'kind', 'creditCardTransaction', 'method', 'card', 'card_last4', '4242',
      'memo', 'Order 123456789 paid', 'account_id', 'acct-1',
      'accountNumber', '026073150', 'checked_at', '2026-09-02T00:00:00Z'
    )
  )),
  (jsonb_build_object(
    'source', 'mercury', 'external_id', 'meta-bad', 'direction', 'expense',
    'line_status', 'posted', 'doc_kind', 'expense', 'currency', 'USD',
    'amount_original', 700, 'amount_negated', true,
    'doc_date', '2026-09-03', 'cash_date', '2026-09-03',
    'description', 'Bad card digits',
    'vat', jsonb_build_object('amount', 0, 'status', 'source'),
    'provider_meta', jsonb_build_object('kind', 'debitCardTransaction', 'method', 'cash', 'card_last4', '424242')
  )),
  (jsonb_build_object(
    'source', 'mercury', 'external_id', 'meta-old', 'direction', 'expense',
    'line_status', 'posted', 'doc_kind', 'expense', 'currency', 'USD',
    'amount_original', 900, 'amount_negated', true,
    'doc_date', '2026-09-04', 'cash_date', '2026-09-04',
    'description', 'WIRE TO ACCT 123456789',
    'vat', jsonb_build_object('amount', 0, 'status', 'source'),
    'provider_meta', jsonb_build_object('kind', 'outgoingPayment')
  ));

select is(
  (public.upsert_connector_lines(
    (select id from meta_co), 'mercury',
    jsonb_build_object('lines', (select jsonb_agg(line) from meta_line), 'removed_ids', '[]'::jsonb, 'complete', false),
    null, null
  )).inserted,
  3,
  'three bank lines insert'
);

select is(
  (select provider_meta from public.transactions where external_id = 'meta-card'),
  jsonb_build_object(
    'kind', 'creditCardTransaction', 'method', 'card', 'card_last4', '4242',
    'memo', 'Order ••6789 paid', 'account_id', 'acct-1', 'checked_at', '2026-09-02T00:00:00Z'
  ),
  'only allowlisted keys are stored, and long digit runs in the memo are masked'
);

select is(
  (select provider_meta from public.transactions where external_id = 'meta-bad'),
  jsonb_build_object('kind', 'debitCardTransaction'),
  'an unknown method and a longer card number are dropped'
);

-- A later sync without checked_at keeps the stored recheck time and takes the new memo.
select is(
  (public.upsert_connector_lines(
    (select id from meta_co), 'mercury',
    jsonb_build_object(
      'lines', jsonb_build_array(
        (select line from meta_line where line->>'external_id' = 'meta-card')
          #- '{provider_meta,checked_at}'
          || jsonb_build_object('provider_meta', jsonb_build_object(
            'kind', 'creditCardTransaction', 'method', 'card', 'card_last4', '4242',
            'memo', 'Updated memo', 'account_id', 'acct-1'
          ))
      ),
      'removed_ids', '[]'::jsonb, 'complete', false
    ),
    null, null
  )).inserted,
  0,
  'the second sync updates in place'
);

select is(
  (select provider_meta->>'memo' || ' / ' || (provider_meta->>'checked_at') from public.transactions where external_id = 'meta-card'),
  'Updated memo / 2026-09-02T00:00:00Z',
  'an update takes the new memo and keeps the recheck time'
);

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

create temp table meta_ids (external_id text, id uuid);
insert into meta_ids select external_id, id from public.transactions where external_id like 'meta-%';
grant select on meta_ids to authenticated;

select tests.authenticate_as('meta_owner');

select is(
  (
    select m - 'transaction_id'
    from jsonb_array_elements(public.get_line_meta((select array_agg(id) from meta_ids))) as m
    where (m->>'transaction_id')::uuid = (select id from meta_ids where external_id = 'meta-card')
  ),
  jsonb_build_object(
    'method', 'card', 'card_last4', '4242', 'card_name', 'Example Utilities', 'memo', 'Updated memo',
    'account', 'Example Checking (1) ••1234', 'counterparty', 'Example Office Suite',
    'bank_description', 'Example Office Suite'
  ),
  'the owner reads the card line normalized, with the masked account label tidied and the card''s nickname (FLOW-707)'
);

select ok(
  (
    select (m ? 'card_name') and m->'card_name' = 'null'::jsonb
    from jsonb_array_elements(public.get_line_meta((select array_agg(id) from meta_ids))) as m
    where (m->>'transaction_id')::uuid = (select id from meta_ids where external_id = 'meta-bad')
  ),
  'a line with no card last 4 has no card name'
);

select is(
  (
    select (m->>'method') || ' / ' || (m->>'bank_description')
    from jsonb_array_elements(public.get_line_meta((select array_agg(id) from meta_ids))) as m
    where (m->>'transaction_id')::uuid = (select id from meta_ids where external_id = 'meta-old')
  ),
  'ach / WIRE TO ACCT ••6789',
  'a line imported before FLOW-304 gets its method from the kind, and its bank text keeps only the last 4'
);

select is(
  jsonb_array_length(public.get_line_meta((select array_agg(id) from meta_ids))),
  3,
  'positive control: the owner sees all three lines'
);

select is(
  (
    select m->>'method'
    from jsonb_array_elements(public.get_line_meta((select array_agg(id) from meta_ids))) as m
    where (m->>'transaction_id')::uuid = (select id from meta_ids where external_id = 'meta-bad')
  ),
  'card',
  'a dropped method falls back to the kind'
);

select tests.authenticate_as('meta_other');

select is(
  public.get_line_meta((select array_agg(id) from meta_ids)),
  '[]'::jsonb,
  'another company reads nothing'
);

select tests.clear_authentication();

select throws_ok(
  $$select public.get_line_meta(array[gen_random_uuid()])$$,
  '42501',
  null,
  'anon cannot call get_line_meta'
);

reset role;

select ok(
  has_column_privilege('authenticated', 'public.connector_connections', 'card_labels', 'select')
    and not has_column_privilege('authenticated', 'public.connector_connections', 'card_labels', 'update'),
  'the owner reads the card names and only the service role writes them'
);

select ok(
  not has_function_privilege('authenticated', 'private.clean_provider_meta(jsonb, jsonb)', 'execute'),
  'only the service role runs the allowlist'
);

select * from finish();
rollback;
