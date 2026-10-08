-- FLOW-335. The sync stores a SUMIT document link on an invoice and list_unpaid returns it:
-- only pay.sumit.co.il links are kept, a sync without a link keeps the stored one, and
-- another company's link is not listed. Invented data only. Amounts are agorot.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('udu_owner', 'udu-owner@example.com');
  perform tests.create_supabase_user('udu_other', 'udu-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('udu_owner'), 'Example Links LLC', false),
  (tests.get_supabase_uid('udu_other'), 'Example Other Links LLC', false);

create temp table udu (label text primary key, id uuid);
grant all on udu to authenticated, service_role;
insert into udu (label, id) select 'co', id from public.companies where name = 'Example Links LLC';
insert into udu (label, id) select 'other_co', id from public.companies where name = 'Example Other Links LLC';

insert into public.sumit_connections (
  company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
)
select id, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '2'
from udu;

-- One full sync of SUMIT customer invoices, written the way the sync writes them: each
-- element of p_docs is [external_id, document_url]. A sync sweeps documents it does not list.
create or replace function pg_temp.sync(p_co text, p_docs jsonb)
returns integer
language sql
as $$
  select public.upsert_sumit_documents(
    (select id from pg_temp.udu where label = p_co),
    (
      select jsonb_agg(jsonb_build_object(
        'idempotency_key', 'sumit:' || (d->>0),
        'external_id', d->>0,
        'direction', 'income',
        'doc_kind', 'invoice',
        'amount_gross', 11800,
        'amount_net', 10000,
        'vat_amount', 1800,
        'vat_status', 'source',
        'doc_date', '2026-06-01',
        'description', 'Invoice ' || (d->>0),
        'document_url', d->1
      ))
      from jsonb_array_elements(p_docs) d
    )
  );
$$;
grant execute on function pg_temp.sync(text, jsonb) to service_role;

-- The document_url list_unpaid returns for one invoice, as the signed-in user.
create or replace function pg_temp.listed_url(p_ext text)
returns jsonb
language sql
as $$
  select u->'document_url'
  from jsonb_array_elements(public.list_unpaid()) u
  where u->>'id' = (select id::text from public.transactions where external_id = p_ext)
$$;
grant execute on function pg_temp.listed_url(text) to authenticated;

set local role service_role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.sync('co', '[["udu-1", "https://pay.sumit.co.il/example/doc-1"],
    ["udu-2", "https://evil.example/doc-2"], ["udu-3", null]]');
  perform pg_temp.sync('other_co', '[["udu-9", "https://pay.sumit.co.il/example/doc-9"]]');
end
$$;
reset role;

select is(
  (select provider_meta->>'document_url' from public.transactions where external_id = 'udu-1'),
  'https://pay.sumit.co.il/example/doc-1',
  'the sync stores a pay.sumit.co.il link'
);

select tests.authenticate_as('udu_owner');
select is(pg_temp.listed_url('udu-1'), to_jsonb('https://pay.sumit.co.il/example/doc-1'::text),
  'list_unpaid returns the link');
select is(pg_temp.listed_url('udu-2'), 'null'::jsonb, 'a link on another host is dropped');
select is(pg_temp.listed_url('udu-3'), 'null'::jsonb, 'an invoice with no link lists null');
select is(pg_temp.listed_url('udu-9'), null, 'another company''s invoice is not listed');

reset role;
set local role service_role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.sync('co', '[["udu-1", null], ["udu-2", null],
    ["udu-3", "https://pay.sumit.co.il/example/doc-3"]]');
end
$$;
reset role;

select tests.authenticate_as('udu_owner');
select is(pg_temp.listed_url('udu-1'), to_jsonb('https://pay.sumit.co.il/example/doc-1'::text),
  'a sync without a link keeps the stored one');
select is(pg_temp.listed_url('udu-3'), to_jsonb('https://pay.sumit.co.il/example/doc-3'::text),
  'a later sync adds a link');

select * from finish();
rollback;
