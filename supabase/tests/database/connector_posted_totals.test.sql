-- Pending lines stay out of the profit sums and still appear on the project list.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('posted_owner', 'posted-owner@test.flow');
end
$users$;

create temp table posted_ref (label text primary key, id uuid);
grant all on posted_ref to authenticated;

select tests.authenticate_as('posted_owner');
select lives_ok($$select public.create_company('סכומים', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'אתר', null, 'active')$$, 'owner opens a project');

insert into posted_ref (label, id) select 'company', id from public.companies;
insert into posted_ref (label, id) select 'project', id from public.projects where name = 'אתר';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  current_date, 'manual', 'posted:line', (select id from posted_ref where label = 'project'), 'נרשם'
from posted_ref where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'expense', 'expense', 'project', 'pending',
  -5000, -5000, 0, 'unknown',
  current_date, 'manual', 'pending:line', (select id from posted_ref where label = 'project'), 'ממתין'
from posted_ref where label = 'company';

select tests.authenticate_as('posted_owner');

select is(
  (public.get_home() ->> 'net_profit_agorot')::bigint,
  -10000::bigint,
  'home profit counts the posted line only'
);

select is(
  (public.get_project((select id from posted_ref where label = 'project')) ->> 'direct_agorot')::bigint,
  10000::bigint,
  'project direct cost counts the posted line only'
);

select is(
  jsonb_array_length(public.get_project((select id from posted_ref where label = 'project')) -> 'transactions'),
  2,
  'the project list still shows the pending line'
);

select is(
  (public.company_pnl((select id from posted_ref where label = 'company'), null, null, 'cash') ->> 'expense_agorot')::bigint,
  10000::bigint,
  'company profit counts the posted expense only'
);

select * from finish();
rollback;
