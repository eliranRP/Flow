-- Disconnect keeps the last SUMIT company id. A failed validation writes nothing.
-- Connecting a different id after disconnect retires only that company's SUMIT rows.

begin;

select plan(17);

do $users$
begin
  perform tests.create_supabase_user('r9b_a', 'r9b-a@test.flow');
  perform tests.create_supabase_user('r9b_b', 'r9b-b@test.flow');
end
$users$;

select tests.authenticate_as('r9b_a');
select lives_ok($$select public.create_company('סבב 9 ניתוק', true)$$, 'owner A creates a company');

create temp table r9b (label text primary key, id uuid);
grant all on r9b to authenticated, service_role;
insert into r9b (label, id) select 'a', id from public.companies where name = 'סבב 9 ניתוק';

select tests.authenticate_as('r9b_b');
select lives_ok($$select public.create_company('סבב 9 אחר', true)$$, 'owner B creates a company');
insert into r9b (label, id) select 'b', id from public.companies where name = 'סבב 9 אחר';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'shared', -1000, -1000, 0, 'unknown',
  '2026-09-07', 'sumit', 'r9b:a-sumit', 'סאמיט א'
from r9b where label = 'a';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project', -500, -500, 0, 'unknown',
  '2026-09-07', 'manual', 'r9b:a-manual', 'ידני א'
from r9b where label = 'a';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'shared', -2000, -2000, 0, 'unknown',
  '2026-09-07', 'sumit', 'r9b:b-sumit', 'סאמיט ב'
from r9b where label = 'b';

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 100, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from r9b where label = 'a';
insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 300, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from r9b where label = 'b';

select tests.authenticate_as('r9b_a');
select lives_ok($$select public.disconnect_sumit()$$, 'disconnect keeps the books and drops the key');

reset role;
select is(
  (select count(*)::int from public.sumit_connections where company_id = (select id from r9b where label = 'a')),
  0,
  'disconnect deletes the connection row'
);
select is(
  (select last_sumit_company_id from public.companies where id = (select id from r9b where label = 'a')),
  100::bigint,
  'disconnect remembers the last SUMIT company id'
);
select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r9b where label = 'a') and source = 'sumit' and removed_at is null),
  1,
  'disconnect leaves the SUMIT ledger in place'
);

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select throws_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 200, '\x01', '\x0201', '\x03', '\x0401', '1', '2', false)$$,
    (select id from r9b where label = 'a')
  ),
  'P0001',
  'validation failed',
  'a failed validation does not connect'
);
select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r9b where label = 'a') and source = 'sumit' and removed_at is null),
  1,
  'a failed validation does not retire the ledger'
);
select is(
  (select last_sumit_company_id from public.companies where id = (select id from r9b where label = 'a')),
  100::bigint,
  'a failed validation keeps the remembered company id'
);
select is(
  (select count(*)::int from public.sumit_connections where company_id = (select id from r9b where label = 'a')),
  0,
  'a failed validation does not store a key'
);

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 200, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true)$$,
    (select id from r9b where label = 'a')
  ),
  'connecting a different company after disconnect retires the old ledger'
);
select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r9b where label = 'a') and source = 'sumit' and removed_at is null),
  0,
  'the previous SUMIT rows are retired'
);
select is(
  (select removed_at is null from public.transactions where idempotency_key = 'r9b:a-manual'),
  true,
  'a manual row stays after the switch'
);
select is(
  (select last_sumit_company_id from public.companies where id = (select id from r9b where label = 'a')),
  200::bigint,
  'connect remembers the new SUMIT company id'
);
select is(
  (select sumit_company_id from public.sumit_connections where company_id = (select id from r9b where label = 'a')),
  200::bigint,
  'the new connection stores the new company id'
);
select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r9b where label = 'b') and source = 'sumit' and removed_at is null),
  1,
  'another company''s SUMIT rows stay'
);
select is(
  (select sumit_company_id from public.sumit_connections where company_id = (select id from r9b where label = 'b')),
  300::bigint,
  'another company''s connection stays'
);

select * from finish();
rollback;
