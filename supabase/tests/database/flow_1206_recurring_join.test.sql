-- FLOW-1206. (a) private.recurring_match_suggestions: its rows equal the body before this change
-- (a pg_temp copy is the oracle) on invented lines, including an expense and an income line that
-- carry both a supplier and a customer, and the function's own plan (its SQL, with the arguments as
-- literals) reads a party's lines from transactions_party_date_idx by the party condition.
-- (b) private.jev_has_work and public.mcp_jev_status answer as the bodies before this change, on
-- enabled Jev integrations, with a refusal whose inputs key holds and one a category rename made
-- stale, for two companies. Invented names and example.com emails only.

begin;

select plan(20);

do $users$
begin
  perform tests.create_supabase_user('fj_r', 'fj-r@example.com');
  perform tests.create_supabase_user('fj_a', 'fj-a@example.com');
  perform tests.create_supabase_user('fj_b', 'fj-b@example.com');
end
$users$;

-- ---------------------------------------------------------------------------------------------
-- A. recurring_match_suggestions
-- ---------------------------------------------------------------------------------------------

create temp table rj (label text primary key, id uuid);
grant all on rj to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$ select id from pg_temp.rj where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into rj (label, id) values ('co', tests.fixture_company('fj_r', 'Example Recurring Join LLC'));

-- Suppliers: the water party and its alike party (seen before the window), the garden firm with an
-- alike annex seen before the window and an alike yard seen in it, and the power company.
-- Customers: a tenant and an alike tenant.
create temp table rj_sup (label text, name text);
insert into rj_sup values ('wtr', 'Riverside Water Works'), ('wtr_annex', 'Riverside Water Annex'),
  ('garden', 'Hilltop Garden Care'), ('garden_annex', 'Hilltop Garden Care Annex'), ('yard', 'Hilltop Garden Yard'),
  ('pwr', 'Northgate Power');
insert into public.suppliers (company_id, name) select pg_temp.id('co'), name from rj_sup;
insert into rj (label, id)
select p.label, s.id from rj_sup p join public.suppliers s on s.company_id = pg_temp.id('co') and s.name = p.name;

insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Cedar Tenant'), (pg_temp.id('co'), 'Cedar Tenant Annex');
insert into rj (label, id)
select 'tnt', c.id from public.customers c where c.company_id = pg_temp.id('co') and c.name = 'Cedar Tenant'
union all
select 'tnt_annex', c.id from public.customers c where c.company_id = pg_temp.id('co') and c.name = 'Cedar Tenant Annex';

-- Lines. tnt_both is an income line whose customer is the alike tenant and whose supplier is set too;
-- yard_new is an expense line whose supplier is the alike yard and whose customer is set too.
insert into rj (label, id)
select l.label, tests.fixture_line(pg_temp.id('co'), 'rj:' || l.label, l.amount, l.direction, null, null, l.doc_date,
  p_pnl_role => null, p_doc_kind => l.doc_kind)
from (values
  ('wtr_old', 'expense', '2026-07-01'::date, 10000::bigint, 'receipt'),
  ('wtr_new', 'expense', '2026-09-30'::date, 10100::bigint, 'receipt'),
  ('wtr_late', 'expense', '2026-10-05'::date, 9900::bigint, 'receipt'),
  ('tnt_inv', 'income', '2026-09-10'::date, 19500::bigint, 'invoice'),
  ('tnt_both', 'income', '2026-09-25'::date, 19900::bigint, 'invoice'),
  ('yard_new', 'expense', '2026-09-25'::date, 5010::bigint, 'receipt')
) as l(label, direction, doc_date, amount, doc_kind);
insert into rj (label, id)
select 'gl' || n, tests.fixture_line(pg_temp.id('co'), 'rj:gl' || n, 5000 + n, 'expense', null, null,
  '2026-01-01'::date + n * 9, p_pnl_role => null, p_doc_kind => 'receipt')
from generate_series(1, 30) n;
insert into rj (label, id)
select 'gl_gone', tests.fixture_line(pg_temp.id('co'), 'rj:gl_gone', 5020, 'expense', null, null, '2026-09-20', p_pnl_role => null, p_doc_kind => 'receipt');

update public.transactions t
set supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end,
  customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end
from (values
  ('wtr_old', 'expense', 'wtr_annex'), ('wtr_new', 'expense', 'wtr_annex'), ('wtr_late', 'expense', 'wtr_annex'),
  ('tnt_inv', 'income', 'tnt'), ('tnt_both', 'income', 'tnt_annex'), ('yard_new', 'expense', 'yard'),
  ('gl_gone', 'expense', 'garden_annex')
) as l(label, direction, party)
where t.id = pg_temp.id(l.label);
update public.transactions t set supplier_id = pg_temp.id('garden_annex')
where t.id in (select id from rj where label ~ '^gl[0-9]+$');
update public.transactions set customer_id = pg_temp.id('tnt') where id = pg_temp.id('yard_new');
update public.transactions set supplier_id = pg_temp.id('pwr') where id = pg_temp.id('tnt_both');
update public.transactions set removed_at = now() where id = pg_temp.id('gl_gone');

create function pg_temp.charges()
returns jsonb
language sql
stable
as $$
  select jsonb_build_array(
    jsonb_build_object('direction', 'expense', 'party_id', pg_temp.id('wtr'), 'currency', 'ILS', 'due_month', '2026-10-01', 'typical', -10000),
    jsonb_build_object('direction', 'expense', 'party_id', pg_temp.id('garden'), 'currency', 'ILS', 'due_month', '2026-10-01', 'typical', -5000),
    jsonb_build_object('direction', 'expense', 'party_id', pg_temp.id('pwr'), 'currency', 'ILS', 'due_month', '2026-10-01', 'typical', -10000),
    jsonb_build_object('direction', 'income', 'party_id', pg_temp.id('tnt'), 'currency', 'ILS', 'due_month', '2026-10-01', 'typical', 20000)
  );
$$;

-- The oracle: the body of private.recurring_match_suggestions before FLOW-1206 (migration 20261114021248).
create function pg_temp.recurring_before(p_company uuid, p_today date, p_charges jsonb)
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
  names as (
    select 'expense'::public.txn_direction as direction, s.id, s.name, private.party_name_words(s.name) as words
    from public.suppliers s where s.company_id = p_company
    union all
    select 'income'::public.txn_direction, cu.id, cu.name, private.party_name_words(cu.name)
    from public.customers cu where cu.company_id = p_company
  ),
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
         and not exists (
           select 1 from public.transactions o
           where o.company_id = p_company and o.removed_at is null and o.line_status = 'posted'
             and coalesce(o.supplier_id, o.customer_id) = c.id
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

-- The same rows as the body before this change, for every charge, on lines with both parties.
select results_eq(
  $$ select * from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) order by party_id $$,
  $$ select * from pg_temp.recurring_before(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) order by party_id $$,
  'each charge gets the same row as the body before FLOW-1206'
);

-- The two lines with both parties are the suggestions the old join gave: the income line through
-- its customer (the tenant's alike annex), the expense line through its supplier (the alike yard).
select is(
  (select (g.suggestion->>'transaction_id')::uuid from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) g
   where g.party_id = pg_temp.id('tnt')),
  pg_temp.id('tnt_both'),
  'the tenant gets the income line that has a supplier as well as its customer'
);
select is(
  (select (g.suggestion->>'transaction_id')::uuid from private.recurring_match_suggestions(pg_temp.id('co'), '2026-10-20', pg_temp.charges()) g
   where g.party_id = pg_temp.id('garden')),
  pg_temp.id('yard_new'),
  'the garden charge gets the expense line that has a customer as well as its supplier'
);

-- Lines for the planner: 40 suppliers and 1,500 lines, analyzed, so the planner has statistics.
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), 'Bulk Vendor ' || lpad(k::text, 2, '0') from generate_series(0, 39) k;
create temp table rj_bulk as
select n, (select s.id from public.suppliers s where s.company_id = pg_temp.id('co')
  and s.name = 'Bulk Vendor ' || lpad((n % 40)::text, 2, '0')) as sid
from generate_series(1, 1500) n;
insert into rj (label, id)
select 'bulk' || b.n, tests.fixture_line(pg_temp.id('co'), 'rj:bulk' || b.n, 1000 + b.n, 'expense', null, null,
  '2026-01-01'::date + (b.n % 300), p_pnl_role => null, p_doc_kind => 'receipt')
from rj_bulk b;
update public.transactions t set supplier_id = b.sid
from rj_bulk b join rj r on r.label = 'bulk' || b.n
where t.id = r.id;
analyze public.transactions;

-- The function's own SQL, with its arguments as literals (pg_get_functiondef's body, with each
-- argument replaced), explained: the plan of the function's query, not of a copy of it.
create function pg_temp.body_sql(p_fn regprocedure, p_subs text[])
returns text
language plpgsql
as $$
declare
  d text;
  body text;
  i integer;
begin
  d := pg_get_functiondef(p_fn);
  body := substring(d from '(?s)AS \$function\$(.*)\$function\$');
  if body is null then
    raise exception 'no body in %', p_fn;
  end if;
  body := btrim(body, E' \n\t;');
  for i in 1 .. cardinality(p_subs) / 2 loop
    body := replace(body, p_subs[2 * i - 1], p_subs[2 * i]);
  end loop;
  return body;
end;
$$;

-- The plan's text (EXPLAIN without costs) on one line, the plan's lines joined by ' | '.
create function pg_temp.plan_of(p_sql text)
returns text
language plpgsql
as $$
declare
  r record;
  out text := '';
begin
  for r in execute 'explain (costs off) ' || p_sql loop
    out := out || r."QUERY PLAN" || ' | ';
  end loop;
  return out;
end;
$$;

select ok(
  pg_temp.plan_of(pg_temp.body_sql('private.recurring_match_suggestions(uuid,date,jsonb)'::regprocedure, array[
    'p_company', quote_literal(pg_temp.id('co')::text) || '::uuid',
    'p_today', '''2026-10-20''::date',
    'p_charges', quote_literal(pg_temp.charges()::text) || '::jsonb']))
    ~ 'transactions_party_date_idx[^|]*\|\s*Index Cond: [^|]*COALESCE',
  'the function''s own plan reads a party''s lines from transactions_party_date_idx, by the party (COALESCE) condition'
);

select is(
  (select (p.prosecdef and p.provolatile = 's') from pg_proc p
   where p.oid = 'private.recurring_match_suggestions(uuid,date,jsonb)'::regprocedure),
  true,
  'the function stays security definer and stable'
);
select ok(
  not has_function_privilege('authenticated', 'private.recurring_match_suggestions(uuid,date,jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.recurring_match_suggestions(uuid,date,jsonb)', 'execute'),
  'the function keeps its revoke: no client role executes it'
);

-- ---------------------------------------------------------------------------------------------
-- B. jev: the refused lines' inputs key, once per company (jev_has_work) or per call (mcp_jev_status)
-- ---------------------------------------------------------------------------------------------

create temp table fj (label text primary key, id uuid);
grant all on fj to authenticated, service_role;

create function pg_temp.fid(p_label text) returns uuid language sql stable as $$ select id from pg_temp.fj where label = p_label; $$;
grant execute on function pg_temp.fid(text) to authenticated, service_role;

insert into fj (label, id) values
  ('a', tests.fixture_company('fj_a', 'Example Jev Works A')),
  ('b', tests.fixture_company('fj_b', 'Example Jev Works B'));
insert into fj (label, id) values
  ('a1', tests.fixture_line(pg_temp.fid('a'), 'fj:a1', 4200, p_source => 'sumit', p_doc_date => '2026-11-01')),
  ('a2', tests.fixture_line(pg_temp.fid('a'), 'fj:a2', 5100, p_source => 'sumit', p_doc_date => '2026-11-02')),
  ('b1', tests.fixture_line(pg_temp.fid('b'), 'fj:b1', 6100, p_source => 'sumit', p_doc_date => '2026-11-03'));
insert into fj (label, id) values
  ('a_cat', tests.fixture_category(pg_temp.fid('a'), 'Example Repairs'));
insert into public.review_queue (company_id, transaction_id, status)
select t.company_id, t.id, 'open' from public.transactions t where t.id in (pg_temp.fid('a1'), pg_temp.fid('a2'), pg_temp.fid('b1'));
-- Each company's only open line is a refused one: a2 is out of the review queue.
delete from public.review_queue where transaction_id = pg_temp.fid('a2');
-- An enabled Jev integration in auto mode for both companies (fixture_company creates none).
insert into public.company_integrations (company_id, provider, enabled, mode)
values (pg_temp.fid('a'), 'jev', true, 'auto'), (pg_temp.fid('b'), 'jev', true, 'auto');
select is(
  (select count(*)::int from public.company_integrations
   where company_id in (pg_temp.fid('a'), pg_temp.fid('b')) and provider = 'jev' and enabled and mode = 'auto'),
  2,
  'both companies have an enabled Jev integration in auto mode'
);

-- The oracle: private.jev_has_work before FLOW-1206 (its body after FLOW-1174, migration 20261114093900).
create function pg_temp.jev_has_work_before()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_integrations ci
    join public.transactions t
      on t.company_id = ci.company_id
     and t.removed_at is null
    join public.review_queue q
      on q.company_id = t.company_id
     and q.transaction_id = t.id
     and q.status = 'open'
    where ci.provider = 'jev'
      and ci.enabled
      and ci.mode in ('shadow', 'auto')
      and ci.daily_call_cap > private.jev_calls_today(ci.company_id)
      and not exists (
        select 1 from public.tag_suggestions s
        where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
      )
      and not exists (
        select 1 from public.jev_line_failures f
        where f.transaction_id = t.id
          and f.model_version = 'jev-1.13.0'
          and f.retry_after > now()
          and (f.refused_at is null or f.refused_inputs = private.jev_inputs_key(f.company_id))
      )
  );
$$;
grant execute on function pg_temp.jev_has_work_before() to authenticated, service_role;

-- The oracle: public.mcp_jev_status before FLOW-1206 (its body after FLOW-1168, migration 20261114093900).
create function pg_temp.mcp_jev_status_before()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  integration public.company_integrations%rowtype;
  last_run timestamptz;
  waiting integer;
  filled_today integer;
  filled_open integer;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into integration
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
  select max(coalesce(u.finished_at, u.started_at)) into last_run
  from public.jev_usage u
  where u.company_id = cid;
  select count(*)::integer into waiting
  from public.transactions t
  join public.review_queue q
    on q.company_id = t.company_id
   and q.transaction_id = t.id
   and q.status = 'open'
  where t.company_id = cid
    and t.removed_at is null
    and not exists (
      select 1 from public.tag_suggestions s
      where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
    );
  select count(*)::integer into filled_today
  from public.jev_prefills jp
  where jp.company_id = cid and jp.undone_at is null
    and jp.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select count(distinct jp.transaction_id)::integer into filled_open
  from public.jev_prefills jp
  join public.transactions t on t.company_id = jp.company_id and t.id = jp.transaction_id
  where jp.company_id = cid and jp.undone_at is null and t.removed_at is null
    and (
      select q.status from public.review_queue q
      where q.company_id = cid and q.transaction_id = jp.transaction_id
      order by q.created_at desc, q.updated_at desc, q.id desc
      limit 1
    ) = 'open';
  return jsonb_build_object(
    'enabled', coalesce(integration.enabled, false)
      and coalesce(integration.mode, 'off') in ('shadow', 'auto'),
    'mode', coalesce(integration.mode, 'off'),
    'threshold', coalesce(integration.threshold, 0.90),
    'daily_call_cap', coalesce(integration.daily_call_cap, 200),
    'calls_today', private.jev_calls_today(cid),
    'last_run_at', last_run,
    'lines_without_suggestion', waiting,
    'prefilled_today', filled_today,
    'prefilled_open', filled_open,
    'lines_not_retried', (
      select count(*)::integer
      from public.transactions t
      join public.review_queue q
        on q.company_id = t.company_id
       and q.transaction_id = t.id
       and q.status = 'open'
      where t.company_id = cid
        and t.removed_at is null
        and not exists (
          select 1 from public.tag_suggestions s
          where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
        )
        and exists (
          select 1 from public.jev_line_failures f
          where f.transaction_id = t.id
            and f.model_version = 'jev-1.13.0'
            and f.refused_at is not null
            and f.retry_after > now()
            and f.refused_inputs = private.jev_inputs_key(cid)
        )
    )
  );
end;
$$;
grant execute on function pg_temp.mcp_jev_status_before() to authenticated, service_role;

-- Lines a1 and b1 are refused as invalid (the job's call), with the inputs the companies have now.
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.jev_mark_failed(pg_temp.fid('a'), pg_temp.fid('a1'), 'jev-1.13.0', true);
select public.jev_mark_failed(pg_temp.fid('b'), pg_temp.fid('b1'), 'jev-1.13.0', true);
reset role;

-- Step 1: both refusals hold.
select is(private.jev_has_work(), pg_temp.jev_has_work_before(),
  'both refusals hold: jev_has_work answers as before');
select tests.authenticate_as('fj_a');
select is(public.mcp_jev_status(), pg_temp.mcp_jev_status_before(),
  'company A: mcp_jev_status answers as before');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 1,
  'company A: its refused line is counted as not retried');
reset role;
select tests.authenticate_as('fj_b');
select is(public.mcp_jev_status(), pg_temp.mcp_jev_status_before(),
  'company B: mcp_jev_status answers as before');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 1,
  'company B: its refused line is counted as not retried');
reset role;

-- Step 2: a category rename changes company A's inputs key, so its refusal holds nothing.
update public.categories set name = 'Example Repairs and Upkeep' where id = pg_temp.fid('a_cat');
select is(private.jev_has_work(), pg_temp.jev_has_work_before(),
  'a renamed category: jev_has_work answers as before');
select ok(private.jev_has_work(), 'a renamed category: company A''s line is work again');
select tests.authenticate_as('fj_a');
select is(public.mcp_jev_status(), pg_temp.mcp_jev_status_before(),
  'company A after the rename: mcp_jev_status answers as before');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 0,
  'company A after the rename: its stale refusal counts for nothing');
reset role;
select tests.authenticate_as('fj_b');
select is(public.mcp_jev_status(), pg_temp.mcp_jev_status_before(),
  'company B after A''s rename: mcp_jev_status answers as before');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 1,
  'company B: its own key still holds, so its refusal counts');
reset role;

-- The grants stay as they were.
select ok(
  has_function_privilege('authenticated', 'public.mcp_jev_status()', 'execute')
  and not has_function_privilege('anon', 'public.mcp_jev_status()', 'execute'),
  'mcp_jev_status: authenticated executes it, anon does not'
);
select ok(
  not has_function_privilege('authenticated', 'private.jev_has_work()', 'execute'),
  'jev_has_work stays revoked from clients'
);

select * from finish();
rollback;
