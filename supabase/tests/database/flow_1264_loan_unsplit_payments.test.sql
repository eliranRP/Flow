-- FLOW-1264: loan_unsplit_payments gives, per open loan with a monthly payment, the latest posted, not removed
-- expense line of the last 75 days in the loan's currency, within 2% of the payment, that no loan split covers,
-- from a supplier an earlier line split to the loan came from.
-- RLS limits the rows to the caller's company. @example.com only.

begin;

select plan(11);

do $users$
begin
  perform tests.create_supabase_user('f1264_a', 'f1264a@example.com');
  perform tests.create_supabase_user('f1264_b', 'f1264b@example.com');
end
$users$;

create temp table f1264 (label text primary key, id uuid);
grant all on f1264 to authenticated, service_role;

insert into public.companies (owner_id, name) values (tests.get_supabase_uid('f1264_a'), 'Example A');
insert into public.companies (owner_id, name) values (tests.get_supabase_uid('f1264_b'), 'Example B');
insert into f1264 select 'co_a', id from public.companies where name = 'Example A';
insert into f1264 select 'co_b', id from public.companies where name = 'Example B';

-- Loans: a USD loan paying 100000 a month, a demand loan (no payment), a paid-off loan, and B's loan.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
  escrow_minor, currency, kind, status, closed_on)
select (select id from f1264 where label = v.co), v.name, 10000000, 60000, v.term, '2026-01-01', v.payment, 0, 'USD',
  v.kind::public.loan_kind, v.status::public.loan_status,
  case when v.status = 'open' then null else '2026-06-01'::date end
from (values
  ('co_a', 'Loan main', 360, 100000, 'amortizing', 'open'),
  ('co_a', 'Loan demand', null, null, 'demand', 'open'),
  ('co_a', 'Loan done', 360, 100000, 'amortizing', 'paid_off'),
  ('co_b', 'Loan B', 360, 100000, 'amortizing', 'open')
) v(co, name, term, payment, kind, status);
insert into f1264 select 'main', id from public.loans where name = 'Loan main';
insert into f1264 select 'demand', id from public.loans where name = 'Loan demand';
insert into f1264 select 'done', id from public.loans where name = 'Loan done';
insert into f1264 select 'lb', id from public.loans where name = 'Loan B';

-- Suppliers: the lender, and a shop that happens to charge about the payment.
insert into public.suppliers (company_id, name)
select (select id from f1264 where label = v.co), v.name
from (values ('co_a', 'Example Lender'), ('co_a', 'Example Shop'), ('co_b', 'Example Lender B')) v(co, name);
insert into f1264 select 'lender', id from public.suppliers where name = 'Example Lender';
insert into f1264 select 'shop', id from public.suppliers where name = 'Example Shop';
insert into f1264 select 'lender_b', id from public.suppliers where name = 'Example Lender B';

-- Lines (days before today, amount, currency, direction, supplier): A's lender line that matches 20 days ago
-- (101500 is 1.5% off), an older lender line split to the loan (it ties the lender to the loan), and later lines
-- that must not count: a removed one, an income, one in ILS, one 5% off, one from the shop for the exact payment,
-- and an older matching one past the 75 days. B: a split lender line and an unsplit one.
create temp table f1264_lines (key text primary key, co text, days int, amount bigint, currency text, direction text,
  supplier text);
insert into f1264_lines values
  ('match', 'co_a', 20, 101500, 'USD', 'expense', 'lender'),
  ('split', 'co_a', 50, 100000, 'USD', 'expense', 'lender'),
  ('removed', 'co_a', 6, 100000, 'USD', 'expense', 'lender'),
  ('income', 'co_a', 7, 100000, 'USD', 'income', 'lender'),
  ('ils', 'co_a', 8, 100000, 'ILS', 'expense', 'lender'),
  ('off', 'co_a', 9, 105000, 'USD', 'expense', 'lender'),
  ('shop', 'co_a', 3, 100000, 'USD', 'expense', 'shop'),
  ('old', 'co_a', 90, 100000, 'USD', 'expense', 'lender'),
  ('b_split', 'co_b', 40, 100000, 'USD', 'expense', 'lender_b'),
  ('b', 'co_b', 10, 100000, 'USD', 'expense', 'lender_b');

insert into public.transactions (company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description, supplier_id)
select (select id from f1264 where label = v.co), v.direction::public.txn_direction,
  (case when v.direction = 'expense' then 'expense' else 'receipt' end)::public.doc_kind,
  case when v.direction = 'expense' then -v.amount else v.amount end,
  case when v.direction = 'expense' then -v.amount else v.amount end,
  v.amount, 0, 'unknown', current_date - v.days, v.currency, 'manual', 'f1264:' || v.key, 'Example line',
  (select id from f1264 where label = v.supplier)
from f1264_lines v;

-- The split lines are their loans': interest 40000, escrow 10000, principal 50000.
select tests.loan_split(t.id, l.id, jsonb_agg(jsonb_build_object('part', p.part, 'amount_minor', p.amount,
  'scheduled_minor', p.amount, 'category_id', c.id)))
from (values ('f1264:split', 'main'), ('f1264:b_split', 'lb')) k(key, loan)
join public.transactions t on t.idempotency_key = k.key
join public.loans l on l.id = (select id from f1264 where label = k.loan)
cross join (values ('interest', 'ריבית משכנתא', 40000), ('escrow', 'מסים וביטוח', 10000),
  ('principal', 'תשלומי הלוואה', 50000)) p(part, category, amount)
join public.categories c on c.company_id = l.company_id and c.name = p.category and c.kind = 'expense'
group by t.id, l.id;

update public.transactions set removed_at = now() where idempotency_key = 'f1264:removed';

select is(
  (select last_on from public.loan_unsplit_payments where loan_id = (select id from f1264 where label = 'main')),
  current_date - 20,
  'the matching lender line counts, not the later removed, income, ILS, 5% off or shop lines'
);

select is(
  (select count(*)::int from public.loan_unsplit_payments v
   join public.transactions t on t.idempotency_key = 'f1264:shop' and t.doc_date = v.last_on),
  0,
  'an unrelated expense for exactly the payment, from a supplier never split to the loan, does not count'
);

select is(
  (select count(*)::int from public.loan_unsplit_payments where loan_id = (select id from f1264 where label = 'demand')),
  0,
  'a demand loan has no payment to match'
);

select is(
  (select count(*)::int from public.loan_unsplit_payments where loan_id = (select id from f1264 where label = 'done')),
  0,
  'a paid-off loan is not open'
);

update public.transactions set removed_at = now() where idempotency_key = 'f1264:match';

select is(
  (select count(*)::int from public.loan_unsplit_payments where loan_id = (select id from f1264 where label = 'main')),
  0,
  'with the match removed, nothing else qualifies: the line past 75 days does not count'
);

update public.transactions set removed_at = null where idempotency_key = 'f1264:match';

select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
   where a.attrelid = 'public.loan_unsplit_payments'::regclass and a.attnum > 0 and not a.attisdropped),
  array['company_id', 'loan_id', 'last_on'],
  'the view''s columns'
);

select ok(
  (select c.reloptions && array['security_invoker=true'] from pg_class c
   join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'loan_unsplit_payments'),
  'the view runs as the caller'
);

select ok(
  has_table_privilege('authenticated', 'public.loan_unsplit_payments', 'select')
  and has_table_privilege('service_role', 'public.loan_unsplit_payments', 'select')
  and not has_table_privilege('anon', 'public.loan_unsplit_payments', 'select')
  and not has_table_privilege('authenticated', 'public.loan_unsplit_payments', 'insert'),
  'select for authenticated and service_role, nothing for anon'
);

select tests.authenticate_as('f1264_a');

select is(
  (select last_on from public.loan_unsplit_payments where loan_id = (select id from f1264 where label = 'main')),
  current_date - 20,
  'RLS: company A''s owner reads A''s own loan'
);

select is(
  (select count(*)::int from public.loan_unsplit_payments where loan_id = (select id from f1264 where label = 'lb')),
  0,
  'RLS: company A''s owner does not read B''s loan'
);

select tests.clear_authentication();
select tests.authenticate_as('f1264_b');

select results_eq(
  $$select loan_id, last_on from public.loan_unsplit_payments$$,
  $$select id, current_date - 10 from f1264 where label = 'lb'$$,
  'RLS: company B''s owner reads only B''s loan'
);

select * from finish();

rollback;
