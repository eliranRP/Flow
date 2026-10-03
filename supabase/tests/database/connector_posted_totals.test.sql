-- Pending lines stay out of the profit sums and still appear on the project list.

begin;

select plan(12);

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

reset role;

insert into public.transactions (
  company_id, direction, doc_kind,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'income', 'invoice',
  8000, 8000, 0, 'unknown',
  current_date, 'manual', 'posted:invoice', (select id from posted_ref where label = 'project'), 'חשבונית'
from posted_ref where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'income', 'receipt',
  3000, 3000, 0, 'unknown',
  current_date, 'manual', 'posted:receipt', (select id from posted_ref where label = 'project'), 'קבלה'
from posted_ref where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'income', 'receipt', 'pending',
  60000, 60000, 0, 'unknown',
  current_date, 'manual', 'pending:receipt', (select id from posted_ref where label = 'project'), 'קבלה ממתינה'
from posted_ref where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'income', 'invoice', 'pending',
  90000, 90000, 0, 'unknown',
  current_date, 'manual', 'pending:invoice', (select id from posted_ref where label = 'project'), 'חשבונית ממתינה'
from posted_ref where label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'expense', 'expense', 'project', 'void',
  -40000, -40000, 0, 'unknown',
  current_date, 'manual', 'void:line', (select id from posted_ref where label = 'project'), 'בוטל'
from posted_ref where label = 'company';

select tests.authenticate_as('posted_owner');

select is(
  (public.company_pnl((select id from posted_ref where label = 'company'), null, null, 'invoiced') ->> 'income_agorot')::bigint,
  8000::bigint,
  'the invoiced basis counts the posted invoice'
);

select is(
  (public.company_pnl((select id from posted_ref where label = 'company'), null, null, 'cash') ->> 'income_agorot')::bigint,
  3000::bigint,
  'the cash basis counts the posted receipt'
);

select is(
  (public.company_pnl((select id from posted_ref where label = 'company'), null, null, 'cash') ->> 'expense_agorot')::bigint,
  10000::bigint,
  'a void line stays out of the expense total'
);

select is(
  (public.get_project((select id from posted_ref where label = 'project')) ->> 'income_agorot')::bigint,
  8000::bigint,
  'project income counts the posted invoice'
);

select is(
  (public.get_project((select id from posted_ref where label = 'project')) ->> 'direct_agorot')::bigint,
  10000::bigint,
  'project direct cost skips the void line'
);

select is(
  (public.get_home() ->> 'net_profit_agorot')::bigint,
  -7000::bigint,
  'home profit counts the receipt and skips the invoice and the void'
);

select * from finish();
rollback;
