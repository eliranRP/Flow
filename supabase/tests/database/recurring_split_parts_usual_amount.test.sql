-- Decision 0189. A recurring charge counts only its own parts of a split line (never the whole transfer, never
-- a kept-out part, and a part for another project feeds that project's charge), and the owner can set a
-- charge's usual amount (set_payment_amount, MCP set_line_usual_amount with undo line_amount).
-- Invented data only. Amounts are agorot. Dates are relative to today (the setters read private.flow_today).

begin;

select plan(36);

do $users$
begin
  perform tests.create_supabase_user('sp_owner', 'sp-owner@example.com');
  perform tests.create_supabase_user('sp_viewer', 'sp-viewer@example.com');
  perform tests.create_supabase_user('sp_other', 'sp-other@example.com');
end
$users$;

create temp table sp (label text primary key, id uuid);
grant all on sp to authenticated, service_role;

insert into sp (label, id) values
  ('co', tests.fixture_company('sp_owner', 'Example Rentals LLC')),
  ('co_b', tests.fixture_company('sp_other', 'Example Elsewhere LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.sp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('co'), tests.get_supabase_uid('sp_viewer'), 'viewer');

-- The first of a month, counted back from this one.
create or replace function pg_temp.m(p_back integer)
returns date
language sql
as $$ select (date_trunc('month', private.flow_today()) - make_interval(months => p_back))::date; $$;
grant execute on function pg_temp.m(integer) to authenticated, service_role;
create temp table sp_day as select private.flow_today() as today;
grant all on sp_day to authenticated, service_role;
create or replace function pg_temp.today()
returns date
language sql
as $$ select today from pg_temp.sp_day; $$;
grant execute on function pg_temp.today() to authenticated, service_role;

insert into sp (label, id) values
  ('hazel', tests.fixture_project(pg_temp.id('co'), 'Hazel St')),
  ('elm', tests.fixture_project(pg_temp.id('co'), 'Elm Ave')),
  ('grove', tests.fixture_project(pg_temp.id('co'), 'Grove Rd')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Rent received', 'income')),
  ('power', tests.fixture_category(pg_temp.id('co'), 'Electricity recharged', 'income')),
  ('water', tests.fixture_category(pg_temp.id('co'), 'Water recharged', 'income')),
  ('deposit', tests.fixture_category(pg_temp.id('co'), 'Tenant deposit held', 'income', true));

insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Rent Platform');
insert into sp (label, id)
select 'platform', c.id from public.customers c where c.company_id = pg_temp.id('co');

-- Hazel's transfers: two months not split (1,757.40 and 2,013.33), then this month's 2,054.86 split into
-- rent 1,700.00, electricity 171.76 and water 183.10. Elm's transfer this month: 3,225.68, filed to Elm under
-- the deposit, split into a tenant deposit 2,500.00 (kept out), Elm's prorated rent 161.29 and Grove's rent
-- 564.39.
create temp table sp_lines (key text, project text, category text, doc_date date, amount bigint);
insert into sp_lines values
  ('hazel:2', 'hazel', 'rent', pg_temp.m(2), 175740),
  ('hazel:1', 'hazel', 'rent', pg_temp.m(1), 201333),
  ('hazel:0', 'hazel', 'rent', pg_temp.m(0), 205486),
  ('elm:0', 'elm', 'deposit', pg_temp.m(0), 322568);
insert into sp (label, id)
select l.key, tests.fixture_line(
  pg_temp.id('co'), 'sp:' || l.key, l.amount, 'income', pg_temp.id(l.project), pg_temp.id(l.category), l.doc_date,
  p_doc_kind => 'invoice_receipt'
)
from sp_lines l;
update public.transactions t set customer_id = pg_temp.id('platform')
from sp_lines l where t.id = pg_temp.id(l.key);

insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor) values
  (pg_temp.id('co'), pg_temp.id('hazel:0'), 1, pg_temp.id('rent'), null, 170000),
  (pg_temp.id('co'), pg_temp.id('hazel:0'), 2, pg_temp.id('power'), null, 17176),
  (pg_temp.id('co'), pg_temp.id('hazel:0'), 3, pg_temp.id('water'), null, 18310),
  (pg_temp.id('co'), pg_temp.id('elm:0'), 1, pg_temp.id('deposit'), null, 250000),
  (pg_temp.id('co'), pg_temp.id('elm:0'), 2, pg_temp.id('rent'), pg_temp.id('elm'), 16129),
  (pg_temp.id('co'), pg_temp.id('elm:0'), 3, pg_temp.id('rent'), pg_temp.id('grove'), 56439);

-- Grove's charge is marked recurring by a word on its own row (it has no line of its own).
insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring)
values (pg_temp.id('co'), 'income', pg_temp.id('platform'), 'ILS', pg_temp.id('grove'), true);

-- One charge's schedule row, with its project's name.
create or replace function pg_temp.row(p_project text)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.recurring_schedule(pg_temp.today())) e
  where (e ->> 'party_id')::uuid = pg_temp.id('platform') and (e ->> 'project_id')::uuid = pg_temp.id(p_project);
$$;
grant execute on function pg_temp.row(text) to authenticated, service_role;

create or replace function pg_temp.arrived(p_project text)
returns jsonb
language sql
as $$
  select e - 'party_id' - 'party_name' - 'supplier_id' - 'supplier_name' - 'transaction_id' - 'project_id'
    - 'project_name' - 'category_id' - 'category_name' - 'alert_key' - 'direction' - 'currency' - 'pace'
    - 'source' - 'typical_day'
  from jsonb_array_elements(public.recurring_this_month(pg_temp.today())) e
  where (e ->> 'party_id')::uuid = pg_temp.id('platform') and (e ->> 'project_id')::uuid = pg_temp.id(p_project);
$$;
grant execute on function pg_temp.arrived(text) to authenticated, service_role;

create or replace function pg_temp.expected(p_project text)
returns jsonb
language sql
as $$
  select e -> 'typical_amount_minor'
  from jsonb_array_elements(public.expected_months(2, null, pg_temp.today()) -> 'recurring') e
  where (e ->> 'party_id')::uuid = pg_temp.id('platform') and (e ->> 'project_id')::uuid = pg_temp.id(p_project);
$$;
grant execute on function pg_temp.expected(text) to authenticated, service_role;

-- 1-3. The streams read the parts: Hazel's split line is its rent part only; Elm's transfer is Elm's rent
-- and Grove's rent, never the deposit.
select is(
  (select jsonb_agg(jsonb_build_object('project', p.name, 'amount', sl.amount_net) order by p.name)
   from private.recurring_stream_lines(pg_temp.id('co'), pg_temp.today()) sl
   join public.projects p on p.id = sl.stream_project
   where sl.id = pg_temp.id('hazel:0')),
  '[{"project": "Hazel St", "amount": 170000}]'::jsonb,
  'Hazel''s split transfer counts its rent part only'
);
select is(
  (select jsonb_agg(jsonb_build_object('project', p.name, 'amount', sl.amount_net) order by p.name)
   from private.recurring_stream_lines(pg_temp.id('co'), pg_temp.today()) sl
   join public.projects p on p.id = sl.stream_project
   where sl.id = pg_temp.id('elm:0')),
  '[{"project": "Elm Ave", "amount": 16129}, {"project": "Grove Rd", "amount": 56439}]'::jsonb,
  'Elm''s transfer feeds Elm''s and Grove''s charges, and the kept-out deposit counts for neither'
);
select is(
  (select jsonb_agg(sl.amount_net order by sl.doc_date)
   from private.recurring_stream_lines(pg_temp.id('co'), pg_temp.today()) sl
   where sl.id in (pg_temp.id('hazel:2'), pg_temp.id('hazel:1'))),
  '[175740, 201333]'::jsonb,
  'unsplit lines count whole, as before'
);

select tests.authenticate_as('sp_owner');

-- 4-5. Hazel is marked recurring on this month's line: the switch is Hazel's charge's.
select is(
  public.set_payment_recurring(pg_temp.id('hazel:0'), true) -> 'override_project_id',
  to_jsonb(pg_temp.id('hazel')),
  'the split line''s charge is its own project''s'
);
select is(
  (select jsonb_build_object('typical', r -> 'typical_amount_minor', 'amount', r -> 'amount_minor',
     'source', r -> 'typical_amount_source', 'state', r -> 'state')
   from pg_temp.row('hazel') r),
  '{"typical": 175740, "amount": 170000, "source": "computed", "state": "arrived"}'::jsonb,
  'Hazel arrived with 1,700.00 against the median of its whole months'
);

-- 6-7. This month's arrival and its change compare the rent part.
select is(
  pg_temp.arrived('hazel'),
  '{"amount_minor": 170000, "typical_amount_minor": 175740, "change_percent": -3, "changed": false, "line_count": 1}'::jsonb,
  'the arrival is 1,700.00 and the change compares it'
);
select is(
  (select jsonb_build_object('month', c -> 'month_amount_minor', 'typical', c -> 'typical_amount_minor',
     'source', c -> 'typical_source', 'percent', c -> 'change_percent')
   from public.party_charges(pg_temp.id('hazel:0')) c),
  '{"month": 170000, "typical": 175740, "source": "recurring", "percent": -3}'::jsonb,
  'the line''s charges count its rent part and read its charge''s usual amount'
);

-- 8-10. Elm marked recurring has only this month: its usual is Elm's rent part; Grove's charge gets its part.
select public.set_payment_recurring(pg_temp.id('elm:0'), true);
select is(
  (select jsonb_build_object('typical', r -> 'typical_amount_minor', 'amount', r -> 'amount_minor') from pg_temp.row('elm') r),
  '{"typical": 16129, "amount": 16129}'::jsonb,
  'Elm''s month counts only Elm''s rent part'
);
select is(
  (select jsonb_build_object('typical', r -> 'typical_amount_minor', 'amount', r -> 'amount_minor') from pg_temp.row('grove') r),
  '{"typical": 56439, "amount": 56439}'::jsonb,
  'Grove''s charge gets 564.39 that month'
);
select is(
  (public.party_charges(pg_temp.id('elm:0')) -> 'month_amount_minor'),
  '16129'::jsonb,
  'Elm''s line page counts Elm''s part'
);

-- 11-15. The owner sets Hazel's usual amount to 1,700.00 and Elm's to 2,500.00.
select is(
  (select jsonb_build_object('prior', w -> 'prior_amount', 'typical', w -> 'typical_amount_minor',
     'source', w -> 'typical_amount_source', 'project', w -> 'project_id')
   from public.set_payment_amount(pg_temp.id('hazel:0'), 170000) w),
  jsonb_build_object('prior', null, 'typical', 170000, 'source', 'owner', 'project', pg_temp.id('hazel')),
  'set_payment_amount writes Hazel''s usual amount, with no amount before'
);
select public.set_payment_amount(pg_temp.id('elm:0'), 250000);
select is(
  (select jsonb_build_object('hazel', pg_temp.row('hazel') -> 'typical_amount_minor',
     'elm', pg_temp.row('elm') -> 'typical_amount_minor', 'elm_source', pg_temp.row('elm') -> 'typical_amount_source')),
  '{"hazel": 170000, "elm": 250000, "elm_source": "owner"}'::jsonb,
  'the schedule uses the owner''s amounts'
);
select is(
  (select jsonb_build_object('hazel', pg_temp.expected('hazel'), 'elm', pg_temp.expected('elm'), 'grove', pg_temp.expected('grove'))),
  '{"hazel": 170000, "elm": 250000, "grove": 56439}'::jsonb,
  'expected_months uses the owner''s amounts'
);
select is(
  pg_temp.arrived('elm'),
  '{"amount_minor": 16129, "typical_amount_minor": 250000, "change_percent": -94, "changed": true, "line_count": 1}'::jsonb,
  'Elm, with no complete month, compares this month with the owner''s amount'
);
select is(
  (select jsonb_build_object('typical', s -> 'typical_amount_minor', 'source', s -> 'typical_amount_source',
     'owner', s -> 'owner_amount_minor')
   from public.payment_recurring(pg_temp.id('hazel:0')) s),
  '{"typical": 170000, "source": "owner", "owner": 170000}'::jsonb,
  'the line''s recurring state says the amount is the owner''s'
);

-- 16. A charge with the owner's amount but no switch and no recurring months does not recur.
select public.set_payment_amount(pg_temp.id('elm:0'), 60000, pg_temp.id('grove'));
reset role;
update public.recurring_overrides set recurring = null where project_id = pg_temp.id('grove');
select tests.authenticate_as('sp_owner');
select is(pg_temp.row('grove'), null::jsonb, 'an amount alone does not make a charge recur');

-- 17-18. A named charge of a split line: Grove's row holds its own amount; another project is refused.
reset role;
select is(
  (select o.typical_amount_minor from public.recurring_overrides o where o.project_id = pg_temp.id('grove')),
  60000::bigint,
  'the amount written for Grove is on Grove''s row'
);
select tests.authenticate_as('sp_owner');
select throws_ok(
  format('select public.set_payment_amount(%L, 100000, %L)', pg_temp.id('elm:0'), pg_temp.id('hazel')),
  'P0001', 'validation',
  'a project the line does not feed is refused'
);

-- 19-21. Validation: positive, below the cap.
select throws_ok(format('select public.set_payment_amount(%L, 0)', pg_temp.id('hazel:0')), 'P0001', 'validation', 'zero is refused');
select throws_ok(format('select public.set_payment_amount(%L, -500)', pg_temp.id('hazel:0')), 'P0001', 'validation', 'a negative amount is refused');
select throws_ok(format('select public.set_payment_amount(%L, 1000000000000)', pg_temp.id('hazel:0')), 'P0001', 'validation', 'an amount over the cap is refused');

-- 22-25. The app's undo writes the prior amount back; clearing returns to the computed amount.
select is(
  public.set_payment_amount(pg_temp.id('hazel:0'), 180000) -> 'prior_amount',
  '170000'::jsonb,
  'a second write returns the amount before'
);
select public.set_payment_amount(pg_temp.id('hazel:0'), 170000);
select is(pg_temp.row('hazel') -> 'typical_amount_minor', '170000'::jsonb, 'ביטול puts 1,700.00 back');
select is(
  (select jsonb_build_object('prior', w -> 'prior_amount', 'typical', w -> 'typical_amount_minor', 'source', w -> 'typical_amount_source')
   from public.set_payment_amount(pg_temp.id('hazel:0'), null) w),
  '{"prior": 170000, "typical": 175740, "source": "computed"}'::jsonb,
  'clearing returns to the computed amount'
);
reset role;
select is(
  (select jsonb_build_object('recurring', o.recurring, 'amount', o.typical_amount_minor) from public.recurring_overrides o
   where o.project_id = pg_temp.id('hazel')),
  '{"recurring": true, "amount": null}'::jsonb,
  'clearing the amount keeps the switch on its row'
);

-- 26-31. The MCP: set, undo, and a conflict once the amount changed again.
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('sp_owner'), pg_temp.id('co'), 'hash-sp-write', 'kid', array['write']::text[], '2099-01-01');
insert into sp (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-sp-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('sp_owner');
  tid uuid;
begin
  select id into tid from pg_temp.sp where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
select is(
  (select jsonb_build_object('kind', d -> 'undo_kind', 'typical', d -> 'typical_amount_minor', 'prior', d ? 'prior_amount')
   from (select public.mcp_set_line_usual_amount('sp-1', pg_temp.id('hazel:0'), 165000) -> 'data' as d) x),
  '{"kind": "line_amount", "typical": 165000, "prior": false}'::jsonb,
  'set_line_usual_amount writes the amount and offers undo line_amount'
);
select is(
  public.mcp_set_line_usual_amount('sp-1', pg_temp.id('hazel:0'), 165000) -> 'data' -> 'typical_amount_minor',
  '165000'::jsonb,
  'the same key replays'
);
select is(
  public.mcp_undo('sp-undo-1', 'line_amount', pg_temp.id('hazel:0')) ->> 'ok',
  'true',
  'undo line_amount'
);
reset role;
select is(
  (select o.typical_amount_minor from public.recurring_overrides o where o.project_id = pg_temp.id('hazel')),
  null::bigint,
  'the undo puts back no amount'
);
select pg_temp.as_mcp();
select public.mcp_set_line_usual_amount('sp-2', pg_temp.id('elm:0'), 240000);
select tests.authenticate_as('sp_owner');
select public.set_payment_amount(pg_temp.id('elm:0'), 230000);
select pg_temp.as_mcp();
select is(
  public.mcp_undo('sp-undo-2', 'line_amount', pg_temp.id('elm:0')) -> 'error' ->> 'code',
  'conflict',
  'an amount changed since the write is a conflict'
);
select is(
  public.mcp_set_line_usual_amount('sp-3', pg_temp.id('elm:0'), -100) -> 'error' ->> 'code',
  'validation',
  'a negative MCP amount is refused'
);

-- 32-33. A viewer cannot write; nothing changes.
select tests.authenticate_as('sp_viewer');
select throws_ok(
  format('select public.set_payment_amount(%L, 100000)', pg_temp.id('hazel:0')),
  '42501', null,
  'a viewer is refused'
);
select is(pg_temp.row('hazel') -> 'typical_amount_minor', '175740'::jsonb, 'the viewer still reads the computed amount');

-- 34-36. Another company is refused and writes nothing.
select tests.authenticate_as('sp_other');
select throws_ok(
  format('select public.set_payment_amount(%L, 100000)', pg_temp.id('hazel:0')),
  'P0001', 'transaction not found',
  'another company''s line is refused'
);
reset role;
select is(
  (select count(*)::integer from public.recurring_overrides where company_id = pg_temp.id('co_b')),
  0,
  'nothing is written for the other company'
);
select is(
  (select o.typical_amount_minor from public.recurring_overrides o where o.project_id = pg_temp.id('elm')),
  230000::bigint,
  'Elm''s amount is the owner''s last write'
);

select * from finish();

rollback;
