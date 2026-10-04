-- A demo viewer can read that company and cannot write. A real company rejects the row.

begin;

select plan(15);

do $users$
begin
  perform tests.create_supabase_user('viewer_owner');
  perform tests.create_supabase_user('viewer_reader');
  perform tests.create_supabase_user('viewer_real_owner');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('viewer_owner'), 'Flow Test 2', true);

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('viewer_real_owner'), 'חברה אמיתית', false);

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, line_status, idempotency_key, description
)
select c.id, 'income', 'invoice', 'project',
  8000, 8000, 8000, 0, 'unknown',
  current_date, 'manual', 'posted', 'viewer:income', 'חשבונית'
from public.companies c
where c.name = 'Flow Test 2';

select throws_ok(
  $$insert into public.company_viewers (user_id, company_id)
    select tests.get_supabase_uid('viewer_reader'), c.id
    from public.companies c
    where c.name = 'חברה אמיתית'$$,
  '42501',
  null,
  'a viewer cannot be attached to a real company'
);

insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('viewer_reader'), c.id
from public.companies c
where c.name = 'Flow Test 2';

select tests.authenticate_as('viewer_reader');

select ok(
  private.current_company_id() is null,
  'a viewer is not the owner'
);

select is(
  private.readable_company_id(),
  (select c.id from public.companies c where c.name = 'Flow Test 2'),
  'a viewer reads the demo company'
);

select is(
  public.get_home() ->> 'name',
  'Flow Test 2',
  'get_home names the demo company'
);

select is(
  (public.get_dashboard(null, null, 'invoiced') ->> 'name'),
  'Flow Test 2',
  'get_dashboard names the demo company'
);

select is(
  (public.get_dashboard(null, null, 'invoiced') ->> 'income_agorot')::bigint,
  8000::bigint,
  'get_dashboard counts the posted invoice'
);

select throws_ok(
  $$select public.company_pnl(
    (select c.id from public.companies c where c.name = 'חברה אמיתית'),
    null, null, 'invoiced'
  )$$,
  'P0001',
  null,
  'a viewer cannot read another company'
);

select throws_ok(
  $$insert into public.transactions (
      company_id, direction, doc_kind,
      amount_gross, amount_net, amount_original, vat_amount, vat_status,
      doc_date, source, idempotency_key, description
    )
    select c.id, 'expense', 'expense',
      -100, -100, 100, 0, 'unknown',
      current_date, 'manual', 'viewer:write', 'אסור'
    from public.companies c
    where c.name = 'Flow Test 2'$$,
  '42501',
  null,
  'a viewer cannot insert a transaction'
);

update public.companies set name = 'שונה' where name = 'Flow Test 2';

select is(
  (select c.name from public.companies c),
  'Flow Test 2',
  'a viewer cannot rename the company'
);

select throws_ok(
  $$select public.create_company('עסק חדש', true)$$,
  '42501',
  null,
  'a viewer cannot create a company'
);

select throws_ok(
  $$insert into public.companies (owner_id, name)
    values (auth.uid(), 'עסק של צופה')$$,
  '42501',
  null,
  'a viewer cannot insert a company row'
);

select is(
  (select count(*)::int from public.companies where name = 'חברה אמיתית'),
  0,
  'a viewer cannot see a real company'
);

select ok(
  public.list_review() is not null,
  'list_review answers the viewer'
);

select tests.authenticate_as('viewer_owner');

select is(
  private.current_company_id(),
  (select c.id from public.companies c where c.name = 'Flow Test 2'),
  'the owner still resolves the company'
);

update public.companies set name = 'Flow Test 2 עודכן' where name = 'Flow Test 2';

select is(
  (select name from public.companies),
  'Flow Test 2 עודכן',
  'the owner can still rename the company'
);

select * from finish();
rollback;
