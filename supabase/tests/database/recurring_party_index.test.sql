-- FLOW-1192. (a) review_queue_open_idx is back: a partial index on (company_id) where status = 'open', the one
-- migration 20261113060409 dropped. (b) private.recurring_match_suggestions answers the same rows (for lines with one
-- party; a line with both a supplier and a customer is not in the fixture, see the migration) after its "first seen
-- lately" anti-join tests coalesce(supplier_id, customer_id) (the expression transactions_party_date_idx is on), and keeps
-- the same grants, volatility and security. The oracle is the function's body before FLOW-1192 (migration
-- 20261113141912), kept as a pg_temp function, as recurring_setwise does. Invented data only.
-- "Today" is 2026-10-20; the charges are due in October, so the window opens on 2026-09-01.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('rpi_owner', 'rpi-owner@example.com');
end
$users$;

create temp table rpi (label text primary key, id uuid);
grant all on rpi to authenticated, service_role;

insert into rpi (label, id) values ('co', tests.fixture_company('rpi_owner', 'Example Party Index LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rpi where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Suppliers: the charge's party, an alike party seen before the window (passed over), an alike party seen in the
-- window (its latest line answers), and a power company whose alike party was seen before the window.
create temp table rpi_sup (label text, name text);
insert into rpi_sup values ('wtr', 'Riverside Water Works'), ('wtr_annex', 'Riverside Water Annex'),
  ('wtr_depot', 'Riverside Water Depot'), ('pwr', 'Northgate Power'), ('pwp', 'Northgate Power Plant');
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), name from rpi_sup;
insert into rpi (label, id)
select p.label, s.id from rpi_sup p join public.suppliers s on s.company_id = pg_temp.id('co') and s.name = p.name;

create temp table rpi_cus (label text, name text);
insert into rpi_cus values ('tnt', 'Cedar Tenant'), ('tnt_annex', 'Cedar Tenant Annex');
insert into public.customers (company_id, name)
select pg_temp.id('co'), name from rpi_cus;
insert into rpi (label, id)
select p.label, c.id from rpi_cus p join public.customers c on c.company_id = pg_temp.id('co') and c.name = p.name;

-- label, party, direction, date, amount (minor units, positive), doc kind
create temp table rpi_lines (label text, party text, direction text, doc_date date, amount bigint, doc_kind text);
insert into rpi_lines values
  ('annex_old', 'wtr_annex', 'expense', '2026-07-01', 10000, 'receipt'),
  ('annex_new', 'wtr_annex', 'expense', '2026-09-30', 10000, 'receipt'),
  ('depot_early', 'wtr_depot', 'expense', '2026-09-25', 10300, 'receipt'),
  ('depot_late', 'wtr_depot', 'expense', '2026-10-05', 10000, 'receipt'),
  ('plant_old', 'pwp', 'expense', '2026-06-15', 9800, 'receipt'),
  ('plant_new', 'pwp', 'expense', '2026-09-12', 10200, 'receipt'),
  ('tenant_inv', 'tnt_annex', 'income', '2026-09-10', 19500, 'invoice');

insert into rpi (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'rpi:' || l.label, l.amount, l.direction, null, null, l.doc_date,
  p_pnl_role => null, p_doc_kind => l.doc_kind
)
from rpi_lines l;
update public.transactions t
set supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end,
  customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end
from rpi_lines l
where t.id = pg_temp.id(l.label);

-- The charges: the water bill, the power bill (its alike party seen before the window), the tenant's rent.
create function pg_temp.charges()
returns jsonb
language sql
stable
as $$
  select jsonb_build_array(
    jsonb_build_object('direction', 'expense', 'party_id', pg_temp.id('wtr'), 'currency', 'ILS', 'due_month', '2026-10-01', 'typical', -10000),
    jsonb_build_object('direction', 'expense', 'party_id', pg_temp.id('pwr'), 'currency', 'ILS', 'due_month', '2026-10-01', 'typical', -10000),
    jsonb_build_object('direction', 'income', 'party_id', pg_temp.id('tnt'), 'currency', 'ILS', 'due_month', '2026-10-01', 'typical', 20000)
  );
$$;

-- The oracle: private.recurring_match_suggestions as migration 20261113141912 left it (its body, under pg_temp).
create function pg_temp.recurring_match_suggestions_before(p_company uuid, p_today date, p_charges jsonb)
returns table(direction public.txn_direction, party_id uuid, currency text, due_month date, typical bigint, suggestion jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  with ch as (
    select distinct c.direction, c.party_id, c.currency, c.due_month, c.typical
    from jsonb_to_recordset(p_charges)
      as c(direction public.txn_direction, party_id uuid, currency text, due_month date, typical bigint)
  ),
  -- Every party's name, its words made once (private.party_name_words).
  names as (
    select 'expense'::public.txn_direction as direction, s.id, s.name, private.party_name_words(s.name) as words
    from public.suppliers s where s.company_id = p_company
    union all
    select 'income'::public.txn_direction, cu.id, cu.name, private.party_name_words(cu.name)
    from public.customers cu where cu.company_id = p_company
  ),
  -- The one definition of two names that may be one party, on the words: neither empty, and the same first word of 3 letters
  -- or more, or one name inside the other.
  alike as (
    select me.direction, me.id as party_id, n.id, n.name
    from (select distinct c.direction, c.party_id from ch c) cp
    join names me on me.direction = cp.direction and me.id = cp.party_id
    join names n on n.direction = me.direction and n.id <> me.id
    where me.words <> '' and n.words <> ''
      and ((char_length(split_part(me.words, ' ', 1)) >= 3 and split_part(me.words, ' ', 1) = split_part(n.words, ' ', 1))
        or position(me.words in n.words) > 0 or position(n.words in me.words) > 0)
  )
  select ch.direction, ch.party_id, ch.currency, ch.due_month, ch.typical,
    (select jsonb_build_object(
        'party_id', l.id,
        'party_name', l.name,
        'transaction_id', l.transaction_id,
        'doc_date', l.doc_date,
        'amount_minor', l.amount_net
      )
     from (
       select distinct on (c.id) c.id, c.name, t.id as transaction_id, t.doc_date, t.amount_net
       from alike c
       join public.transactions t
         on t.company_id = p_company and t.direction = ch.direction and t.currency = ch.currency
         and c.id = case when ch.direction = 'expense' then t.supplier_id else t.customer_id end
       where c.direction = ch.direction and c.party_id = ch.party_id
         and not exists (
           select 1 from public.recurring_matches m
           where m.company_id = p_company and m.direction = ch.direction
             and ((m.party_id = ch.party_id and m.match_party_id = c.id) or (m.match_party_id = c.id and m.same)
               or m.party_id = c.id)
         )
         and t.removed_at is null
         and t.line_status = 'posted'
         and (ch.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and t.doc_date >= (ch.due_month - interval '1 month')::date
         and t.doc_date <= p_today
         -- First seen lately: no line before the month ahead of the due month.
         and not exists (
           select 1 from public.transactions o
           where o.company_id = p_company and o.removed_at is null and o.line_status = 'posted'
             and c.id = case when ch.direction = 'expense' then o.supplier_id else o.customer_id end
             and o.doc_date < (ch.due_month - interval '1 month')::date
         )
       order by c.id, t.doc_date desc, t.created_at desc
     ) l
     where ch.typical <> 0
       and abs(l.amount_net) * 2 >= abs(ch.typical)
       and abs(l.amount_net) * 2 <= abs(ch.typical) * 3
     order by abs(abs(l.amount_net) - abs(ch.typical)), l.doc_date desc, l.id
     limit 1) as suggestion
  from ch;
$$;


-- (a) The open-row partial index, as schema_v1 defined it.
select is(
  pg_get_indexdef('public.review_queue_open_idx'::regclass),
  'CREATE INDEX review_queue_open_idx ON public.review_queue USING btree (company_id) WHERE (status = ''open''::review_status)',
  'review_queue_open_idx is on company_id, partial on status = open'
);

-- (b) The same rows as the body before this change, for every charge.
select results_eq(
  $$ select * from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) order by party_id $$,
  $$ select * from pg_temp.recurring_match_suggestions_before(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) order by party_id $$,
  'each charge gets the same row as the body before FLOW-1192'
);

select is(
  (select g.suggestion ->> 'transaction_id'
   from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) g
   where g.party_id = pg_temp.id('wtr')),
  pg_temp.id('depot_late')::text,
  'the water bill answers with the alike party seen in the window (its latest line); the one seen since July is passed over'
);

select ok(
  (select g.suggestion is null
   from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) g
   where g.party_id = pg_temp.id('pwr')),
  'the power bill has no suggestion: its alike party was seen before the window'
);

select is(
  (select g.suggestion ->> 'transaction_id'
   from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) g
   where g.party_id = pg_temp.id('tnt')),
  pg_temp.id('tenant_inv')::text,
  'the tenant rent answers with the invoice of its alike party in the window'
);

select is(
  (select p.provolatile::text || p.prosecdef::text
   from pg_proc p where p.oid = 'private.recurring_match_suggestions(uuid, date, jsonb)'::regprocedure),
  'strue',
  'the function is still stable and security definer'
);

select ok(
  not has_function_privilege('anon', 'private.recurring_match_suggestions(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.recurring_match_suggestions(uuid, date, jsonb)', 'execute'),
  'anon and authenticated still cannot call it'
);

select * from finish();
rollback;
