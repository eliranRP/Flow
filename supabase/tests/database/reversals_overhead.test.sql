-- FLOW-104 review. The overhead income weights read the category kind and let a reversal
-- income line (an outflow under an income category) lower a project's weight on both
-- document kinds (decision 0103). Invented data only. Amounts are minor units.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('ro_owner', 'ro-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('ro_owner'), 'Example Overhead Reversals LLC', false);

create temp table ro_ref (label text primary key, id uuid);
grant all on ro_ref to authenticated, service_role;

insert into ro_ref (label, id)
select 'co', id from public.companies where name = 'Example Overhead Reversals LLC';

insert into public.projects (company_id, name, status)
select (select id from ro_ref where label = 'co'), v.name, 'active'
from (values ('Site One'), ('Site Two')) v(name);

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from ro_ref where label = 'co'), v.name, v.kind::public.category_kind, 60, false, false
from (values ('Rent income', 'income'), ('Materials', 'expense')) v(name, kind);

insert into ro_ref (label, id)
select case name when 'Site One' then 'p1' else 'p2' end, id
from public.projects where company_id = (select id from ro_ref where label = 'co');
insert into ro_ref (label, id)
select case name when 'Rent income' then 'rent' else 'materials' end, id
from public.categories
where company_id = (select id from ro_ref where label = 'co') and name in ('Rent income', 'Materials');

create function pg_temp.mk(
  p_key text, p_direction text, p_doc_kind text, p_role text, p_net bigint, p_cat text, p_project text
) returns void
language plpgsql
as $$
begin
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
    user_assigned
  ) values (
    (select id from ro_ref where label = 'co'),
    p_direction::public.txn_direction, p_doc_kind::public.doc_kind,
    p_role::public.pnl_role, 'posted', 'ILS',
    p_net, p_net, 0, 'source',
    '2026-06-10', '2026-06-10', 'manual', 'ro:' || p_key,
    (select id from ro_ref where label = p_project),
    (select id from ro_ref where label = p_cat),
    'example ' || p_key, true
  );
  insert into ro_ref (label, id)
  select p_key, id from public.transactions where idempotency_key = 'ro:' || p_key;
end
$$;

-- Each project invoices 600.00. Site One took 400.00 of it back: an outflow under the
-- income category. Site Two also refunded 30.00 of a cost: an inflow under Materials,
-- which is a cost, not income, so it must not weigh.
select pg_temp.mk('i1', 'income',  'invoice_receipt', null,       60000, 'rent',      'p1');
select pg_temp.mk('i2', 'income',  'invoice_receipt', null,       60000, 'rent',      'p2');
select pg_temp.mk('v1', 'expense', 'expense',         null,      -40000, 'rent',      'p1');
select pg_temp.mk('v2', 'income',  'invoice_receipt', 'project',   3000, 'materials', 'p2');
select pg_temp.mk('o1', 'expense', 'expense',         'overhead', -100000, 'materials', null);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values ((select id from ro_ref where label = 'co'), (select id from ro_ref where label = 'v2'),
  (select id from ro_ref where label = 'p2'), 10000, 3000);
insert into public.overhead (company_id, transaction_id)
values ((select id from ro_ref where label = 'co'), (select id from ro_ref where label = 'o1'));

select tests.authenticate_as('ro_owner');
select lives_ok($$select public.set_after_overhead(true, null)$$, 'the overhead view is on');

create function pg_temp.share(p_label text) returns jsonb language sql as $$
  select public.get_project((select id from ro_ref where label = p_label), 'cash')
    -> 'overhead_share_agorot';
$$;
grant execute on function pg_temp.share(text) to authenticated;

select is(
  (select jsonb_build_object('p1', pg_temp.share('p1'), 'p2', pg_temp.share('p2'))),
  '{"p1": 30000, "p2": 70000}'::jsonb,
  'the reversal lowers Site One''s income weight, so it carries less of the overhead'
);
select is(
  (select (pg_temp.share('p1'))::text::bigint + (pg_temp.share('p2'))::text::bigint),
  100000::bigint,
  'the shares still add up to the company overhead'
);
select is(
  (select j->'income_agorot' from (select public.get_project((select id from ro_ref where label = 'p2'), 'cash') j) s),
  '60000'::jsonb,
  'the refund on Site Two is a cost, not income, so it does not weigh'
);
select is(
  (select j->'income_agorot' from (select public.get_project((select id from ro_ref where label = 'p1'), 'invoiced') j) s),
  '20000'::jsonb,
  'Site One income on the invoiced basis counts the reversal too'
);

select * from finish();
rollback;
