-- FLOW-953 (decision 0210). Balance-sheet accounts through book_line: a closing wire, a refinance
-- deposit and a mortgage payment book asset and liability legs; each is mirrored to a kept-out category
-- part, so pnl_lines equals the equivalent split_line booking, the shadow P&L still equals the posting
-- rules (ledger_pnl_diff empty), and get_line_legs reads the legs back on the right accounts. Also owner
-- capital, a transfer pair through Transfers in transit, a security deposit held, the name binding,
-- list_accounts, undo and the refusals. Invented books only; USD cents.

begin;
select plan(64);

do $u$ begin
  perform tests.create_supabase_user('ba_owner', 'ba-owner@example.com');
  perform tests.create_supabase_user('ba_other', 'ba-other@example.com');
end $u$;

insert into public.companies (owner_id, name, is_demo) values
  (tests.get_supabase_uid('ba_owner'), 'Example Balance LLC', false),
  (tests.get_supabase_uid('ba_other'), 'Example Other Balance LLC', false);

create temp table ba (label text primary key, id uuid);
grant all on ba to authenticated, service_role;
insert into ba select 'co', id from public.companies where name = 'Example Balance LLC';
insert into ba select 'other_co', id from public.companies where name = 'Example Other Balance LLC';

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.ba where label = p_label
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into public.projects (company_id, name, status)
select pg_temp.id('co'), v.n, 'active' from (values ('Oak'), ('Elm')) v(n);
insert into ba select lower(name), id from public.projects where company_id = pg_temp.id('co');

-- Invented categories. Property purchase price and Owner contributions are built-in kept-out names, so
-- they start kept out and bound to Property and Owner capital.
insert into public.categories (company_id, name, kind, sort_order, is_default)
select pg_temp.id('co'), v.name, v.kind::public.category_kind, 90, false
from (values ('Property purchase price', 'expense'), ('Closing costs', 'expense'), ('Property taxes', 'expense'),
  ('Owner contributions', 'income'), ('Rent', 'income')) v(name, kind);
insert into ba select 'c_' || replace(lower(name), ' ', '_'), id from public.categories
where company_id = pg_temp.id('co') and sort_order = 90;
-- The seeded loan and transfer categories.
insert into ba select 'c_principal', id from public.categories where company_id = pg_temp.id('co') and loan_part = 'principal';
insert into ba select 'c_interest', id from public.categories where company_id = pg_temp.id('co') and loan_part = 'interest';
insert into ba select 'c_escrow_loan', id from public.categories where company_id = pg_temp.id('co') and loan_part = 'escrow';
insert into ba select 'c_loan_money', id from public.categories where company_id = pg_temp.id('co') and name = 'כסף שהתקבל מהלוואות';
insert into ba select 'c_transfer_out', id from public.categories where company_id = pg_temp.id('co') and name = 'העברות' and kind = 'expense';
-- The company deleted its incoming transfer category: book_line makes it again for Transfers in transit.
delete from public.categories where company_id = pg_temp.id('co') and name = 'העברות' and kind = 'income';
-- A category in the P&L that holds the name book_line would give a hidden Owner capital debit category.
insert into public.categories (company_id, name, kind, sort_order, is_default)
values (pg_temp.id('co'), 'Owner capital · ledger', 'expense', 92, false);
insert into ba select 'c_owner_ledger', id from public.categories where company_id = pg_temp.id('co') and name = 'Owner capital · ledger';

-- Accounts: a category's is a_<category label without c_>; the system ones by name.
insert into ba select 'a_' || substr(c.label, 3), a.id from public.accounts a join ba c on c.id = a.category_id where c.label like 'c\_%';
insert into ba select 's_' || v.k, a.id from public.accounts a
join (values ('bank', 'Bank/Clearing'), ('loan', 'Loan principal'), ('escrow', 'Escrow'), ('owner', 'Owner capital'),
  ('deposit', 'Security deposit held'), ('transit', 'Transfers in transit'), ('property', 'Property'),
  ('suspense', 'Suspense'), ('vat', 'VAT control'), ('uexp', 'Uncategorized expense')) v(k, n) on v.n = a.name
where a.company_id = pg_temp.id('co') and a.category_id is null;
insert into ba select 'x_property', id from public.accounts
where company_id = pg_temp.id('other_co') and category_id is null and name = 'Property';

-- Posted lines (expense unless the amount is positive).
create function pg_temp.line(p_key text, p_gross bigint, p_category text, p_project text default 'oak',
  p_company text default 'co') returns void
language sql as $$
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
  )
  values (pg_temp.id(p_company), case when p_gross > 0 then 'income' else 'expense' end::public.txn_direction,
    'receipt', 'project', 'posted', 'USD', p_gross, p_gross, abs(p_gross), 0, 'source', '2026-07-01', '2026-07-01',
    'manual', 'ba:' || p_key, pg_temp.id(p_project), pg_temp.id(p_category), p_key, true);
  insert into pg_temp.ba select 'txn_' || p_key, id from public.transactions where idempotency_key = 'ba:' || p_key;
$$;
-- The closing wire and its twin for the equivalent split booking: 300,000.00 price + 4,500.00 closing +
-- 1,200.00 tax - 800.00 seller tax credit - 240,000.00 loan funded at closing = 64,900.00 wired.
select pg_temp.line('wire', -6490000, 'c_closing_costs');
select pg_temp.line('wire_twin', -6490000, 'c_closing_costs');
-- The mortgage payment: 2,100.00 interest + 500.00 escrow + 600.00 principal.
select pg_temp.line('mortgage', -320000, 'c_interest');
select pg_temp.line('mortgage_twin', -320000, 'c_interest');
-- A line switched into the P&L, and an owner contribution posted by the rules.
select pg_temp.line('forced', -100000, 'c_closing_costs');
update public.transactions set in_pnl_override = true where id = pg_temp.id('txn_forced');
select pg_temp.line('capital', 500000, 'c_owner_contributions', null);
-- The refinance's twin (the refinance itself is a new line).
select pg_temp.line('refi_twin', 7100000, null, 'elm');

create function pg_temp.leg(p_account text, p_amount bigint, p_project text default null) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'account_id', pg_temp.id(p_account), 'amount_minor', p_amount, 'project_id', pg_temp.id(p_project)))
$$;
grant execute on function pg_temp.leg(text, bigint, text) to authenticated, service_role;

create function pg_temp.part(p_category text, p_amount bigint, p_gross_up boolean, p_project text default 'oak')
returns jsonb language sql stable as $$
  select jsonb_build_object('category_id', pg_temp.id(p_category), 'project_id', pg_temp.id(p_project),
    'amount_minor', p_amount, 'gross_up', p_gross_up)
$$;
grant execute on function pg_temp.part(text, bigint, boolean, text) to authenticated, service_role;

-- A line's P&L rows, without the line id, as sorted text.
create function pg_temp.pnl_rows(p_line uuid) returns text language sql stable as $$
  select string_agg(format('%s/%s/%s/%s/%s/%s', l.category_id, l.project_id, l.amount_net, l.in_pnl, l.kind, l.gross_up),
    ' ' order by l.category_id, l.project_id, l.amount_net)
  from private.pnl_lines l where l.transaction_id = p_line
$$;
grant execute on function pg_temp.pnl_rows(uuid) to authenticated, service_role;

-- A line's legs as account label:amount, sorted.
create function pg_temp.legs_of(p_line uuid) returns text language sql stable as $$
  select string_agg(coalesce(b.label, l.account_id::text) || ':' || l.amount_minor, ' ' order by coalesce(b.label, l.account_id::text), l.amount_minor)
  from public.legs l left join pg_temp.ba b on b.id = l.account_id and b.label like '_\_%'
  where l.transaction_id = p_line
$$;
grant execute on function pg_temp.legs_of(uuid) to authenticated, service_role;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ba_owner'), pg_temp.id('co'), 'hash-ba-write', 'kid', array['read', 'write']::text[], '2099-01-01');
insert into ba select 'write', id from private.mcp_credentials where token_hash = 'hash-ba-write';

create function pg_temp.as_mcp() returns void language plpgsql set search_path = '' as $$
declare uid uuid := tests.get_supabase_uid('ba_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('write'))::text, true);
end $$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

-- The shadow P&L equals the posting rules (FLOW-951's gate), read as the test's superuser.
create function pg_temp.diff_rows() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from private.ledger_pnl_diff(pg_temp.id('co'))
$$;
grant execute on function pg_temp.diff_rows() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Binding and routing.
-- ---------------------------------------------------------------------------
select is((select string_agg(b.label || '>' || a.name, ' ' order by b.label)
  from public.categories c join ba b on b.id = c.id join public.accounts a on a.id = c.ledger_account_id
  where c.company_id = pg_temp.id('co')),
  'c_loan_money>Loan principal c_owner_contributions>Owner capital c_owner_ledger>Owner capital c_property_purchase_price>Property c_transfer_out>Transfers in transit',
  'built-in kept-out names (and the ledger names) bind to their balance-sheet account; loan parts and other categories stay unbound');
select is((select name from public.accounts where id = private.kept_out_account(pg_temp.id('co'), pg_temp.id('c_principal'), null)),
  'Loan principal', 'the principal category still routes by its loan part');
select is((select name from public.accounts where id = private.kept_out_account(pg_temp.id('co'), pg_temp.id('c_rent'), null)),
  'Suspense', 'an unbound category falls back to Suspense');
select is(pg_temp.legs_of(pg_temp.id('txn_capital')), 's_bank:500000 s_owner:-500000',
  'an owner contribution posted by the rules lands on Owner capital');
select is((select category_id from public.legs where transaction_id = pg_temp.id('txn_capital') and leg_kind = 'item'),
  pg_temp.id('c_owner_contributions'), 'the kept-out leg keeps the category the person sees');

set local role authenticated;
select pg_temp.as_mcp();

-- ---------------------------------------------------------------------------
-- 2. list_accounts.
-- ---------------------------------------------------------------------------
create temp table acct as select x from jsonb_array_elements(public.mcp_accounts()->'accounts') x;
select is((select string_agg(x->>'name' || ':' || (x->>'type') || ':' || (x->>'bookable'), ' ' order by x->>'name')
  from acct x where (x->>'system')::boolean and not (x->>'is_bank')::boolean),
  'Escrow:asset:true Loan principal:liability:true Owner capital:liability:true Property:asset:true Security deposit held:liability:true Suspense:asset:false Transfers in transit:asset:true Uncategorized expense:expense:false Uncategorized income:income:false VAT control:liability:false',
  'balance-sheet system accounts are bookable, except Suspense; VAT control and Uncategorized are not');
select is((select (x->>'bookable') || '/' || (x->>'posts_to') from acct x where (x->>'id')::uuid = pg_temp.id('a_property_purchase_price')),
  'true/' || pg_temp.id('s_property'), 'a kept-out category account is bookable and says it posts to Property');
select is((select (x->>'bookable') || '/' || coalesce(x->>'posts_to', '-') from acct x where (x->>'id')::uuid = pg_temp.id('a_closing_costs')),
  'true/-', 'an in-P&L category account posts to itself (no posts_to)');
select is((select x->>'posts_to' from acct x where (x->>'id')::uuid = pg_temp.id('a_principal')),
  pg_temp.id('s_loan')::text, 'the principal category posts to Loan principal');

-- ---------------------------------------------------------------------------
-- 3. A closing wire on an existing line.
-- ---------------------------------------------------------------------------
create temp table wire as select public.mcp_book_line('ba-wire', null, 'expense', null, null, jsonb_build_array(
    pg_temp.leg('s_bank', -6490000),
    pg_temp.leg('s_property', 30000000, 'oak'),
    pg_temp.leg('a_closing_costs', 450000, 'oak'),
    pg_temp.leg('a_property_taxes', 120000, 'oak'),
    pg_temp.leg('a_property_taxes', -80000, 'oak'),
    pg_temp.leg('s_loan', -24000000, 'oak')), null, pg_temp.id('txn_wire')) as r;
select is((select r->>'ok' || '/' || (r->'data'->>'undo_kind') from wire), 'true/line_split', 'book_line books the closing wire in place');

select is(public.save_line_split(pg_temp.id('txn_wire_twin'), jsonb_build_array(
    pg_temp.part('c_property_purchase_price', 30000000, false),
    pg_temp.part('c_closing_costs', 450000, false),
    pg_temp.part('c_property_taxes', 120000, false),
    pg_temp.part('c_property_taxes', 80000, true),
    pg_temp.part('c_loan_money', 24000000, true))) is not null, true, 'the twin is split the way split_line would');
select is(pg_temp.pnl_rows(pg_temp.id('txn_wire')), pg_temp.pnl_rows(pg_temp.id('txn_wire_twin')),
  'the wire''s P&L rows equal the equivalent split booking');
select is((select sum(amount_net)::bigint from private.pnl_lines where transaction_id = pg_temp.id('txn_wire') and in_pnl),
  -490000::bigint, 'profit moves by the costs only: -4,500.00 closing, -1,200.00 tax, +800.00 credit');
select is((select string_agg(c.name || ':' || l.amount_net, ' ' order by c.name)
  from private.pnl_lines l join public.categories c on c.id = l.category_id
  where l.transaction_id = pg_temp.id('txn_wire') and not l.in_pnl),
  'Property purchase price:-30000000 כסף שהתקבל מהלוואות:24000000', 'the price and the loan stay out of profit');
select is(pg_temp.legs_of(pg_temp.id('txn_wire')),
  'a_closing_costs:450000 a_property_taxes:-80000 a_property_taxes:120000 s_bank:-6490000 s_loan:-24000000 s_property:30000000',
  'the legs sit on Property (asset) and Loan principal (liability)');
create temp table wire_legs as select public.mcp_line_legs(pg_temp.id('txn_wire')) as j;
select is((select j->>'balanced' from wire_legs), 'true', 'get_line_legs: the wire balances');
select is((select string_agg(l->>'account_name' || '/' || (l->>'account_type') || '/' || (l->>'category_name'), ' ' order by l->>'account_name')
  from wire_legs, jsonb_array_elements(j->'legs') l where l->>'account_type' in ('asset', 'liability') and not (l->>'is_bank')::boolean),
  'Loan principal/liability/כסף שהתקבל מהלוואות Property/asset/Property purchase price',
  'get_line_legs names the balance-sheet account and the category behind each kept-out leg');
select is(pg_temp.diff_rows(), 0::bigint, 'the shadow P&L still equals the posting rules');

select is(public.mcp_undo('ba-wire-undo', 'line_split', pg_temp.id('txn_wire'))->>'ok', 'true', 'undo of the wire succeeds');
select is((select count(*)::int from public.line_splits where transaction_id = pg_temp.id('txn_wire')), 0, 'undo restores the whole line');
select is(pg_temp.legs_of(pg_temp.id('txn_wire')), 'a_closing_costs:6490000 s_bank:-6490000', 'its legs are the whole line again');

-- ---------------------------------------------------------------------------
-- 4. A refinance deposit on a new line: the new loan, the old loan paid off, closing costs and escrow
--    funding. The company's escrow loan category counts in the P&L, so the Escrow leg gets a hidden
--    kept-out category.
-- ---------------------------------------------------------------------------
create temp table refi as select public.mcp_book_line('ba-refi', '2026-07-05', 'income', 'USD', 'Refinance', jsonb_build_array(
    pg_temp.leg('s_bank', 7100000),
    pg_temp.leg('s_loan', -50000000),
    pg_temp.leg('s_loan', 42000000),
    pg_temp.leg('a_closing_costs', 600000),
    pg_temp.leg('s_escrow', 300000)), pg_temp.id('elm')) as r;
select is((select r->>'ok' || '/' || (r->'data'->>'undo_kind') from refi), 'true/book_line', 'the refinance deposit books as a new line');
insert into ba select 'txn_refi', (r->'data'->>'id')::uuid from refi;
insert into ba select 'c_escrow_hidden', id from public.categories
where company_id = pg_temp.id('co') and name = 'Escrow · ledger' and kind = 'expense';
select is((select hidden::text || '/' || excluded_from_pnl::text || '/' || (ledger_account_id = pg_temp.id('s_escrow'))::text
  from public.categories where id = pg_temp.id('c_escrow_hidden')),
  'true/true/true', 'a hidden kept-out "Escrow · ledger" category, bound to Escrow, is made for the escrow leg');
select is((select string_agg(b.label || ':' || s.amount_minor || ':' || s.gross_up, ' ' order by s.ordinal)
  from public.line_splits s join ba b on b.id = s.category_id where s.transaction_id = pg_temp.id('txn_refi')),
  'c_loan_money:50000000:false c_principal:42000000:true c_closing_costs:600000:true c_escrow_hidden:300000:true',
  'the new loan is a normal part; the payoff, closing costs and escrow net against it');
select is(public.save_line_split(pg_temp.id('txn_refi_twin'), jsonb_build_array(
    pg_temp.part('c_loan_money', 50000000, false, 'elm'),
    pg_temp.part('c_principal', 42000000, true, 'elm'),
    pg_temp.part('c_closing_costs', 600000, true, 'elm'),
    pg_temp.part('c_escrow_hidden', 300000, true, 'elm'))) is not null, true, 'the twin deposit is split the same way');
select is(pg_temp.pnl_rows(pg_temp.id('txn_refi')), pg_temp.pnl_rows(pg_temp.id('txn_refi_twin')),
  'the refinance''s P&L rows equal the equivalent split booking');
select is((select sum(amount_net)::bigint from private.pnl_lines where transaction_id = pg_temp.id('txn_refi') and in_pnl),
  -600000::bigint, 'only the closing costs reach profit');
select is(pg_temp.legs_of(pg_temp.id('txn_refi')),
  'a_closing_costs:600000 s_bank:7100000 s_escrow:300000 s_loan:-50000000 s_loan:42000000',
  'the loan legs sit on Loan principal and the escrow on Escrow');
select is(pg_temp.diff_rows(), 0::bigint, 'after the refinance the shadow P&L still equals the posting rules');

-- ---------------------------------------------------------------------------
-- 5. A mortgage payment on an existing line: interest, escrow and principal.
-- ---------------------------------------------------------------------------
select is(public.mcp_book_line('ba-mortgage', null, 'expense', null, null, jsonb_build_array(
    pg_temp.leg('s_bank', -320000),
    pg_temp.leg('a_interest', 210000),
    pg_temp.leg('s_escrow', 50000),
    pg_temp.leg('s_loan', 60000)), null, pg_temp.id('txn_mortgage'))->>'ok', 'true', 'the mortgage payment books in place');
select is((select string_agg(b.label || ':' || s.amount_minor, ' ' order by s.ordinal)
  from public.line_splits s join ba b on b.id = s.category_id where s.transaction_id = pg_temp.id('txn_mortgage')),
  'c_interest:210000 c_escrow_hidden:50000 c_principal:60000', 'the escrow leg reuses the hidden Escrow category; principal is the loan category');
select is(public.save_line_split(pg_temp.id('txn_mortgage_twin'), jsonb_build_array(
    pg_temp.part('c_interest', 210000, false, null),
    pg_temp.part('c_escrow_hidden', 50000, false, null),
    pg_temp.part('c_principal', 60000, false, null))) is not null, true, 'the twin payment is split the same way');
select is(pg_temp.pnl_rows(pg_temp.id('txn_mortgage')), pg_temp.pnl_rows(pg_temp.id('txn_mortgage_twin')),
  'the payment''s P&L rows equal the equivalent split booking');
select is((select sum(amount_net)::bigint from private.pnl_lines where transaction_id = pg_temp.id('txn_mortgage') and in_pnl),
  -210000::bigint, 'only the interest reaches profit');
select is(pg_temp.legs_of(pg_temp.id('txn_mortgage')), 'a_interest:210000 s_bank:-320000 s_escrow:50000 s_loan:60000',
  'escrow debits Escrow and principal debits Loan principal');
select is((select count(*)::int from public.loan_splits where transaction_id = pg_temp.id('txn_mortgage')), 0,
  'book_line writes no loan split: a tracked loan''s balance moves only through attach_loan_payment');

-- ---------------------------------------------------------------------------
-- 6. Owner capital, a transfer pair and a security deposit held, each a new whole line.
-- ---------------------------------------------------------------------------
create temp table owner as select public.mcp_book_line('ba-owner', '2026-07-06', 'income', 'USD', 'Owner money in', jsonb_build_array(
  pg_temp.leg('s_bank', 1000000), pg_temp.leg('s_owner', -1000000))) as r;
select is((select t.category_id from public.transactions t join owner o on t.id = (o.r->'data'->>'id')::uuid),
  pg_temp.id('c_owner_contributions'), 'an owner contribution is a whole line in Owner contributions');
select is((select in_pnl::text || '/' || amount_net from private.pnl_lines l join owner o on l.transaction_id = (o.r->'data'->>'id')::uuid),
  'false/1000000', 'it stays out of profit');
select is((select pg_temp.legs_of((r->'data'->>'id')::uuid) from owner), 's_bank:1000000 s_owner:-1000000', 'it credits Owner capital');

create temp table transfers as
select public.mcp_book_line('ba-tr-out', '2026-07-07', 'expense', 'USD', 'To savings', jsonb_build_array(
  pg_temp.leg('s_bank', -200000), pg_temp.leg('s_transit', 200000))) as r
union all
select public.mcp_book_line('ba-tr-in', '2026-07-08', 'income', 'USD', 'From checking', jsonb_build_array(
  pg_temp.leg('s_bank', 200000), pg_temp.leg('s_transit', -200000)));
select is((select string_agg(c.name || '/' || c.kind, ' ' order by c.kind) from transfers x
  join public.transactions t on t.id = (x.r->'data'->>'id')::uuid join public.categories c on c.id = t.category_id),
  'העברות/expense העברות/income', 'each side of the transfer is filed to the transfer category of its side');
select is((select c.excluded_from_pnl::text || '/' || c.in_cash::text || '/' || c.hidden::text || '/' || (c.ledger_account_id = pg_temp.id('s_transit'))::text
  from public.categories c where c.company_id = pg_temp.id('co') and c.name = 'העברות' and c.kind = 'income'),
  'true/false/false/true', 'the missing incoming העברות is made as transfer_mark_line makes it: out of profit and cash, bound to Transfers in transit');
select is((select sum(l.amount_minor)::bigint from public.legs l join transfers x on l.transaction_id = (x.r->'data'->>'id')::uuid
  where l.account_id = pg_temp.id('s_transit')), 0::bigint, 'the two Transfers in transit legs net to 0');
select is((select count(*)::int from private.pnl_lines l join transfers x on l.transaction_id = (x.r->'data'->>'id')::uuid where l.in_pnl),
  0, 'neither side of the transfer reaches profit');

create temp table deposit as select public.mcp_book_line('ba-deposit', '2026-07-09', 'income', 'USD', 'Tenant deposit', jsonb_build_array(
  pg_temp.leg('s_bank', 150000), pg_temp.leg('s_deposit', -150000, 'oak'))) as r;
select is((select c.name || '/' || c.kind || '/' || c.hidden::text from public.transactions t join deposit d on t.id = (d.r->'data'->>'id')::uuid
  join public.categories c on c.id = t.category_id),
  'Security deposit held · ledger/income/true', 'no category posts to Security deposit held, so a hidden income one is made');
select is((select pg_temp.legs_of((r->'data'->>'id')::uuid) from deposit), 's_bank:150000 s_deposit:-150000', 'the deposit credits Security deposit held');
select is(pg_temp.diff_rows(), 0::bigint, 'after every booking the shadow P&L still equals the posting rules');

-- Undo of a new line removes it; the hidden category stays for the next booking.
select is(public.mcp_undo('ba-deposit-undo', 'book_line', (select (r->'data'->>'id')::uuid from deposit))->>'ok', 'true',
  'undo of the deposit succeeds');
select is((select count(*)::int from public.transactions t join deposit d on t.id = (d.r->'data'->>'id')::uuid), 0,
  'undo removes the booked line and its legs');

-- ---------------------------------------------------------------------------
-- 7. Refusals.
-- ---------------------------------------------------------------------------
create function pg_temp.book_new(p_key text, p_legs jsonb, p_direction text default 'expense') returns jsonb
language sql as $$
  select public.mcp_book_line(p_key, '2026-07-10', p_direction, 'USD', 'Refused', p_legs)
$$;
grant execute on function pg_temp.book_new(text, jsonb, text) to authenticated;

select is(pg_temp.book_new('ba-r1', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('a_closing_costs', 800, 'oak'),
  pg_temp.leg('s_vat', 200)))->'error'->>'message', 'book_line: a VAT leg is a later phase', 'a VAT leg is refused');
select is(pg_temp.book_new('ba-r2', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('s_suspense', 1000)))->'error'->>'message',
  'book_line: unsupported account — use a category account or a balance-sheet account', 'Suspense takes no booking');
select is(pg_temp.book_new('ba-r3', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('s_uexp', 1000)))->'error'->>'message',
  'book_line: unsupported account — use a category account or a balance-sheet account', 'Uncategorized takes no booking');
select is(pg_temp.book_new('ba-r4', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('s_bank', -1000),
  pg_temp.leg('s_property', 2000, 'oak')))->'error'->>'message', 'exactly one bank leg is required', 'two bank legs are refused');
select is(pg_temp.book_new('ba-r5', jsonb_build_array(pg_temp.leg('s_bank', -1000),
  jsonb_build_object('account_id', pg_temp.id('s_property'), 'amount_minor', 1000, 'currency', 'ILS')))->'error'->>'code',
  'validation', 'a leg carries no currency: a booking is in the line''s one currency');
select is(public.mcp_book_line('ba-r6', null, 'expense', null, null, jsonb_build_array(
    pg_temp.leg('s_bank', -100000), pg_temp.leg('a_closing_costs', 40000), pg_temp.leg('s_property', 60000, 'oak')),
    null, pg_temp.id('txn_forced'))->'error'->>'message',
  'book_line: the line is switched into the P&L — clear set_line_pnl first', 'a line switched into the P&L takes no kept-out leg');
select is(pg_temp.book_new('ba-r7', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('x_property', 1000)))->'error'->>'message',
  'The write was refused.', 'another company''s account stays generic (no existence leak)');
-- A second expense category bound to Property makes the Property debit ambiguous.
reset role;
insert into public.categories (company_id, name, kind, sort_order, is_default)
values (pg_temp.id('co'), 'Purchase deposits', 'expense', 91, false);
select pg_temp.as_mcp();
select is(pg_temp.book_new('ba-r8', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('s_property', 1000, 'oak')))->'error'->>'message',
  'book_line: several kept-out categories post to this account — book the leg on one category''s account',
  'two kept-out categories of the leg''s side on one account are refused');
select is((pg_temp.book_new('ba-r9', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('a_property_purchase_price', 1000, 'oak')))->>'ok'),
  'true', 'booking on the category''s own account picks it');
select is((select count(*)::int from public.transactions where company_id = pg_temp.id('co') and description = 'Refused' and doc_date = '2026-07-10'),
  1, 'only the accepted booking wrote a line');
select is((select count(*)::int from public.categories where company_id = pg_temp.id('co') and hidden), 2,
  'refusals made no hidden category (only the Escrow and Security deposit held ones exist)');
-- An owner draw needs an expense category on Owner capital. The name book_line would use is taken by a
-- category counted in the P&L (the path a concurrent booking takes too: insert on conflict, then re-read),
-- so it refuses plainly instead of failing on the unique key.
select is(pg_temp.book_new('ba-r10', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('s_owner', 1000)))->'error'->>'message',
  'book_line: no kept-out category posts to this account', 'a taken name in the P&L is refused plainly');
reset role;
update public.categories set excluded_from_pnl = true where id = pg_temp.id('c_owner_ledger');
select pg_temp.as_mcp();
create temp table draw as select pg_temp.book_new('ba-r11', jsonb_build_array(pg_temp.leg('s_bank', -1000), pg_temp.leg('s_owner', 1000))) as r;
select is((select t.category_id::text from draw d join public.transactions t on t.id = (d.r->'data'->>'id')::uuid),
  pg_temp.id('c_owner_ledger')::text, 'kept out, the same category takes the owner draw');

-- ---------------------------------------------------------------------------
-- 8. Isolation: the other company sees none of it.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from acct x where (x->>'id')::uuid in (select id from public.accounts where company_id = pg_temp.id('other_co'))),
  0, 'list_accounts shows no account of another company');
select is((select count(*)::int from public.categories where company_id = pg_temp.id('other_co') and hidden), 0,
  'no hidden category was made in another company');
select is(pg_temp.diff_rows(), 0::bigint, 'at the end the shadow P&L equals the posting rules');

select * from finish();
rollback;
