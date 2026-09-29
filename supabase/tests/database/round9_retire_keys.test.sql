-- A different SUMIT company must not reuse the previous company's document keys,
-- party ids, or budget section ids. The same company keeps them.

begin;

select plan(31);

do $users$
begin
  perform tests.create_supabase_user('r9k_a', 'r9k-a@test.flow');
end
$users$;

select tests.authenticate_as('r9k_a');
select lives_ok($$select public.create_company('סבב 9 מפתחות', true)$$, 'owner creates a company');

create temp table r9k (label text primary key, id uuid);
grant all on r9k to authenticated, service_role;
insert into r9k (label, id) select 'company', id from public.companies where name = 'סבב 9 מפתחות';
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r9k (label, id) select 'alpha', id from public.projects where name = 'אלפא';
insert into r9k (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;
update public.projects
set sumit_budget_section_id = 42
where id = (select id from r9k where label = 'alpha');
insert into public.suppliers (company_id, name, sumit_external_id, remembered_category_id)
select id, 'ספק ישן', 7, (select id from r9k where label = 'haul')
from r9k where label = 'company';
insert into r9k (label, id) select 'supplier', id from public.suppliers where name = 'ספק ישן';
insert into public.customers (company_id, name, sumit_external_id)
select id, 'לקוח ישן', 7
from r9k where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, external_id,
  project_id, category_id, user_assigned, description
)
select id, 'expense', 'expense', 'project', -1000, -1000, 0, 'unknown',
  '2026-09-01', 'sumit', 'sumit:50', '50',
  (select id from r9k where label = 'alpha'),
  (select id from r9k where label = 'haul'),
  true, 'מסמך ישן'
from r9k where label = 'company';
insert into r9k (label, id)
select 'old', id from public.transactions where idempotency_key = 'sumit:50';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from r9k where label = 'company'), id,
  (select id from r9k where label = 'alpha'), 10000, -1000
from r9k where label = 'old';
insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from r9k where label = 'company'), id, 'open', 'missing_project'
from r9k where label = 'old';
insert into r9k (label, id)
select 'review', id from public.review_queue
where transaction_id = (select id from r9k where label = 'old');

insert into public.transactions (
  company_id, direction, doc_kind,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', -500, -500, 0, 'unknown',
  '2026-09-02', 'manual', 'r9k:manual', 'ידני'
from r9k where label = 'company';

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 100, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from r9k where label = 'company';

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 100, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true)$$,
    (select id from r9k where label = 'company')
  ),
  'reconnecting the same SUMIT company keeps the ledger'
);
select is(
  (select idempotency_key from public.transactions where id = (select id from r9k where label = 'old')),
  'sumit:50',
  'the same company keeps the document key'
);
select is(
  (select removed_at is null from public.transactions where id = (select id from r9k where label = 'old')),
  true,
  'the same company does not retire the row'
);
select is(
  (select sumit_budget_section_id from public.projects where id = (select id from r9k where label = 'alpha')),
  42::bigint,
  'the same company keeps the budget section id'
);
select is(
  (select sumit_external_id from public.suppliers where id = (select id from r9k where label = 'supplier')),
  7::bigint,
  'the same company keeps the supplier id'
);
select is(
  (select status::text from public.review_queue where id = (select id from r9k where label = 'review')),
  'open',
  'the same company leaves the open review'
);

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 200, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true)$$,
    (select id from r9k where label = 'company')
  ),
  'a different SUMIT company retires the ledger and releases its ids'
);
select is(
  (select removed_at is null from public.transactions where id = (select id from r9k where label = 'old')),
  false,
  'the previous document is retired'
);
select is(
  (select idempotency_key = 'sumit:50' from public.transactions where id = (select id from r9k where label = 'old')),
  false,
  'the retired document frees its idempotency key'
);
select is(
  (select external_id = '50' from public.transactions where id = (select id from r9k where label = 'old')),
  false,
  'the retired document frees its external id'
);
select is(
  (select user_assigned from public.transactions where id = (select id from r9k where label = 'old')),
  true,
  'the retired document keeps the owner assignment'
);
select is(
  (select project_id from public.transactions where id = (select id from r9k where label = 'old')),
  (select id from r9k where label = 'alpha'),
  'the retired document stays on its project'
);
select is(
  (select status::text from public.review_queue where id = (select id from r9k where label = 'review')),
  'skipped',
  'the open review on the retired document is skipped'
);
select is(
  (select sumit_budget_section_id from public.projects where id = (select id from r9k where label = 'alpha')),
  null,
  'the previous budget section id is cleared'
);
select is(
  (select sumit_external_id from public.suppliers where id = (select id from r9k where label = 'supplier')),
  null,
  'the previous supplier id is cleared'
);
select is(
  (select remembered_category_id from public.suppliers where id = (select id from r9k where label = 'supplier')),
  (select id from r9k where label = 'haul'),
  'the supplier and its remembered category stay'
);
select is(
  (select sumit_external_id from public.customers where name = 'לקוח ישן'),
  null,
  'the previous customer id is cleared'
);
select is(
  (select removed_at is null from public.transactions where idempotency_key = 'r9k:manual'),
  true,
  'a manual row stays'
);

select is(
  public.upsert_sumit_documents(
    (select id from r9k where label = 'company'),
    jsonb_build_array(jsonb_build_object(
      'idempotency_key', 'sumit:50',
      'external_id', '50',
      'direction', 'expense',
      'doc_kind', 'expense',
      'pnl_role', 'project',
      'amount_gross', '-2000',
      'amount_net', '-2000',
      'vat_amount', '0',
      'vat_status', 'derived',
      'doc_date', '2026-09-20',
      'description', 'מסמך חדש',
      'budget_section_id', '42',
      'budget_section_name', 'שם חדש',
      'party_name', 'ספק חדש',
      'party_kind', 'supplier',
      'party_external_id', '7'
    ))
  ),
  1,
  'the next company can save document 50 and supplier 7'
);
select is(
  (select id = (select id from r9k where label = 'old')
    from public.transactions where idempotency_key = 'sumit:50'),
  false,
  'document 50 is a new row'
);
select is(
  (select user_assigned from public.transactions where idempotency_key = 'sumit:50'),
  false,
  'the new document is not already assigned'
);
select is(
  (select project_id = (select id from r9k where label = 'alpha')
    from public.transactions where idempotency_key = 'sumit:50'),
  false,
  'the new document is not filed on the previous project'
);
select is(
  (select name from public.projects where sumit_budget_section_id = 42),
  'שם חדש',
  'section 42 belongs to the new project'
);
select is(
  (select amount_net from public.transactions where id = (select id from r9k where label = 'old')),
  -1000::bigint,
  'the retired document keeps its amount'
);
select is(
  (select count(*)::int from public.allocations
    where transaction_id = (select id from r9k where label = 'old')
      and project_id = (select id from r9k where label = 'alpha')),
  1,
  'the retired allocation stays on the old project'
);
select is(
  (select sumit_external_id from public.suppliers where name = 'ספק חדש'),
  7::bigint,
  'the new supplier can use the released id'
);

select lives_ok(
  format(
    $$select public.replace_sumit_connection(%L::uuid, 100, '\x01', '\x0201', '\x03', '\x0401', '1', '2', true)$$,
    (select id from r9k where label = 'company')
  ),
  'switching back retires the second ledger without a key collision'
);
select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r9k where label = 'company')
      and source = 'sumit'
      and removed_at is null),
  0,
  'both SUMIT ledgers are retired'
);
select is(
  (select count(*)::int from public.transactions
    where idempotency_key like 'sumit:50:retired:%'),
  2,
  'each retired copy keeps its own key'
);

select * from finish();
rollback;
