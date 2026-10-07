-- FLOW-107. get_loan_split: the parts of a loan payment and what each does in the P&L.
-- Invented data only. Amounts are USD minor units (100000 is 1000.00).

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('lr_owner', 'lr-owner@example.com');
  perform tests.create_supabase_user('lr_other', 'lr-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lr_owner'), 'Example Split Read LLC', false),
  (tests.get_supabase_uid('lr_other'), 'Example Split Neighbour LLC', false);

insert into public.categories (company_id, name, kind, sort_order, is_default)
select c.id, 'Mortgage servicer', 'expense'::public.category_kind, 50, false
from public.companies c
where c.name in ('Example Split Read LLC', 'Example Split Neighbour LLC');

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
select c.id, 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD'
from public.companies c
where c.name in ('Example Split Read LLC', 'Example Split Neighbour LLC');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description,
  user_assigned, removed_at
)
select
  c.id, 'expense', 'expense', null, 'posted', 'USD',
  v.gross, v.net, -v.gross, v.vat, 'source',
  '2026-06-10', '2026-06-10', 'manual', v.ikey,
  (select k.id from public.categories k where k.company_id = c.id and k.name = 'Mortgage servicer'),
  v.ikey, true,
  case when v.removed then now() end
from public.companies c
join (values
  ('lr_main',    'Example Split Read LLC',      -100000, -100000,     0, false),
  ('lr_flagged', 'Example Split Read LLC',       -50000,  -50000,     0, false),
  ('lr_vat',     'Example Split Read LLC',       -11800,  -10000, -1800, false),
  ('lr_plain',   'Example Split Read LLC',       -20000,  -20000,     0, false),
  ('lr_removed', 'Example Split Read LLC',      -100000, -100000,     0, true),
  ('lr_theirs',  'Example Split Neighbour LLC',  -30000,  -30000,     0, false)
) as v(ikey, company, gross, net, vat, removed) on v.company = c.name;

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select
  t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k
   where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense'),
  v.flagged
from public.transactions t
join public.loans l on l.company_id = t.company_id
join (values
  ('lr_main',    'principal', 10000, 'תשלומי הלוואה', false),
  ('lr_main',    'interest',  70000, 'ריבית משכנתא', false),
  ('lr_main',    'escrow',    20000, 'מסים וביטוח',   false),
  ('lr_flagged', 'interest',  30000, 'ריבית משכנתא', true),
  ('lr_flagged', 'escrow',    10000, 'מסים וביטוח',   true),
  ('lr_flagged', 'principal', 10000, 'תשלומי הלוואה', true),
  ('lr_vat',     'interest',   7000, 'ריבית משכנתא', false),
  ('lr_vat',     'escrow',     2800, 'מסים וביטוח',   false),
  ('lr_vat',     'principal',  2000, 'תשלומי הלוואה', false),
  ('lr_removed', 'interest',  70000, 'ריבית משכנתא', false),
  ('lr_removed', 'escrow',    20000, 'מסים וביטוח',   false),
  ('lr_removed', 'principal', 10000, 'תשלומי הלוואה', false),
  ('lr_theirs',  'interest',  20000, 'ריבית משכנתא', false),
  ('lr_theirs',  'escrow',     5000, 'מסים וביטוח',   false),
  ('lr_theirs',  'principal',  5000, 'תשלומי הלוואה', false)
) as v(ikey, part, amount, cat, flagged) on t.idempotency_key = v.ikey;

create temp table lr_ref (label text primary key, id uuid);
grant all on lr_ref to authenticated, service_role;
insert into lr_ref (label, id)
select idempotency_key, id from public.transactions where idempotency_key like 'lr_%';

create function pg_temp.split(p_label text)
returns jsonb
language sql
as $$
  select public.get_loan_split((select id from lr_ref where label = p_label));
$$;
grant execute on function pg_temp.split(text) to authenticated;

select tests.authenticate_as('lr_owner');

select is(
  pg_temp.split('lr_main')->'parts',
  '[{"part": "interest", "amount_minor": 70000, "in_pnl": true},
    {"part": "escrow", "amount_minor": 20000, "in_pnl": true},
    {"part": "principal", "amount_minor": 10000, "in_pnl": false}]'::jsonb,
  'a valid split lists interest, escrow, principal; the principal is kept out of the P&L'
);

select is(
  (select sum((p->>'amount_minor')::bigint) from jsonb_array_elements(pg_temp.split('lr_main')->'parts') p),
  100000::numeric,
  'the parts add up to the bank line'
);

select is(pg_temp.split('lr_main')->'by_parts', 'true'::jsonb, 'a valid split counts by its parts');
select is(pg_temp.split('lr_main')->'needs_review', 'false'::jsonb, 'a valid split does not need review');
select is(pg_temp.split('lr_main')->>'loan_name', 'Example mortgage', 'the loan is named');

select is(
  (select jsonb_build_object('by_parts', s->'by_parts', 'needs_review', s->'needs_review',
     'in_pnl', (select jsonb_agg(p->'in_pnl') from jsonb_array_elements(s->'parts') p))
   from (select pg_temp.split('lr_flagged') s) x),
  '{"by_parts": false, "needs_review": true, "in_pnl": [null, null, null]}'::jsonb,
  'a split that needs review counts as the whole line, so no part has its own P&L flag'
);

select is(
  (select jsonb_build_object('by_parts', s->'by_parts', 'parts', jsonb_array_length(s->'parts'))
   from (select pg_temp.split('lr_vat') s) x),
  '{"by_parts": false, "parts": 3}'::jsonb,
  'a line with VAT keeps its parts but counts as the whole line'
);

select is(pg_temp.split('lr_plain'), null, 'a line with no split reads null');
select is(pg_temp.split('lr_removed'), null, 'a removed line reads null');
select is(pg_temp.split('lr_theirs'), null, 'another company''s split reads null');
select is(public.get_loan_split(gen_random_uuid()), null, 'an unknown id reads null');

select tests.authenticate_as('lr_other');

select is(
  pg_temp.split('lr_theirs')->'by_parts',
  'true'::jsonb,
  'positive control: the other company reads its own split'
);

select tests.clear_authentication();

select ok(
  not has_function_privilege('anon', 'public.get_loan_split(uuid)', 'execute'),
  'anon cannot call get_loan_split'
);
select ok(
  has_function_privilege('authenticated', 'public.get_loan_split(uuid)', 'execute'),
  'authenticated can call get_loan_split'
);

select * from finish();
rollback;
