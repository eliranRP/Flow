-- L1a. Off-P&L categories seed with the company, and a second insert does nothing.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('l1a_seed', 'l1a-seed@test.flow');
end
$users$;

select tests.authenticate_as('l1a_seed');
select lives_ok($$select public.create_company('זרע', true)$$, 'owner creates a company');

select is(
  (
    select count(*)
    from public.categories
    where company_id = (select id from public.companies where name = 'זרע')
      and excluded_from_pnl
  ),
  3::bigint,
  'a new company gets the three off-P&L categories'
);

select is(
  (
    select sort_order
    from public.categories
    where company_id = (select id from public.companies where name = 'זרע')
      and name = 'תשלומי הלוואה'
      and kind = 'expense'
  ),
  8,
  'loan payments are expense sort 8'
);

select is(
  (
    select count(*)
    from public.categories
    where company_id = (select id from public.companies where name = 'זרע')
      and name = 'העברות'
      and excluded_from_pnl
  ),
  2::bigint,
  'transfers exist once as expense and once as income'
);

select is(
  (
    select excluded_from_pnl
    from public.categories
    where company_id = (select id from public.companies where name = 'זרע')
      and name = 'הכנסה אחרת'
      and kind = 'income'
  ),
  false,
  'other income stays in the P&L'
);

reset role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select c.id, v.name, v.kind, v.sort_order, true, true
from public.companies c
cross join (
  values
    ('תשלומי הלוואה', 'expense'::public.category_kind, 8),
    ('העברות', 'expense'::public.category_kind, 9),
    ('העברות', 'income'::public.category_kind, 3)
) as v(name, kind, sort_order)
where c.name = 'זרע'
on conflict (company_id, kind, name) do nothing;

select is(
  (
    select count(*)
    from public.categories
    where company_id = (select id from public.companies where name = 'זרע')
      and excluded_from_pnl
  ),
  3::bigint,
  'on conflict does not add a second copy'
);

select * from finish();
rollback;
