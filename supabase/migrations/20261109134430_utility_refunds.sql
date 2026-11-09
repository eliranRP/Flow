-- FLOW-1134 (decision 0265): utility bills the tenant never paid back.
--
-- A utility is one supplier's bills for one property and currency (the key of a recurring charge,
-- decision 0185). Flow finds it from the lines: an expense filed to a property in a category named
-- חשבונות or under it (the starter categories' tree); the owner can add one by hand. Each is
-- tenant-paid (the tenant pays it back) unless the owner says the company pays.
--
-- 1. public.utility_payers: who pays a utility (tenant or company) and whether the owner added it.
--    public.utility_refund_answers: the owner's answers for a bill: matched (with the payment line),
--    rejected (a payment that is not the refund; never suggested again for that bill) or seen
--    (nothing to do). RLS on, no client grant; only the functions below read and write them.
-- 2. The match is worked out on read (private.utility_refund_rows), like the transfer suggestions
--    (decision 0205): for each bill of a tenant-paid utility, from the first one in the books, a
--    money-in line dated from one month before the bill to the as-of date, filed to the property or
--    to no property, not the refund of another bill, whose amount is within one unit of the
--    currency (100 minor units) of (1) the bill, (2) several of the property's bills of that month
--    together, or (3) the property's usual rent plus one or more of them. Rule 1 or 2 with the
--    payment filed to the category every bill shares counts as refunded by itself; any other match is a
--    suggestion. A bill with no match 30 days after its date is not refunded (לא הוחזר); a month
--    with no rent line on the property is flagged.
-- 3. Reads (any member): list_utility_refunds, count_utility_refunds, list_utility_payers. Writes
--    (owner or editor, decision 0167): set_utility_payer, answer_utility_refund,
--    mark_utility_refunds_seen and unmark_utility_refunds_seen, refile_utility_refund and
--    undo_utility_refile (the one-tap fix: the payment moves to the bill's category, or the bill's
--    part is split off a rent payment through save_line_split).
-- 4. MCP (decision 0095): mcp_set_utility_payer, mcp_answer_utility_refund,
--    mcp_mark_utility_refunds_seen and mcp_refile_utility_refund, with the idempotency key, the write
--    gate and the undo kinds utility_payer, utility_refund, utility_refunds_seen and utility_refile
--    (id: the write). mcp_writes and mcp_undo are patched from their current definitions with counted
--    anchors.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- 1. The tables.
create table public.utility_payers (
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid not null,
  supplier_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payer text not null default 'tenant' check (payer in ('tenant', 'company')),
  -- A supplier the owner added to the property by hand (its bills count although none is filed
  -- under חשבונות).
  added boolean not null default false,
  set_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, project_id, supplier_id, currency),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id) on delete cascade
);
create index utility_payers_supplier_idx on public.utility_payers (company_id, supplier_id);
create index utility_payers_set_by_idx on public.utility_payers (set_by);
comment on table public.utility_payers is
  'FLOW-1134: who pays a property''s utility (one supplier and currency): the tenant pays it back (tenant, the default) or the company pays (company: its bills are never checked); added marks one the owner added by hand. Decision 0265.';

alter table public.utility_payers enable row level security;
revoke all on public.utility_payers from public, anon, authenticated;
grant select, insert, update, delete on public.utility_payers to service_role;

create table public.utility_refund_answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  bill_transaction_id uuid not null,
  state text not null check (state in ('matched', 'rejected', 'seen')),
  payment_transaction_id uuid,
  -- A matched pair the one-tap fix refiled: what it changed, so undo_utility_refile puts it back.
  refile jsonb,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default clock_timestamp(),
  constraint utility_refund_answers_payment check ((state = 'seen') = (payment_transaction_id is null)),
  constraint utility_refund_answers_two_lines check (payment_transaction_id is distinct from bill_transaction_id),
  constraint utility_refund_answers_refile check (
    refile is null or (state = 'matched' and jsonb_typeof(refile) = 'object')
  ),
  foreign key (company_id, bill_transaction_id) references public.transactions (company_id, id) on delete cascade,
  foreign key (company_id, payment_transaction_id) references public.transactions (company_id, id) on delete cascade
);
-- One closing answer (matched or seen) per bill; one rejection per pair.
create unique index utility_refund_answers_closed_idx
  on public.utility_refund_answers (company_id, bill_transaction_id) where state in ('matched', 'seen');
create unique index utility_refund_answers_rejected_idx
  on public.utility_refund_answers (company_id, bill_transaction_id, payment_transaction_id) where state = 'rejected';
create index utility_refund_answers_bill_idx on public.utility_refund_answers (company_id, bill_transaction_id);
create index utility_refund_answers_payment_idx on public.utility_refund_answers (company_id, payment_transaction_id);
create index utility_refund_answers_set_by_idx on public.utility_refund_answers (set_by);
comment on table public.utility_refund_answers is
  'FLOW-1134: the owner''s answers for a utility bill: matched (the payment line is its refund), rejected (that payment is not; never suggested again for the bill) or seen (closed, nothing to do). refile keeps what the one-tap fix changed. Decision 0265.';

alter table public.utility_refund_answers enable row level security;
revoke all on public.utility_refund_answers from public, anon, authenticated;
grant select, insert, update, delete on public.utility_refund_answers to service_role;

-- 2. The match.
-- A category named p_root of kind p_kind and every category under it (the parent tree).
create function private.utility_category_ids(p_company uuid, p_root text, p_kind public.category_kind)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  with recursive tree (id, depth) as (
    select c.id, 0 from public.categories c
    where c.company_id = p_company and c.kind = p_kind and c.name = p_root
    union
    select c.id, t.depth + 1 from public.categories c
    join tree t on c.parent_id = t.id
    where c.company_id = p_company and t.depth < 10
  )
  select coalesce(array_agg(distinct tree.id), '{}') from tree;
$$;

-- The company's utilities: a (property, supplier, currency) with an expense line filed under
-- חשבונות (found), or one the owner added; payer is the owner's pick, tenant by default.
create function private.utility_keys(p_company uuid)
returns table (project_id uuid, supplier_id uuid, currency text, payer text, added boolean, found boolean)
language sql
stable
set search_path = ''
as $$
  with found as (
    select distinct t.project_id, t.supplier_id, t.currency
    from public.transactions t
    where t.company_id = p_company
      and t.direction = 'expense'
      and t.project_id is not null
      and t.supplier_id is not null
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.category_id = any (private.utility_category_ids(p_company, 'חשבונות', 'expense'))
  ),
  payers as (
    select u.* from public.utility_payers u where u.company_id = p_company
  )
  select coalesce(f.project_id, u.project_id), coalesce(f.supplier_id, u.supplier_id), coalesce(f.currency, u.currency),
    coalesce(u.payer, 'tenant'), coalesce(u.added, false), f.project_id is not null
  from found f
  full join payers u on u.project_id = f.project_id and u.supplier_id = f.supplier_id and u.currency = f.currency
  where f.project_id is not null or u.added;
$$;

create type private.utility_bill as (
  id uuid, project_id uuid, supplier_id uuid, currency text, category_id uuid, doc_date date, amount bigint
);

-- The bills of the company's tenant-paid utilities (p_all: of every utility, company-paid too): posted
-- expense lines that are not credit notes, of more than one unit of the currency.
create function private.utility_bills(p_company uuid, p_all boolean default false)
returns setof private.utility_bill
language sql
stable
set search_path = ''
as $$
  select t.id, t.project_id, t.supplier_id, t.currency, t.category_id, t.doc_date, t.amount_original
  from public.transactions t
  join private.utility_keys(p_company) k
    on k.project_id = t.project_id and k.supplier_id = t.supplier_id and k.currency = t.currency
  where t.company_id = p_company
    and (p_all or k.payer = 'tenant')
    and t.direction = 'expense'
    and t.doc_kind <> 'credit'
    and t.removed_at is null
    and t.line_status = 'posted'
    and t.amount_original > 100;
$$;

-- The property's usual rent: the median of its last 3 money-in lines in the rent categories
-- (שכירות and under it), in the currency, dated before p_before. Null when it has none.
create function private.utility_usual_rent(
  p_company uuid, p_project uuid, p_currency text, p_before date, p_rent uuid[]
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select round(percentile_cont(0.5) within group (order by r.amount_original))::bigint
  from (
    select t.amount_original
    from public.transactions t
    where t.company_id = p_company
      and t.project_id = p_project
      and t.currency = p_currency
      and t.direction = 'income'
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.category_id = any (p_rent)
      and t.doc_date < p_before
    order by t.doc_date desc, t.id desc
    limit 3
  ) r
  having count(*) > 0;
$$;

-- A month with no rent: the property has no money-in line in the rent categories dated in it.
create function private.utility_no_rent(p_company uuid, p_project uuid, p_day date, p_rent uuid[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.transactions t
    where t.company_id = p_company
      and t.project_id = p_project
      and t.direction = 'income'
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.category_id = any (p_rent)
      and t.doc_date >= date_trunc('month', p_day)::date
      and t.doc_date < (date_trunc('month', p_day) + interval '1 month')::date
  );
$$;

-- Every bill of a tenant-paid utility with its state as of p_today:
--   refunded: matched by the owner (source owner) or counted by itself (source auto: rule 1 or 2 and
--     the payment filed to the category every bill of the group shares);
--   suggested: any other match (rule 1, 2 or 3), for the owner to answer;
--   seen: closed by the owner; not_refunded: no match 30 days or more after the bill; waiting: younger.
-- Bills are matched oldest first; a payment is the refund of one bill, or of one group of the same
-- month's bills (rules 2 and 3: group_ids). A pair the owner rejected is never matched. The peers a
-- group is drawn from are the bill and up to 9 more of the property's open bills of that month, in
-- that currency. p_project only filters what is returned: the match always runs on the whole company.
create function private.utility_refund_rows(p_company uuid, p_today date, p_project uuid default null)
returns table (
  bill_id uuid, project_id uuid, supplier_id uuid, currency text, category_id uuid, doc_date date,
  amount bigint, state text, source text, rule smallint, payment_id uuid, group_ids uuid[], no_rent boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  bills private.utility_bill[];
  rent uuid[] := private.utility_category_ids(p_company, 'שכירות', 'income');
  done uuid[] := '{}';
  used uuid[] := '{}';
  b private.utility_bill;
  g private.utility_bill;
  a record;
  best record;
  usual bigint;
  peers private.utility_bill[];
begin
  select coalesce(array_agg(x order by x.doc_date, x.id), '{}') into bills
  from private.utility_bills(p_company) x;

  -- The owner's closing answers first.
  for a in
    select x.bill_transaction_id, x.state as answer, x.payment_transaction_id
    from public.utility_refund_answers x
    where x.company_id = p_company and x.state in ('matched', 'seen')
      and x.bill_transaction_id in (select u.id from unnest(bills) u)
  loop
    done := done || a.bill_transaction_id;
    if a.payment_transaction_id is not null then
      used := used || a.payment_transaction_id;
    end if;
  end loop;
  for b in select u.* from unnest(bills) u where u.id = any (done) loop
    continue when p_project is not null and b.project_id <> p_project;
    select x.state, x.payment_transaction_id into a
    from public.utility_refund_answers x
    where x.company_id = p_company and x.bill_transaction_id = b.id and x.state in ('matched', 'seen');
    bill_id := b.id; project_id := b.project_id; supplier_id := b.supplier_id; currency := b.currency;
    category_id := b.category_id; doc_date := b.doc_date; amount := b.amount;
    state := case when a.state = 'matched' then 'refunded' else 'seen' end;
    source := 'owner'; rule := null; payment_id := a.payment_transaction_id; group_ids := array[b.id];
    no_rent := private.utility_no_rent(p_company, b.project_id, b.doc_date, rent);
    return next;
  end loop;

  -- Then the match, oldest bill first.
  foreach b in array bills loop
    continue when b.id = any (done);
    usual := private.utility_usual_rent(p_company, b.project_id, b.currency, b.doc_date, rent);
    peers := array[b] || coalesce((
      select array_agg(q.u order by (q.u).doc_date, (q.u).id)
      from (
        select u from unnest(bills) u
        where u.id <> b.id and not (u.id = any (done))
          and u.project_id = b.project_id and u.currency = b.currency
          and date_trunc('month', u.doc_date) = date_trunc('month', b.doc_date)
        order by u.doc_date, u.id
        limit 9
      ) q
    ), '{}');

    select m.* into best
    from (
      with mb as (
        select u.id, u.amount, u.category_id, u.ord
        from unnest(peers) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
      ),
      subs as (
        select array_agg(mb.id order by mb.ord) as ids, sum(mb.amount)::bigint as total,
          array_agg(mb.category_id) as cats, count(*)::integer as size
        from generate_series(1, (1 << cardinality(peers)) - 1) s(mask)
        join mb on ((s.mask >> (mb.ord::integer - 1)) & 1) = 1
        group by s.mask
        having bool_or(mb.ord = 1)
      )
      select p.id as pay_id, s.ids, r.rule,
        r.rule < 3 and p.category_id is not null and coalesce(p.category_id = all (s.cats), false) as auto,
        abs(p.doc_date - b.doc_date) as days_apart, s.size,
        abs(p.amount_original - s.total - case when r.rule = 3 then usual else 0 end) as off_by
      from subs s
      cross join public.transactions p
      cross join lateral (
        select case
          when s.size = 1 and abs(p.amount_original - s.total) <= 100 then 1
          when s.size > 1 and abs(p.amount_original - s.total) <= 100 then 2
          when usual is not null and abs(p.amount_original - usual - s.total) <= 100 then 3
        end::smallint as rule
      ) r
      where p.company_id = p_company
        and p.removed_at is null
        and p.line_status = 'posted'
        and p.amount_original > 0
        and (p.direction = 'income' or p.doc_kind = 'credit')
        and p.currency = b.currency
        and (p.project_id = b.project_id or p.project_id is null)
        and p.doc_date >= (b.doc_date - interval '1 month')::date
        and p.doc_date <= p_today
        and not (p.id = any (used))
        and r.rule is not null
        and not exists (
          select 1 from public.utility_refund_answers x
          where x.company_id = p_company and x.state = 'rejected'
            and x.payment_transaction_id = p.id and x.bill_transaction_id = any (s.ids)
        )
    ) m
    order by m.auto desc, m.rule, m.days_apart, m.size, m.off_by, m.pay_id
    limit 1;

    if best.pay_id is not null then
      used := used || best.pay_id;
      done := done || best.ids;
      for g in select u.* from unnest(peers) u where u.id = any (best.ids) loop
        continue when p_project is not null and g.project_id <> p_project;
        bill_id := g.id; project_id := g.project_id; supplier_id := g.supplier_id; currency := g.currency;
        category_id := g.category_id; doc_date := g.doc_date; amount := g.amount;
        state := case when best.auto then 'refunded' else 'suggested' end;
        source := case when best.auto then 'auto' end;
        rule := best.rule; payment_id := best.pay_id; group_ids := best.ids;
        no_rent := private.utility_no_rent(p_company, g.project_id, g.doc_date, rent);
        return next;
      end loop;
    else
      done := done || b.id;
      continue when p_project is not null and b.project_id <> p_project;
      bill_id := b.id; project_id := b.project_id; supplier_id := b.supplier_id; currency := b.currency;
      category_id := b.category_id; doc_date := b.doc_date; amount := b.amount;
      state := case when p_today - b.doc_date >= 30 then 'not_refunded' else 'waiting' end;
      source := null; rule := null; payment_id := null; group_ids := array[b.id];
      no_rent := private.utility_no_rent(p_company, b.project_id, b.doc_date, rent);
      return next;
    end if;
  end loop;
end;
$$;

-- The payment line as the list gives it.
create function private.utility_payment_json(p_company uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'transaction_id', t.id,
    'doc_date', t.doc_date,
    'amount_minor', t.amount_original,
    'currency', t.currency,
    'description', t.description,
    'party', coalesce(cu.name, s.name),
    'project_id', t.project_id,
    'category_id', t.category_id,
    'category_name', c.name,
    'split', exists (select 1 from private.split_parts x where x.transaction_id = t.id)
  )
  from public.transactions t
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  left join public.suppliers s on s.id = t.supplier_id and s.company_id = t.company_id
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.id = p_id and t.company_id = p_company;
$$;

-- A matched payment filed elsewhere: neither its category nor one of its split parts is the bill's.
create function private.utility_wrong_category(p_company uuid, p_payment uuid, p_category uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_category is not null
    and not exists (
      select 1 from public.transactions t
      where t.id = p_payment and t.company_id = p_company and t.category_id = p_category
        and not exists (select 1 from private.split_parts x where x.transaction_id = t.id)
    )
    and not exists (
      select 1 from private.split_parts x
      where x.company_id = p_company and x.transaction_id = p_payment and x.category_id = p_category and not x.draft
    );
$$;

-- A bill's answers, in a fixed order (what undo compares and puts back).
create function private.utility_answer_rows(p_company uuid, p_bill uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'state', x.state, 'payment_transaction_id', x.payment_transaction_id, 'refile', x.refile
    ) order by x.state, x.payment_transaction_id), '[]'::jsonb)
  from public.utility_refund_answers x
  where x.company_id = p_company and x.bill_transaction_id = p_bill;
$$;

create function private.utility_answer_put(p_company uuid, p_bill uuid, p_rows jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.utility_refund_answers x where x.company_id = p_company and x.bill_transaction_id = p_bill;
  insert into public.utility_refund_answers (company_id, bill_transaction_id, state, payment_transaction_id, refile, set_by)
  select p_company, p_bill, e->>'state', (e->>'payment_transaction_id')::uuid,
    case when jsonb_typeof(e->'refile') = 'object' then e->'refile' end, auth.uid()
  from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) e;
end;
$$;

revoke all on function private.utility_category_ids(uuid, text, public.category_kind) from public, anon, authenticated;
revoke all on function private.utility_keys(uuid) from public, anon, authenticated;
revoke all on function private.utility_bills(uuid, boolean) from public, anon, authenticated;
revoke all on function private.utility_usual_rent(uuid, uuid, text, date, uuid[]) from public, anon, authenticated;
revoke all on function private.utility_no_rent(uuid, uuid, date, uuid[]) from public, anon, authenticated;
revoke all on function private.utility_refund_rows(uuid, date, uuid) from public, anon, authenticated;
revoke all on function private.utility_payment_json(uuid, uuid) from public, anon, authenticated;
revoke all on function private.utility_wrong_category(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.utility_answer_rows(uuid, uuid) from public, anon, authenticated;
revoke all on function private.utility_answer_put(uuid, uuid, jsonb) from public, anon, authenticated;

-- The caller's company for a write (owner or editor), or the refusal.
create function private.utility_writer_company()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
begin
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  return cid;
end;
$$;
revoke all on function private.utility_writer_company() from public, anon, authenticated;

-- 3. The reads (any member).
create function public.list_utility_refunds(
  p_project_id uuid default null, p_today date default null, p_all boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid := private.readable_company_id();
  today date := coalesce(p_today, private.flow_today());
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  return jsonb_build_object('as_of', today, 'bills', coalesce((
    select jsonb_agg(jsonb_build_object(
        'bill_transaction_id', r.bill_id,
        'project_id', r.project_id,
        'project_name', p.name,
        'supplier_id', r.supplier_id,
        'supplier_name', s.name,
        'currency', r.currency,
        'category_id', r.category_id,
        'category_name', c.name,
        'amount_minor', r.amount,
        'doc_date', r.doc_date,
        'days', today - r.doc_date,
        'state', r.state,
        'source', r.source,
        'rule', case r.rule when 1 then 'bill' when 2 then 'bills' when 3 then 'rent_and_bills' end,
        'group_bill_transaction_ids', to_jsonb(r.group_ids),
        'no_rent', r.no_rent,
        'payment', case when r.payment_id is not null then private.utility_payment_json(cid, r.payment_id) end,
        'wrong_category', r.payment_id is not null and private.utility_wrong_category(cid, r.payment_id, r.category_id),
        'refiled', exists (
          select 1 from public.utility_refund_answers x
          where x.company_id = cid and x.bill_transaction_id = r.bill_id and x.refile is not null
        )
      ) order by case r.state when 'suggested' then 0 when 'not_refunded' then 1 when 'refunded' then 2 else 3 end,
        p.name, r.doc_date, r.bill_id)
    from private.utility_refund_rows(cid, today, p_project_id) r
    join public.projects p on p.id = r.project_id and p.company_id = cid
    left join public.suppliers s on s.id = r.supplier_id and s.company_id = cid
    left join public.categories c on c.id = r.category_id and c.company_id = cid
    -- The app's list: what asks for an answer (a suggestion, a bill not refunded) and a refund the
    -- owner matched that sits in another category (the one-tap fix). p_all (the MCP): every bill.
    where coalesce(p_all, false)
      or r.state in ('suggested', 'not_refunded')
      or (r.state = 'refunded' and r.source = 'owner'
        and private.utility_wrong_category(cid, r.payment_id, r.category_id))
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.list_utility_refunds(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.list_utility_refunds(uuid, date, boolean) to authenticated;
comment on function public.list_utility_refunds(uuid, date, boolean) is
  'FLOW-1134 (decision 0265): utility bills the tenant has not paid back, and the suggested refunds, as of p_today (default Israel''s today). p_project_id limits it to a property; p_all lists every bill with its state.';

create function public.count_utility_refunds(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid := private.readable_company_id();
  today date := coalesce(p_today, private.flow_today());
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    with r as materialized (select * from private.utility_refund_rows(cid, today))
    select jsonb_build_object(
      'as_of', today,
      'not_refunded_count', (select count(*) from r where r.state = 'not_refunded'),
      'not_refunded_by_currency', coalesce((
        select jsonb_agg(jsonb_build_object('currency', x.currency, 'amount_minor', x.total) order by x.currency)
        from (select r.currency, sum(r.amount)::bigint as total from r where r.state = 'not_refunded' group by r.currency) x
      ), '[]'::jsonb),
      'suggested_count', (select count(*) from r where r.state = 'suggested')
    )
  );
end;
$$;
revoke all on function public.count_utility_refunds(date) from public, anon, authenticated;
grant execute on function public.count_utility_refunds(date) to authenticated;
comment on function public.count_utility_refunds(date) is
  'FLOW-1134 (decision 0265): for Home''s row, the bills not refunded (count and sum per currency) and the suggestions, as of p_today.';

create function public.list_utility_payers(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid := private.readable_company_id();
begin
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  return jsonb_build_object('project_id', p_project_id, 'utilities', coalesce((
    select jsonb_agg(jsonb_build_object(
        'supplier_id', k.supplier_id,
        'supplier_name', s.name,
        'currency', k.currency,
        'payer', k.payer,
        'added', k.added,
        'found', k.found,
        'usual_minor', u.usual,
        'bill_count', u.bills,
        'last_bill_date', u.last_date
      ) order by s.name, k.currency, k.supplier_id)
    from private.utility_keys(cid) k
    join public.suppliers s on s.id = k.supplier_id and s.company_id = cid
    -- The usual amount: the median of the utility's last 3 bills.
    cross join lateral (
      select (select round(percentile_cont(0.5) within group (order by l.amount))::bigint
              from (select b.amount from private.utility_bills(cid, true) b
                    where b.project_id = k.project_id and b.supplier_id = k.supplier_id and b.currency = k.currency
                    order by b.doc_date desc, b.id desc limit 3) l
              having count(*) > 0) as usual,
        (select count(*) from private.utility_bills(cid, true) b
         where b.project_id = k.project_id and b.supplier_id = k.supplier_id and b.currency = k.currency) as bills,
        (select max(b.doc_date) from private.utility_bills(cid, true) b
         where b.project_id = k.project_id and b.supplier_id = k.supplier_id and b.currency = k.currency) as last_date
    ) u
    where k.project_id = p_project_id
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.list_utility_payers(uuid) from public, anon, authenticated;
grant execute on function public.list_utility_payers(uuid) to authenticated;
comment on function public.list_utility_payers(uuid) is
  'FLOW-1134 (decision 0265): a property''s utilities (found from its חשבונות lines, or added by the owner) with who pays, the usual amount (the median of the last 3 bills), the bill count and the last bill''s date.';

-- 4. The writes (owner or editor).
create function public.set_utility_payer(
  p_project_id uuid, p_supplier_id uuid, p_currency text, p_payer text, p_added boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.utility_writer_company();
  cur public.utility_payers%rowtype;
  prior jsonb;
begin
  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  if p_supplier_id is null or not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id and s.company_id = cid
  ) then
    raise exception 'supplier not found';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or (p_payer is not null and p_payer not in ('tenant', 'company')) then
    raise exception 'validation';
  end if;

  select * into cur from public.utility_payers u
  where u.company_id = cid and u.project_id = p_project_id and u.supplier_id = p_supplier_id and u.currency = p_currency
  for update;
  prior := case when found then jsonb_build_object('payer', cur.payer, 'added', cur.added) end;

  if p_payer is null then
    delete from public.utility_payers u
    where u.company_id = cid and u.project_id = p_project_id and u.supplier_id = p_supplier_id and u.currency = p_currency;
  else
    insert into public.utility_payers (company_id, project_id, supplier_id, currency, payer, added, set_by)
    values (cid, p_project_id, p_supplier_id, p_currency, p_payer, coalesce(p_added, false), auth.uid())
    on conflict (company_id, project_id, supplier_id, currency) do update
    set payer = excluded.payer, added = excluded.added, set_by = excluded.set_by, updated_at = now();
  end if;

  return jsonb_build_object(
    'project_id', p_project_id,
    'supplier_id', p_supplier_id,
    'currency', p_currency,
    'payer', p_payer,
    'added', case when p_payer is null then null else coalesce(p_added, false) end,
    'prior', prior
  );
end;
$$;
revoke all on function public.set_utility_payer(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_utility_payer(uuid, uuid, text, text, boolean) to authenticated;
comment on function public.set_utility_payer(uuid, uuid, text, text, boolean) is
  'FLOW-1134 (decision 0265): who pays a property''s utility: tenant (pays it back) or company (its bills are not checked); p_added marks a supplier added by hand; a null payer removes the row. Returns prior for ביטול. Owner or editor.';

create function public.answer_utility_refund(
  p_bill_transaction_id uuid, p_state text, p_payment_transaction_id uuid default null, p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.utility_writer_company();
  bill public.transactions%rowtype;
  pay public.transactions%rowtype;
  before jsonb;
  closing record;
  changed integer := 0;
  auto_pay uuid;
  result_state text := p_state;
begin
  select * into bill from public.transactions t
  where t.id = p_bill_transaction_id and t.company_id = cid
  for update;
  if bill.id is null then
    raise exception 'transaction not found';
  end if;
  if p_payment_transaction_id is not null then
    select * into pay from public.transactions t
    where t.id = p_payment_transaction_id and t.company_id = cid;
    if pay.id is null then
      raise exception 'transaction not found';
    end if;
  end if;
  if p_state is not null and p_state not in ('matched', 'rejected', 'seen')
    or (p_state in ('matched', 'rejected') and p_payment_transaction_id is null)
    or (p_state = 'seen' and p_payment_transaction_id is not null)
  then
    raise exception 'validation';
  end if;
  if not exists (
    select 1 from private.utility_keys(cid) k
    where k.project_id = bill.project_id and k.supplier_id = bill.supplier_id and k.currency = bill.currency
  ) or bill.direction <> 'expense' or bill.doc_kind = 'credit' or bill.removed_at is not null then
    raise exception 'not a utility bill';
  end if;
  if pay.id is not null and (
    pay.removed_at is not null or pay.currency <> bill.currency or pay.id = bill.id
    or not (pay.direction = 'income' or pay.doc_kind = 'credit')
  ) then
    raise exception 'not a refund payment';
  end if;

  perform 1 from public.utility_refund_answers x
  where x.company_id = cid and x.bill_transaction_id = bill.id
  for update;
  before := private.utility_answer_rows(cid, bill.id);
  select x.state, x.payment_transaction_id, x.refile into closing
  from public.utility_refund_answers x
  where x.company_id = cid and x.bill_transaction_id = bill.id and x.state in ('matched', 'seen');

  -- A refund the one-tap fix refiled keeps its answer until the refile is undone.
  if closing.refile is not null and (
    (p_state = 'matched' and p_payment_transaction_id <> closing.payment_transaction_id)
    or p_state = 'seen'
    or (p_state = 'rejected' and p_payment_transaction_id = closing.payment_transaction_id)
    or (p_state is null and (p_payment_transaction_id is null or p_payment_transaction_id = closing.payment_transaction_id))
  ) then
    raise exception 'undo the refile first';
  end if;

  if p_state = 'matched' then
    if closing.state is distinct from 'matched' or closing.payment_transaction_id <> pay.id then
      delete from public.utility_refund_answers x
      where x.company_id = cid and x.bill_transaction_id = bill.id
        and (x.state in ('matched', 'seen') or (x.state = 'rejected' and x.payment_transaction_id = pay.id));
      insert into public.utility_refund_answers (company_id, bill_transaction_id, state, payment_transaction_id, set_by)
      values (cid, bill.id, 'matched', pay.id, auth.uid());
    end if;
  elsif p_state = 'rejected' then
    delete from public.utility_refund_answers x
    where x.company_id = cid and x.bill_transaction_id = bill.id and x.state = 'matched' and x.payment_transaction_id = pay.id;
    insert into public.utility_refund_answers (company_id, bill_transaction_id, state, payment_transaction_id, set_by)
    values (cid, bill.id, 'rejected', pay.id, auth.uid())
    on conflict (company_id, bill_transaction_id, payment_transaction_id) where state = 'rejected' do nothing;
  elsif p_state = 'seen' then
    if closing.state is distinct from 'seen' then
      delete from public.utility_refund_answers x
      where x.company_id = cid and x.bill_transaction_id = bill.id and x.state in ('matched', 'seen');
      insert into public.utility_refund_answers (company_id, bill_transaction_id, state, set_by)
      values (cid, bill.id, 'seen', auth.uid());
    end if;
  else
    -- Taking an answer back: the bill's closing answer, or (with a payment) that pair's answer.
    delete from public.utility_refund_answers x
    where x.company_id = cid and x.bill_transaction_id = bill.id
      and (case when pay.id is null then x.state in ('matched', 'seen') else x.payment_transaction_id = pay.id end);
    get diagnostics changed = row_count;
    if changed = 0 then
      -- Nothing the owner wrote: taking back a refund Flow counted by itself rejects that pair, so it
      -- is neither counted nor suggested again.
      select r.payment_id into auto_pay
      from private.utility_refund_rows(cid, coalesce(p_today, private.flow_today()), bill.project_id) r
      where r.bill_id = bill.id and r.state = 'refunded' and r.source = 'auto'
        and (pay.id is null or r.payment_id = pay.id);
      if auto_pay is not null then
        insert into public.utility_refund_answers (company_id, bill_transaction_id, state, payment_transaction_id, set_by)
        values (cid, bill.id, 'rejected', auto_pay, auth.uid())
        on conflict (company_id, bill_transaction_id, payment_transaction_id) where state = 'rejected' do nothing;
        result_state := 'rejected';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'bill_transaction_id', bill.id,
    'state', result_state,
    'payment_transaction_id', coalesce(auto_pay, pay.id),
    'prior_state', closing.state,
    'prior_payment_transaction_id', closing.payment_transaction_id,
    'before', before,
    'after', private.utility_answer_rows(cid, bill.id)
  );
end;
$$;
revoke all on function public.answer_utility_refund(uuid, text, uuid, date) from public, anon, authenticated;
grant execute on function public.answer_utility_refund(uuid, text, uuid, date) to authenticated;
comment on function public.answer_utility_refund(uuid, text, uuid, date) is
  'FLOW-1134 (decision 0265): answer a utility bill: matched (the payment is its refund), rejected (it is not; never suggested again), seen (nothing to do), or null to take the answer back (taking back a refund Flow counted by itself rejects the pair). Owner or editor.';

create function public.mark_utility_refunds_seen(p_project_id uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.utility_writer_company();
  stamp timestamptz := clock_timestamp();
  ids uuid[];
begin
  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  perform 1 from public.projects p where p.id = p_project_id and p.company_id = cid for update;
  select coalesce(array_agg(r.bill_id order by r.doc_date, r.bill_id), '{}') into ids
  from private.utility_refund_rows(cid, coalesce(p_today, private.flow_today()), p_project_id) r
  where r.state = 'not_refunded';
  insert into public.utility_refund_answers (company_id, bill_transaction_id, state, set_by, set_at)
  select cid, x, 'seen', auth.uid(), stamp from unnest(ids) x;
  return jsonb_build_object('project_id', p_project_id, 'bill_transaction_ids', to_jsonb(ids), 'set_at', stamp);
end;
$$;
revoke all on function public.mark_utility_refunds_seen(uuid, date) from public, anon, authenticated;
grant execute on function public.mark_utility_refunds_seen(uuid, date) to authenticated;
comment on function public.mark_utility_refunds_seen(uuid, date) is
  'FLOW-1134 (decision 0265): closes every open not-refunded bill of a property as seen (suggestions stay open); returns the bills for ביטול (unmark_utility_refunds_seen). Owner or editor.';

create function public.unmark_utility_refunds_seen(p_bill_transaction_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.utility_writer_company();
  ids uuid[];
begin
  with gone as (
    delete from public.utility_refund_answers x
    where x.company_id = cid and x.state = 'seen' and x.bill_transaction_id = any (coalesce(p_bill_transaction_ids, '{}'))
    returning x.bill_transaction_id
  )
  select coalesce(array_agg(g.bill_transaction_id order by g.bill_transaction_id), '{}') into ids from gone g;
  return jsonb_build_object('bill_transaction_ids', to_jsonb(ids));
end;
$$;
revoke all on function public.unmark_utility_refunds_seen(uuid[]) from public, anon, authenticated;
grant execute on function public.unmark_utility_refunds_seen(uuid[]) to authenticated;
comment on function public.unmark_utility_refunds_seen(uuid[]) is
  'FLOW-1134 (decision 0265): the ביטול of mark_utility_refunds_seen: those bills'' seen answers go. Owner or editor.';

-- The one-tap fix: a refund the owner matched that sits in another category moves to the bill's
-- category (reassign_transaction, with the bill's property), or, when the payment is more than the
-- bills it refunds (rent plus the bills), their part is split off it (save_line_split), the rest staying
-- in its own category. What it changed is kept on the answer (refile) for undo_utility_refile.
create function public.refile_utility_refund(p_bill_transaction_id uuid, p_payment_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.utility_writer_company();
  bill public.transactions%rowtype;
  pay public.transactions%rowtype;
  answer public.utility_refund_answers%rowtype;
  total bigint;
  part bigint;
  changed jsonb;
  undo_id uuid;
begin
  select * into bill from public.transactions t where t.id = p_bill_transaction_id and t.company_id = cid;
  select * into pay from public.transactions t where t.id = p_payment_transaction_id and t.company_id = cid for update;
  if bill.id is null or pay.id is null then
    raise exception 'transaction not found';
  end if;
  select * into answer from public.utility_refund_answers x
  where x.company_id = cid and x.bill_transaction_id = bill.id and x.state = 'matched'
    and x.payment_transaction_id = pay.id
  for update;
  if answer.id is null then
    raise exception 'refund not matched';
  end if;
  if answer.refile is not null or not private.utility_wrong_category(cid, pay.id, bill.category_id) then
    raise exception 'refund already in the bill''s category';
  end if;
  if bill.project_id is null then
    raise exception 'project not found';
  end if;
  if exists (select 1 from private.split_parts x where x.transaction_id = pay.id) then
    raise exception 'line has a split by category';
  end if;

  -- The bills this payment refunds (the owner matched it to each).
  select coalesce(sum(t.amount_original), 0) into total
  from public.utility_refund_answers x
  join public.transactions t on t.id = x.bill_transaction_id and t.company_id = cid
  where x.company_id = cid and x.state = 'matched' and x.payment_transaction_id = pay.id
    and t.category_id is not distinct from bill.category_id;

  if pay.amount_original - total > 100 then
    part := round(total::numeric * abs(pay.amount_net) / pay.amount_original)::bigint;
    perform public.save_line_split(pay.id, jsonb_build_array(
      jsonb_build_object('category_id', bill.category_id, 'project_id', bill.project_id, 'amount_minor', part),
      jsonb_build_object('rest', true)
    ), false);
    changed := jsonb_build_object(
      'mode', 'split',
      'user_assigned', pay.user_assigned,
      'category_suggested', pay.category_suggested,
      'written', private.line_split_parts(pay.id)
    );
  else
    undo_id := public.reassign_transaction(pay.id, bill.project_id, bill.category_id);
    changed := jsonb_build_object(
      'mode', 'move',
      'reassign_undo_id', undo_id,
      'from_category_id', pay.category_id,
      'from_project_id', pay.project_id,
      'written', jsonb_build_object('category_id', bill.category_id, 'project_id', bill.project_id)
    );
  end if;

  update public.utility_refund_answers x set refile = changed where x.id = answer.id;
  return jsonb_build_object(
    'bill_transaction_id', bill.id,
    'payment_transaction_id', pay.id,
    'mode', changed->>'mode',
    'category_id', bill.category_id,
    'part_minor', part,
    'refile', changed
  );
end;
$$;
revoke all on function public.refile_utility_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refile_utility_refund(uuid, uuid) to authenticated;
comment on function public.refile_utility_refund(uuid, uuid) is
  'FLOW-1134 (decision 0265): the one-tap fix for a matched refund filed elsewhere: moves the payment to the bill''s category, or splits the bills'' part off a rent payment. Returns what it changed; undo_utility_refile puts it back. Owner or editor.';

create function public.undo_utility_refile(p_bill_transaction_id uuid, p_payment_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.utility_writer_company();
  answer public.utility_refund_answers%rowtype;
  pay public.transactions%rowtype;
begin
  select * into pay from public.transactions t
  where t.id = p_payment_transaction_id and t.company_id = cid
  for update;
  if pay.id is null or not exists (
    select 1 from public.transactions t where t.id = p_bill_transaction_id and t.company_id = cid
  ) then
    raise exception 'transaction not found';
  end if;
  select * into answer from public.utility_refund_answers x
  where x.company_id = cid and x.bill_transaction_id = p_bill_transaction_id and x.state = 'matched'
    and x.payment_transaction_id = pay.id
  for update;
  if answer.refile is null then
    raise exception 'nothing to undo';
  end if;
  -- Only while the line still reads as the refile left it.
  if answer.refile->>'mode' = 'split' then
    if private.line_split_parts(pay.id) is distinct from answer.refile->'written' then
      raise exception 'line changed since';
    end if;
    perform private.set_line_parts(cid, pay.id, '[]'::jsonb);
    update public.transactions t
    set user_assigned = (answer.refile->>'user_assigned')::boolean,
        category_suggested = (answer.refile->>'category_suggested')::boolean
    where t.id = pay.id and t.company_id = cid;
  else
    if pay.category_id is distinct from (answer.refile->'written'->>'category_id')::uuid
      or pay.project_id is distinct from (answer.refile->'written'->>'project_id')::uuid
      or exists (select 1 from private.split_parts x where x.transaction_id = pay.id)
    then
      raise exception 'line changed since';
    end if;
    perform public.undo_reassign((answer.refile->>'reassign_undo_id')::uuid);
  end if;
  update public.utility_refund_answers x set refile = null where x.id = answer.id;
  return jsonb_build_object(
    'bill_transaction_id', p_bill_transaction_id,
    'payment_transaction_id', pay.id,
    'refile', answer.refile
  );
end;
$$;
revoke all on function public.undo_utility_refile(uuid, uuid) from public, anon, authenticated;
grant execute on function public.undo_utility_refile(uuid, uuid) to authenticated;
comment on function public.undo_utility_refile(uuid, uuid) is
  'FLOW-1134 (decision 0265): puts back what refile_utility_refund changed, refused (line changed since) once the payment line was changed after it. Owner or editor.';

-- 5. MCP: the writes with the idempotency key, the write gate and undo (id: the write).
create function private.utility_mcp_failure(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message = 'validation' then private.mcp_error('validation', 'validation')
    when p_message in (
      'transaction not found', 'project not found', 'supplier not found', 'not a utility bill',
      'not a refund payment', 'undo the refile first', 'refund not matched',
      'refund already in the bill''s category', 'line has a split by category', 'line has an open review',
      'nothing to undo', 'line changed since'
    ) then private.mcp_error('refused', p_message)
    else private.mcp_refused(p_message)
  end;
$$;
revoke all on function private.utility_mcp_failure(text) from public, anon, authenticated;

create function private.utility_mcp_begin(p_idempotency_key text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  prior jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128 then
    return jsonb_build_object('done', private.mcp_error('validation', 'validation'));
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return jsonb_build_object('done', gate);
  end if;
  prior := private.mcp_idempotency_lookup((gate->>'token_id')::uuid, p_idempotency_key, p_hash);
  if prior->>'state' = 'replay' then
    return jsonb_build_object('done', prior->'response');
  end if;
  if prior->>'state' = 'conflict' then
    return jsonb_build_object('done', private.mcp_error('conflict', 'conflict'));
  end if;
  return jsonb_build_object('token_id', gate->>'token_id');
end;
$$;
revoke all on function private.utility_mcp_begin(text, text) from public, anon, authenticated;

create function public.mcp_set_utility_payer(
  p_idempotency_key text, p_project_id uuid, p_supplier_id uuid, p_currency text, p_payer text,
  p_added boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start jsonb;
  token uuid;
  hash text := 'utility_payer|' || coalesce(p_project_id::text, '') || '|' || coalesce(p_supplier_id::text, '')
    || '|' || coalesce(p_currency, '') || '|' || coalesce(p_payer, 'null') || '|' || coalesce(p_added::text, 'null');
  written jsonb;
  write_id uuid;
  response jsonb;
begin
  start := private.utility_mcp_begin(p_idempotency_key, hash);
  if start ? 'done' then
    return start->'done';
  end if;
  token := (start->>'token_id')::uuid;
  begin
    written := public.set_utility_payer(p_project_id, p_supplier_id, p_currency, p_payer, p_added);
    insert into private.mcp_writes (token_id, user_id, kind, project_id, prior, created_at)
    values (token, auth.uid(), 'utility_payer', p_project_id, jsonb_build_object(
      'supplier_id', p_supplier_id, 'currency', p_currency,
      'before', coalesce(written->'prior', 'null'::jsonb),
      'after', case when p_payer is null then 'null'::jsonb
        else jsonb_build_object('payer', p_payer, 'added', coalesce(p_added, false)) end
    ), clock_timestamp())
    returning id into write_id;
    response := jsonb_build_object('ok', true, 'data', written || jsonb_build_object(
      'undo_kind', 'utility_payer', 'id', write_id));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.utility_mcp_failure(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_set_utility_payer(text, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mcp_set_utility_payer(text, uuid, uuid, text, text, boolean) to authenticated;

create function public.mcp_answer_utility_refund(
  p_idempotency_key text, p_bill_transaction_id uuid, p_state text, p_payment_transaction_id uuid default null,
  p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start jsonb;
  token uuid;
  hash text := 'utility_refund|' || coalesce(p_bill_transaction_id::text, '') || '|' || coalesce(p_state, 'null')
    || '|' || coalesce(p_payment_transaction_id::text, 'null') || '|' || coalesce(p_today::text, 'today');
  written jsonb;
  write_id uuid;
  response jsonb;
begin
  start := private.utility_mcp_begin(p_idempotency_key, hash);
  if start ? 'done' then
    return start->'done';
  end if;
  token := (start->>'token_id')::uuid;
  begin
    written := public.answer_utility_refund(p_bill_transaction_id, p_state, p_payment_transaction_id, p_today);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior, created_at)
    values (token, auth.uid(), 'utility_refund', p_bill_transaction_id,
      jsonb_build_object('before', written->'before', 'after', written->'after'), clock_timestamp())
    returning id into write_id;
    response := jsonb_build_object('ok', true, 'data', (written - 'before' - 'after') || jsonb_build_object(
      'undo_kind', 'utility_refund', 'id', write_id));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.utility_mcp_failure(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_answer_utility_refund(text, uuid, text, uuid, date) from public, anon, authenticated;
grant execute on function public.mcp_answer_utility_refund(text, uuid, text, uuid, date) to authenticated;

create function public.mcp_mark_utility_refunds_seen(p_idempotency_key text, p_project_id uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start jsonb;
  token uuid;
  hash text := 'utility_refunds_seen|' || coalesce(p_project_id::text, '') || '|' || coalesce(p_today::text, 'today');
  written jsonb;
  write_id uuid;
  response jsonb;
begin
  start := private.utility_mcp_begin(p_idempotency_key, hash);
  if start ? 'done' then
    return start->'done';
  end if;
  token := (start->>'token_id')::uuid;
  begin
    written := public.mark_utility_refunds_seen(p_project_id, p_today);
    insert into private.mcp_writes (token_id, user_id, kind, project_id, prior, created_at)
    values (token, auth.uid(), 'utility_refunds_seen', p_project_id,
      jsonb_build_object('before', 'null'::jsonb, 'after', written), clock_timestamp())
    returning id into write_id;
    response := jsonb_build_object('ok', true, 'data', (written - 'set_at') || jsonb_build_object(
      'undo_kind', 'utility_refunds_seen', 'id', write_id));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.utility_mcp_failure(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_mark_utility_refunds_seen(text, uuid, date) from public, anon, authenticated;
grant execute on function public.mcp_mark_utility_refunds_seen(text, uuid, date) to authenticated;

create function public.mcp_refile_utility_refund(
  p_idempotency_key text, p_bill_transaction_id uuid, p_payment_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start jsonb;
  token uuid;
  hash text := 'utility_refile|' || coalesce(p_bill_transaction_id::text, '') || '|'
    || coalesce(p_payment_transaction_id::text, '');
  written jsonb;
  write_id uuid;
  response jsonb;
begin
  start := private.utility_mcp_begin(p_idempotency_key, hash);
  if start ? 'done' then
    return start->'done';
  end if;
  token := (start->>'token_id')::uuid;
  begin
    written := public.refile_utility_refund(p_bill_transaction_id, p_payment_transaction_id);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior, created_at)
    values (token, auth.uid(), 'utility_refile', p_payment_transaction_id, jsonb_build_object(
      'bill_transaction_id', p_bill_transaction_id, 'before', 'null'::jsonb, 'after', written->'refile'
    ), clock_timestamp())
    returning id into write_id;
    response := jsonb_build_object('ok', true, 'data', written || jsonb_build_object(
      'undo_kind', 'utility_refile', 'id', write_id));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.utility_mcp_failure(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_refile_utility_refund(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_refile_utility_refund(text, uuid, uuid) to authenticated;

-- The undo of the four kinds (mcp_undo, by the write's id): what the write left must still hold, else
-- a conflict; then what was before comes back.
create function private.undo_utility_write(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rec private.mcp_writes := p_write;
  cur jsonb;
  bill uuid;
  n integer;
begin
  if rec.kind = 'utility_payer' then
    perform 1 from public.projects p where p.id = rec.project_id and p.company_id = cid for update;
    select jsonb_build_object('payer', u.payer, 'added', u.added) into cur
    from public.utility_payers u
    where u.company_id = cid and u.project_id = rec.project_id
      and u.supplier_id = (rec.prior->>'supplier_id')::uuid and u.currency = rec.prior->>'currency'
    for update;
    if coalesce(cur, 'null'::jsonb) is distinct from rec.prior->'after' then
      return private.mcp_error('conflict', 'conflict');
    end if;
    perform public.set_utility_payer(rec.project_id, (rec.prior->>'supplier_id')::uuid, rec.prior->>'currency',
      rec.prior->'before'->>'payer', coalesce((rec.prior->'before'->>'added')::boolean, false));
  elsif rec.kind = 'utility_refund' then
    perform 1 from public.transactions t where t.id = rec.transaction_id and t.company_id = cid for update;
    if private.utility_answer_rows(cid, rec.transaction_id) is distinct from rec.prior->'after' then
      return private.mcp_error('conflict', 'conflict');
    end if;
    perform private.utility_answer_put(cid, rec.transaction_id, rec.prior->'before');
  elsif rec.kind = 'utility_refunds_seen' then
    delete from public.utility_refund_answers x
    where x.company_id = cid and x.state = 'seen'
      and x.set_at = (rec.prior->'after'->>'set_at')::timestamptz
      and x.bill_transaction_id in (
        select e::uuid from jsonb_array_elements_text(rec.prior->'after'->'bill_transaction_ids') e
      );
    get diagnostics n = row_count;
    if n = 0 and jsonb_array_length(rec.prior->'after'->'bill_transaction_ids') > 0 then
      return private.mcp_error('conflict', 'conflict');
    end if;
  elsif rec.kind = 'utility_refile' then
    bill := (rec.prior->>'bill_transaction_id')::uuid;
    if (select x.refile from public.utility_refund_answers x
        where x.company_id = cid and x.bill_transaction_id = bill and x.state = 'matched'
          and x.payment_transaction_id = rec.transaction_id) is distinct from rec.prior->'after' then
      return private.mcp_error('conflict', 'conflict');
    end if;
    begin
      perform public.undo_utility_refile(bill, rec.transaction_id);
    exception
      when others then
        if sqlerrm = 'line changed since' then
          return private.mcp_error('conflict', 'line changed since');
        end if;
        raise;
    end;
  else
    return private.mcp_error('not_found', 'not found');
  end if;
  update private.mcp_writes w
  set undone_at = clock_timestamp()
  where w.id = rec.id and w.user_id = auth.uid() and w.undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', rec.kind, 'id', rec.id));
end;
$$;
revoke all on function private.undo_utility_write(uuid, private.mcp_writes) from public, anon, authenticated;

do $undo$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'recurring_handover'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor
      || $n$, 'utility_payer'::text, 'utility_refund'::text, 'utility_refunds_seen'::text, 'utility_refile'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'utility_payer'::text) AND (project_id IS NOT NULL) AND (prior ? 'supplier_id'::text) AND (prior ? 'currency'::text) AND (prior ? 'before'::text) AND (prior ? 'after'::text)) OR ((kind = ANY (ARRAY['utility_refund'::text, 'utility_refile'::text])) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text)) OR ((kind = 'utility_refunds_seen'::text) AND (project_id IS NOT NULL) AND (prior ? 'after'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'recurring_handover', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor
    || $n$'utility_payer', 'utility_refund', 'utility_refunds_seen', 'utility_refile', $n$);

  anchor := $a$        or (p_kind = 'recurring_handover' and w.kind = 'recurring_handover' and w.id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind in ('utility_payer', 'utility_refund', 'utility_refunds_seen', 'utility_refile')
          and w.kind = p_kind and w.id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'recurring_handover' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo branches are not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind in ('utility_payer', 'utility_refund', 'utility_refunds_seen', 'utility_refile') then
      -- FLOW-1134 (decision 0265): what the write left must still hold; then what was before comes back.
      response := private.undo_utility_write(cid, rec);
$n$ || anchor);
  execute def;
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
