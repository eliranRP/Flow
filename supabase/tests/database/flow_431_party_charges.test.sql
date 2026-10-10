-- FLOW-431 (decision 0178): party_charges, a line's earlier charges from its supplier or customer
-- in its currency, with the month against the usual amount. Invented data only. Amounts are
-- agorot. "Today" is 2026-10-20.

begin;

select plan(17);

do $users$
begin
  perform tests.create_supabase_user('pc_owner', 'pc-owner@example.com');
  perform tests.create_supabase_user('pc_other', 'pc-other@example.com');
end
$users$;

create temp table pc (label text primary key, id uuid);
grant all on pc to anon, authenticated, service_role;

insert into pc (label, id) values
  ('co', tests.fixture_company('pc_owner', 'Example Charges LLC')),
  ('co_b', tests.fixture_company('pc_other', 'Example Elsewhere LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pc where label = p_label; $$;
grant execute on function pg_temp.id(text) to anon, authenticated, service_role;

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n from unnest(array['Example Mailbox', 'Example Hardware', 'Example Once', 'Example Refund']) n;
insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Tenant');
insert into pc (label, id)
select case s.name when 'Example Mailbox' then 'mailbox' when 'Example Hardware' then 'hardware' when 'Example Refund' then 'refunder' else 'once' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');
insert into pc (label, id) select 'tenant', c.id from public.customers c where c.company_id = pg_temp.id('co');

-- label, party, date, amount, direction, currency, doc kind
create temp table pc_lines (label text, party text, doc_date date, amount bigint, direction text, currency text, kind text);
-- Mailbox: monthly 1,199 from April to September, 2,299 in October (recurring, up 92%).
insert into pc_lines
select 'mailbox_' || to_char(d, 'MM'), 'mailbox', (d::date + 5), 1199, 'expense', 'USD', 'receipt'
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into pc_lines values ('mailbox_10', 'mailbox', '2026-10-06', 2299, 'expense', 'USD', 'receipt');
-- Hardware: two earlier months only (not recurring), 10,000 and 20,000, then 12,000 in October.
insert into pc_lines values
  ('hardware_06', 'hardware', '2026-06-12', 10000, 'expense', 'ILS', 'receipt'),
  ('hardware_08', 'hardware', '2026-08-12', 20000, 'expense', 'ILS', 'receipt'),
  ('hardware_10', 'hardware', '2026-10-12', 12000, 'expense', 'ILS', 'receipt');
insert into pc_lines values ('once_10', 'once', '2026-10-03', 5000, 'expense', 'ILS', 'receipt');
-- Tenant: rent invoices 500,000 from July to September, 400,000 in October (income down 20%).
insert into pc_lines
select 'rent_' || to_char(d, 'MM'), 'tenant', (d::date), case when d = '2026-10-01' then 400000 else 500000 end,
  'income', 'ILS', 'invoice'
from generate_series('2026-07-01'::date, '2026-10-01'::date, interval '1 month') d;
-- Refunder: 10,000 a month in July and August, then money back in October.
insert into pc_lines values
  ('refunder_07', 'refunder', '2026-07-09', 10000, 'expense', 'ILS', 'receipt'),
  ('refunder_08', 'refunder', '2026-08-09', 10000, 'expense', 'ILS', 'receipt'),
  ('refunder_10', 'refunder', '2026-10-09', 3000, 'expense', 'ILS', 'receipt');
insert into pc_lines values ('loose_10', null, '2026-10-16', 3000, 'expense', 'ILS', 'receipt');

insert into pc (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'pc:' || l.label, l.amount, l.direction, null, null, l.doc_date, l.currency,
  p_pnl_role => null, p_doc_kind => l.kind
)
from pc_lines l;
update public.transactions t
set supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end,
  customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end
from pc_lines l
where t.id = pg_temp.id(l.label) and l.party is not null;

-- The refund is money in on an expense supplier.
update public.transactions set amount_net = 3000, amount_gross = 3000 where id = pg_temp.id('refunder_10');
-- The owner marked Example Once recurring after its first charge.
insert into public.recurring_overrides (company_id, direction, party_id, currency, recurring)
values (pg_temp.id('co'), 'expense', pg_temp.id('once'), 'ILS', true);

select tests.authenticate_as('pc_owner');

-- 1-6. A recurring supplier: the usual amount is the recurring rule's.
select is(
  public.party_charges(pg_temp.id('mailbox_10'), '2026-10-20') - 'transaction_id' - 'months' - 'charges' - 'party',
  jsonb_build_object(
    'month', '2026-10', 'month_amount_minor', -2299, 'typical_amount_minor', -1199,
    'typical_source', 'recurring', 'change_percent', 92, 'others', 6
  ),
  'the mailbox is 92% over its usual 11.99'
);
select is(
  public.party_charges(pg_temp.id('mailbox_10'), '2026-10-20') -> 'party' ->> 'name',
  'Example Mailbox',
  'names the supplier'
);
select is(
  (select jsonb_agg(e ->> 'month') from jsonb_array_elements(public.party_charges(pg_temp.id('mailbox_10'), '2026-10-20') -> 'months') e),
  '["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]'::jsonb,
  'six months up to the line''s month, oldest first'
);
select is(
  (public.party_charges(pg_temp.id('mailbox_10'), '2026-10-20') -> 'months' -> 5 ->> 'amount_minor')::bigint,
  -2299::bigint,
  'the month''s total'
);
select is(
  (select jsonb_agg(e ->> 'doc_date') from jsonb_array_elements(public.party_charges(pg_temp.id('mailbox_10'), '2026-10-20') -> 'charges') e),
  '["2026-10-06", "2026-09-06", "2026-08-06", "2026-07-06", "2026-06-06", "2026-05-06", "2026-04-06"]'::jsonb,
  'the charges, newest first, this one included'
);
select is(
  public.party_charges(pg_temp.id('mailbox_08'), '2026-10-20') ->> 'change_percent',
  '0',
  'an older line is read against the usual of its own month'
);

-- 7-8. Not recurring: the median of its earlier months.
select is(
  public.party_charges(pg_temp.id('hardware_10'), '2026-10-20') - 'transaction_id' - 'months' - 'charges' - 'party',
  jsonb_build_object(
    'month', '2026-10', 'month_amount_minor', -12000, 'typical_amount_minor', -10000,
    'typical_source', 'earlier_months', 'change_percent', 20, 'others', 2
  ),
  'two earlier months give a usual amount (the lower median)'
);
select is(
  public.party_charges(pg_temp.id('once_10'), '2026-10-20') ->> 'typical_amount_minor',
  null,
  'a first charge has no usual amount, even when the owner marked it recurring'
);
select is(
  public.party_charges(pg_temp.id('refunder_10'), '2026-10-20') - 'transaction_id' - 'months' - 'charges' - 'party' - 'others',
  jsonb_build_object(
    'month', '2026-10', 'month_amount_minor', 3000, 'typical_amount_minor', -10000,
    'typical_source', 'earlier_months', 'change_percent', null
  ),
  'a refund month gets no percent'
);
select is(
  (select jsonb_agg(e ->> 'doc_date') from jsonb_array_elements(public.party_charges(pg_temp.id('mailbox_06'), '2026-10-20') -> 'charges') e),
  '["2026-06-06", "2026-05-06", "2026-04-06"]'::jsonb,
  'an older line lists the charges up to its own month'
);
select is(
  public.party_charges(pg_temp.id('rent_09'), '2026-10-20') ->> 'change_percent',
  '0',
  'an invoice is compared'
);

-- 12. Income down: the customer's invoices.
select is(
  public.party_charges(pg_temp.id('rent_10'), '2026-10-20') - 'transaction_id' - 'months' - 'charges' - 'party',
  jsonb_build_object(
    'month', '2026-10', 'month_amount_minor', 400000, 'typical_amount_minor', 500000,
    'typical_source', 'recurring', 'change_percent', -20, 'others', 3
  ),
  'rent came in 20% under its usual amount'
);

-- 13. A line with no party.
select is(
  public.party_charges(pg_temp.id('loose_10'), '2026-10-20') -> 'party',
  'null'::jsonb,
  'a line with no supplier has no party and no charges'
);

-- 14-15. Another company, and no company.
select tests.authenticate_as('pc_other');
select throws_ok(
  format('select public.party_charges(%L)', pg_temp.id('mailbox_10')),
  'P0001', 'transaction not found',
  'another company does not read the charges'
);
select tests.clear_authentication();
select throws_ok(
  format('select public.party_charges(%L)', pg_temp.id('mailbox_10')),
  '42501', null,
  'no session, no read'
);

-- 16-17.
select ok(
  not has_function_privilege('anon', 'public.party_charges(uuid, date)', 'execute'),
  'anon cannot call it'
);
select is(
  (select provolatile from pg_proc where proname = 'party_charges' and pronamespace = 'public'::regnamespace),
  's',
  'it is a read (stable)'
);

select * from finish();
rollback;
