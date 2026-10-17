-- FLOW-447c: recurring_party_line, the newest counted line of a recurring party in one currency: the
-- line the charge page reads. Invented data only. Amounts are agorot. "Today" is 2026-10-20.

begin;

select plan(15);

do $users$
begin
  perform tests.create_supabase_user('pl_owner', 'pl-owner@example.com');
  perform tests.create_supabase_user('pl_other', 'pl-other@example.com');
end
$users$;

create temp table pl (label text primary key, id uuid);
grant all on pl to anon, authenticated, service_role;

insert into pl (label, id) values
  ('co', tests.fixture_company('pl_owner', 'Example Line LLC')),
  ('co_b', tests.fixture_company('pl_other', 'Example Elsewhere Line LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pl where label = p_label; $$;
grant execute on function pg_temp.id(text) to anon, authenticated, service_role;

insert into public.suppliers (company_id, name) values
  (pg_temp.id('co'), 'Example Mailbox'), (pg_temp.id('co'), 'Example Empty'), (pg_temp.id('co_b'), 'Example Foreign');
insert into public.customers (company_id, name) values
  (pg_temp.id('co'), 'Example Tenant'), (pg_temp.id('co'), 'Example Payer');
insert into pl (label, id)
select case s.name when 'Example Mailbox' then 'mailbox' when 'Example Empty' then 'empty' else 'foreign' end, s.id
from public.suppliers s where s.name in ('Example Mailbox', 'Example Empty', 'Example Foreign');
insert into pl (label, id)
select case c.name when 'Example Tenant' then 'tenant' else 'payer' end, c.id
from public.customers c where c.name in ('Example Tenant', 'Example Payer');

-- label, party, date, amount, direction, currency, doc kind
create temp table pl_lines (label text, party text, doc_date date, amount bigint, direction text, currency text, kind text);
insert into pl_lines values
  ('mb_08', 'mailbox', '2026-08-06', 1199, 'expense', 'ILS', 'receipt'),
  ('mb_09', 'mailbox', '2026-09-06', 1199, 'expense', 'ILS', 'receipt'),
  ('mb_10', 'mailbox', '2026-10-06', 2299, 'expense', 'ILS', 'receipt'),
  ('mb_usd', 'mailbox', '2026-10-07', 900, 'expense', 'USD', 'receipt'),
  ('mb_removed', 'mailbox', '2026-10-12', 700, 'expense', 'ILS', 'receipt'),
  ('mb_future', 'mailbox', '2026-10-25', 2500, 'expense', 'ILS', 'receipt'),
  ('tn_07', 'tenant', '2026-07-01', 500000, 'income', 'ILS', 'invoice'),
  ('tn_08', 'tenant', '2026-08-01', 500000, 'income', 'ILS', 'invoice'),
  ('tn_09', 'tenant', '2026-09-01', 500000, 'income', 'ILS', 'invoice'),
  ('tn_10', 'tenant', '2026-10-01', 350000, 'income', 'ILS', 'invoice'),
  ('tn_receipt', 'tenant', '2026-10-15', 350000, 'income', 'ILS', 'receipt'),
  ('pay_receipt', 'payer', '2026-10-03', 4000, 'income', 'ILS', 'receipt');

insert into pl (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'pl:' || l.label, l.amount, l.direction, null, null, l.doc_date, l.currency,
  p_pnl_role => null, p_doc_kind => l.kind
)
from pl_lines l;
update public.transactions t
set supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end,
  customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end
from pl_lines l
where t.id = pg_temp.id(l.label);
-- A removed line is not counted, however new.
update public.transactions set removed_at = now() where id = pg_temp.id('mb_removed');

-- The owner reads the schedule, so the change alert is the one the arrival raises.
select tests.authenticate_as('pl_owner');

-- 1-3. The newest counted line: not removed, not dated after today, in the party's currency.
select is(
  public.recurring_party_line('expense', pg_temp.id('mailbox'), 'ILS', '2026-10-20'),
  pg_temp.id('mb_10'),
  'the newest counted line of the supplier (a removed and a later-dated line are skipped)'
);
select is(
  public.recurring_party_line('expense', pg_temp.id('mailbox'), 'ILS', '2026-10-05'),
  pg_temp.id('mb_09'),
  'with today before the October bill, the September bill is the line'
);
select is(
  public.recurring_party_line('expense', pg_temp.id('mailbox'), 'USD', '2026-10-20'),
  pg_temp.id('mb_usd'),
  'the line of the currency asked for'
);

-- 4-5. No line, and an income party whose only line is a receipt.
select is(
  public.recurring_party_line('expense', pg_temp.id('empty'), 'ILS', '2026-10-20'),
  null::uuid,
  'a party with no line has none'
);
select is(
  public.recurring_party_line('income', pg_temp.id('payer'), 'ILS', '2026-10-20'),
  null::uuid,
  'a receipt alone is not a counted income line'
);

-- 6. An income receipt newer than the invoices is not the line: the invoice is.
select is(
  public.recurring_party_line('income', pg_temp.id('tenant'), 'ILS', '2026-10-20'),
  pg_temp.id('tn_10'),
  'an income party ignores a receipt and reads its newest invoice'
);

-- 7-8. The change alert's key is the arrival, and it is the line the page reads after the ignore.
select is(
  (select r ->> 'transaction_id' from jsonb_array_elements(public.recurring_changes('2026-10-20')) r where r ->> 'party_id' = pg_temp.id('tenant')::text),
  pg_temp.id('tn_10')::text,
  'the change alert of the arrival is keyed by the line the page reads'
);
select public.dismiss_recurring_alert('change', pg_temp.id('tn_10')::text);
select is(
  (select count(*) from jsonb_array_elements(public.recurring_changes('2026-10-20')) r where r ->> 'party_id' = pg_temp.id('tenant')::text),
  0::bigint,
  'once ignored, the change is no longer listed'
);
select is(
  public.recurring_party_line('income', pg_temp.id('tenant'), 'ILS', '2026-10-20'),
  pg_temp.id('tn_10'),
  'and the page still reads the same line'
);

-- 9-10. Another company gets nothing; no session gets refused.
select tests.authenticate_as('pl_other');
select is(
  public.recurring_party_line('expense', pg_temp.id('mailbox'), 'ILS', '2026-10-20'),
  null::uuid,
  'another company does not read the party'
);
select tests.clear_authentication();
select throws_ok(
  format('select public.recurring_party_line(%L, %L, %L, %L)', 'expense', pg_temp.id('mailbox'), 'ILS', '2026-10-20'),
  '42501', null,
  'no session, no read'
);

-- 11. A direction that is neither income nor expense is refused.
select tests.authenticate_as('pl_owner');
select throws_ok(
  format('select public.recurring_party_line(%L, %L, %L, %L)', 'transfer', pg_temp.id('mailbox'), 'ILS', '2026-10-20'),
  'P0001', 'validation',
  'an unknown direction is refused'
);

-- 12-14. Grants and volatility.
select ok(
  not has_function_privilege('anon', 'public.recurring_party_line(text, uuid, text, date)', 'execute'),
  'anon cannot call it'
);
select ok(
  has_function_privilege('authenticated', 'public.recurring_party_line(text, uuid, text, date)', 'execute'),
  'a signed-in user can call it'
);
select is(
  (select provolatile from pg_proc where proname = 'recurring_party_line' and pronamespace = 'public'::regnamespace),
  's',
  'it is a read (stable)'
);

select * from finish();
rollback;
