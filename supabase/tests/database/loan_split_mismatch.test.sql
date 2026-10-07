-- FLOW-101 review. A split whose parts no longer sum to the line's net amount
-- (the line was re-synced without touching amount_original, so nothing flagged it)
-- falls back to the whole line instead of counting stale parts. Invented data only.

begin;

select plan(5);

select tests.create_supabase_user('lm_owner', 'lm-owner@example.com');
select tests.create_supabase_user('lm_other', 'lm-other@example.com');

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lm_owner'), 'Example Mismatch LLC', false),
  (tests.get_supabase_uid('lm_other'), 'Example Mismatch Neighbour LLC', false);

create temp table lm_ref (label text primary key, id uuid);
grant all on lm_ref to authenticated, service_role;
insert into lm_ref (label, id) select 'co', id from public.companies where name = 'Example Mismatch LLC';

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from lm_ref where label = 'co'), 'Mortgage servicer', 'expense', 50, false);

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from lm_ref where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
values ((select id from lm_ref where label = 'co'), 'expense', 'expense', 'overhead', 'posted', 'USD',
  -100000, -100000, 100000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'pay',
  (select id from public.categories where company_id = (select id from lm_ref where label = 'co') and name = 'Mortgage servicer'),
  'pay', true);

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
)
select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense')
from public.transactions t
join public.loans l on l.company_id = t.company_id
join (values
  ('interest', 70000, 'ריבית משכנתא'),
  ('escrow', 20000, 'מסים וביטוח'),
  ('principal', 10000, 'תשלומי הלוואה')
) as v(part, amount, cat) on t.idempotency_key = 'pay';

create function pg_temp.usd()
returns jsonb
language sql
as $$
  select x from jsonb_array_elements(
    public.company_pnl((select id from lm_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'by_currency') x
  where x->>'currency' = 'USD';
$$;
grant execute on function pg_temp.usd() to authenticated;

select tests.authenticate_as('lm_owner');

select is(
  pg_temp.usd()->'expense_minor',
  '90000'::jsonb,
  'matching parts count by part (owner positive control)'
);

-- A re-sync rewrites amount_net and leaves amount_original, so the parts are not flagged.
reset role;
update public.transactions set amount_gross = -120000, amount_net = -120000 where idempotency_key = 'pay';
select tests.authenticate_as('lm_owner');

select is(
  (select bool_and(s.needs_review) from public.loan_splits s
   join public.transactions t on t.id = s.transaction_id where t.idempotency_key = 'pay'),
  false,
  'precondition: nothing flagged the parts'
);

select is(
  (select jsonb_build_object('expense', x->'expense_minor', 'excluded', x->'excluded_expense_minor', 'fallback', x->'loan_split_fallback_count')
   from pg_temp.usd() x),
  '{"expense": 120000, "excluded": 0, "fallback": 1}'::jsonb,
  'parts that no longer sum to the line fall back to the whole line and are counted'
);

select is(
  (select count(*)::int from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key = 'pay' and l.part is null and l.loan_split_fallback),
  1,
  'the view emits the whole line once, marked as a fallback'
);

select tests.authenticate_as('lm_other');

select is(
  (select count(*)::int from private.pnl_lines l
   where l.company_id = (select id from lm_ref where label = 'co')),
  0,
  'another company''s caller sees none of these rows'
);

select * from finish();

rollback;
