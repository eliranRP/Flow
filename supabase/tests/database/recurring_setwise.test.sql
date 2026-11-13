-- FLOW-1171. missing_bills and expected_months answer for every recurring charge in one statement
-- (private.recurring_match_suggestions, private.recurring_handovers). The per-charge functions they
-- replaced (recurring_match_suggestion, recurring_handover, party_names_alike) are dropped; their last bodies
-- live here as pg_temp functions, the oracle: this file reads their answer for every charge first, then checks
-- that the set-wise answers are the same (the same rows, the same counts), on a match suggestion with several
-- alike parties, on lines each filter must leave out (pending, void, removed, another currency, a receipt
-- income, after today) and on handover candidates. Invented data only.
-- Amounts are agorot or cents. "Today" is 2026-10-20.

begin;

select plan(23);

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

-- The oracle: the dropped per-charge functions as they were (migrations 20261014161237, 20261018085732 and
-- 20261103151207), with the helpers they called under pg_temp. Created as postgres, before any sign-in.
create function pg_temp.party_names_alike(p_a text, p_b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with w as (select private.party_name_words(p_a) as a, private.party_name_words(p_b) as b)
  select w.a <> '' and w.b <> '' and (
    (char_length(split_part(w.a, ' ', 1)) >= 3 and split_part(w.a, ' ', 1) = split_part(w.b, ' ', 1))
    or position(w.a in w.b) > 0 or position(w.b in w.a) > 0)
  from w;
$$;

create function pg_temp.recurring_match_suggestion(p_company uuid, p_direction public.txn_direction, p_party uuid,
  p_currency text, p_due_month date, p_typical bigint, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with me as (
    select coalesce(s.name, cu.name) as name
    from (select 1) one
    left join public.suppliers s on p_direction = 'expense' and s.company_id = p_company and s.id = p_party
    left join public.customers cu on p_direction = 'income' and cu.company_id = p_company and cu.id = p_party
  ),
  candidates as (
    select n.id, n.name
    from (
      select s.id, s.name from public.suppliers s where p_direction = 'expense' and s.company_id = p_company
      union all
      select cu.id, cu.name from public.customers cu where p_direction = 'income' and cu.company_id = p_company
    ) n, me
    where n.id <> p_party
      and pg_temp.party_names_alike(me.name, n.name)
      and not exists (
        select 1 from public.recurring_matches m
        where m.company_id = p_company and m.direction = p_direction
          and ((m.party_id = p_party and m.match_party_id = n.id) or (m.match_party_id = n.id and m.same)
            or m.party_id = n.id)
      )
  ),
  latest as (
    select distinct on (c.id) c.id, c.name, t.id as transaction_id, t.doc_date, t.amount_net
    from candidates c
    join public.transactions t
      on t.company_id = p_company and t.direction = p_direction and t.currency = p_currency
      and c.id = case when p_direction = 'expense' then t.supplier_id else t.customer_id end
    where t.removed_at is null
      and t.line_status = 'posted'
      and (p_direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= (p_due_month - interval '1 month')::date
      and t.doc_date <= p_today
      and not exists (
        select 1 from public.transactions o
        where o.company_id = p_company and o.removed_at is null and o.line_status = 'posted'
          and c.id = case when p_direction = 'expense' then o.supplier_id else o.customer_id end
          and o.doc_date < (p_due_month - interval '1 month')::date
      )
    order by c.id, t.doc_date desc, t.created_at desc
  )
  select jsonb_build_object(
      'party_id', l.id,
      'party_name', l.name,
      'transaction_id', l.transaction_id,
      'doc_date', l.doc_date,
      'amount_minor', l.amount_net
    )
  from latest l
  where p_typical <> 0
    and abs(l.amount_net) * 2 >= abs(p_typical)
    and abs(l.amount_net) * 2 <= abs(p_typical) * 3
  order by abs(abs(l.amount_net) - abs(p_typical)), l.doc_date desc, l.id
  limit 1;
$$;

create function pg_temp.recurring_handover(p_company uuid, p_direction public.txn_direction, p_party uuid,
  p_currency text, p_project uuid, p_typical bigint, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with b as (select date_trunc('month', p_today)::date as this_month),
  lines as (
    select lp.id, lp.doc_date, lp.created_at, lp.amount_net, lp.line_party_id as party_id
    from b, private.recurring_line_parts(p_company, b.this_month, p_today) lp
    where p_project is not null
      and p_typical <> 0
      and lp.direction = p_direction
      and lp.currency = p_currency
      and lp.project_id = p_project
      and lp.line_party_id <> p_party
      and lp.party_id <> p_party
      and abs(abs(lp.amount_net) - abs(p_typical)) * 50 <= abs(p_typical)
  ),
  earlier as (
    select distinct lp.line_party_id as party_id
    from b, private.recurring_line_parts(p_company, '0001-01-01'::date, (b.this_month - 1)) lp
    where exists (select 1 from lines)
      and lp.direction = p_direction
      and lp.project_id = p_project
  )
  select jsonb_build_object(
      'party_id', l.party_id,
      'party_name', coalesce(s.name, cu.name),
      'transaction_id', l.id,
      'doc_date', l.doc_date,
      'amount_minor', l.amount_net
    )
  from lines l
  left join public.suppliers s on p_direction = 'expense' and s.company_id = p_company and s.id = l.party_id
  left join public.customers cu on p_direction = 'income' and cu.company_id = p_company and cu.id = l.party_id
  where coalesce(s.id, cu.id) is not null
    and not exists (select 1 from earlier e where e.party_id = l.party_id)
    and not exists (
      select 1 from public.recurring_handovers h
      where h.company_id = p_company and h.direction = p_direction and h.party_id = p_party
        and h.currency = p_currency and h.project_id = p_project and h.to_party_id = l.party_id
    )
  order by abs(abs(l.amount_net) - abs(p_typical)), l.doc_date desc, l.created_at desc, l.id
  limit 1;
$$;

insert into rs (label, id) values
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Maple House')),
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar Lot')),
  ('aspen', tests.fixture_project(pg_temp.id('co'), 'Aspen Court')),
  ('larch', tests.fixture_project(pg_temp.id('co'), 'Larch Row'));

-- Suppliers. Match: water is the recurring one (USD, no project) and has six alike parties: works (an
-- amount 1.4 times the usual), depot and svc (both 100 off the usual, depot's bill a day later), annex (50
-- off, but the owner said it is not the same), oldwater (seen since May, so not new) and gas (three times the
-- usual). hillcrest is not alike. Five more alike parties, each at exactly
-- the usual amount (so each would win were its line not left out), have one October line that must not count:
-- pending (not posted), voided (void), removed (posted, then removed), ils (in ILS, not the charge's USD) and
-- future (dated after today). Handover (ILS, on projects): northgate paid Maple's loan until September;
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
  ('ash', 'Ash Utilities'), ('beech', 'Beech Works'),
  ('pending', 'Riverside Water Pending'), ('voided', 'Riverside Water Voided'), ('removed', 'Riverside Water Removed'),
  ('ils', 'Riverside Water Shekel'), ('future', 'Riverside Water Future');
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), name from rs_sup;
insert into rs (label, id)
select p.label, s.id from rs_sup p join public.suppliers s on s.company_id = pg_temp.id('co') and s.name = p.name;

-- Customers: tenant pays monthly invoices; annex's first invoice came in October, alike in name. Its two
-- neighbours must be passed over: receipt's October line is a receipt (income suggests invoices only) and
-- dollar's is in USD (the charge is in ILS), both at exactly the usual amount.
create temp table rs_cus (label text, name text);
insert into rs_cus values ('tenant', 'Cedar Tenant'), ('tenant_annex', 'Cedar Tenant Annex'),
  ('tenant_receipt', 'Cedar Tenant Receipt'), ('tenant_usd', 'Cedar Tenant Dollar');
insert into public.customers (company_id, name)
select pg_temp.id('co'), name from rs_cus;
insert into rs (label, id)
select p.label, c.id from rs_cus p join public.customers c on c.company_id = pg_temp.id('co') and c.name = p.name;

-- label, party, direction, project, date, amount, currency
create temp table rs_lines (label text, party text, direction text, project text, doc_date date, amount bigint, currency text,
  line_status text default 'posted');
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
  ('hillcrest_10', 'hillcrest', 'expense', null, '2026-10-07', 4300, 'USD'),
  ('removed_10', 'removed', 'expense', null, '2026-10-07', 4200, 'USD'),
  ('ils_10', 'ils', 'expense', null, '2026-10-07', 4200, 'ILS'),
  ('future_10', 'future', 'expense', null, '2026-10-25', 4200, 'USD');
insert into rs_lines (label, party, direction, project, doc_date, amount, currency, line_status) values
  ('pending_10', 'pending', 'expense', null, '2026-10-07', 4200, 'USD', 'pending'),
  ('voided_10', 'voided', 'expense', null, '2026-10-07', 4200, 'USD', 'void');
insert into rs_lines
select 'tenant_' || to_char(d, 'MM'), 'tenant', 'income', null, d::date + 1, 300000, 'ILS'
from generate_series('2026-06-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rs_lines values
  ('tenant_annex_10', 'tenant_annex', 'income', null, '2026-10-08', 310000, 'ILS'),
  ('tenant_receipt_10', 'tenant_receipt', 'income', null, '2026-10-08', 300000, 'ILS'),
  ('tenant_usd_10', 'tenant_usd', 'income', null, '2026-10-08', 300000, 'USD');
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
  p_currency => l.currency, p_line_status => l.line_status,
  p_pnl_role => case when l.project is null then null else 'project' end,
  p_doc_kind => case when l.direction = 'income' and l.label <> 'tenant_receipt_10' then 'invoice' else 'receipt' end
)
from rs_lines l;
update public.transactions t
set supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end,
  customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end
from rs_lines l
where t.id = pg_temp.id(l.label);
update public.transactions set removed_at = now() where id = pg_temp.id('removed_10');

-- The owner said annex is not the same as water, and beech is not the same as ash on Larch.
insert into public.recurring_matches (company_id, direction, party_id, match_party_id, same)
values (pg_temp.id('co'), 'expense', pg_temp.id('water'), pg_temp.id('annex'), false);
insert into public.recurring_handovers (company_id, direction, party_id, currency, project_id, to_party_id, same)
values (pg_temp.id('co'), 'expense', pg_temp.id('ash'), 'ILS', pg_temp.id('larch'), pg_temp.id('beech'), false);

-- The per-charge functions' answer for every charge: the suggestion, and the handover where the charge is
-- due this month with no line yet on a project.
create temp table rs_old as
select rp.direction, rp.party_id, rp.currency, rp.project_id, rp.next_due_month, rp.typical_amount_minor as typical,
  pg_temp.recurring_match_suggestion(pg_temp.id('co'), rp.direction, rp.party_id, rp.currency, rp.next_due_month,
    rp.typical_amount_minor, '2026-10-20') as suggestion,
  not rp.seen_this_month and rp.project_id is not null and rp.next_due_month <= '2026-10-01' as eligible,
  case when not rp.seen_this_month and rp.project_id is not null and rp.next_due_month <= '2026-10-01'
    then pg_temp.recurring_handover(pg_temp.id('co'), rp.direction, rp.party_id, rp.currency, rp.project_id,
      rp.typical_amount_minor, '2026-10-20')
  end as handover
from private.recurring_parties(pg_temp.id('co'), '2026-10-20') rp;
grant select on rs_old to authenticated, service_role;

-- The set-wise answers for the same charges, read once. A charge with no handover has no row.
create temp table rs_sg as
select g.*
from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', (
  select jsonb_agg(jsonb_build_object('direction', o.direction, 'party_id', o.party_id, 'currency', o.currency,
    'due_month', o.next_due_month, 'typical', o.typical))
  from rs_old o)) g;
create temp table rs_ho as
select h.*
from private.recurring_handovers(pg_temp.id('co'), '2026-10-20', (
  select jsonb_agg(jsonb_build_object('direction', o.direction, 'party_id', o.party_id, 'currency', o.currency,
    'project_id', o.project_id, 'typical', o.typical))
  from rs_old o where o.eligible)) h;
grant select on rs_sg, rs_ho to authenticated, service_role;

-- 1-4. The helpers, called for all the charges at once. A full join, so a charge missing on either side
-- counts as a difference, and an empty answer cannot pass.
select is(
  (select count(*)::integer
   from rs_sg g
   full join rs_old o on o.direction = g.direction and o.party_id = g.party_id and o.currency = g.currency
     and o.next_due_month = g.due_month and o.typical = g.typical
   where g.direction is null or o.direction is null or g.suggestion is distinct from o.suggestion),
  0,
  'the set-wise suggestion of every charge is the per-charge one'
);
select is(
  (select count(*) filter (where suggestion is not null)::integer from rs_sg),
  (select count(*) filter (where suggestion is not null)::integer from rs_old),
  'as many charges have a suggestion as with the per-charge function'
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
   from rs_ho h
   full join (select * from rs_old where handover is not null) o
     on o.direction = h.direction and o.party_id = h.party_id and o.currency = h.currency
     and o.project_id = h.project_id and o.typical = h.typical
   where h.direction is null or o.direction is null or h.handover is distinct from o.handover),
  0,
  'the set-wise handover of every charge is the per-charge one,'
);
select is(
  (select count(*)::integer from rs_old where handover is not null),
  (select count(*)::integer from rs_ho),
  'as many charges have a handover as with the per-charge function'
);
select is(
  (select array_agg(party_name order by party_name) from (
     select ho.handover ->> 'party_name' as party_name from rs_ho ho) x),
  array['Oak Partners', 'Summit Loan Care'],
  'northgate (to summit) and elm (to oak) have a handover; ash''s candidate was answered, pine paid on Maple in August and bayview is 3% off'
);
select is(
  (select o.suggestion ->> 'party_name' from rs_old o where o.party_id = pg_temp.id('tenant')),
  'Cedar Tenant Annex',
  'the income charge suggests the new invoice party: not the receipt party nor the USD one, both at the exact usual amount'
);
select is(
  (select g.suggestion ->> 'party_name' from rs_sg g where g.party_id = pg_temp.id('tenant')),
  'Cedar Tenant Annex',
  'and so does the set-wise one'
);
select ok(
  pg_temp.recurring_match_suggestion(pg_temp.id('co'), 'expense', pg_temp.id('water'), 'USD', '2026-10-01', 0,
    '2026-10-20') is null
  and (select g.suggestion is null from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20',
    jsonb_build_array(jsonb_build_object('direction', 'expense', 'party_id', pg_temp.id('water'), 'currency', 'USD',
      'due_month', '2026-10-01', 'typical', 0))) g)
  and not exists (select 1 from private.recurring_handovers(pg_temp.id('co'), '2026-10-20',
    jsonb_build_array(jsonb_build_object('direction', 'expense', 'party_id', pg_temp.id('northgate'), 'currency', 'ILS',
      'project_id', pg_temp.id('maple'), 'typical', 0)))),
  'a charge with a usual amount of 0 has no suggestion and no handover, as with the per-charge functions'
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
select ok(
  to_regprocedure('private.recurring_match_suggestion(uuid, public.txn_direction, uuid, text, date, bigint, date)') is null
  and to_regprocedure('private.recurring_handover(uuid, public.txn_direction, uuid, text, uuid, bigint, date)') is null
  and to_regprocedure('private.party_names_alike(text, text)') is null,
  'the per-charge helpers and the name comparison are gone'
);

select * from finish();
rollback;
