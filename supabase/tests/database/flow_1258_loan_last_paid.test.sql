-- FLOW-1258: loan_balances.last_paid_on is the latest posted, not removed payment split to the loan; null with
-- none. A flagged payment still counts (the bank paid it); a removed line does not. RLS still
-- limits the rows to the caller's company. @example.com only.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('f1258_a', 'f1258a@example.com');
  perform tests.create_supabase_user('f1258_b', 'f1258b@example.com');
end
$users$;

create temp table f1258 (label text primary key, id uuid);
grant all on f1258 to authenticated, service_role;

insert into public.companies (owner_id, name) values (tests.get_supabase_uid('f1258_a'), 'Example A');
insert into public.companies (owner_id, name) values (tests.get_supabase_uid('f1258_b'), 'Example B');
insert into f1258 select 'co_a', id from public.companies where name = 'Example A';
insert into f1258 select 'co_b', id from public.companies where name = 'Example B';

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
  escrow_minor, currency)
select (select id from f1258 where label = v.co), v.name, 100000, 60000, 360, '2026-01-01', 1000, 0, 'USD'
from (values ('co_a', 'Loan paid'), ('co_a', 'Loan none'), ('co_a', 'Loan flagged'), ('co_b', 'Loan B')) v(co, name);
insert into f1258 select 'paid', id from public.loans where name = 'Loan paid';
insert into f1258 select 'none', id from public.loans where name = 'Loan none';
insert into f1258 select 'flagged', id from public.loans where name = 'Loan flagged';
insert into f1258 select 'lb', id from public.loans where name = 'Loan B';

-- Loan paid: posted lines on 02-05 and 03-05 and a line on 04-05 that is then removed.
-- Loan flagged: one posted line on 03-10, flagged for review. Loan B: one posted line on 06-01.
create temp table f1258_lines (key text primary key, label text, doc_date date);
insert into f1258_lines values ('p1', 'paid', '2026-02-05'), ('p2', 'paid', '2026-03-05'), ('p3', 'paid', '2026-04-05'),
  ('f1', 'flagged', '2026-03-10'), ('b1', 'lb', '2026-06-01');

insert into public.transactions (company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description)
select l.company_id, 'expense', 'expense', -1000, -1000, 1000, 0, 'unknown', v.doc_date, 'USD', 'manual',
  'f1258:' || v.key, 'Example payment'
from f1258_lines v
join f1258 f on f.label = v.label
join public.loans l on l.id = f.id;

-- Each line is interest 400, escrow 100 and principal 500 (a split needs all three parts).
select tests.loan_split(t.id, l.id, jsonb_agg(jsonb_build_object('part', p.part, 'amount_minor', p.amount,
  'scheduled_minor', p.amount, 'category_id', c.id)))
from f1258_lines v
join f1258 f on f.label = v.label
join public.loans l on l.id = f.id
join public.transactions t on t.company_id = l.company_id and t.idempotency_key = 'f1258:' || v.key
cross join (values ('interest', 'ריבית משכנתא', 400), ('escrow', 'מסים וביטוח', 100),
  ('principal', 'תשלומי הלוואה', 500)) p(part, category, amount)
join public.categories c on c.company_id = l.company_id and c.name = p.category and c.kind = 'expense'
group by t.id, l.id;

update public.transactions set removed_at = now() where idempotency_key = 'f1258:p3';
select tests.loan_split_review(t.id, true) from public.transactions t where t.idempotency_key = 'f1258:f1';

select is(
  (select b.last_paid_on from public.loan_balances b where b.loan_id = (select id from f1258 where label = 'paid')),
  '2026-03-05'::date,
  'the latest posted payment, not the later removed one'
);

select is(
  (select b.last_paid_on from public.loan_balances b where b.loan_id = (select id from f1258 where label = 'none')),
  null::date,
  'a loan with no payment has none'
);

select is(
  (select b.last_paid_on from public.loan_balances b where b.loan_id = (select id from f1258 where label = 'flagged')),
  '2026-03-10'::date,
  'a payment waiting for review still counts as paid'
);

select is(
  (select b.balance_minor from public.loan_balances b where b.loan_id = (select id from f1258 where label = 'paid')),
  99000::bigint,
  'the balance is unchanged: two posted principal parts of 500'
);

select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
   where a.attrelid = 'public.loan_balances'::regclass and a.attnum > 0 and not a.attisdropped),
  array['company_id', 'loan_id', 'currency', 'balance_minor', 'flagged_parts', 'project_id', 'last_paid_on'],
  'last_paid_on is appended last'
);

select ok(
  (select c.reloptions && array['security_invoker=true'] from pg_class c
   join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'loan_balances'),
  'the view still runs as the caller'
);

select tests.authenticate_as('f1258_a');

select is(
  (select last_paid_on from public.loan_balances where loan_id = (select id from f1258 where label = 'paid')),
  '2026-03-05'::date,
  'RLS: company A''s owner reads A''s own loan and its payment'
);

select is(
  (select count(*)::int from public.loan_balances where loan_id = (select id from f1258 where label = 'lb')),
  0,
  'RLS: company A''s owner does not read B''s loan'
);

select tests.clear_authentication();
select tests.authenticate_as('f1258_b');

select results_eq(
  $$select loan_id, last_paid_on from public.loan_balances$$,
  $$select id, '2026-06-01'::date from f1258 where label = 'lb'$$,
  'RLS: company B''s owner reads only B''s loan and its payment'
);

select * from finish();

rollback;
