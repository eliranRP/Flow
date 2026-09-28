-- Owner isolation, anon denial, and same-company foreign keys.
-- Helpers come from supabase/tests/helpers.sql, loaded on `supabase db start`.

begin;

select plan(83);

do $users$
begin
  perform tests.create_supabase_user('owner_a');
  perform tests.create_supabase_user('owner_b');
end
$users$;

insert into public.companies (owner_id, name, tax_id)
values (tests.get_supabase_uid('owner_a'), 'אלפא שיפוצים', '500000001');

create temp table flow_a as
select
  c.id as company_id,
  c.owner_id,
  (select p.id from public.projects p where p.company_id = c.id limit 1) as project_id,
  (select id from public.customers where company_id = c.id limit 1) as customer_id,
  (select id from public.suppliers where company_id = c.id limit 1) as supplier_id,
  (select id from public.categories where company_id = c.id limit 1) as category_id,
  (select id from public.transactions where company_id = c.id limit 1) as transaction_id
from public.companies c
where c.name = 'אלפא שיפוצים';

insert into public.projects (company_id, name, state_label)
select company_id, 'שיפוץ הרצל 12', 'פעיל' from flow_a;

update flow_a set project_id = (select id from public.projects where name = 'שיפוץ הרצל 12');

insert into public.customers (company_id, name)
select company_id, 'לקוח א' from flow_a;
update flow_a set customer_id = (select id from public.customers where name = 'לקוח א');

insert into public.suppliers (company_id, name)
select company_id, 'ספק א' from flow_a;
update flow_a set supplier_id = (select id from public.suppliers where name = 'ספק א');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, external_id, idempotency_key,
  project_id, description
)
select
  company_id, 'expense', 'expense', 'project',
  -2596000, -2200000, -396000, 'assumed',
  '2026-04-12', '2026-04-12', 'sumit', '2389941435', 'sumit:2389941435',
  project_id, 'בלוקים'
from flow_a;
update flow_a set transaction_id = (
  select id from public.transactions where idempotency_key = 'sumit:2389941435'
);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select company_id, transaction_id, project_id, 10000, -2200000 from flow_a;

insert into public.split_rules (company_id, supplier_id, method, label)
select company_id, supplier_id, 'worker_days', 'ימי עבודה' from flow_a;

alter table flow_a add column rule_id uuid;
alter table flow_a add column spare_project_id uuid;
update flow_a set rule_id = (
  select id from public.split_rules where label = 'ימי עבודה'
);

insert into public.split_rule_targets (company_id, rule_id, project_id, month, share_bp)
select a.company_id, r.id, a.project_id, '2026-04-01', 10000
from flow_a a
join public.split_rules r on r.company_id = a.company_id;

insert into public.review_queue (company_id, transaction_id, reason)
select company_id, transaction_id, 'ניחוש' from flow_a;

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
)
select
  company_id, 2389917160,
  '\x0011'::bytea, '\x00112233445566778899aabb'::bytea,
  '\x00ff'::bytea, '\xff00112233445566778899aa'::bytea,
  'SUMIT_KEK_v1'
from flow_a;

grant all on flow_a to authenticated, anon;

select is(
  (select count(*)::int from public.categories),
  9,
  'a new company seeds 7 expense categories and 2 income categories'
);

select tests.authenticate_as('owner_a');

select is((select count(*)::int from public.companies), 1, 'owner can read their company');
select is((select count(*)::int from public.projects), 1, 'owner can read their project');
select is((select count(*)::int from public.categories), 9, 'owner can read categories');
select is((select count(*)::int from public.transactions), 1, 'owner can read transactions');
select is(
  (select connected from public.sumit_connection_status),
  true,
  'owner can see the SUMIT connection status'
);
select throws_ok(
  $$select key_ciphertext from public.sumit_connections$$,
  '42501',
  NULL,
  'owner cannot read SUMIT ciphertext'
);
select throws_ok(
  $$insert into public.sumit_connections (
      company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
    )
    select company_id, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, 'SUMIT_KEK_v1'
    from flow_a$$,
  '42501',
  NULL,
  'owner cannot write a SUMIT connection'
);
select throws_ok(
  $$insert into public.audit_log (company_id, actor_id, action, entity)
    select company_id, owner_id, 'tamper', 'company' from flow_a$$,
  '42501',
  NULL,
  'owner cannot forge an audit row'
);

update public.companies set name = 'אלפא אחרי';

select is(
  (select count(*)::int from public.audit_log where action = 'update' and entity = 'companies'),
  1,
  'updating the company writes an audit row'
);

select tests.authenticate_as('owner_b');

select is((select count(*)::int from public.companies), 0, 'second user cannot read the company');
select is((select count(*)::int from public.categories), 0, 'second user cannot read categories');
select is((select count(*)::int from public.projects), 0, 'second user cannot read projects');
select is((select count(*)::int from public.customers), 0, 'second user cannot read customers');
select is((select count(*)::int from public.suppliers), 0, 'second user cannot read suppliers');
select is((select count(*)::int from public.transactions), 0, 'second user cannot read transactions');
select is((select count(*)::int from public.allocations), 0, 'second user cannot read allocations');
select is((select count(*)::int from public.split_rules), 0, 'second user cannot read split rules');
select is((select count(*)::int from public.split_rule_targets), 0, 'second user cannot read split targets');
select is((select count(*)::int from public.overhead), 0, 'second user cannot read overhead');
select is((select count(*)::int from public.review_queue), 0, 'second user cannot read the review queue');
select is((select count(*)::int from public.sumit_connections), 0, 'second user cannot read SUMIT rows');
select is((select count(*)::int from public.sumit_connection_status), 0, 'second user cannot read SUMIT status');
select is((select count(*)::int from public.audit_log), 0, 'second user cannot read the audit log');

with u as (update public.companies set name = 'נגנב' returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update the company');
with u as (update public.projects set name = 'נגנב' returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update projects');
with u as (update public.transactions set description = 'נגנב' returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update transactions');
with u as (update public.customers set name = 'נגנב' returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update customers');
with u as (update public.suppliers set name = 'נגנב' returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update suppliers');
with u as (update public.categories set hidden = true returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update categories');
with u as (update public.allocations set share_bp = 1 returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update allocations');
with u as (update public.split_rules set label = 'נגנב' returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update split rules');
with u as (update public.split_rule_targets set share_bp = 1 returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update split targets');
with u as (update public.overhead set updated_at = now() returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update overhead');
with u as (update public.review_queue set reason = 'נגנב' returning 1)
select is((select count(*)::int from u), 0, 'second user cannot update the review queue');
with u as (delete from public.projects returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete projects');
with u as (delete from public.customers returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete customers');
with u as (delete from public.suppliers returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete suppliers');
with u as (delete from public.categories returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete categories');
with u as (delete from public.transactions returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete transactions');
with u as (delete from public.allocations returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete allocations');
with u as (delete from public.split_rules returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete split rules');
with u as (delete from public.split_rule_targets returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete split targets');
with u as (delete from public.review_queue returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete the review queue');
with u as (delete from public.companies returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete the company');

select throws_ok(
  $$insert into public.projects (company_id, name)
    select company_id, 'פרויקט גנוב' from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert a project into the other company'
);
select throws_ok(
  $$insert into public.transactions (
      company_id, direction, doc_kind,
      amount_gross, amount_net, vat_amount, vat_status,
      doc_date, source, idempotency_key, description
    )
    select company_id, 'expense', 'expense', 100, 100, 0, 'unknown',
      '2026-09-01', 'manual', 'stolen', 'גנוב'
    from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert a transaction'
);
select throws_ok(
  $$insert into public.customers (company_id, name)
    select company_id, 'לקוח גנוב' from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert a customer'
);
select throws_ok(
  $$insert into public.suppliers (company_id, name)
    select company_id, 'ספק גנוב' from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert a supplier'
);
select throws_ok(
  $$insert into public.categories (company_id, name, kind, sort_order)
    select company_id, 'גנוב', 'expense', 99 from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert a category'
);
select throws_ok(
  $$insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    select company_id, transaction_id, project_id, 10000, 1 from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert an allocation'
);
select throws_ok(
  $$insert into public.split_rules (company_id, method, label)
    select company_id, 'manual', 'גנוב' from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert a split rule'
);
select throws_ok(
  $$insert into public.review_queue (company_id, reason)
    select company_id, 'גנוב' from flow_a$$,
  '42501',
  NULL,
  'second user cannot insert a review row'
);
select throws_ok(
  $$insert into public.audit_log (company_id, actor_id, action, entity)
    select company_id, auth.uid(), 'tamper', 'company' from flow_a$$,
  '42501',
  NULL,
  'second user cannot append to the audit log'
);

insert into public.companies (name) values ('בטא');

select throws_ok(
  $$insert into public.companies (name, owner_id)
    select 'גנוב', owner_id from flow_a$$,
  '42501',
  NULL,
  'cannot create a company owned by someone else'
);

insert into public.projects (company_id, name)
select id, 'פרויקט של ב' from public.companies where name = 'בטא';
insert into public.customers (company_id, name)
select id, 'לקוח של ב' from public.companies where name = 'בטא';
insert into public.suppliers (company_id, name)
select id, 'ספק של ב' from public.companies where name = 'בטא';
insert into public.categories (company_id, name, kind, sort_order)
select id, 'קטגוריה של ב', 'expense', 99 from public.companies where name = 'בטא';
insert into public.transactions (
  company_id, direction, doc_kind,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 100, 100, 0, 'unknown',
  '2026-09-02', 'manual', 'beta-move', 'תנועה של ב'
from public.companies where name = 'בטא';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select c.id, t.id, p.id, 10000, 100
from public.companies c
join public.transactions t on t.company_id = c.id and t.idempotency_key = 'beta-move'
join public.projects p on p.company_id = c.id and p.name = 'פרויקט של ב'
where c.name = 'בטא';
insert into public.split_rules (company_id, method, label)
select id, 'manual', 'כלל של ב' from public.companies where name = 'בטא';
insert into public.split_rule_targets (company_id, rule_id, project_id, share_bp)
select c.id, r.id, p.id, 10000
from public.companies c
join public.split_rules r on r.company_id = c.id and r.label = 'כלל של ב'
join public.projects p on p.company_id = c.id and p.name = 'פרויקט של ב'
where c.name = 'בטא';
insert into public.overhead (company_id, transaction_id)
select c.id, t.id
from public.companies c
join public.transactions t on t.company_id = c.id and t.idempotency_key = 'beta-move'
where c.name = 'בטא';
insert into public.review_queue (company_id, reason)
select id, 'תור של ב' from public.companies where name = 'בטא';

-- sumit_connections has no insert grant for authenticated. A spare project
-- on אלפא gives the composite foreign keys a real destination row.
reset role;
insert into public.projects (company_id, name)
select company_id, 'פרויקט פנוי' from flow_a;
update flow_a set spare_project_id = (
  select id from public.projects where name = 'פרויקט פנוי'
);
insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
)
select
  id, 1,
  '\x0011'::bytea, '\x00112233445566778899aabb'::bytea,
  '\x00ff'::bytea, '\xff00112233445566778899aa'::bytea,
  'SUMIT_KEK_v1'
from public.companies where name = 'בטא';
select tests.authenticate_as('owner_b');

select throws_ok(
  $$update public.categories
    set company_id = (select company_id from flow_a)
    where name = 'קטגוריה של ב'$$,
  '42501',
  NULL,
  'cannot move a category into another company'
);
select throws_ok(
  $$update public.projects
    set company_id = (select company_id from flow_a)
    where name = 'פרויקט של ב'$$,
  '42501',
  NULL,
  'cannot move a project into another company'
);
select throws_ok(
  $$update public.customers
    set company_id = (select company_id from flow_a)
    where name = 'לקוח של ב'$$,
  '42501',
  NULL,
  'cannot move a customer into another company'
);
select throws_ok(
  $$update public.suppliers
    set company_id = (select company_id from flow_a),
        remembered_project_id = null,
        remembered_category_id = null
    where name = 'ספק של ב'$$,
  '42501',
  NULL,
  'cannot move a supplier into another company'
);
select throws_ok(
  $$update public.transactions
    set company_id = (select company_id from flow_a),
        project_id = null,
        customer_id = null,
        supplier_id = null,
        category_id = null
    where idempotency_key = 'beta-move'$$,
  '42501',
  NULL,
  'cannot move a transaction into another company'
);
select throws_ok(
  $$update public.allocations
    set company_id = (select company_id from flow_a),
        transaction_id = (select transaction_id from flow_a),
        project_id = (select spare_project_id from flow_a)
    where transaction_id = (
      select id from public.transactions where idempotency_key = 'beta-move'
    )$$,
  '42501',
  NULL,
  'cannot move an allocation into another company'
);
select throws_ok(
  $$update public.split_rules
    set company_id = (select company_id from flow_a),
        supplier_id = null
    where label = 'כלל של ב'$$,
  '42501',
  NULL,
  'cannot move a split rule into another company'
);
select throws_ok(
  $$update public.split_rule_targets
    set company_id = (select company_id from flow_a),
        rule_id = (select rule_id from flow_a),
        project_id = (select spare_project_id from flow_a)
    where project_id = (
      select id from public.projects where name = 'פרויקט של ב'
    )$$,
  '42501',
  NULL,
  'cannot move a split target into another company'
);
select throws_ok(
  $$update public.overhead
    set company_id = (select company_id from flow_a),
        transaction_id = (select transaction_id from flow_a)
    where transaction_id = (
      select id from public.transactions where idempotency_key = 'beta-move'
    )$$,
  '42501',
  NULL,
  'cannot move an overhead row into another company'
);
select throws_ok(
  $$update public.review_queue
    set company_id = (select company_id from flow_a),
        transaction_id = null
    where reason = 'תור של ב'$$,
  '42501',
  NULL,
  'cannot move a review row into another company'
);
select throws_ok(
  $$update public.sumit_connections
    set company_id = (select company_id from flow_a)
    where company_id = (select id from public.companies where name = 'בטא')$$,
  '42501',
  NULL,
  'cannot move a SUMIT connection into another company'
);
select throws_ok(
  $$update public.audit_log
    set company_id = (select company_id from flow_a)
    where company_id = (select id from public.companies where name = 'בטא')$$,
  '42501',
  NULL,
  'cannot move an audit row into another company'
);

delete from public.overhead
where transaction_id = (
  select id from public.transactions where idempotency_key = 'beta-move'
);

select throws_ok(
  $$insert into public.overhead (company_id, transaction_id)
    select c.id, a.transaction_id
    from public.companies c
    cross join flow_a a
    where c.name = 'בטא'$$,
  '23503',
  NULL,
  'cross-tenant overhead foreign key fails'
);
select throws_ok(
  $$insert into public.suppliers (company_id, name, remembered_project_id)
    select c.id, 'ספק זר', a.project_id
    from public.companies c
    cross join flow_a a
    where c.name = 'בטא'$$,
  '23503',
  NULL,
  'cross-tenant remembered project fails'
);
select throws_ok(
  $$insert into public.transactions (
      company_id, direction, doc_kind,
      amount_gross, amount_net, vat_amount, vat_status,
      doc_date, source, idempotency_key, project_id, description
    )
    select c.id, 'expense', 'expense', 100, 100, 0, 'unknown',
      '2026-09-01', 'manual', 'cross-fk', a.project_id, 'זר'
    from public.companies c
    cross join flow_a a
    where c.name = 'בטא'$$,
  '23503',
  NULL,
  'cross-tenant transaction project fails'
);

select tests.authenticate_as('owner_a');

insert into public.overhead (company_id, transaction_id)
select company_id, transaction_id from flow_a;

select is((select count(*)::int from public.overhead), 1, 'owner can still mark their transaction as overhead');
select is((select name from public.companies), 'אלפא אחרי', 'the company name survived the other user');

select tests.authenticate_as('owner_b');
select is((select count(*)::int from public.overhead), 0, 'second user still cannot see that overhead row');
with u as (delete from public.overhead returning 1)
select is((select count(*)::int from u), 0, 'second user cannot delete overhead');

select tests.authenticate_as('owner_a');
select is((select count(*)::int from public.overhead), 1, 'the overhead row survived the other user');

select tests.clear_authentication();

select throws_ok(
  $$select * from public.companies$$,
  '42501',
  NULL,
  'anon cannot read companies'
);
select throws_ok(
  $$select * from public.transactions$$,
  '42501',
  NULL,
  'anon cannot read transactions'
);
select throws_ok(
  $$select * from public.sumit_connections$$,
  '42501',
  NULL,
  'anon cannot read SUMIT connections'
);
select throws_ok(
  $$select public.get_home()$$,
  '42501',
  NULL,
  'anon cannot call get_home'
);
select throws_ok(
  $$select private.current_company_id()$$,
  '42501',
  NULL,
  'anon cannot call private.current_company_id'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  0,
  'anon has no execute on functions in public'
);

select tests.authenticate_as('owner_a');
select lives_ok(
  $$delete from public.companies$$,
  'owner can delete their company'
);
select is((select count(*)::int from public.companies), 0, 'the company is gone after the owner deletes it');

select * from finish();

rollback;
