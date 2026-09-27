-- A second authenticated user cannot read or write another company's rows.
-- Runs under `supabase test db`, which installs the `tests` helpers.

begin;

select plan(16);

select tests.create_supabase_user('owner_a');
select tests.create_supabase_user('owner_b');

select tests.authenticate_as('owner_a');

insert into public.companies (name, tax_id)
values ('אלפא שיפוצים', '500000001');

create temp table flow_ids as
select id as company_id
from public.companies
where name = 'אלפא שיפוצים';

select is(
  (select count(*)::int from public.categories),
  9,
  'a new company seeds 7 expense categories and 2 income categories'
);

select is(
  (select count(*)::int from public.categories where kind = 'expense' and is_default),
  7,
  'seven default expense categories'
);

insert into public.projects (company_id, name, state_label)
select company_id, 'שיפוץ הרצל 12', 'פעיל'
from flow_ids;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, external_id, idempotency_key, description
)
select
  company_id, 'expense', 'expense', 'project',
  2596000, 2200000, 396000, 'assumed',
  '2026-04-12', '2026-04-12', 'sumit', '2389941435', 'sumit:2389941435',
  'בלוקים'
from flow_ids;

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
)
select
  company_id, 2389917160,
  '\x0011'::bytea, '\x00112233445566778899aabb'::bytea,
  '\x00ff'::bytea, '\xff00112233445566778899aa'::bytea,
  'SUMIT_KEK_v1'
from flow_ids;

insert into public.audit_log (company_id, actor_id, action, entity)
select company_id, auth.uid(), 'seed', 'company'
from flow_ids;

select is(
  (select count(*)::int from public.projects),
  1,
  'owner can read their project'
);

select tests.authenticate_as('owner_b');

select is(
  (select count(*)::int from public.companies),
  0,
  'second user cannot read the company'
);

select is(
  (select count(*)::int from public.projects),
  0,
  'second user cannot read projects'
);

select is(
  (select count(*)::int from public.categories),
  0,
  'second user cannot read categories'
);

select is(
  (select count(*)::int from public.transactions),
  0,
  'second user cannot read transactions'
);

select is(
  (select count(*)::int from public.sumit_connections),
  0,
  'second user cannot read SUMIT ciphertext'
);

select is(
  (select count(*)::int from public.audit_log),
  0,
  'second user cannot read the audit log'
);

select is(
  (
    with updated as (
      update public.companies set name = 'נגנב' returning id
    )
    select count(*)::int from updated
  ),
  0,
  'second user cannot update the company'
);

select throws_ok(
  $$insert into public.projects (company_id, name)
    select company_id, 'פרויקט גנוב' from flow_ids$$,
  '42501',
  'second user cannot insert a project'
);

select throws_ok(
  $$insert into public.transactions (
      company_id, direction, doc_kind,
      amount_gross, amount_net, vat_amount, vat_status,
      doc_date, source, idempotency_key, description
    )
    select company_id, 'expense', 'expense',
      100, 100, 0, 'unknown',
      '2026-09-01', 'manual', 'stolen', 'גנוב'
    from flow_ids$$,
  '42501',
  'second user cannot insert a transaction'
);

select throws_ok(
  $$insert into public.sumit_connections (
      company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
    )
    select company_id, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, '\x04'::bytea, 'SUMIT_KEK_v1'
    from flow_ids$$,
  '42501',
  'second user cannot write a SUMIT connection'
);

select throws_ok(
  $$insert into public.audit_log (company_id, actor_id, action, entity)
    select company_id, auth.uid(), 'tamper', 'company' from flow_ids$$,
  '42501',
  'second user cannot append to the audit log'
);

select tests.authenticate_as('owner_a');

select is(
  (select name from public.companies),
  'אלפא שיפוצים',
  'the company name is unchanged after the other user tried to write'
);

select is(
  (select count(*)::int from public.projects),
  1,
  'the original project is still the only one'
);

select * from finish();

rollback;
