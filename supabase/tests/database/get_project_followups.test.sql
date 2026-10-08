-- FLOW-209. get_project's transactions[] rows carry line_status, and other_currencies counts
-- a shared line's share for this project even when the line's own project_id is this project,
-- as by_currency does. Invented data only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('gpf_owner', 'gpf-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('gpf_owner'), 'Example Followups LLC', false);

insert into public.projects (company_id, name, status)
select c.id, n, 'active'
from public.companies c
cross join (values ('Followups A'), ('Followups B')) v(n)
where c.name = 'Example Followups LLC';

create temp table gpf_ref as
select
  (select id from public.companies where name = 'Example Followups LLC') as cid,
  (select id from public.projects where name = 'Followups A') as a,
  (select id from public.projects where name = 'Followups B') as b;
grant select on gpf_ref to authenticated;

-- One posted and one pending ILS line on project A.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select r.cid, 'expense', 'expense', 'project', s.status::public.line_status, 'ILS',
  -100, -100, 0, 'source',
  s.d::date, s.d::date, 'manual', 'gpf:' || s.status, r.a, 'example ' || s.status, true
from gpf_ref r
cross join (values ('posted', '2026-06-10'), ('pending', '2026-06-11')) s(status, d);

-- A posted USD shared line that keeps project A as its own project_id: 60% A, 40% B.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select r.cid, 'expense', 'expense', 'shared', 'posted', 'USD',
  -1000, -1000, 0, 'source',
  '2026-06-12', '2026-06-12', 'manual', 'gpf:shared', r.a, 'example shared', true
from gpf_ref r;

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select r.cid, t.id, s.project_id, s.bp, s.amount
from gpf_ref r
join public.transactions t on t.idempotency_key = 'gpf:shared' and t.company_id = r.cid
cross join lateral (values (r.a, 6000, -600), (r.b, 4000, -400)) s(project_id, bp, amount);

select tests.authenticate_as('gpf_owner');

select is(
  (select x->>'line_status'
   from jsonb_array_elements(public.get_project((select a from gpf_ref), 'cash')->'transactions') x
   where x->>'description' = 'example pending'),
  'pending',
  'a pending line reads line_status pending'
);

select is(
  (select x->>'line_status'
   from jsonb_array_elements(public.get_project((select a from gpf_ref), 'cash')->'transactions') x
   where x->>'description' = 'example posted'),
  'posted',
  'a posted line reads line_status posted'
);

select is(
  (select x->>'expense_minor'
   from jsonb_array_elements(public.get_project((select a from gpf_ref), 'cash')->'other_currencies') x
   where x->>'currency' = 'USD'),
  '-600',
  'other_currencies counts A''s share of a shared line whose project_id is A'
);

select is(
  (select -(x->>'expense_minor')::bigint
   from jsonb_array_elements(public.get_project((select a from gpf_ref), 'cash')->'other_currencies') x
   where x->>'currency' = 'USD'),
  (select (x->>'shared_minor')::bigint
   from jsonb_array_elements(public.get_project((select a from gpf_ref), 'cash')->'by_currency') x
   where x->>'currency' = 'USD'),
  'other_currencies agrees with by_currency shared_minor'
);

select is(
  (select (x->>'count')::integer
   from jsonb_array_elements(public.get_project((select a from gpf_ref), 'cash')->'other_currencies') x
   where x->>'currency' = 'USD'),
  1,
  'the shared line counts once for A'
);

select is(
  (select x->>'expense_minor'
   from jsonb_array_elements(public.get_project((select b from gpf_ref), 'invoiced')->'other_currencies') x
   where x->>'currency' = 'USD'),
  '-400',
  'B''s share is unchanged'
);

select * from finish();
rollback;
