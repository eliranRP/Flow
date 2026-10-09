-- FLOW-114 server follow-up from #252: save_loan_split takes a category on every part, checked
-- by private.loan_part_category_ok, so an edit or an unmatch undo keeps a part the owner moved.
-- Fixed dates. @example.com only.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('lpc_owner', 'lpc-owner@example.com');
  perform tests.create_supabase_user('lpc_other', 'lpc-other@example.com');
end
$users$;

create temp table lpc (label text primary key, id uuid);
grant all on lpc to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.lpc where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select tests.authenticate_as('lpc_other');
select public.create_company('Example Other Part Co', true);
select tests.authenticate_as('lpc_owner');
select public.create_company('Example Part Category Co', true);
reset role;
insert into lpc (label, id) select 'company', id from public.companies where name = 'Example Part Category Co';
insert into lpc (label, id) select 'other_company', id from public.companies where name = 'Example Other Part Co';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  (pg_temp.id('company'), 'Example card interest', 'expense', 90, false, false),
  (pg_temp.id('company'), 'Example insurance', 'expense', 91, false, false),
  (pg_temp.id('company'), 'Example owner loan repaid', 'expense', 92, false, true),
  (pg_temp.id('company'), 'Example kept out', 'expense', 93, false, true),
  (pg_temp.id('company'), 'Example rent in', 'income', 94, false, false),
  (pg_temp.id('other_company'), 'Example elsewhere', 'expense', 90, false, false);
insert into lpc (label, id)
select v.label, c.id
from (values
  ('interest_cat', 'Example card interest'),
  ('escrow_cat', 'Example insurance'),
  ('principal_cat', 'Example owner loan repaid'),
  ('kept_out', 'Example kept out'),
  ('income_cat', 'Example rent in'),
  ('elsewhere', 'Example elsewhere')
) as v(label, name)
join public.categories c on c.name = v.name;
insert into lpc (label, id)
select 'default_' || c.loan_part::text, c.id
from public.categories c
where c.company_id = pg_temp.id('company') and c.loan_part::text in ('interest', 'escrow', 'principal');

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
  payment_minor, escrow_minor, currency, kind)
values (pg_temp.id('company'), 'Example Part Loan', 12000000, 60000, 360, '2026-01-01', 71946, 0, 'USD', 'amortizing');
insert into lpc (label, id) select 'loan', id from public.loans where name = 'Example Part Loan';

insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
values (pg_temp.id('company'), 'expense', 'expense', 'posted', -71946, -71946, 71946, 0, 'unknown',
  '2026-02-01', 'USD', 'manual', 'lpc:a1', 'Example loan payment');
insert into lpc (label, id) select 'txn', id from public.transactions where idempotency_key = 'lpc:a1';

-- Interest 60,000, escrow 0, principal 11,946; each part names the category given, if any.
create or replace function pg_temp.parts(p_interest uuid, p_escrow uuid, p_principal uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', 60000, 'scheduled_minor', 60000)
      || case when p_interest is null then '{}'::jsonb else jsonb_build_object('category_id', p_interest) end,
    jsonb_build_object('part', 'escrow', 'amount_minor', 0, 'scheduled_minor', 0)
      || case when p_escrow is null then '{}'::jsonb else jsonb_build_object('category_id', p_escrow) end,
    jsonb_build_object('part', 'principal', 'amount_minor', 11946, 'scheduled_minor', 11946)
      || case when p_principal is null then '{}'::jsonb else jsonb_build_object('category_id', p_principal) end
  );
$$;
grant execute on function pg_temp.parts(uuid, uuid, uuid) to authenticated, service_role;

create or replace function pg_temp.stored(p_part text)
returns uuid
language sql
set search_path = ''
as $$
  select category_id from public.loan_splits
  where transaction_id = pg_temp.id('txn') and part::text = p_part;
$$;
grant execute on function pg_temp.stored(text) to authenticated, service_role;

create or replace function pg_temp.refusal(p_parts jsonb)
returns text
language plpgsql
set search_path = ''
as $$
begin
  perform public.save_loan_split(pg_temp.id('txn'), pg_temp.id('loan'), p_parts);
  return 'saved';
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function pg_temp.refusal(jsonb) to authenticated, service_role;

select tests.authenticate_as('lpc_owner');

-- 1. A preview and a save use the categories each part names.
select is(
  public.save_loan_split(pg_temp.id('txn'), pg_temp.id('loan'),
    pg_temp.parts(pg_temp.id('interest_cat'), pg_temp.id('escrow_cat'), pg_temp.id('principal_cat')), true)
    -> 'parts' -> 0 ->> 'category_id',
  pg_temp.id('interest_cat')::text, 'a preview shows the interest part''s named category');
select is(
  public.save_loan_split(pg_temp.id('txn'), pg_temp.id('loan'),
    pg_temp.parts(pg_temp.id('interest_cat'), pg_temp.id('escrow_cat'), pg_temp.id('principal_cat')))->>'replaced',
  'false', 'a split with a category on every part saves');
select is(pg_temp.stored('interest'), pg_temp.id('interest_cat'), 'interest is filed under its named category');
select is(pg_temp.stored('escrow'), pg_temp.id('escrow_cat'), 'escrow is filed under its named category');
select is(pg_temp.stored('principal'), pg_temp.id('principal_cat'), 'principal is filed under its named kept-out category');

-- 2. An edit that sends the stored categories back (the app's edit and unmatch undo) keeps them.
select is(
  public.save_loan_split(pg_temp.id('txn'), pg_temp.id('loan'),
    pg_temp.parts(pg_temp.stored('interest'), pg_temp.stored('escrow'), pg_temp.stored('principal')))->>'replaced',
  'true', 'an edit replaces the split');
select is(pg_temp.stored('interest'), pg_temp.id('interest_cat'), 'and the moved interest part keeps its category');

-- 3. A part that names none takes the loan's category or the keyed default, as before.
select public.save_loan_split(pg_temp.id('txn'), pg_temp.id('loan'), pg_temp.parts(null, null, null));
select is(pg_temp.stored('interest'), pg_temp.id('default_interest'), 'with no category, interest goes to the keyed default');

-- 4. A category that does not fit its part, or is not the company's, is refused.
select is(pg_temp.refusal(pg_temp.parts(pg_temp.id('kept_out'), null, null)),
  'category does not fit the loan part', 'interest cannot go to a kept-out category');
select is(pg_temp.refusal(pg_temp.parts(null, null, pg_temp.id('interest_cat'))),
  'category does not fit the loan part', 'principal cannot go to a category in the P&L');
select is(pg_temp.refusal(pg_temp.parts(null, pg_temp.id('income_cat'), null)),
  'category does not fit the loan part', 'escrow cannot go to an income category');
select is(pg_temp.refusal(pg_temp.parts(pg_temp.id('elsewhere'), null, null)),
  'category not found', 'a category of another company is not found');

select * from finish();
rollback;
