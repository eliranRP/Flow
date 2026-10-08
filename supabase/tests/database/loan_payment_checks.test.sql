-- FLOW-111: loan writes refuse a payment below the interest, update_loan input rules,
-- attach_loan_payment part rules, the app split balance check, loan_split undo after an
-- app correction, and the capped currency default. Fixed dates. @example.com only.

begin;

select plan(36);

do $users$
begin
  perform tests.create_supabase_user('f111_owner', 'owner111@example.com');
end
$users$;

create temp table f111 (label text primary key, id uuid);
grant all on f111 to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('f111_owner');
  select id into tid from pg_temp.f111 where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

select tests.authenticate_as('f111_owner');
select public.create_company('Example Loan Checks Co', true);
reset role;
insert into f111 (label, id) select 'company', id from public.companies where name = 'Example Loan Checks Co';

select public.store_mcp_credential(
  tests.get_supabase_uid('f111_owner'), 'hash-f111-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f111 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f111-write-1';

-- 120,000.00 at 6 percent: month-one interest is 600.00.
select pg_temp.as_mcp('write');
insert into f111 (label, id)
select 'loan', (
  public.mcp_add_loan('f111-add', 'Example Bank', 12000000, 60000, 360, '2026-01-01'::date, 100000, 10000, 'USD')->'data'->>'id'
)::uuid;

-- Payment below the interest.

select is(
  public.mcp_update_loan('f111-low-pay', (select id from f111 where label = 'loan'), '{"payment_minor": 50000}'::jsonb)->'error',
  '{"code": "refused", "message": "payment below interest"}'::jsonb,
  'a payment below the interest is refused with a fixed message'
);
select is(
  (select payment_minor from public.loans where id = (select id from f111 where label = 'loan')),
  100000::bigint,
  'the refused payment is not stored'
);
select is(
  public.mcp_update_loan('f111-high-rate', (select id from f111 where label = 'loan'), '{"annual_rate_ppm": 100000}'::jsonb)->'error'->>'message',
  'payment below interest',
  'a higher rate that the payment no longer covers is refused'
);
select is(
  public.mcp_update_loan('f111-escrow', (select id from f111 where label = 'loan'), '{"escrow_minor": 45000}'::jsonb)->'error'->>'message',
  'payment below interest',
  'escrow that leaves too little for interest is refused'
);
select is(
  public.mcp_update_loan('f111-exact', (select id from f111 where label = 'loan'), '{"payment_minor": 70000}'::jsonb)->'ok',
  'true'::jsonb,
  'a payment that exactly covers interest and escrow is accepted'
);
select is(
  public.mcp_update_loan('f111-low-pay', (select id from f111 where label = 'loan'), '{"payment_minor": 50000}'::jsonb)->'error'->>'message',
  'payment below interest',
  'the refusal replays under the same key'
);
select is(
  public.mcp_update_loan('f111-bad-terms', (select id from f111 where label = 'loan'), '{"escrow_minor": 70000}'::jsonb)->'error'->>'message',
  'invalid loan terms',
  'other bad terms keep the general refusal'
);

-- The app writes loans directly. The same rule holds there.
-- discard plans: the trigger's plan cached under the definer above would hide a missing grant.
discard plans;
select tests.authenticate_as('f111_owner');
select throws_ok(
  $$
    insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
    values ((select id from f111 where label = 'company'), 'Example Low', 12000000, 60000, 360, '2026-01-01', 50000, 0, 'USD')
  $$,
  '23514',
  'loan_payment_below_interest',
  'the app cannot save a payment below the interest'
);
select lives_ok(
  $$
    insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
    values ((select id from f111 where label = 'company'), 'Example Interest Only', 12000000, 60000, 360, '2026-01-01', 60000, 0, 'USD')
  $$,
  'an interest-only payment saves'
);
reset role;

-- A row saved before this check can still be renamed.
alter table public.loans disable trigger loans_payment_covers_interest;
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
values ((select id from f111 where label = 'company'), 'Example Legacy', 12000000, 60000, 360, '2026-01-01', 1000, 0, 'USD');
alter table public.loans enable trigger loans_payment_covers_interest;
insert into f111 (label, id) select 'legacy', id from public.loans where name = 'Example Legacy';

select pg_temp.as_mcp('write');
select is(
  public.mcp_update_loan('f111-legacy-name', (select id from f111 where label = 'legacy'), '{"name": "Example Legacy Renamed"}'::jsonb)->'ok',
  'true'::jsonb,
  'a name-only edit of an older low-payment loan saves'
);
select is(
  public.mcp_update_loan('f111-legacy-fix', (select id from f111 where label = 'legacy'), '{"payment_minor": 80000}'::jsonb)->'ok',
  'true'::jsonb,
  'raising the payment above the interest saves'
);
select is(
  public.mcp_undo('f111-legacy-undo', 'loan_update', (select id from f111 where label = 'legacy'))->'error'->>'message',
  'payment below interest',
  'undo that would restore a payment below the interest is refused by name'
);
select is(
  (select payment_minor from public.loans where id = (select id from f111 where label = 'legacy')),
  80000::bigint,
  'the refused undo keeps the raised payment'
);

-- Name and nulls.

select is(
  public.mcp_update_loan('f111-trim', (select id from f111 where label = 'loan'), '{"name": "  Example Trimmed  "}'::jsonb)->'ok',
  'true'::jsonb,
  'a padded name saves'
);
select is(
  (select name from public.loans where id = (select id from f111 where label = 'loan')),
  'Example Trimmed',
  'the name is stored trimmed'
);
select is(
  public.mcp_update_loan('f111-blank', (select id from f111 where label = 'loan'), '{"name": "   "}'::jsonb)->'error'->>'message',
  'invalid loan terms',
  'a blank name is refused'
);
select is(
  public.mcp_update_loan('f111-null-name', (select id from f111 where label = 'loan'), '{"name": null}'::jsonb)->'error'->>'code',
  'validation',
  'an explicit null name is a validation error'
);
select is(
  public.mcp_update_loan('f111-null-pay', (select id from f111 where label = 'loan'), '{"payment_minor": null, "name": "Example X"}'::jsonb)->'error'->>'code',
  'validation',
  'an explicit null amount is a validation error'
);
select is(
  public.mcp_update_loan('f111-empty', (select id from f111 where label = 'loan'), '{}'::jsonb)->'error'->>'code',
  'validation',
  'an empty patch is a validation error'
);
reset role;
select is(
  (select count(*)::int from private.mcp_writes w where w.kind = 'loan_update' and w.loan_id = (select id from f111 where label = 'loan')),
  2,
  'refused edits log no undo entry'
);

-- Bad parts.

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', -70000, -70000, 70000, 0, 'unknown',
  '2026-01-01', 'USD', 'manual', 'f111:pay', 'Example payment'
from f111 c where c.label = 'company';
insert into f111 (label, id) select 'txn', id from public.transactions where idempotency_key = 'f111:pay';

select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment('f111-parts-missing', (select id from f111 where label = 'txn'), (select id from f111 where label = 'loan'),
    '[{"part": "interest", "amount_minor": 60000, "scheduled_minor": 60000},
      {"part": "principal", "amount_minor": 10000, "scheduled_minor": 10000}]'::jsonb)->'error'->>'message',
  'invalid loan parts',
  'a missing part is refused by name'
);
select is(
  public.mcp_attach_loan_payment('f111-parts-dup', (select id from f111 where label = 'txn'), (select id from f111 where label = 'loan'),
    '[{"part": "interest", "amount_minor": 60000, "scheduled_minor": 60000},
      {"part": "interest", "amount_minor": 0, "scheduled_minor": 0},
      {"part": "principal", "amount_minor": 10000, "scheduled_minor": 10000}]'::jsonb)->'error'->>'message',
  'invalid loan parts',
  'a repeated part is refused by name'
);
select is(
  public.mcp_attach_loan_payment('f111-parts-neg', (select id from f111 where label = 'txn'), (select id from f111 where label = 'loan'),
    '[{"part": "interest", "amount_minor": 80000, "scheduled_minor": 60000},
      {"part": "escrow", "amount_minor": -10000, "scheduled_minor": 0},
      {"part": "principal", "amount_minor": 0, "scheduled_minor": 10000}]'::jsonb)->'error'->>'message',
  'invalid loan parts',
  'a negative part is refused by name'
);
select is(
  public.mcp_attach_loan_payment('f111-parts-text', (select id from f111 where label = 'txn'), (select id from f111 where label = 'loan'),
    '[{"part": "interest", "amount_minor": "60000", "scheduled_minor": 60000},
      {"part": "escrow", "amount_minor": 0, "scheduled_minor": 0},
      {"part": "principal", "amount_minor": 10000, "scheduled_minor": 10000}]'::jsonb)->'error'->>'message',
  'invalid loan parts',
  'a part amount that is not a number is refused by name'
);
select is(
  public.mcp_attach_loan_payment('f111-parts-sum', (select id from f111 where label = 'txn'), (select id from f111 where label = 'loan'),
    '[{"part": "interest", "amount_minor": 60000, "scheduled_minor": 60000},
      {"part": "escrow", "amount_minor": 0, "scheduled_minor": 0},
      {"part": "principal", "amount_minor": 1, "scheduled_minor": 10000}]'::jsonb)->'error'->>'message',
  'invalid loan parts',
  'parts that do not sum to the line are refused by name'
);
select is(
  public.mcp_attach_loan_payment('f111-parts-no-scheduled', (select id from f111 where label = 'txn'), (select id from f111 where label = 'loan'),
    '[{"part": "interest", "amount_minor": 60000},
      {"part": "escrow", "amount_minor": 0, "scheduled_minor": 0},
      {"part": "principal", "amount_minor": 10000, "scheduled_minor": 10000}]'::jsonb)->'error'->>'message',
  'invalid loan parts',
  'a part without scheduled_minor is refused by name'
);
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from f111 where label = 'txn')),
  0,
  'refused parts write nothing'
);

-- Undo after an app correction.

select is(
  public.mcp_attach_loan_payment('f111-attach', (select id from f111 where label = 'txn'), (select id from f111 where label = 'loan'),
    '[{"part": "interest", "amount_minor": 60000, "scheduled_minor": 60000},
      {"part": "escrow", "amount_minor": 0, "scheduled_minor": 0},
      {"part": "principal", "amount_minor": 10000, "scheduled_minor": 10000}]'::jsonb)->'data'->>'undo_kind',
  'loan_split',
  'valid parts attach'
);

select tests.authenticate_as('f111_owner');
update public.loan_splits set amount_minor = 55000
where transaction_id = (select id from f111 where label = 'txn') and part = 'interest';
update public.loan_splits set amount_minor = 15000
where transaction_id = (select id from f111 where label = 'txn') and part = 'principal';

select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('f111-undo-corrected', 'loan_split', (select id from f111 where label = 'txn'))->'error'->>'code',
  'conflict',
  'undo refuses a split the app corrected afterwards'
);
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from f111 where label = 'txn')),
  3,
  'the corrected split stays'
);

select tests.authenticate_as('f111_owner');
update public.loan_splits set amount_minor = 60000
where transaction_id = (select id from f111 where label = 'txn') and part = 'interest';
update public.loan_splits set amount_minor = 10000
where transaction_id = (select id from f111 where label = 'txn') and part = 'principal';

-- An undo row written before the parts were kept falls back to updated_at.
reset role;
update private.mcp_writes set prior = null, created_at = now() - interval '1 minute'
where kind = 'loan_split' and transaction_id = (select id from f111 where label = 'txn');

select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('f111-undo-legacy', 'loan_split', (select id from f111 where label = 'txn'))->'error'->>'code',
  'conflict',
  'an older undo row refuses once the parts were touched later'
);

reset role;
update private.mcp_writes set prior = jsonb_build_object('parts', (
  select jsonb_agg(jsonb_build_object('part', s.part, 'amount_minor', s.amount_minor, 'category_id', s.category_id) order by s.part)
  from public.loan_splits s where s.transaction_id = (select id from f111 where label = 'txn')
))
where kind = 'loan_split' and transaction_id = (select id from f111 where label = 'txn');

select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('f111-undo-same', 'loan_split', (select id from f111 where label = 'txn'))->'data'->>'kind',
  'loan_split',
  'undo succeeds when the parts are back to what the MCP wrote'
);

-- The app split path cannot take the balance below zero.

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', 'posted', -13000000, -13000000, 13000000, 0, 'unknown',
  '2026-01-01', 'USD', 'manual', 'f111:big', 'Example large payment'
from f111 c where c.label = 'company';

select tests.authenticate_as('f111_owner');
select throws_ok(
  $$
    insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
    select t.company_id, (select id from f111 where label = 'loan'), t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.transactions t
    cross join (values
      ('interest', 'ריבית משכנתא', 0),
      ('escrow', 'מסים וביטוח', 0),
      ('principal', 'תשלומי הלוואה', 13000000)
    ) as v(part, category, amount)
    join public.categories c on c.company_id = t.company_id and c.name = v.category and c.kind = 'expense'
    where t.idempotency_key = 'f111:big';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_balance',
  'an app split past the principal is refused'
);
reset role;
update public.transactions set amount_gross = -12000000, amount_net = -12000000, amount_original = 12000000
where idempotency_key = 'f111:big';
select tests.authenticate_as('f111_owner');
select lives_ok(
  $$
    insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
    select t.company_id, (select id from f111 where label = 'loan'), t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.transactions t
    cross join (values
      ('interest', 'ריבית משכנתא', 0),
      ('escrow', 'מסים וביטוח', 0),
      ('principal', 'תשלומי הלוואה', 12000000)
    ) as v(part, category, amount)
    join public.categories c on c.company_id = t.company_id and c.name = v.category and c.kind = 'expense'
    where t.idempotency_key = 'f111:big';
    set constraints all immediate;
  $$,
  'an app split that pays the balance down to exactly zero saves'
);
reset role;

-- The currency default is the stored company currency (FLOW-504, decision 0146), not a guess
-- from the lines: an ILS line does not change it.

insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', -100, -100, 100, 0, 'unknown',
  '2026-04-01', 'ILS', 'manual', 'f111:new-ils', 'Example new line'
from f111 c where c.label = 'company';
update public.companies set base_currency = 'USD' where id = (select id from f111 where label = 'company');

select pg_temp.as_mcp('write');
select is(public.mcp_company_loan_currency(), 'USD', 'the stored company currency is the loan default');

reset role;
update public.companies set base_currency = 'ILS' where id = (select id from f111 where label = 'company');
select pg_temp.as_mcp('write');
select is(public.mcp_company_loan_currency(), 'ILS', 'changing the company currency changes the default');

select * from finish();

rollback;
