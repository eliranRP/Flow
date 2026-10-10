-- FLOW-213: match_lines pairs an outside ledger's rows with Flow lines. Invented data only.

begin;

select plan(20);

do $users$
begin
  perform tests.create_supabase_user('ml_owner', 'ml-owner@example.com');
  perform tests.create_supabase_user('ml_other', 'ml-other@example.com');
  perform tests.create_supabase_user('ml_nobody', 'ml-nobody@example.com');
end
$users$;

create temp table ml (label text primary key, id uuid);
grant all on ml to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from ml where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select tests.authenticate_as('ml_other');
do $o$ begin perform public.create_company('Other Match Books', true); end $o$;
insert into ml (label, id) select 'other', id from public.companies where name = 'Other Match Books';

select tests.authenticate_as('ml_owner');
do $c$ begin perform public.create_company('Match Books', true); end $c$;
insert into ml (label, id) select 'co', id from public.companies where name = 'Match Books';

reset role;
with s as (
  insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Hardware') returning id
)
insert into ml (label, id) select 'supplier', id from s;
with c as (
  insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Tenant') returning id
)
insert into ml (label, id) select 'customer', id from c;

create function pg_temp.line(
  p_label text, p_company uuid, p_direction text, p_gross bigint, p_doc date, p_cash date,
  p_currency text default 'ILS', p_status text default 'posted', p_removed boolean default false
) returns void language plpgsql as $$
declare
  new_id uuid;
begin
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, description,
    supplier_id, customer_id, removed_at
  ) values (
    p_company, p_direction::public.txn_direction, (case when p_direction = 'income' then 'receipt' else 'expense' end)::public.doc_kind,
    'project', p_status::public.line_status, p_currency,
    p_gross, p_gross, abs(p_gross), 0, 'source',
    p_doc, p_cash, 'manual', 'ml:' || p_label, 'ml:' || p_label,
    case when p_direction = 'expense' and p_company = pg_temp.id('co') then pg_temp.id('supplier') end,
    case when p_direction = 'income' and p_company = pg_temp.id('co') then pg_temp.id('customer') end,
    case when p_removed then now() end
  ) returning id into new_id;
  insert into ml (label, id) values (p_label, new_id);
end;
$$;

select pg_temp.line('l1', pg_temp.id('co'), 'expense', -12000, '2026-09-03', '2026-09-05');
select pg_temp.line('l2', pg_temp.id('co'), 'expense', -12000, '2026-09-10', null);
select pg_temp.line('l3', pg_temp.id('co'), 'income', 50000, '2026-09-01', null);
select pg_temp.line('l4', pg_temp.id('co'), 'expense', -7000, '2026-09-20', null, p_removed => true);
select pg_temp.line('l5', pg_temp.id('co'), 'expense', -7000, '2026-09-21', null, p_status => 'void');
select pg_temp.line('l6', pg_temp.id('co'), 'expense', -3300, '2026-09-15', null, p_currency => 'USD');
select pg_temp.line('l7', pg_temp.id('co'), 'expense', -999, '2026-09-12', null);
select pg_temp.line('l8', pg_temp.id('co'), 'expense', -12000, '2026-08-01', null);
select pg_temp.line('x1', pg_temp.id('other'), 'expense', -12000, '2026-09-05', null);

create temp table out (k text primary key, v jsonb);
grant all on out to authenticated, service_role;

select tests.authenticate_as('ml_owner');
insert into out (k, v) values ('base', public.match_lines($j$[
  {"date": "2026-09-05", "amount_minor": -12000, "ref": "INV-1"},
  {"date": "2026-09-06", "amount_minor": 12000},
  {"date": "2026-09-02", "amount_minor": 50000},
  {"date": "2026-09-20", "amount_minor": -7000},
  {"date": "2026-09-15", "amount_minor": -3300}
]$j$::jsonb));

create function pg_temp.r(p_k text, p_i integer) returns jsonb language sql stable as $$
  select v->'rows'->p_i from out where k = p_k;
$$;
grant execute on function pg_temp.r(text, integer) to authenticated, service_role;

select is(
  (select jsonb_build_object('currency', v->'currency', 'window_days', v->'window_days', 'from', v->'from', 'to', v->'to') from out where k = 'base'),
  '{"currency": "ILS", "window_days": 5, "from": "2026-09-02", "to": "2026-09-20"}'::jsonb,
  'the read names the currency, the window and the rows'' date range'
);
select is(
  (pg_temp.r('base', 0)->'match'->>'transaction_id')::uuid,
  pg_temp.id('l1'),
  'a row takes the line paid on its date'
);
select is(
  pg_temp.r('base', 0)->'match'->'day_diff',
  '0'::jsonb,
  'matched on the payment date, not the document date'
);
select is(
  pg_temp.r('base', 0)->>'ref',
  'INV-1',
  'the row''s ref comes back'
);
select is(
  (select array_agg((c->>'transaction_id')::uuid order by n) from jsonb_array_elements(pg_temp.r('base', 0)->'candidates') with ordinality as x(c, n)),
  array[pg_temp.id('l1'), pg_temp.id('l2')],
  'candidates are the same amount within the window, closest first, never another company''s'
);
select is(
  (pg_temp.r('base', 1)->'match'->>'transaction_id')::uuid,
  pg_temp.id('l2'),
  'a line already claimed by a closer row goes to the next one'
);
select is(
  pg_temp.r('base', 1)->'candidate_count',
  '2'::jsonb,
  'and both lines stay its candidates'
);
select is(
  (pg_temp.r('base', 2)->'match') - 'transaction_id',
  jsonb_build_object(
    'doc_date', '2026-09-01', 'cash_date', null, 'amount_minor', 50000, 'currency', 'ILS',
    'direction', 'income', 'line_status', 'posted', 'party', 'Example Tenant', 'description', 'ml:l3',
    'project_name', null, 'pnl_role', 'project', 'category_name', 'הכנסה מלקוחות', 'day_diff', 1
  ),
  'a matched line carries its dates, signed amount, party, project and category'
);
select is(
  pg_temp.r('base', 3)->'candidates',
  '[]'::jsonb,
  'removed and void lines never match'
);
select is(
  pg_temp.r('base', 4)->'match',
  'null'::jsonb,
  'a line in another currency does not match'
);
select is(
  (select v->'unmatched_rows' from out where k = 'base'),
  '[3, 4]'::jsonb,
  'unmatched_rows lists the rows with no line'
);
select is(
  (select v->'matched_count' from out where k = 'base'),
  '3'::jsonb,
  'matched_count counts the pairs'
);
select is(
  (select array_agg((l->>'transaction_id')::uuid) from out, jsonb_array_elements(v->'unclaimed_lines') l where k = 'base'),
  array[pg_temp.id('l7')],
  'unclaimed_lines are the lines in the rows'' date range no row took'
);

select is(
  (public.match_lines('[{"date": "2026-09-15", "amount_minor": 3300}]'::jsonb, p_currency => 'USD')->'rows'->0->'match'->>'transaction_id')::uuid,
  pg_temp.id('l6'),
  'a currency picks that currency''s lines'
);
select is(
  public.match_lines('[{"date": "2026-09-05", "amount_minor": 12000}]'::jsonb, p_direction => 'income')->'rows'->0->'candidate_count',
  '0'::jsonb,
  'a direction narrows the lines'
);
select is(
  public.match_lines('[{"date": "2026-09-06", "amount_minor": 12000}]'::jsonb, 0)->'rows'->0->'candidate_count',
  '0'::jsonb,
  'a window of 0 takes only the same day'
);

-- Refusals.
create function pg_temp.refused(p_rows jsonb, p_window integer default 5, p_direction text default null, p_currency text default null)
returns boolean language plpgsql as $$
begin
  perform public.match_lines(p_rows, p_window, p_direction, p_currency);
  return false;
exception when raise_exception then
  return sqlerrm = 'validation';
end;
$$;
grant execute on function pg_temp.refused(jsonb, integer, text, text) to authenticated, service_role;

select is(
  (
    select array_agg(r.n order by r.n)
    from unnest(array[
      '[]',
      '{"date": "2026-09-01", "amount_minor": 1}',
      '[{"date": "2026-02-30", "amount_minor": 1}]',
      '[{"date": "01/09/2026", "amount_minor": 1}]',
      '[{"amount_minor": 1}]',
      '[{"date": "2026-09-01", "amount_minor": 0}]',
      '[{"date": "2026-09-01", "amount_minor": 1.5}]',
      '[{"date": "2026-09-01", "amount_minor": "100"}]',
      '[{"date": "2026-09-01", "amount_minor": 1, "note": "x"}]',
      '[{"date": "2026-09-01", "amount_minor": 1, "ref": 7}]',
      '["2026-09-01"]'
    ]::jsonb[]) with ordinality as r(j, n)
    where not pg_temp.refused(r.j)
  ),
  null,
  'every malformed rows argument is refused'
);
select ok(
  pg_temp.refused((select jsonb_agg(jsonb_build_object('date', '2026-09-01', 'amount_minor', 1)) from generate_series(1, 501)))
  and pg_temp.refused('[{"date": "2026-09-01", "amount_minor": 1}]', 32)
  and pg_temp.refused('[{"date": "2026-09-01", "amount_minor": 1}]', -1)
  and pg_temp.refused('[{"date": "2026-09-01", "amount_minor": 1}]', 5, 'both')
  and pg_temp.refused('[{"date": "2026-09-01", "amount_minor": 1}]', 5, null, 'usd'),
  'more than 500 rows, a window outside 0 to 31, a bad direction or currency are refused'
);
select ok(
  not pg_temp.refused('[{"date": "2026-09-01", "amount_minor": -1, "ref": null}]'),
  'a negative amount and a null ref are fine'
);

select tests.authenticate_as('ml_nobody');
select is(
  public.match_lines('[{"date": "2026-09-05", "amount_minor": 12000}]'::jsonb),
  null,
  'a user with no company reads nothing'
);

select * from finish();
rollback;
