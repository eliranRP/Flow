-- FLOW-1232: loan_balances gets project_id (the loan's project), appended last. The rows are otherwise the old
-- definition's (20261028093217_ledger_only.sql, copied below into pg_temp), the project_id is the loan's, and RLS
-- still limits the rows to the caller's company. @example.com only.

begin;

select plan(15);

do $users$
begin
  perform tests.create_supabase_user('f1231_a', 'f1231a@example.com');
  perform tests.create_supabase_user('f1231_b', 'f1231b@example.com');
end
$users$;

create temp table f1231 (label text primary key, id uuid);
grant all on f1231 to authenticated, service_role;

insert into public.companies (owner_id, name) values (tests.get_supabase_uid('f1231_a'), 'Example A');
insert into public.companies (owner_id, name) values (tests.get_supabase_uid('f1231_b'), 'Example B');
insert into f1231 select 'co_a', id from public.companies where name = 'Example A';
insert into f1231 select 'co_b', id from public.companies where name = 'Example B';

insert into public.projects (company_id, name, status)
select (select id from f1231 where label = v.co), v.name, 'active'
from (values ('co_a', 'Site One'), ('co_a', 'Site Two'), ('co_b', 'Site B')) v(co, name);
insert into f1231 select 'p1', id from public.projects where name = 'Site One';
insert into f1231 select 'p2', id from public.projects where name = 'Site Two';
insert into f1231 select 'pb', id from public.projects where name = 'Site B';

-- Four loans: one per project of A, one with no project, one of B.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
  escrow_minor, currency, project_id)
select (select id from f1231 where label = v.co), v.name, v.principal, 60000, 360, '2026-01-01', 1000, 100, v.currency,
  (select id from f1231 where label = v.project)
from (values
  ('co_a', 'Loan P1', 120000, 'USD', 'p1'),
  ('co_a', 'Loan P2', 90000, 'ILS', 'p2'),
  ('co_a', 'Loan none', 50000, 'USD', null),
  ('co_b', 'Loan B', 70000, 'USD', 'pb')
) v(co, name, principal, currency, project);
insert into f1231 select 'l1', id from public.loans where name = 'Loan P1';
insert into f1231 select 'l2', id from public.loans where name = 'Loan P2';
insert into f1231 select 'l3', id from public.loans where name = 'Loan none';
insert into f1231 select 'lb', id from public.loans where name = 'Loan B';

-- One 10000 line per loan except l3, split into interest 5000, escrow 2000 and principal 3000. l2's line is then
-- flagged, so l2 has its three parts flagged and its principal does not count.
insert into public.transactions (company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description)
select l.company_id, 'expense', 'expense', -10000, -10000, 10000, 0, 'unknown', '2026-02-01', l.currency, 'manual',
  'f1231:' || f.label, 'Example payment'
from f1231 f join public.loans l on l.id = f.id
where f.label in ('l1', 'l2', 'lb');

select tests.loan_split(t.id, l.id, jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount,
  'scheduled_minor', v.amount, 'category_id', c.id)))
from f1231 f
join public.loans l on l.id = f.id
join public.transactions t on t.company_id = l.company_id and t.idempotency_key = 'f1231:' || f.label
cross join (values ('interest', 'ריבית משכנתא', 5000), ('escrow', 'מסים וביטוח', 2000),
  ('principal', 'תשלומי הלוואה', 3000)) v(part, category, amount)
join public.categories c on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense'
where f.label in ('l1', 'l2', 'lb')
group by t.id, l.id;

select tests.loan_split_review(t.id, true)
from public.transactions t where t.idempotency_key = 'f1231:l2';

-- The old definition, as 20261028093217_ledger_only.sql has it (without project_id), run as the owner.
create temp view old_loan_balances as
  select l.company_id, l.id as loan_id, l.currency,
    (l.principal_minor::numeric - coalesce(sum(s.amount_minor) filter (
      where s.part = 'principal'::public.loan_split_part and t.line_status = 'posted'::public.line_status
        and t.removed_at is null and s.needs_review is not true), 0::numeric))::bigint as balance_minor,
    count(*) filter (
      where s.needs_review and t.removed_at is null and t.line_status is distinct from 'void'::public.line_status
    )::integer as flagged_parts
  from public.loans l
  left join private.loan_parts s on s.company_id = l.company_id and s.loan_id = l.id
  left join public.transactions t on t.company_id = s.company_id and t.id = s.transaction_id
  group by l.company_id, l.id, l.currency, l.principal_minor;
grant select on old_loan_balances to authenticated, service_role;

-- The fixture has what the comparison needs: a paid loan, a flagged one, one with no parts.
select results_eq(
  $$select f.label, b.balance_minor, b.flagged_parts from f1231 f join public.loan_balances b on b.loan_id = f.id
    where f.label like 'l%' order by f.label$$,
  $$values ('l1'::text, 117000::bigint, 0), ('l2', 90000, 3), ('l3', 50000, 0), ('lb', 67000, 0)$$,
  'the fixture: a paid loan, a flagged one, a loan with no parts, a loan of another company'
);

select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
   where a.attrelid = 'public.loan_balances'::regclass and a.attnum > 0 and not a.attisdropped),
  array['company_id', 'loan_id', 'currency', 'balance_minor', 'flagged_parts', 'project_id'],
  'the old columns keep their order and project_id comes last'
);

select is(
  (select count(*)::int from public.loan_balances),
  (select count(*)::int from old_loan_balances),
  'the view has one row per loan, as the old definition has'
);

select is_empty(
  $$(select company_id, loan_id, currency, balance_minor, flagged_parts from public.loan_balances
     except select company_id, loan_id, currency, balance_minor, flagged_parts from old_loan_balances)
    union all
    (select company_id, loan_id, currency, balance_minor, flagged_parts from old_loan_balances
     except select company_id, loan_id, currency, balance_minor, flagged_parts from public.loan_balances)$$,
  'apart from project_id, every row is the old definition''s'
);

select is_empty(
  $$select 1 from public.loan_balances b join public.loans l on l.company_id = b.company_id and l.id = b.loan_id
    where b.project_id is distinct from l.project_id$$,
  'project_id is the loan''s project, null included'
);

select is(
  (select b.project_id from public.loan_balances b where b.loan_id = (select id from f1231 where label = 'l2')),
  (select id from f1231 where label = 'p2'),
  'a loan of project two carries project two'
);

select is(
  (select count(*)::int from public.loan_balances where project_id is null),
  1,
  'the loan with no project has a null project_id'
);

select ok(
  (select c.reloptions && array['security_invoker=true'] from pg_class c
   join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'loan_balances'),
  'the view still runs as the caller'
);

select ok(
  has_table_privilege('authenticated', 'public.loan_balances', 'select')
  and has_table_privilege('service_role', 'public.loan_balances', 'select')
  and not has_table_privilege('anon', 'public.loan_balances', 'select')
  and not has_table_privilege('authenticated', 'public.loan_balances', 'insert'),
  'the grants are unchanged: select for authenticated and service_role, nothing for anon'
);

select tests.authenticate_as('f1231_a');

select is(
  (select count(*)::int from public.loan_balances),
  3,
  'RLS: company A''s owner reads A''s three loans'
);

select is(
  (select count(*)::int from public.loan_balances where loan_id = (select id from f1231 where label = 'lb')),
  0,
  'RLS: company A''s owner does not read B''s loan, even by its id'
);

select is(
  (select count(*)::int from public.loan_balances where project_id = (select id from f1231 where label = 'pb')),
  0,
  'RLS: a filter by B''s project gives A''s owner nothing'
);

select results_eq(
  $$select loan_id from public.loan_balances where project_id = (select id from f1231 where label = 'p1')$$,
  $$select id from f1231 where label = 'l1'$$,
  'a filter by project one gives only project one''s loan'
);

select tests.clear_authentication();
select tests.authenticate_as('f1231_b');

select results_eq(
  $$select loan_id, project_id from public.loan_balances$$,
  $$select l.id, p.id from f1231 l, f1231 p where l.label = 'lb' and p.label = 'pb'$$,
  'RLS: company B''s owner reads only B''s loan, with B''s project'
);

select is(
  (select count(*)::int from public.loan_balances where project_id = (select id from f1231 where label = 'p1')),
  0,
  'RLS: B''s owner filtering by A''s project gets nothing'
);

select * from finish();

rollback;
