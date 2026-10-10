-- FLOW-103, server (decision 0170). A P&L read called without a basis follows the company's
-- date choice (companies.cash_basis: paid is the P&L's cash, invoice its invoiced); a basis the
-- caller names still wins. Invented data only. Amounts are agorot.

begin;

select plan(19);

do $users$
begin
  perform tests.create_supabase_user('pcb_owner', 'pcb-owner@example.com');
  perform tests.create_supabase_user('pcb_other', 'pcb-other@example.com');
end
$users$;

create temp table pcb (label text primary key, id uuid);
grant all on pcb to authenticated, service_role;

insert into pcb (label, id) values ('co', tests.fixture_company('pcb_owner', 'Example Basis LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pcb where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pcb (label, id) values ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor'));
insert into pcb (label, id) values
  ('other_cost', (select c.id from public.categories c
                  where c.company_id = pg_temp.id('co') and c.name = 'אחר' and c.kind = 'expense'));

-- An open income invoice (counts on the invoice date only) and a paid cost (counts on both).
select tests.fixture_line(pg_temp.id('co'), 'pcb:invoice', 100000, 'income', pg_temp.id('harbor'),
  null, '2026-06-05', p_pnl_role => null, p_doc_kind => 'invoice');
select tests.fixture_line(pg_temp.id('co'), 'pcb:cost', 20000, 'expense', pg_temp.id('harbor'),
  pg_temp.id('other_cost'), '2026-06-08');

select tests.authenticate_as('pcb_owner');

-- 1-8. The payment date, the default.
select is(public.company_pnl_basis(), 'cash', 'a new company counts profit by the payment date');
select is(public.get_dashboard('2026-06-01', '2026-06-30') ->> 'basis', 'cash', 'get_dashboard without a basis follows it');
select is(
  (public.get_dashboard('2026-06-01', '2026-06-30') ->> 'income_agorot')::bigint, 0::bigint,
  'and the open invoice is not income yet'
);
select is(
  public.get_dashboard('2026-06-01', '2026-06-30', 'invoiced') ->> 'basis', 'invoiced',
  'a basis the caller names still wins'
);
select is(
  (public.get_dashboard('2026-06-01', '2026-06-30', null) ->> 'income_agorot')::bigint, 0::bigint,
  'an explicit null is the company''s choice too'
);
select is(public.get_breakdown('income', '2026-06-01', '2026-06-30') ->> 'basis', 'cash', 'get_breakdown follows it');
select is(public.get_profit_months('2026-06-01', '2026-06-30') ->> 'basis', 'cash', 'get_profit_months follows it');
select is(
  public.list_project_category(pg_temp.id('harbor'), pg_temp.id('other_cost')) ->> 'basis', 'cash',
  'list_project_category follows it (it used to default to the invoice date)'
);

-- 9-16. The invoice date.
select lives_ok($$select public.set_cash_basis('invoice')$$, 'the owner picks the invoice date');
select is(public.company_pnl_basis(), 'invoiced', 'company_pnl_basis says so');
select is(public.get_dashboard('2026-06-01', '2026-06-30') ->> 'basis', 'invoiced', 'get_dashboard follows it');
select is(
  (public.get_dashboard('2026-06-01', '2026-06-30') ->> 'income_agorot')::bigint, 100000::bigint,
  'and the open invoice is income'
);
select is(
  (public.get_dashboard('2026-06-01', '2026-06-30', 'cash') ->> 'income_agorot')::bigint, 0::bigint,
  'a caller that names cash still gets cash'
);
select is(public.get_profit_months('2026-06-01', '2026-06-30') ->> 'basis', 'invoiced', 'get_profit_months follows it');
select is(
  public.get_project(pg_temp.id('harbor'), null) -> 'income_agorot',
  public.get_project(pg_temp.id('harbor'), 'invoiced') -> 'income_agorot',
  'get_project with a null basis counts as the company does'
);
select is(
  public.get_project(pg_temp.id('harbor'), null) -> 'income_agorot', '100000'::jsonb,
  'which counts the open invoice'
);

-- 17-19. Who sees what.
select tests.authenticate_as('pcb_other');
select is(public.company_pnl_basis(), null, 'a user without a company has no basis');
select tests.clear_authentication();
reset role;
select ok(
  not has_function_privilege('anon', 'public.company_pnl_basis()', 'execute'),
  'anon cannot call company_pnl_basis'
);
select ok(
  not has_function_privilege('anon', 'private.pnl_basis(uuid, text)', 'execute'),
  'anon cannot call private.pnl_basis'
);

select * from finish();
rollback;
