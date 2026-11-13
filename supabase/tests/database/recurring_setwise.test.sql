-- FLOW-1171. missing_bills and expected_months answer for every recurring charge in one statement
-- (private.recurring_match_suggestions, private.recurring_handovers). The per-charge functions they
-- replaced (private.recurring_match_suggestion, private.recurring_handover) stay as the reference: this file
-- reads their answer for every charge first, then checks that the set-wise answers are the same, on a
-- match suggestion with several alike parties and on handover candidates. Invented data only.
-- Amounts are agorot or cents. "Today" is 2026-10-20.

begin;

select plan(17);

do $users$
begin
  perform tests.create_supabase_user('rs_owner', 'rs-owner@example.com');
end
$users$;

create temp table rs (label text primary key, id uuid);
grant all on rs to authenticated, service_role;

insert into rs (label, id) values ('co', tests.fixture_company('rs_owner', 'Example Setwise LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rs where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into rs (label, id) values
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Maple House')),
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar Lot')),
  ('aspen', tests.fixture_project(pg_temp.id('co'), 'Aspen Court')),
  ('larch', tests.fixture_project(pg_temp.id('co'), 'Larch Row'));

-- Suppliers. Match: water is the recurring one (USD, no project) and has six alike parties: works (an
-- amount 1.4 times the usual), depot and svc (both 100 off the usual, depot's bill a day later), annex (50
-- off, but the owner said it is not the same), oldwater (seen since May, so not new) and gas (three times the
-- usual). hillcrest is not alike. Handover (ILS, on projects): northgate paid Maple's loan until September;
-- summit paid it in October. elm paid Aspen until September; fir and oak both paid it in October. ash paid
-- Larch until September; beech paid it in October, and the owner has already said it is not the same.
create temp table rs_sup (label text, name text);
insert into rs_sup values
  ('water', 'Riverside Water'), ('works', 'Riverside Water Works'), ('depot', 'Riverside Water Depot'),
  ('svc', 'Riverside Water Services'), ('annex', 'Riverside Water Annex'), ('oldwater', 'Riverside Waterworks Co'),
  ('gas', 'Riverside Gas'), ('hillcrest', 'Hillcrest Utility'),
  ('northgate', 'Northgate Servicing'), ('summit', 'Summit Loan Care'), ('bayview', 'Bayview Lending'),
  ('harbor', 'Harbor Mortgage'), ('pine', 'Pine Credit'),
  ('elm', 'Elm Estates'), ('fir', 'Fir Holdings'), ('oak', 'Oak Partners'),
  ('ash', 'Ash Utilities'), ('beech', 'Beech Works');
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), name from rs_sup;
insert into rs (label, id)
select p.label, s.id from rs_sup p join public.suppliers s on s.company_id = pg_temp.id('co') and s.name = p.name;

-- Customers: tenant pays monthly invoices; annex's first invoice came in October, alike in name.
create temp table rs_cus (label text, name text);
insert into rs_cus values ('tenant', 'Cedar Tenant'), ('tenant_annex', 'Cedar Tenant Annex');
insert into public.customers (company_id, name)
select pg_temp.id('co'), name from rs_cus;
insert into rs (label, id)
select p.label, c.id from rs_cus p join public.customers c on c.company_id = pg_temp.id('co') and c.name = p.name;

-- label, party, direction, project, date, amount, currency
create temp table rs_lines (label text, party text, direction text, project text, doc_date date, amount bigint, currency text);
insert into rs_lines
select 'water_' || to_char(d, 'MM'), 'water', 'expense', null, d::date + 3, 4200, 'USD'
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rs_lines values
  ('works_10', 'works', 'expense', null, '2026-10-06', 5779, 'USD'),
  ('depot_10', 'depot', 'expense', null, '2026-10-09', 4100, 'USD'),
  ('svc_10', 'svc', 'expense', null, '2026-10-05', 4300, 'USD'),
  ('annex_10', 'annex', 'expense', null, '2026-10-07', 4150, 'USD'),
  ('oldwater_05', 'oldwater', 'expense', null, '2026-05-21', 4500, 'USD'),
  ('oldwater_10', 'oldwater', 'expense', null, '2026-10-02', 4500, 'USD'),
  ('gas_10', 'gas', 'expense', null, '2026-10-08', 12600, 'USD'),
  ('hillcrest_10', 'hillcrest', 'expense', null, '2026-10-07', 4300, 'USD');
insert into rs_lines
select 'tenant_' || to_char(d, 'MM'), 'tenant', 'income', null, d::date + 1, 300000, 'ILS'
from generate_series('2026-06-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rs_lines values ('tenant_annex_10', 'tenant_annex', 'income', null, '2026-10-08', 310000, 'ILS');
insert into rs_lines
select 'northgate_' || to_char(d, 'MM'), 'northgate', 'expense', 'maple', d::date + 4, 250000, 'ILS'
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rs_lines
select 'summit_cedar_' || to_char(d, 'MM'), 'summit', 'expense', 'cedar', d::date + 6, 180000, 'ILS'
from generate_series('2026-04-01'::date, '2026-10-01'::date, interval '1 month') d;
insert into rs_lines values
  ('summit_maple_10', 'summit', 'expense', 'maple', '2026-10-05', 249000, 'ILS'),
  ('bayview_10', 'bayview', 'expense', 'maple', '2026-10-06', 257500, 'ILS'),
  ('harbor_10', 'harbor', 'expense', 'cedar', '2026-10-07', 250000, 'ILS'),
  ('pine_08', 'pine', 'expense', 'maple', '2026-08-12', 40000, 'ILS'),
  ('pine_10', 'pine', 'expense', 'maple', '2026-10-08', 250000, 'ILS'),
  ('fir_10', 'fir', 'expense', 'aspen', '2026-10-04', 101000, 'ILS'),
  ('oak_10', 'oak', 'expense', 'aspen', '2026-10-06', 99500, 'ILS'),
  ('beech_10', 'beech', 'expense', 'larch', '2026-10-03', 80000, 'ILS');
insert into rs_lines
select p || '_' || to_char(d, 'MM'), p, 'expense', case p when 'elm' then 'aspen' else 'larch' end, d::date + 2,
  case p when 'elm' then 100000 else 80000 end, 'ILS'
from unnest(array['elm', 'ash']) p, generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;

insert into rs (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'rs:' || l.label, l.amount, l.direction, pg_temp.id(l.project), null, l.doc_date,
  p_currency => l.currency,
  p_pnl_role => case when l.project is null then null else 'project' end,
  p_doc_kind => case when l.direction = 'income' then 'invoice' else 'receipt' end
)
from rs_lines l;
update public.transactions t
set supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end,
  customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end
from rs_lines l
where t.id = pg_temp.id(l.label);

-- The owner said annex is not the same as water, and beech is not the same as ash on Larch.
insert into public.recurring_matches (company_id, direction, party_id, match_party_id, same)
values (pg_temp.id('co'), 'expense', pg_temp.id('water'), pg_temp.id('annex'), false);
insert into public.recurring_handovers (company_id, direction, party_id, currency, project_id, to_party_id, same)
values (pg_temp.id('co'), 'expense', pg_temp.id('ash'), 'ILS', pg_temp.id('larch'), pg_temp.id('beech'), false);

-- The per-charge functions' answer for every charge: the suggestion, and the handover where the charge is
-- due this month with no line yet on a project.
create temp table rs_old as
select rp.direction, rp.party_id, rp.currency, rp.project_id, rp.next_due_month, rp.typical_amount_minor as typical,
  private.recurring_match_suggestion(pg_temp.id('co'), rp.direction, rp.party_id, rp.currency, rp.next_due_month,
    rp.typical_amount_minor, '2026-10-20') as suggestion,
  not rp.seen_this_month and rp.project_id is not null and rp.next_due_month <= '2026-10-01' as eligible,
  case when not rp.seen_this_month and rp.project_id is not null and rp.next_due_month <= '2026-10-01'
    then private.recurring_handover(pg_temp.id('co'), rp.direction, rp.party_id, rp.currency, rp.project_id,
      rp.typical_amount_minor, '2026-10-20')
  end as handover
from private.recurring_parties(pg_temp.id('co'), '2026-10-20') rp;
grant select on rs_old to authenticated, service_role;

-- 1-4. The helpers, called for all the charges at once.
select is(
  (select count(*)::integer
   from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', (
     select jsonb_agg(jsonb_build_object('direction', o.direction, 'party_id', o.party_id, 'currency', o.currency,
       'due_month', o.next_due_month, 'typical', o.typical))
     from rs_old o)) g
   join rs_old o on o.direction = g.direction and o.party_id = g.party_id and o.currency = g.currency
     and o.next_due_month = g.due_month and o.typical = g.typical
   where g.suggestion is distinct from o.suggestion),
  0,
  'the set-wise suggestion of every charge is the per-charge one'
);
select is(
  (select g.suggestion ->> 'party_name'
   from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', jsonb_build_array(jsonb_build_object(
     'direction', 'expense', 'party_id', pg_temp.id('water'), 'currency', 'USD', 'due_month', '2026-10-01',
     'typical', -4200))) g),
  'Riverside Water Depot',
  'of six alike parties the nearest amount wins, the later bill on a tie; the one answered no, the one seen since May and the one at three times the amount are passed over'
);
select is(
  (select count(*)::integer
   from private.recurring_handovers(pg_temp.id('co'), '2026-10-20', (
     select jsonb_agg(jsonb_build_object('direction', o.direction, 'party_id', o.party_id, 'currency', o.currency,
       'project_id', o.project_id, 'typical', o.typical))
     from rs_old o where o.eligible)) h
   join rs_old o on o.direction = h.direction and o.party_id = h.party_id and o.currency = h.currency
     and o.project_id = h.project_id and o.typical = h.typical
   where h.handover is distinct from o.handover),
  0,
  'the set-wise handover of every charge is the per-charge one'
);
select is(
  (select count(*)::integer from rs_old where handover is not null),
  2,
  'two charges have a handover: northgate (to summit) and elm (to oak); ash''s candidate was answered, pine paid on Maple in August and bayview is 3% off'
);

-- 5-17. Through the public functions.
select tests.authenticate_as('rs_owner');

create or replace function pg_temp.item(p_party text, p_project text)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'recurring') e
  where (e ->> 'party_id')::uuid = pg_temp.id(p_party) and (e ->> 'project_id')::uuid = pg_temp.id(p_project);
$$;
grant execute on function pg_temp.item(text, text) to authenticated, service_role;

create or replace function pg_temp.late(p_party text)
returns boolean
language sql
as $$
  select exists (select 1 from jsonb_array_elements(public.missing_bills('2026-10-20')) e
    where (e ->> 'party_id')::uuid = pg_temp.id(p_party));
$$;
grant execute on function pg_temp.late(text) to authenticated, service_role;

select is(
  (select e -> 'suggestion' ->> 'party_name' from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   where (e ->> 'party_id')::uuid = pg_temp.id('water')),
  'Riverside Water Depot',
  'missing_bills: the late water bill suggests the same party the per-charge function picked'
);
select is(
  (select count(*)::integer
   from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   join rs_old o on o.direction = (e ->> 'direction')::txn_direction and o.party_id = (e ->> 'party_id')::uuid
     and o.currency = e ->> 'currency' and o.project_id is not distinct from (e ->> 'project_id')::uuid
   where e -> 'suggestion' is distinct from coalesce(o.suggestion, 'null'::jsonb)),
  0,
  'missing_bills: every late bill''s suggestion is the per-charge one (the customer with an alike new name too)'
);
select ok(
  (select count(*) from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   join rs_old o on o.direction = (e ->> 'direction')::txn_direction and o.party_id = (e ->> 'party_id')::uuid
     and o.currency = e ->> 'currency' and o.project_id is not distinct from (e ->> 'project_id')::uuid) >= 3,
  'missing_bills: the comparison covers the late bills (water, the tenant, ash)'
);
select is(
  pg_temp.item('northgate', 'maple') -> 'handover',
  jsonb_build_object('party_id', pg_temp.id('summit'), 'party_name', 'Summit Loan Care',
    'transaction_id', pg_temp.id('summit_maple_10'), 'doc_date', '2026-10-05', 'amount_minor', -249000),
  'expected_months: the old servicer''s charge names the new servicer''s payment'
);
select is(
  pg_temp.item('elm', 'aspen') -> 'handover',
  jsonb_build_object('party_id', pg_temp.id('oak'), 'party_name', 'Oak Partners',
    'transaction_id', pg_temp.id('oak_10'), 'doc_date', '2026-10-06', 'amount_minor', -99500),
  'expected_months: of two candidates on a project the amount nearest the usual wins'
);
select is(
  pg_temp.item('ash', 'larch') -> 'handover',
  'null'::jsonb,
  'expected_months: a candidate the owner already answered is not offered again'
);
select is(
  (select count(*)::integer
   from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'recurring') e
   join rs_old o on o.direction = (e ->> 'direction')::txn_direction and o.party_id = (e ->> 'party_id')::uuid
     and o.currency = e ->> 'currency' and o.project_id is not distinct from (e ->> 'project_id')::uuid
   where e -> 'handover' is distinct from coalesce(o.handover, 'null'::jsonb)),
  0,
  'expected_months: every charge''s handover is the per-charge one'
);
select is(
  (select count(*)::integer
   from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'recurring') e
   where e -> 'handover' <> 'null'::jsonb),
  2,
  'expected_months: two charges have a handover'
);
select is(
  (select coalesce(sum((c ->> 'expense_minor')::bigint), 0)::bigint
   from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'months') m,
     jsonb_array_elements(m -> 'by_currency') c
   where (m ->> 'open')::boolean and c ->> 'currency' = 'ILS'),
  -80000::bigint,
  'expected_months: this month''s cells leave out the two handed-over charges and keep ash'
);
select is(pg_temp.late('northgate'), false, 'missing_bills: the handed-over servicer is not late');
select is(pg_temp.late('elm'), false, 'missing_bills: elm, handed over to oak, is not late');
select is(pg_temp.late('ash'), true, 'missing_bills: ash, whose candidate was answered no, is late');

-- 17. The helpers are for the definers only.
select tests.clear_authentication();
reset role;
select ok(
  not has_function_privilege('anon', 'private.recurring_match_suggestions(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.recurring_match_suggestions(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.recurring_handovers(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.recurring_handovers(uuid, date, jsonb)', 'execute'),
  'the set-wise helpers are not callable by clients'
);

select * from finish();
rollback;
