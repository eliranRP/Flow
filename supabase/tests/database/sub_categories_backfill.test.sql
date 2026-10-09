-- FLOW-406 server 1a (decision 0164): the group_name backfill. Groups are set with the parent
-- triggers off, as before the migration; the backfill runs; the company totals don't move.
-- Invented data only.

begin;

select plan(11);

select tests.create_supabase_user('bf_owner', 'bf-owner@example.com');
create temp table bf (label text primary key, id uuid);
grant all on bf to authenticated, service_role;
create temp table bf_tot (label text primary key, body jsonb);

select tests.authenticate_as('bf_owner');
do $c$ begin perform public.create_company('Backfill Books', true); end $c$;
do $p$ begin perform public.upsert_project(null, 'Site Bravo', null, 'active'); end $p$;
insert into bf (label, id) select 'co', id from public.companies where name = 'Backfill Books';
insert into bf (label, id) select 'proj', id from public.projects where name = 'Site Bravo';
insert into bf (label, id) values
  ('bills', public.create_category('Bills', 'expense')),
  ('water', public.create_category('Water', 'expense')),
  ('power', public.create_category('Power', 'expense')),
  ('fees', public.create_category('Fees', 'expense')),
  ('rent_in', public.create_category('Rent In', 'income'));
insert into bf (label, id) select 'loan_cat', c.id from public.categories c
where c.company_id = (select id from bf where label = 'co') and c.loan_part = 'interest';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from bf where label = 'co'),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role, 'posted', 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source', v.d::date, v.d::date, 'manual', v.ikey,
  (select id from bf where label = 'proj'), (select id from bf where label = v.cat), v.ikey
from (values
  ('income',  'receipt', null,      90000, '2026-06-01', 'bf:rent',  'rent_in'),
  ('expense', 'expense', 'project', -12000, '2026-06-02', 'bf:bills', 'bills'),
  ('expense', 'expense', 'project', -8000,  '2026-06-03', 'bf:water', 'water'),
  ('expense', 'expense', 'project', -5000,  '2026-06-04', 'bf:power', 'power'),
  ('expense', 'expense', 'project', -3000,  '2026-06-05', 'bf:fees',  'fees'),
  ('expense', 'expense', 'project', -4000,  '2026-06-06', 'bf:loan',  'loan_cat')
) as v(direction, doc_kind, pnl_role, amount, d, ikey, cat);

insert into bf_tot (label, body) values
  ('invoiced', public.company_pnl((select id from bf where label = 'co'), null, null, 'invoiced')),
  ('cash', public.company_pnl((select id from bf where label = 'co'), null, null, 'cash'));

-- Groups as an older build left them, with the parent triggers off.
alter table public.categories disable trigger categories_parent_a_sync;
alter table public.categories disable trigger categories_parent_b_check;
update public.categories c set group_name = v.g
from (values
  ('water', 'Bills'),      -- names a category that has lines: it becomes the parent
  ('power', 'Utilities'),  -- names no category: a new one is made
  ('bills', 'Utilities'),  -- Bills leads its own group, so it stays top level
  ('rent_in', 'Utilities'),-- an income category: its own income parent
  ('fees', 'Interest'),    -- the loan interest category's name: left ungrouped
  ('loan_cat', 'Utilities')-- a loan part never gets a parent
) as v(label, g)
where c.id = (select id from bf where label = v.label);
update public.categories c set name = 'Interest'
where c.id = (select id from bf where label = 'loan_cat');
select private.backfill_category_parents();
alter table public.categories enable trigger categories_parent_a_sync;
alter table public.categories enable trigger categories_parent_b_check;

create function pg_temp.parent_name(p_label text) returns text language sql stable as $$
  select p.name from public.categories c join public.categories p on p.id = c.parent_id
  where c.id = (select id from bf where label = p_label);
$$;

select is(pg_temp.parent_name('water'), 'Bills', 'a group named after a category goes under that category');
select is(pg_temp.parent_name('bills'), null, 'a category that leads a group stays top level');
select is(pg_temp.parent_name('power'), 'Utilities', 'a new group name becomes a parent');
select is(
  (select jsonb_build_object('rehab', c.rehab, 'default', c.is_default, 'hidden', c.hidden)
   from public.categories c
   where c.company_id = (select id from bf where label = 'co') and c.name = 'Utilities' and c.kind = 'expense'),
  jsonb_build_object('rehab', false, 'default', false, 'hidden', false),
  'the made parent is not rehab, not a default and not hidden'
);
select is(
  (select p.kind::text from public.categories c join public.categories p on p.id = c.parent_id
   where c.id = (select id from bf where label = 'rent_in')),
  'income',
  'an income member gets an income parent of the same name'
);
select is(pg_temp.parent_name('fees'), null, 'a group named after a loan category is left ungrouped');
select is(pg_temp.parent_name('loan_cat'), null, 'a loan category gets no parent');
select is(
  (select count(*)::int from public.categories c
   where c.company_id = (select id from bf where label = 'co') and c.group_name is distinct from
     (select p.name from public.categories p where p.id = c.parent_id)),
  0,
  'every label matches its parent, and no label is left without one'
);
select is(
  public.company_pnl((select id from bf where label = 'co'), null, null, 'invoiced'),
  (select body from bf_tot where label = 'invoiced'),
  'the invoiced totals are the same after the backfill'
);
select is(
  public.company_pnl((select id from bf where label = 'co'), null, null, 'cash'),
  (select body from bf_tot where label = 'cash'),
  'the cash totals are the same after the backfill'
);

-- Deleting the company (or its owner) takes its parents and sub-categories with it.
select lives_ok(
  $$delete from public.companies where id = (select id from bf where label = 'co')$$,
  'a company with sub-categories can be deleted'
);

select * from finish();
rollback;
