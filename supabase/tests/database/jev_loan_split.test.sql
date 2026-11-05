-- FLOW-1032 (decision 0254). Jev splits a loan payment: jev_prefill skips a loan category,
-- jev_prefill_loan writes the split under the prefill gates, jev_loan_candidates lists the loans
-- the job may match, undo_jev_prefill takes the split back, and save_loan_split still works.
-- Fixed dates, invented names, @example.com only.

begin;

select plan(23);

do $users$
begin
  perform tests.create_supabase_user('jls_owner', 'jls-owner@example.com');
end
$users$;

create temp table jls (label text primary key, id uuid);
grant all on jls to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.jls where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select tests.authenticate_as('jls_owner');
select public.create_company('Example Jev Loan Co', true);
reset role;
insert into jls (label, id) select 'co', id from public.companies where name = 'Example Jev Loan Co';
insert into jls (label, id)
select 'cat_' || c.loan_part::text, c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.loan_part is not null;
insert into jls (label, id)
select 'cat_plain', c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.kind = 'expense' and c.loan_part is null and not c.hidden
  and not c.excluded_from_pnl
order by c.name, c.id limit 1;

-- 120,000.00 at 6 percent over 360 months plus 100.00 escrow; a demand loan; a closed loan.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
  payment_minor, escrow_minor, currency, kind)
values
  (pg_temp.id('co'), 'Example Mortgage', 12000000, 60000, 360, '2026-01-01', 81946, 10000, 'USD', 'amortizing'),
  (pg_temp.id('co'), 'Example Demand', 100000, 0, null, '2026-01-01', null, 0, 'USD', 'demand'),
  (pg_temp.id('co'), 'Example Closed', 100000, 60000, 12, '2026-01-01', 8607, 0, 'USD', 'amortizing');
insert into jls (label, id) select 'mortgage', id from public.loans where name = 'Example Mortgage';
insert into jls (label, id) select 'demand', id from public.loans where name = 'Example Demand';
insert into jls (label, id) select 'closed', id from public.loans where name = 'Example Closed';
update public.loans set status = 'closed', closed_on = '2026-01-15' where id = pg_temp.id('closed');

insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, cash_date, currency, source, idempotency_key, description,
  category_id, user_assigned, category_assigned
)
select pg_temp.id('co'), 'expense', 'expense', 'posted', -81946, -81946, 81946, 0, 'unknown',
  v.day, v.day, 'USD', 'manual', 'jls:' || v.label, 'Example servicer payment',
  pg_temp.id('cat_principal'), v.assigned, v.assigned
from (values
  ('l1', '2026-02-01'::date, false),
  ('l2', '2026-03-01'::date, false),
  ('l3', '2026-04-01'::date, false),
  ('l_closed', '2026-05-01'::date, false),
  ('l_set', '2026-05-02'::date, true),
  ('l_bad', '2026-05-03'::date, false)
) as v(label, day, assigned);
insert into jls (label, id) select replace(idempotency_key, 'jls:', ''), id
from public.transactions where idempotency_key like 'jls:%';
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, case when t.idempotency_key = 'jls:l_closed' then 'approved' else 'open' end::public.review_status, 'test'
from public.transactions t
where t.idempotency_key like 'jls:%'
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
update public.review_queue set status = 'approved'
where transaction_id = pg_temp.id('l_closed');
set constraints all immediate;

-- The first row of the schedule: 600.00 interest, 100.00 escrow, 119.46 principal.
create or replace function pg_temp.parts(p_interest bigint, p_escrow bigint, p_principal bigint)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', p_interest, 'scheduled_minor', p_interest),
    jsonb_build_object('part', 'escrow', 'amount_minor', p_escrow, 'scheduled_minor', p_escrow),
    jsonb_build_object('part', 'principal', 'amount_minor', p_principal, 'scheduled_minor', p_principal)
  );
$$;
grant execute on function pg_temp.parts(bigint, bigint, bigint) to authenticated, service_role;

create temp table jls_out (label text primary key, result jsonb);
grant all on jls_out to authenticated, service_role;

-- Not the service role: refused.
select tests.authenticate_as('jls_owner');
select throws_ok(
  $$select public.jev_prefill_loan(pg_temp.id('co'), pg_temp.id('l1'), pg_temp.id('mortgage'), pg_temp.parts(60000, 10000, 11946))$$,
  '42501', null, 'a member cannot call jev_prefill_loan'
);
select throws_ok(
  $$select public.jev_loan_candidates(pg_temp.id('co'))$$,
  '42501', null, 'a member cannot read jev_loan_candidates'
);
reset role;

do $call$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into jls_out values ('cands_before', public.jev_loan_candidates(pg_temp.id('co')));
  -- A loan category on the whole line is never filled.
  insert into jls_out values ('cat_interest', public.jev_prefill(
    pg_temp.id('co'), pg_temp.id('l1'), null, pg_temp.id('cat_interest'), 'jev-1.13.0', 0.99));
  insert into jls_out values ('cat_plain', public.jev_prefill(
    pg_temp.id('co'), pg_temp.id('l_bad'), null, pg_temp.id('cat_plain'), 'jev-1.13.0', 0.99));
  insert into jls_out values ('l1', public.jev_prefill_loan(
    pg_temp.id('co'), pg_temp.id('l1'), pg_temp.id('mortgage'), pg_temp.parts(60000, 10000, 11946), 'jev-1.13.0', 0.99));
  insert into jls_out values ('l1_again', public.jev_prefill_loan(
    pg_temp.id('co'), pg_temp.id('l1'), pg_temp.id('mortgage'), pg_temp.parts(60000, 10000, 11946), 'jev-1.13.0', 0.99));
  insert into jls_out values ('l_closed', public.jev_prefill_loan(
    pg_temp.id('co'), pg_temp.id('l_closed'), pg_temp.id('mortgage'), pg_temp.parts(60000, 10000, 11946), 'jev-1.13.0', 0.99));
  insert into jls_out values ('l_set', public.jev_prefill_loan(
    pg_temp.id('co'), pg_temp.id('l_set'), pg_temp.id('mortgage'), pg_temp.parts(60000, 10000, 11946), 'jev-1.13.0', 0.99));
  insert into jls_out values ('l_bad', public.jev_prefill_loan(
    pg_temp.id('co'), pg_temp.id('l_bad'), pg_temp.id('mortgage'), pg_temp.parts(60000, 10000, 1), 'jev-1.13.0', 0.99));
  insert into jls_out values ('l_bad_closed_loan', public.jev_prefill_loan(
    pg_temp.id('co'), pg_temp.id('l_bad'), pg_temp.id('closed'), pg_temp.parts(60000, 10000, 11946), 'jev-1.13.0', 0.99));
  insert into jls_out values ('l2', public.jev_prefill_loan(
    pg_temp.id('co'), pg_temp.id('l2'), pg_temp.id('mortgage'), pg_temp.parts(59940, 10000, 12006), 'jev-1.13.0', 0.95));
  insert into jls_out values ('cands_after', public.jev_loan_candidates(pg_temp.id('co')));
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end
$call$;

-- 1. The candidates: the open scheduled loan only, with no payment yet, then the newest one.
select is(
  (select jsonb_agg(e->>'id') from jsonb_array_elements((select result from jls_out where label = 'cands_before')) e),
  jsonb_build_array(pg_temp.id('mortgage')::text),
  'jev_loan_candidates lists the open scheduled loan, not the demand or the closed one'
);
select is(
  (select result->0->'last_payment_minor' from jls_out where label = 'cands_before'),
  'null'::jsonb,
  'a loan with no payment attached has no last payment'
);
select is(
  (select (result->0->>'last_payment_minor')::bigint from jls_out where label = 'cands_after'),
  81946::bigint,
  'after a split the last payment is that line''s amount'
);

-- 2. jev_prefill skips a loan category and still fills a plain one.
select is(
  (select result from jls_out where label = 'cat_interest'),
  '{"project": false, "category": false}'::jsonb,
  'jev_prefill never fills a loan-part category on a whole line'
);
select is(
  (select result->'category' from jls_out where label = 'cat_plain'),
  'true'::jsonb,
  'jev_prefill still fills a category with no loan part'
);

-- 3. The split.
select is(
  (select result->'loan' from jls_out where label = 'l1'),
  'true'::jsonb,
  'jev_prefill_loan splits an open, unassigned line'
);
select is(
  (select jsonb_object_agg(s.part::text, s.amount_minor) from private.loan_parts s where s.transaction_id = pg_temp.id('l1')),
  '{"interest": 60000, "escrow": 10000, "principal": 11946}'::jsonb,
  'the line carries the three parts'
);
select is(
  (select jsonb_object_agg(s.part::text, s.category_id) from private.loan_parts s where s.transaction_id = pg_temp.id('l1')),
  jsonb_build_object('interest', pg_temp.id('cat_interest'), 'escrow', pg_temp.id('cat_escrow'), 'principal', pg_temp.id('cat_principal')),
  'each part goes to its loan category'
);
select is(
  (select jp.loan_id from public.jev_prefills jp where jp.transaction_id = pg_temp.id('l1')),
  pg_temp.id('mortgage'),
  'the audit row names the loan'
);
select is(
  (select q.status::text from public.review_queue q where q.transaction_id = pg_temp.id('l1') order by q.created_at desc limit 1),
  'open',
  'the line stays in review: Jev never approves'
);

-- 4. The gates.
select is((select result->>'skipped' from jls_out where label = 'l1_again'), 'split', 'a line already split is left alone');
select is((select result->>'skipped' from jls_out where label = 'l_closed'), 'closed', 'a line out of review is left alone');
select is((select result->>'skipped' from jls_out where label = 'l_set'), 'closed', 'a line the owner set is left alone');
select is(
  (select result - 'reason' from jls_out where label = 'l_bad'),
  '{"loan": false, "skipped": "refused"}'::jsonb,
  'parts that do not add up are refused without an error'
);
select is(
  (select result->>'reason' from jls_out where label = 'l_bad_closed_loan'),
  'loan closed',
  'a loan closed before the line is refused'
);
select is(
  (select count(*)::integer from private.loan_parts s where s.transaction_id = pg_temp.id('l_bad')),
  0,
  'a refused split writes nothing'
);

-- 5. Undo: the split goes, the balance comes back; an owner's change is kept. The ledger checks
-- run at commit, as in the app (a split's legs are replaced in two statements).
set constraints all deferred;
select tests.authenticate_as('jls_owner');
select is(
  (public.undo_jev_prefill(pg_temp.id('l1'))->>'loan_id')::uuid,
  pg_temp.id('mortgage'),
  'undo_jev_prefill takes back a loan split'
);
reset role;
select is(
  (select count(*)::integer from private.loan_parts s where s.transaction_id = pg_temp.id('l1')),
  0,
  'the undone line has no parts'
);
select tests.authenticate_as('jls_owner');
select lives_ok(
  $$select public.save_loan_split(pg_temp.id('l2'), pg_temp.id('mortgage'), pg_temp.parts(59940, 10006, 12000))$$,
  'save_loan_split still writes for the owner'
);
select throws_ok(
  $$select public.undo_jev_prefill(pg_temp.id('l2'))$$,
  'P0001', 'line changed since', 'a split the owner changed is not undone'
);
reset role;
select is(
  (select b.balance_minor from public.loan_balances b where b.loan_id = pg_temp.id('mortgage')),
  12000000::bigint - 12000,
  'the balance counts the owner''s split only'
);

select * from finish();
rollback;
