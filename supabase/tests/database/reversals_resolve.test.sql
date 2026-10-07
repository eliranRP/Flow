-- FLOW-104 review. When resolve_review changes only the project, the role comes from the
-- line's own category kind, not from its direction (decision 0102). Invented data only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('rr_owner', 'rr-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('rr_owner'), 'Example Resolve Reversals LLC', false);

create temp table rr_ref (label text primary key, id uuid);
grant all on rr_ref to authenticated, service_role;

insert into rr_ref (label, id)
select 'co', id from public.companies where name = 'Example Resolve Reversals LLC';

insert into public.projects (company_id, name, status)
select (select id from rr_ref where label = 'co'), v.name, 'active'
from (values ('Site One'), ('Site Two')) v(name);

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from rr_ref where label = 'co'), v.name, v.kind::public.category_kind, 60, false, false
from (values ('Rent income', 'income'), ('Materials', 'expense')) v(name, kind);

insert into rr_ref (label, id)
select case name when 'Site One' then 'p1' else 'p2' end, id
from public.projects where company_id = (select id from rr_ref where label = 'co');
insert into rr_ref (label, id)
select case name when 'Rent income' then 'rent' else 'materials' end, id
from public.categories
where company_id = (select id from rr_ref where label = 'co') and name in ('Rent income', 'Materials');

create function pg_temp.mk(
  p_key text, p_direction text, p_doc_kind text, p_role text, p_net bigint, p_cat text
) returns void
language plpgsql
as $$
begin
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
    user_assigned, category_assigned
  ) values (
    (select id from rr_ref where label = 'co'),
    p_direction::public.txn_direction, p_doc_kind::public.doc_kind,
    p_role::public.pnl_role, 'posted', 'ILS',
    p_net, p_net, 0, 'source',
    '2026-06-10', '2026-06-10', 'manual', 'rr:' || p_key,
    null,
    (select id from rr_ref where label = p_cat),
    'example ' || p_key, false, true
  );
  insert into rr_ref (label, id)
  select p_key, id from public.transactions where idempotency_key = 'rr:' || p_key;
end
$$;

-- An outflow already filed under an income category, and an inflow already filed under an
-- expense category. Both still need a project.
select pg_temp.mk('q1', 'expense', 'expense', null, -10000, 'rent');
select pg_temp.mk('q2', 'income',  'receipt', null,   5000, 'materials');

insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from rr_ref where label = 'co'), id, 'open', 'missing_project'
from rr_ref where label in ('q1', 'q2');

insert into rr_ref (label, id)
select 'rev:' || replace(t.idempotency_key, 'rr:', ''), q.id
from public.review_queue q join public.transactions t on t.id = q.transaction_id
where t.idempotency_key like 'rr:%';

create function pg_temp.state(p_label text) returns jsonb language sql as $$
  select jsonb_build_object(
    'role', t.pnl_role,
    'project', (select p.name from public.projects p where p.id = t.project_id),
    'shares', (select count(*) from public.allocations a where a.transaction_id = t.id))
  from public.transactions t where t.id = (select id from rr_ref where label = p_label);
$$;
grant execute on function pg_temp.state(text) to authenticated;

select tests.authenticate_as('rr_owner');

select lives_ok(
  format('select public.resolve_review(%L::uuid, ''changed'', %L::uuid, null, false, false)',
    (select id from rr_ref where label = 'rev:q1'), (select id from rr_ref where label = 'p1')),
  'resolve_review sets only the project on an outflow filed under an income category'
);
select is(
  pg_temp.state('q1'),
  '{"role": null, "project": "Site One", "shares": 0}'::jsonb,
  'the role follows the line''s own income category: no cost role, no share'
);
select lives_ok(
  format('select public.resolve_review(%L::uuid, ''changed'', %L::uuid, null, false, false)',
    (select id from rr_ref where label = 'rev:q2'), (select id from rr_ref where label = 'p2')),
  'resolve_review sets only the project on an inflow filed under an expense category'
);
select is(
  pg_temp.state('q2'),
  '{"role": "project", "project": "Site Two", "shares": 1}'::jsonb,
  'the role follows the line''s own expense category: a project cost with one share'
);
select is(
  (select a.amount_net from public.allocations a
   where a.transaction_id = (select id from rr_ref where label = 'q2')),
  5000::bigint,
  'the share carries the line amount'
);
select is(
  (select j->'income_agorot' from (select public.get_project((select id from rr_ref where label = 'p1'), 'cash') j) s),
  '-10000'::jsonb,
  'the project reads the reversal as negative income'
);

select * from finish();
rollback;
