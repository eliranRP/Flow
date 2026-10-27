-- FLOW-977: top Flow QA up to at least twice the largest real company's row count.
--
-- Run by hand through the owner's Supabase connector (docs/runbooks/qa-user.md, "Seed a
-- scenario"). Not a migration: it never runs on deploy or in CI. Safe to run again: it adds only
-- the shortfall, so a second run with unchanged counts adds nothing.
--
-- Guards (the runbook's):
-- - The target is the one company named 'Flow QA', not a demo, owned by the QA login. Any other
--   result stops the run before a write.
-- - Every insert names that company id. Of other companies it reads only the companies row's
--   name, owner and demo flag (to find Flow QA and skip demos) and count(*) per table, never
--   their rows.
-- - Writes that the app makes through an RPC (loan and line splits) go through that RPC, as the
--   QA login, so every app rule applies. Every other insert passes the tables' checks and
--   triggers; nothing is disabled.
--
-- Synthetic rows are marked so a sync never touches them and they can be listed and removed:
-- - transactions: source 'manual', no external id, idempotency key 'qa-seed:...',
--   provider_meta.qa_seed = true. mercury-sync and sumit-sync read and write only their own
--   source's lines, by external id.
-- - every other row with an id: id = md5(company, table, n), see pg_temp.qa_id. Names start
--   with 'QA '.
-- - recurring_dismissals and recurring_matches (no id): their party is a seeded supplier.
--
-- Settings (optional, set before the run): qa_seed.factor (default 2), qa_seed.floors (a JSON
-- object of per-table minimum row counts, default {}).

create or replace function pg_temp.qa_id(p_company uuid, p_table text, p_n integer)
returns uuid
language sql
immutable
as $$ select md5(p_company::text || ':' || p_table || ':' || p_n)::uuid; $$;

-- The first p_k seeded numbers n whose row (id pg_temp.qa_id) is not in the table yet, so a
-- deleted seeded row is filled again and new rows never collide with old ones.
create or replace function pg_temp.qa_free(p_company uuid, p_table text, p_k integer)
returns setof integer
language plpgsql
as $$
begin
  if p_k > 0 then
    return query execute format(
      'select g from generate_series(1, $3 + (select count(*)::integer from public.%I where company_id = $1)) g where not exists (select 1 from public.%I x where x.company_id = $1 and x.id = pg_temp.qa_id($1, $2, g)) order by g limit $3',
      p_table, p_table) using p_company, p_table, p_k;
  end if;
end;
$$;

-- A deterministic number in [0, 1) for a key, so a re-run builds the same rows.
create or replace function pg_temp.qa_r(p_key text)
returns double precision
language sql
immutable
as $$ select ('x' || substr(md5(p_key), 1, 8))::bit(32)::bigint / 4294967296.0; $$;

-- One element of a text array, picked by a key.
create or replace function pg_temp.qa_pick(p_items text[], p_key text)
returns text
language sql
immutable
as $$ select p_items[1 + floor(pg_temp.qa_r(p_key) * array_length(p_items, 1))::integer]; $$;

drop table if exists pg_temp.qa_seed_report;
create temp table qa_seed_report (
  tbl text primary key,
  reference integer not null,
  target integer not null,
  before integer not null,
  after integer
);

do $seed$
declare
  factor numeric := coalesce(nullif(current_setting('qa_seed.factor', true), '')::numeric, 2);
  floors jsonb := coalesce(nullif(current_setting('qa_seed.floors', true), '')::jsonb, '{}'::jsonb);
  tables constant text[] := array[
    'customers', 'suppliers', 'projects', 'categories', 'accounts', 'loans', 'loan_rates',
    'loan_splits', 'transactions', 'allocations', 'line_splits', 'review_queue', 'legs',
    'transaction_notes', 'transaction_files', 'jev_prefills', 'project_forecast_edits',
    'recurring_overrides', 'recurring_dismissals', 'recurring_matches'
  ];
  qa uuid;
  qa_owner uuid;
  matches integer;
  cur text;
  span_start date;
  span_end date;
  span_days integer;
  model text;
  tname text;
  ref integer;
  n_now integer;
  k integer;
  r record;
  loan record;
  pay_month integer;
  txn uuid;
  bal bigint;
  interest bigint;
  principal bigint;
  paid integer;
  wanted integer;
  shared_n integer;
  alloc_needed integer;
  per_shared integer;
  project_ids uuid[];
  expense_cats uuid[];
  income_cats uuid[];
  supplier_ids uuid[];
  customer_ids uuid[];
  cat_interest uuid;
  last_names constant text[] := array['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'שפירא', 'דהן', 'אזולאי', 'גבאי', 'חדד'];
  first_names constant text[] := array['יוסי', 'מיכל', 'דני', 'נועה', 'אבי', 'שירה', 'רון', 'תמר', 'עומר', 'יעל'];
  trades constant text[] := array['בנייה', 'שיפוצים', 'חשמל', 'אינסטלציה', 'צבע', 'נגרות', 'ריצוף', 'גינון', 'הובלות', 'חומרי בניין', 'ייעוץ', 'ביטוח'];
  streets constant text[] := array['הרצל', 'ויצמן', 'בן גוריון', 'רוטשילד', 'הנביאים', 'ז׳בוטינסקי', 'סוקולוב', 'ביאליק'];
  expense_words constant text[] := array['חומרים', 'קבלני משנה', 'עבודה', 'היתרים', 'ביטוח', 'תחזוקה', 'שיווק', 'משפטי', 'הנהלת חשבונות', 'תוכנה', 'רכב', 'נסיעות', 'ציוד', 'שירותים', 'ארנונה', 'חשמל ומים'];
  income_words constant text[] := array['שכירות', 'מכירה', 'דמי ניהול', 'החזר', 'עמלה'];
  note_bodies constant text[] := array['QA לבדוק מול החשבונית', 'QA שולם בהעברה', 'QA חלק ראשון מתוך שניים', 'QA לפי הצעת מחיר', 'QA אושר בטלפון'];
begin
  -- The guard: exactly one company named Flow QA, not a demo, owned by the QA login.
  select count(*) into matches
  from public.companies c
  join auth.users u on u.id = c.owner_id
  where c.name = 'Flow QA' and not c.is_demo and u.email = 'ops+qa@nromomentum.com';
  if matches <> 1 then
    raise exception 'qa_seed: expected exactly one Flow QA company owned by the QA login, found %', matches;
  end if;
  select c.id, c.owner_id, c.base_currency into qa, qa_owner, cur
  from public.companies c
  join auth.users u on u.id = c.owner_id
  where c.name = 'Flow QA' and not c.is_demo and u.email = 'ops+qa@nromomentum.com'
  for update of c;

  -- RPCs run as the QA login, and must resolve to Flow QA.
  perform set_config('request.jwt.claims', json_build_object('sub', qa_owner, 'role', 'authenticated')::text, true);
  if private.current_company_id() is distinct from qa then
    raise exception 'qa_seed: the QA login does not resolve to Flow QA';
  end if;

  -- Targets: factor x the largest other real company's count, per table (counts only).
  foreach tname in array tables loop
    execute format(
      'select coalesce(max(n), 0) from (select count(*) n from public.%I x join public.companies c on c.id = x.company_id where x.company_id <> $1 and not c.is_demo group by x.company_id) s',
      tname) into ref using qa;
    execute format('select count(*) from public.%I where company_id = $1', tname) into n_now using qa;
    insert into pg_temp.qa_seed_report (tbl, reference, target, before)
    values (tname, ref, greatest(ceil(ref * factor)::integer, coalesce((floors->>tname)::integer, 0)), n_now);
  end loop;

  -- Dates follow Flow QA's own lines (not the seed's); 18 months back when it has none.
  select min(t.doc_date), max(t.doc_date) into span_start, span_end
  from public.transactions t
  where t.company_id = qa and t.idempotency_key not like 'qa-seed:%';
  span_end := coalesce(span_end, current_date);
  span_start := coalesce(span_start, span_end - 540);
  span_days := greatest(span_end - span_start, 30);

  -- Customers and suppliers.
  select target - (select count(*) from public.customers where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'customers';
  if k > 0 then
    insert into public.customers (id, company_id, name)
    select pg_temp.qa_id(qa, 'customers', g), qa,
      'QA ' || pg_temp.qa_pick(first_names, 'cf' || g) || ' ' || pg_temp.qa_pick(last_names, 'cl' || g) || ' ' || g
    from pg_temp.qa_free(qa, 'customers', k) g
    on conflict do nothing;
  end if;

  select target - (select count(*) from public.suppliers where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'suppliers';
  if k > 0 then
    insert into public.suppliers (id, company_id, name)
    select pg_temp.qa_id(qa, 'suppliers', g), qa,
      'QA ' || pg_temp.qa_pick(last_names, 'sl' || g) || ' ' || pg_temp.qa_pick(trades, 'st' || g) || ' ' || g
    from pg_temp.qa_free(qa, 'suppliers', k) g
    on conflict do nothing;
  end if;

  -- Projects: properties with a purchase price and an after-repair value.
  select target - (select count(*) from public.projects where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'projects';
  if k > 0 then
    insert into public.projects (id, company_id, name, status, purchase_minor, arv_minor, investment_currency, finished_on)
    select pg_temp.qa_id(qa, 'projects', g), qa,
      'QA ' || pg_temp.qa_pick(streets, 'ps' || g) || ' ' || (2 + floor(pg_temp.qa_r('pn' || g) * 90))::integer || ' ' || g,
      case when pg_temp.qa_r('pf' || g) < 0.2 then 'finished'::public.project_status else 'active'::public.project_status end,
      (8000000 + floor(pg_temp.qa_r('pp' || g) * 40000000))::bigint,
      (15000000 + floor(pg_temp.qa_r('pa' || g) * 60000000))::bigint,
      cur,
      case when pg_temp.qa_r('pf' || g) < 0.2 then span_end - 30 end
    from pg_temp.qa_free(qa, 'projects', k) g
    on conflict do nothing;
  end if;

  -- Categories (each one also gets its ledger account from the categories trigger).
  select target - (select count(*) from public.categories where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'categories';
  if k > 0 then
    insert into public.categories (id, company_id, name, kind, sort_order)
    select pg_temp.qa_id(qa, 'categories', g), qa,
      case when g % 4 = 0
        then 'QA ' || pg_temp.qa_pick(income_words, 'ci' || g) || ' ' || g
        else 'QA ' || pg_temp.qa_pick(expense_words, 'ce' || g) || ' ' || g
      end,
      case when g % 4 = 0 then 'income'::public.category_kind else 'expense'::public.category_kind end,
      1000 + g
    from pg_temp.qa_free(qa, 'categories', k) g
    on conflict do nothing;
  end if;

  -- Accounts beyond the categories' own: cash boxes.
  select target - (select count(*) from public.accounts where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'accounts';
  if k > 0 then
    insert into public.accounts (id, company_id, name, type)
    select pg_temp.qa_id(qa, 'accounts', g), qa, 'QA קופה ' || g, 'asset'
    from pg_temp.qa_free(qa, 'accounts', k) g
    on conflict do nothing;
  end if;

  -- Pools for the lines.
  select array_agg(id order by id) into project_ids from public.projects where company_id = qa and status = 'active';
  select array_agg(id order by id) into expense_cats from public.categories
    where company_id = qa and kind = 'expense' and loan_part is null and not hidden and not excluded_from_pnl;
  select array_agg(id order by id) into income_cats from public.categories
    where company_id = qa and kind = 'income' and loan_part is null and not hidden and not excluded_from_pnl;
  select array_agg(id order by id) into supplier_ids from public.suppliers where company_id = qa;
  select array_agg(id order by id) into customer_ids from public.customers where company_id = qa;
  if project_ids is null or expense_cats is null or income_cats is null or supplier_ids is null or customer_ids is null then
    raise exception 'qa_seed: Flow QA needs an active project, an expense and an income category, a supplier and a customer';
  end if;
  select id into cat_interest from public.categories where company_id = qa and loan_part = 'interest';

  -- Loans: mostly amortizing, some interest-only and balloon, in the company currency.
  select target - (select count(*) from public.loans where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'loans';
  if k > 0 then
    insert into public.loans (
      id, company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
      escrow_minor, currency, project_id, kind, interest_only_months, amortization_months, sort_order
    )
    select l.id, qa, l.name, l.principal, l.rate, l.term, l.start_date,
      l.escrow + case
        when l.kind = 'interest_only' then ceil(l.principal * l.rate / 12000000.0)::bigint + 1
        else ceil(l.principal * (l.rate / 12000000.0) / (1 - power(1 + l.rate / 12000000.0, -l.amort)))::bigint
      end,
      l.escrow, cur, l.project_id, l.kind::public.loan_kind,
      case when l.kind = 'interest_only' then l.term end,
      case when l.kind = 'balloon' then l.amort end,
      1000 + l.g
    from (
      select g, pg_temp.qa_id(qa, 'loans', g) as id,
        'QA הלוואה ' || pg_temp.qa_pick(streets, 'ls' || g) || ' ' || g as name,
        (8000000 + floor(pg_temp.qa_r('lp' || g) * 42000000))::bigint as principal,
        (65000 + floor(pg_temp.qa_r('lr' || g) * 50000))::integer as rate,
        case g % 5 when 3 then 'interest_only' when 4 then 'balloon' else 'amortizing' end as kind,
        case g % 5 when 3 then 24 when 4 then 60 else 360 end as term,
        case g % 5 when 3 then 24 else 360 end as amort,
        case when pg_temp.qa_r('le' || g) < 0.5 then 0 else (15000 + floor(pg_temp.qa_r('lx' || g) * 25000))::bigint end as escrow,
        span_start + floor(pg_temp.qa_r('ld' || g) * span_days * 0.4)::integer as start_date,
        project_ids[1 + floor(pg_temp.qa_r('lj' || g) * array_length(project_ids, 1))::integer] as project_id
      from pg_temp.qa_free(qa, 'loans', k) g
    ) l
    on conflict do nothing;
  end if;

  -- Loan rates: the starting rate, then a change every 6 months while more are needed.
  select target - (select count(*) from public.loan_rates where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'loan_rates';
  if k > 0 then
    insert into public.loan_rates (id, company_id, loan_id, effective_date, annual_rate_ppm)
    select pg_temp.qa_id(qa, 'loan_rates:' || x.loan_id, x.step), qa, x.loan_id, x.effective_date, x.rate
    from (
      select l.id as loan_id, st.step,
        (l.start_date + make_interval(months => 6 * st.step))::date as effective_date,
        greatest(l.annual_rate_ppm + (st.step * 2500 * (case when st.step % 2 = 0 then 1 else -1 end)), 0) as rate,
        row_number() over (order by st.step, l.id) as rn
      from public.loans l
      cross join generate_series(0, 6) st(step)
      where l.company_id = qa and l.name like 'QA %'
        and (l.start_date + make_interval(months => 6 * st.step))::date <= span_end
        and not exists (
          select 1 from public.loan_rates lr
          where lr.company_id = qa and lr.loan_id = l.id and lr.effective_date = (l.start_date + make_interval(months => 6 * st.step))::date
        )
    ) x
    where x.rn <= k
    on conflict do nothing;
  end if;

  -- Loan payments: a monthly line per seeded loan, split by save_loan_split (interest, escrow,
  -- principal), until the loan splits reach their target.
  select target - (select count(*) from public.loan_splits where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'loan_splits';
  if k > 0 and cat_interest is not null then
    wanted := ceil(k / 3.0)::integer;
    paid := 0;
    <<months>>
    for pay_month in 1..120 loop
      for loan in
        select l.* from public.loans l
        where l.company_id = qa and l.name like 'QA %' and l.status = 'open' and l.kind <> 'demand'
        order by l.sort_order, l.id
      loop
        exit months when paid >= wanted;
        continue when (loan.start_date + make_interval(months => pay_month))::date > span_end;
        txn := pg_temp.qa_id(qa, 'loanpay:' || loan.id, pay_month);
        continue when exists (select 1 from public.transactions t where t.company_id = qa and t.id = txn);
        select b.balance_minor into bal from public.loan_balances b where b.company_id = qa and b.loan_id = loan.id;
        bal := coalesce(bal, loan.principal_minor);
        continue when bal <= 0;
        interest := round(bal * loan.annual_rate_ppm / 12000000.0)::bigint;
        principal := greatest(loan.payment_minor - loan.escrow_minor - interest, 0);
        if loan.kind = 'interest_only' then
          principal := 0;
        end if;
        principal := least(principal, bal);
        insert into public.transactions (
          id, company_id, direction, doc_kind, pnl_role, amount_gross, amount_net, vat_amount, vat_status,
          doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
          user_assigned, category_assigned, project_assigned, currency, provider_meta
        ) values (
          txn, qa, 'expense', 'expense',
          case when loan.project_id is null then 'overhead'::public.pnl_role else 'project'::public.pnl_role end,
          -(interest + loan.escrow_minor + principal), -(interest + loan.escrow_minor + principal), 0, 'derived',
          (loan.start_date + make_interval(months => pay_month))::date,
          (loan.start_date + make_interval(months => pay_month))::date,
          'manual', 'qa-seed:loanpay:' || loan.id || ':' || pay_month, loan.project_id, cat_interest,
          loan.name, true, true, true, loan.currency, '{"qa_seed": true}'
        );
        if loan.project_id is null then
          insert into public.overhead (company_id, transaction_id) values (qa, txn);
        else
          insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
          values (qa, txn, loan.project_id, 10000, -(interest + loan.escrow_minor + principal));
        end if;
        perform public.save_loan_split(txn, loan.id, jsonb_build_array(
          jsonb_build_object('part', 'interest', 'amount_minor', interest, 'scheduled_minor', interest),
          jsonb_build_object('part', 'escrow', 'amount_minor', loan.escrow_minor, 'scheduled_minor', loan.escrow_minor),
          jsonb_build_object('part', 'principal', 'amount_minor', principal, 'scheduled_minor', principal)
        ), false);
        paid := paid + 1;
      end loop;
    end loop;
  end if;

  -- Everyday lines: expenses (to one project, shared across projects, or overhead) and income.
  select target - (select count(*) from public.transactions where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'transactions';
  if k > 0 then
    insert into public.transactions (
      id, company_id, direction, doc_kind, pnl_role, amount_gross, amount_net, vat_amount, vat_status,
      doc_date, cash_date, source, idempotency_key, project_id, customer_id, supplier_id, category_id,
      description, user_assigned, category_suggested, category_assigned, project_assigned, currency, provider_meta
    )
    select x.id, qa, x.direction::public.txn_direction,
      case when x.direction = 'income' then 'invoice_receipt'::public.doc_kind else 'expense'::public.doc_kind end,
      x.role::public.pnl_role, x.amount, x.amount, 0, 'derived', x.doc_date, x.doc_date, 'manual',
      'qa-seed:txn:' || x.g, x.project_id, x.customer_id, x.supplier_id, x.category_id,
      coalesce((select c.name from public.customers c where c.company_id = qa and c.id = x.customer_id),
               (select p.name from public.suppliers p where p.company_id = qa and p.id = x.supplier_id), ''),
      not x.open_review, x.open_review, not x.open_review, not x.open_review, cur, '{"qa_seed": true}'
    from (
      select g, pg_temp.qa_id(qa, 'transactions', g) as id, y.direction, y.open_review,
        case when y.direction = 'income' then null
             when y.rr < 0.55 then 'project' when y.rr < 0.80 then 'shared' else 'overhead' end as role,
        case when y.direction = 'income'
             then (100000 + floor(pg_temp.qa_r('ta' || g) * 5900000))::bigint
             else -round(2000 * power(1000, pg_temp.qa_r('ta' || g)))::bigint end as amount,
        span_start + floor(pg_temp.qa_r('td' || g) * (span_days + 1))::integer as doc_date,
        case when (y.direction = 'expense' and y.rr < 0.55) or (y.direction = 'income' and y.rr < 0.7)
             then project_ids[1 + floor(pg_temp.qa_r('tj' || g) * array_length(project_ids, 1))::integer] end as project_id,
        case when y.direction = 'income'
             then customer_ids[1 + floor(pg_temp.qa_r('tc' || g) * array_length(customer_ids, 1))::integer] end as customer_id,
        case when y.direction = 'expense'
             then supplier_ids[1 + floor(pg_temp.qa_r('ts' || g) * array_length(supplier_ids, 1))::integer] end as supplier_id,
        case when y.direction = 'income'
             then income_cats[1 + floor(pg_temp.qa_r('tk' || g) * array_length(income_cats, 1))::integer]
             else expense_cats[1 + floor(pg_temp.qa_r('tk' || g) * array_length(expense_cats, 1))::integer] end as category_id
      from pg_temp.qa_free(qa, 'transactions', k) g
      cross join lateral (
        select case when pg_temp.qa_r('tdir' || g) < 0.2 then 'income' else 'expense' end as direction,
          pg_temp.qa_r('trole' || g) as rr,
          pg_temp.qa_r('trq' || g) < 0.45 as open_review
      ) y
    ) x
    on conflict do nothing;

    -- One allocation per project line, overhead rows, and enough shares on shared lines to reach
    -- the allocation target.
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    select qa, t.id, t.project_id, 10000, t.amount_net
    from public.transactions t
    where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%' and t.pnl_role = 'project'
      and not exists (select 1 from public.allocations a where a.company_id = qa and a.transaction_id = t.id);
    insert into public.overhead (company_id, transaction_id)
    select qa, t.id
    from public.transactions t
    where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%' and t.pnl_role = 'overhead'
      and not exists (select 1 from public.overhead o where o.company_id = qa and o.transaction_id = t.id);

    select count(*) into shared_n from public.transactions t
    where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%' and t.pnl_role = 'shared'
      and not exists (select 1 from public.allocations a where a.company_id = qa and a.transaction_id = t.id);
    select target - (select count(*) from public.allocations where company_id = qa) into alloc_needed
    from pg_temp.qa_seed_report where tbl = 'allocations';
    per_shared := least(greatest(ceil(greatest(alloc_needed, 0)::numeric / greatest(shared_n, 1))::integer, 2),
                        6, array_length(project_ids, 1));
    if shared_n > 0 and per_shared >= 2 then
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      select qa, t.id,
        project_ids[1 + ((t.base + j) % array_length(project_ids, 1))],
        (10000 / per_shared) + case when j = 0 then 10000 % per_shared else 0 end,
        (t.amount_net / per_shared) + case when j = 0 then t.amount_net % per_shared else 0 end
      from (
        select t.id, t.amount_net,
          floor(pg_temp.qa_r('sb' || t.id) * array_length(project_ids, 1))::integer as base
        from public.transactions t
        where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%' and t.pnl_role = 'shared'
          and not exists (select 1 from public.allocations a where a.company_id = qa and a.transaction_id = t.id)
      ) t
      cross join generate_series(0, per_shared - 1) j;
    end if;
  end if;

  -- Line splits through save_line_split: an overhead expense split across two categories.
  select target - (select count(*) from public.line_splits where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'line_splits';
  if k > 0 and array_length(expense_cats, 1) >= 2 then
    for r in
      select t.id, t.amount_net, t.category_id
      from public.transactions t
      where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%' and t.pnl_role = 'overhead'
        and t.user_assigned
        and not exists (select 1 from public.line_splits l where l.company_id = qa and l.transaction_id = t.id)
        and not exists (select 1 from public.review_queue q where q.company_id = qa and q.transaction_id = t.id)
      order by t.idempotency_key
      limit ceil(k / 2.0)::integer
    loop
      perform public.save_line_split(r.id, jsonb_build_array(
        jsonb_build_object('category_id', r.category_id, 'amount_minor', round(abs(r.amount_net) * 0.6)::bigint),
        jsonb_build_object(
          'category_id', (select c from unnest(expense_cats) c where c <> r.category_id order by md5(c::text || r.id::text) limit 1),
          'rest', true)
      ), false);
    end loop;
  end if;

  -- Legs come from the lines through the ledger triggers. When they are still short, split more
  -- overhead lines three ways (each adds two legs).
  select target - (select count(*) from public.legs where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'legs';
  if k > 0 and array_length(expense_cats, 1) >= 3 then
    for r in
      select t.id, t.amount_net, t.category_id
      from public.transactions t
      where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%' and t.pnl_role = 'overhead'
        and t.user_assigned and abs(t.amount_net) >= 300
        and not exists (select 1 from public.line_splits l where l.company_id = qa and l.transaction_id = t.id)
        and not exists (select 1 from public.review_queue q where q.company_id = qa and q.transaction_id = t.id and q.status = 'open')
      order by t.idempotency_key desc
      limit ceil(k / 2.0)::integer
    loop
      perform public.save_line_split(r.id, (
        select jsonb_build_array(
          jsonb_build_object('category_id', r.category_id, 'amount_minor', round(abs(r.amount_net) * 0.5)::bigint),
          jsonb_build_object('category_id', o.cats[1], 'amount_minor', round(abs(r.amount_net) * 0.3)::bigint),
          jsonb_build_object('category_id', o.cats[2], 'rest', true))
        from (
          select array_agg(c order by md5(c::text || r.id::text)) as cats
          from unnest(expense_cats) c where c <> r.category_id
        ) o
      ), false);
    end loop;
  end if;

  -- Review rows for seeded lines without one: open for the lines left unassigned, the rest
  -- approved or skipped.
  select target - (select count(*) from public.review_queue where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'review_queue';
  if k > 0 then
    insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at)
    select qa, t.id, x.status::public.review_status,
      case when t.pnl_role = 'project' or t.project_id is not null then 'missing_category' else 'missing_project' end,
      case when x.status <> 'open' then t.doc_date + 2 end
    from public.transactions t
    cross join lateral (
      select case when not t.user_assigned then 'open'
                  when pg_temp.qa_r('rs' || t.id) < 0.75 then 'approved' else 'skipped' end as status
    ) x
    where t.company_id = qa and t.idempotency_key like 'qa-seed:%'
      and not exists (select 1 from public.review_queue q where q.company_id = qa and q.transaction_id = t.id)
    order by t.idempotency_key
    limit k;
  end if;

  -- Open seeded review rows carry a suggestion from Flow QA's newest Jev model, so Jev does not
  -- spend a call on them. Not counted against a target: the unique (transaction_id,
  -- model_version) key makes a re-run add only the missing ones.
  select ts.model_version into model from public.tag_suggestions ts
  where ts.company_id = qa order by ts.created_at desc limit 1;
  if model is not null then
    insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
    select qa, t.id,
      jsonb_build_object(
        'project', jsonb_build_object('type', 'choice', 'choice', coalesce(t.project_id::text, 'none'),
          'confidence', 0.8, 'probabilities', jsonb_build_object(coalesce(t.project_id::text, 'none'), 0.8)),
        'category', jsonb_build_object('type', 'choice', 'choice', t.category_id::text,
          'confidence', 0.85, 'probabilities', jsonb_build_object(t.category_id::text, 0.85))),
      0.8, model, model
    from public.transactions t
    join public.review_queue q on q.company_id = qa and q.transaction_id = t.id and q.status = 'open'
    where t.company_id = qa and t.idempotency_key like 'qa-seed:%' and t.category_id is not null
    on conflict do nothing;
  end if;

  -- Notes, files, Jev prefills on seeded lines.
  select target - (select count(*) from public.transaction_notes where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'transaction_notes';
  if k > 0 then
    insert into public.transaction_notes (company_id, transaction_id, source, author_id, body)
    select qa, t.id, 'flow', qa_owner, pg_temp.qa_pick(note_bodies, 'nb' || t.id)
    from public.transactions t
    where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%'
      and not exists (select 1 from public.transaction_notes n where n.company_id = qa and n.transaction_id = t.id and n.removed_at is null)
    order by t.idempotency_key
    limit k;
  end if;

  select target - (select count(*) from public.transaction_files where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'transaction_files';
  if k > 0 then
    insert into public.transaction_files (company_id, transaction_id, source, storage_path, file_name, mime, bytes, uploaded_by)
    select qa, t.id, 'flow', qa || '/' || t.id || '/qa-seed.pdf', 'QA קבלה.pdf', 'application/pdf',
      (40000 + floor(pg_temp.qa_r('fb' || t.id) * 400000))::bigint, qa_owner
    from public.transactions t
    where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%'
      and not exists (select 1 from public.transaction_files f where f.company_id = qa and f.transaction_id = t.id)
    order by t.idempotency_key desc
    limit k
    on conflict do nothing;
  end if;

  select target - (select count(*) from public.jev_prefills where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'jev_prefills';
  if k > 0 then
    insert into public.jev_prefills (id, company_id, transaction_id, model_version, confidence, project_id, category_id)
    select pg_temp.qa_id(qa, 'jev_prefills:' || t.id, 1), qa, t.id, coalesce(model, 'qa-seed'), 0.9, t.project_id, t.category_id
    from (
      select t.id, t.project_id, t.category_id
      from public.transactions t
      where t.company_id = qa and t.idempotency_key like 'qa-seed:txn:%' and t.category_id is not null
        and t.user_assigned
        and not exists (select 1 from public.jev_prefills p where p.company_id = qa and p.transaction_id = t.id)
      limit k
    ) t
    on conflict do nothing;
  end if;

  -- Forecast edits: planned income and costs per project.
  select target - (select count(*) from public.project_forecast_edits where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'project_forecast_edits';
  if k > 0 then
    insert into public.project_forecast_edits (id, company_id, project_id, kind, category_id, direction, amount_minor, pace, start_month, created_by)
    select pg_temp.qa_id(qa, 'project_forecast_edits', g), qa,
      project_ids[1 + (g % array_length(project_ids, 1))], 'add',
      case when g % 3 = 0 then income_cats[1 + (g % array_length(income_cats, 1))]
           else expense_cats[1 + (g % array_length(expense_cats, 1))] end,
      case when g % 3 = 0 then 'income' else 'expense' end,
      (50000 + floor(pg_temp.qa_r('fa' || g) * 2000000))::bigint,
      pg_temp.qa_pick(array['once', 'month', '2months', 'quarter', 'year'], 'fp' || g),
      to_char(span_end + make_interval(months => g % 9), 'YYYY-MM'),
      qa_owner
    from pg_temp.qa_free(qa, 'project_forecast_edits', k) g
    on conflict do nothing;
  end if;

  -- Recurring: monthly charges, dismissed alerts and same-party matches, on seeded suppliers.
  select target - (select count(*) from public.recurring_overrides where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'recurring_overrides';
  if k > 0 then
    insert into public.recurring_overrides (company_id, direction, party_id, currency, recurring, pace, typical_amount_minor, set_by)
    select qa, 'expense', sp.id, cur, true,
      pg_temp.qa_pick(array['month', 'month', 'quarter', 'year'], 'rp' || sp.id),
      (5000 + floor(pg_temp.qa_r('ra' || sp.id) * 300000))::bigint, qa_owner
    from public.suppliers sp
    where sp.company_id = qa and sp.name like 'QA %'
      and not exists (select 1 from public.recurring_overrides o where o.company_id = qa and o.party_id = sp.id)
    order by sp.name
    limit k
    on conflict do nothing;
  end if;

  select target - (select count(*) from public.recurring_dismissals where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'recurring_dismissals';
  if k > 0 then
    insert into public.recurring_dismissals (user_id, company_id, kind, alert_key)
    select qa_owner, qa, 'missing', 'expense:' || sp.id || ':' || cur || ':' || to_char(span_end, 'YYYY-MM')
    from public.suppliers sp
    where sp.company_id = qa and sp.name like 'QA %'
      and not exists (
        select 1 from public.recurring_dismissals d
        where d.company_id = qa and d.alert_key = 'expense:' || sp.id || ':' || cur || ':' || to_char(span_end, 'YYYY-MM'))
    order by sp.name desc
    limit k
    on conflict do nothing;
  end if;

  select target - (select count(*) from public.recurring_matches where company_id = qa) into k from pg_temp.qa_seed_report where tbl = 'recurring_matches';
  if k > 0 then
    insert into public.recurring_matches (company_id, direction, party_id, match_party_id, same, set_by)
    select qa, 'expense', p.a, p.b, true, qa_owner
    from (
      select sp.id as a, lead(sp.id) over (order by sp.id) as b, row_number() over (order by sp.id) as rn
      from public.suppliers sp
      where sp.company_id = qa and sp.name like 'QA %'
    ) p
    where p.b is not null and p.rn % 2 = 1
      and not exists (select 1 from public.recurring_matches m where m.company_id = qa and (m.party_id = p.a or m.match_party_id = p.b))
    limit k
    on conflict do nothing;
  end if;

  -- The counts after.
  foreach tname in array tables loop
    execute format('select count(*) from public.%I where company_id = $1', tname) into n_now using qa;
    update pg_temp.qa_seed_report set after = n_now where qa_seed_report.tbl = tname;
  end loop;
end;
$seed$;

select tbl, reference, target, before, after, after >= target as ok
from pg_temp.qa_seed_report
order by tbl;
