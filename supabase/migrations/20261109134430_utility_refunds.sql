-- FLOW-1134 (decision 0265): utility bills the tenant never paid back.
--
-- A utility is one supplier's bills for one property and currency (the key of a recurring charge,
-- decision 0185). Flow finds it from the lines: an expense filed to a property in a category named
-- חשבונות or under it (the starter categories' tree), or paid with a card whose name names exactly one
-- property and a utilities word (decision 0262's card-name rule, ported to SQL); the owner can add one by
-- hand. Each is
-- tenant-paid (the tenant pays it back) unless the owner says the company pays.
--
-- 1. public.utility_payers: who pays a utility (tenant or company) and whether the owner added it.
--    public.utility_refund_answers: the owner's answers for a bill: matched (with the payment line),
--    rejected (a payment that is not the refund; never suggested again for that bill) or seen
--    (nothing to do); a matched answer may keep a payment filed elsewhere as it is (keep_category).
--    RLS on, no client grant; only the functions below read and write them.
-- 2. The match is worked out on read (private.utility_refund_rows), like the transfer suggestions
--    (decision 0205), in one pass: for each bill of a tenant-paid utility, from the first one in the books,
--    an income line dated from one month before the bill to the as-of date, filed to the property or
--    to no property, not the refund of another bill, whose amount is within one unit of the
--    currency (100 minor units) of (1) the bill, (2) several of the property's bills of that month
--    together, or (3) the property's usual rent plus one or more of them. Rule 1 or 2 with the
--    payment filed to the category every bill shares counts as refunded by itself; any other match is a
--    suggestion. A bill with no match 30 days after its date is not refunded (לא הוחזר); a month
--    with no rent line on the property is flagged.
-- 3. Reads (any member): list_utility_refunds, count_utility_refunds, list_utility_payers. Writes
--    (owner or editor, decision 0167): set_utility_payer, answer_utility_refund,
--    mark_utility_refunds_seen and unmark_utility_refunds_seen, refile_utility_refund and
--    undo_utility_refile (the one-tap fix: the payment moves to the bill's category, or is split into a
--    part per bill category, plus the rest of a rent payment, through save_line_split).
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
  -- A matched refund filed elsewhere that the owner keeps as it is (להשאיר): no wrong-category note.
  keep_category boolean not null default false,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default clock_timestamp(),
  constraint utility_refund_answers_payment check ((state = 'seen') = (payment_transaction_id is null)),
  constraint utility_refund_answers_two_lines check (payment_transaction_id is distinct from bill_transaction_id),
  constraint utility_refund_answers_keep check (not keep_category or state = 'matched'),
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

-- The match reads a company's lines by direction and date (the money-in candidates, the rent lines).
create index transactions_company_direction_date_idx
  on public.transactions (company_id, direction, doc_date) where removed_at is null;

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

-- The card-name rule of decision 0262 (cardProject in supabase/functions/_shared/jev_tag_plan.ts), in SQL.
-- Keep the two in step: the same generic words, tokens and cases (the pgTAP test of FLOW-1134 repeats the
-- Deno test "FLOW-1072: the card's name matches a property by its own words").
-- Words a property's name shares with any card or account name, so they never decide a match.
create function private.card_generic_words()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'rd', 'road', 'ave', 'av', 'avenue', 'st', 'street', 'dr', 'drive', 'ln', 'lane', 'blvd', 'boulevard', 'ct', 'court',
    'way', 'pl', 'place', 'ter', 'terrace', 'cir', 'circle', 'hwy', 'pkwy', 'trl', 'sq', 'north', 'south', 'east', 'west',
    'utilities', 'utility', 'card', 'account', 'checking', 'savings', 'ops', 'operating', 'rent', 'rental', 'flip',
    'rehab', 'renovation', 'property', 'project', 'llc', 'inc', 'the', 'and', 'of', 'unit', 'apt',
    'main', 'business', 'primary', 'personal', 'joint', 'general', 'company',
    'רחוב', 'שדרות', 'דרך', 'כרטיס', 'חשבון', 'שיפוץ', 'פרויקט', 'דירה', 'נכס'
  ]::text[];
$$;

-- A name's own words (3 letters or more, generic words left out) and numbers (2 digits or more), lower case.
create function private.card_name_keys(p_name text, out words text[], out numbers text[])
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(array_agg(distinct k.token) filter (
      where k.token !~ '^[0-9]+$' and char_length(k.token) >= 3 and not (k.token = any (private.card_generic_words()))
    ), '{}'),
    coalesce(array_agg(distinct k.token) filter (where k.token ~ '^[0-9]+$' and char_length(k.token) >= 2), '{}')
  from regexp_split_to_table(lower(coalesce(p_name, '')), '[^[:alnum:]]+') as k(token)
  where k.token <> '';
$$;

-- The project a card's name names, when exactly one does: every word of the project's name is in the card's
-- name, and a number on both must agree. Overhead and finished projects are not candidates. p_projects is
-- [{id, name, overhead, finished}], as cardProject takes them.
create function private.card_name_project_of(p_card text, p_projects jsonb)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when count(*) = 1 then min(m.id::text)::uuid end
  from (
    select (e->>'id')::uuid as id
    from jsonb_array_elements(case when jsonb_typeof(p_projects) = 'array' then p_projects else '[]'::jsonb end) e
    cross join lateral private.card_name_keys(e->>'name') own
    cross join lateral private.card_name_keys(p_card) card
    where nullif(btrim(coalesce(p_card, '')), '') is not null
      and not coalesce((e->>'overhead')::boolean, false)
      and not coalesce((e->>'finished')::boolean, false)
      and cardinality(own.words) > 0
      and own.words <@ card.words
      and not (cardinality(card.numbers) > 0 and cardinality(own.numbers) > 0 and not (own.numbers && card.numbers))
  ) m;
$$;

-- The company's projects as card_name_project_of takes them.
create function private.card_name_projects(p_company uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name,
      'overhead', p.id is not distinct from c.overhead_project_id,
      'finished', p.status = 'finished'
    )), '[]'::jsonb)
  from public.projects p
  join public.companies c on c.id = p.company_id
  where p.company_id = p_company;
$$;

-- The company's utilities: a (property, supplier, currency) with an expense line filed under חשבונות, or
-- paid with a card whose name names exactly one property and a utilities word (the purpose words of the
-- generic list: utilities, utility), wherever that line is filed (found); or one the owner added. payer is
-- the owner's pick, tenant by default.
create function private.utility_keys(p_company uuid)
returns table (project_id uuid, supplier_id uuid, currency text, payer text, added boolean, found boolean)
language sql
stable
set search_path = ''
as $$
  with cats as (
    select private.utility_category_ids(p_company, 'חשבונות', 'expense') as ids
  ),
  projects as (
    select private.card_name_projects(p_company) as list
  ),
  cards as (
    select distinct cc.provider::text as provider, card.value->>'last4' as last4,
      private.card_name_project_of(private.mask_long_digits(card.value->>'label'), pr.list) as project_id
    from public.connector_connections cc
    cross join projects pr
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cc.card_labels) = 'array' then cc.card_labels else '[]'::jsonb end
    ) as card(value)
    where cc.company_id = p_company
      and card.value->>'last4' ~ '^[0-9]{4}$'
      and exists (
        select 1 from regexp_split_to_table(lower(coalesce(card.value->>'label', '')), '[^[:alnum:]]+') w(token)
        where w.token in ('utilities', 'utility')
      )
  ),
  found as (
    select t.project_id, t.supplier_id, t.currency
    from public.transactions t, cats
    where t.company_id = p_company
      and t.direction = 'expense'
      and t.project_id is not null
      and t.supplier_id is not null
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.category_id = any (cats.ids)
    union
    select cd.project_id, t.supplier_id, t.currency
    from public.transactions t
    join cards cd on cd.provider = t.source::text and cd.last4 = t.provider_meta->>'card_last4'
    where t.company_id = p_company
      and cd.project_id is not null
      and t.direction = 'expense'
      and t.supplier_id is not null
      and t.removed_at is null
      and t.line_status = 'posted'
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

-- Every bill of a tenant-paid utility with its state as of p_today:
--   refunded: matched by the owner (source owner) or counted by itself (source auto: rule 1 or 2 and
--     the payment filed to the category every bill of the group shares);
--   suggested: any other match (rule 1, 2 or 3), for the owner to answer;
--   seen: closed by the owner; not_refunded: no match 30 days or more after the bill; waiting: younger.
-- One pass (FLOW-1134 review, B2): the bills the owner closed are left out first; the groups are every
-- set of up to 3 of a month's open bills of a property and currency, plus the whole month when it has
-- more; each group's targets (its total, and the usual rent plus its total) meet the money-in lines once,
-- by amount bucket. Then bills are matched oldest first: a group is owned by its oldest bill, a payment is
-- the refund of one group, a bill is in one group, and a pair the owner rejected is never matched.
-- p_project only filters what is returned: the match always runs on the whole company.
create function private.utility_refund_rows(p_company uuid, p_today date, p_project uuid default null)
returns table (
  bill_id uuid, project_id uuid, supplier_id uuid, currency text, category_id uuid, doc_date date,
  amount bigint, state text, source text, rule smallint, payment_id uuid, group_ids uuid[], no_rent boolean
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  rent uuid[] := private.utility_category_ids(p_company, 'שכירות', 'income');
  bills private.utility_bill[];
  closed text[];
  closed_pay uuid[];
  owner_paid uuid[];
  done boolean[] := '{}';
  used boolean[] := '{}';
  res_state text[] := '{}';
  res_rule smallint[] := '{}';
  res_pay uuid[] := '{}';
  res_owner integer[] := '{}';
  c record;
  cur integer := 0;
  taken boolean := false;
  o integer;
  clash boolean;
begin
  select coalesce(array_agg(x order by x.doc_date, x.id), '{}') into bills
  from private.utility_bills(p_company) x;
  if cardinality(bills) = 0 then
    return;
  end if;

  -- The owner's closing answers, by the bill's place in bills.
  select array_agg(a.state order by u.ord), array_agg(a.payment_transaction_id order by u.ord)
  into closed, closed_pay
  from unnest(bills) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
  left join public.utility_refund_answers a
    on a.company_id = p_company and a.bill_transaction_id = u.id and a.state in ('matched', 'seen');
  owner_paid := array_remove(closed_pay, null);

  for c in
    with b as materialized (
      select u.ord::integer as ord, u.id, u.project_id, u.currency, u.category_id, u.doc_date, u.amount,
        date_trunc('month', u.doc_date)::date as month
      from unnest(bills) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
      where closed[u.ord] is null
    ),
    -- The pairs and triples are drawn from a month's first 12 open bills (220 triples at most).
    b12 as materialized (
      select x.* from (
        select b.*, row_number() over (partition by b.project_id, b.currency, b.month order by b.ord) as rn from b
      ) x
      where x.rn <= 12
    ),
    subs as materialized (
      select row_number() over () as sid, x.*
      from (
        select b1.ord as owner, array[b1.ord] as ords, b1.amount as total, array[b1.category_id] as cats, 1 as size,
          b1.project_id, b1.currency, b1.doc_date
        from b b1
        union all
        select b1.ord, array[b1.ord, b2.ord], b1.amount + b2.amount, array[b1.category_id, b2.category_id], 2,
          b1.project_id, b1.currency, b1.doc_date
        from b12 b1
        join b12 b2 on b2.project_id = b1.project_id and b2.currency = b1.currency and b2.month = b1.month and b2.ord > b1.ord
        union all
        select b1.ord, array[b1.ord, b2.ord, b3.ord], b1.amount + b2.amount + b3.amount,
          array[b1.category_id, b2.category_id, b3.category_id], 3, b1.project_id, b1.currency, b1.doc_date
        from b12 b1
        join b12 b2 on b2.project_id = b1.project_id and b2.currency = b1.currency and b2.month = b1.month and b2.ord > b1.ord
        join b12 b3 on b3.project_id = b1.project_id and b3.currency = b1.currency and b3.month = b1.month and b3.ord > b2.ord
        union all
        -- The whole month, when it has more than 3 bills.
        select min(b.ord), array_agg(b.ord order by b.ord), sum(b.amount)::bigint, array_agg(b.category_id), count(*)::integer,
          b.project_id, b.currency, min(b.doc_date)
        from b
        group by b.project_id, b.currency, b.month
        having count(*) > 3
      ) x
    ),
    rent_lines as materialized (
      select t.project_id, t.currency, t.doc_date,
        lead(t.doc_date) over w as next_date,
        array_agg(t.amount_original) over (w rows between 2 preceding and current row) as last3
      from public.transactions t
      where t.company_id = p_company
        and t.direction = 'income'
        and t.removed_at is null
        and t.line_status = 'posted'
        and t.project_id is not null
        and t.category_id = any (rent)
      window w as (partition by t.project_id, t.currency order by t.doc_date, t.id)
    ),
    -- The usual rent of each open bill: the median of the last 3 rent lines dated before it (the rent
    -- line before it, and the 2 before that one).
    usual as materialized (
      select b.ord,
        (select round(percentile_cont(0.5) within group (order by v))::bigint from unnest(r.last3) v) as usual
      from b
      join rent_lines r
        on r.project_id = b.project_id and r.currency = b.currency
        and r.doc_date < b.doc_date and (r.next_date is null or b.doc_date <= r.next_date)
    ),
    pays as materialized (
      select p.id, p.currency, p.project_id, p.category_id, p.doc_date, p.amount_original as amount,
        p.amount_original / 100 as bucket, (row_number() over ())::integer as pord
      from public.transactions p
      where p.company_id = p_company
        and p.direction = 'income'
        and p.removed_at is null
        and p.line_status = 'posted'
        and p.amount_original > 0
        and p.doc_date <= p_today
        and p.doc_date >= (select min(b.doc_date) from b) - 31
        and (p.project_id is null or p.project_id in (select b.project_id from b))
        and not (p.id = any (owner_paid))
    ),
    -- Each group's targets (its total; the usual rent plus its total) in amount buckets 100 minor units
    -- wide, so the money-in lines are met by equality.
    buckets as materialized (
      select s.sid, s.project_id, s.currency, s.doc_date, k.kind, k.target, g.bucket
      from subs s
      left join usual u on u.ord = s.owner
      cross join lateral (values (1, s.total), (3, s.total + u.usual)) k(kind, target)
      cross join lateral generate_series((k.target - 100) / 100, (k.target + 100) / 100) g(bucket)
      where k.target is not null
    ),
    cand as materialized (
      select t.sid,
        p.id as pay_id, p.pord, p.category_id as pay_cat, t.kind,
        abs(p.amount - t.target) as off_by,
        abs(p.doc_date - t.doc_date) as days_apart
      from buckets t
      join pays p on p.currency = t.currency and p.bucket = t.bucket
      where abs(p.amount - t.target) <= 100
        and (p.project_id is null or p.project_id = t.project_id)
        and p.doc_date >= (t.doc_date - interval '1 month')::date
    )
    select s.owner, s.ords, s.size, x.pay_id, x.pord, x.off_by, x.days_apart,
      case when x.kind = 3 then 3 when s.size = 1 then 1 else 2 end::smallint as rule,
      (x.kind = 1 and x.pay_cat is not null and coalesce(x.pay_cat = all (s.cats), false)) as auto
    from cand x
    join subs s on s.sid = x.sid
    where not exists (
      select 1 from public.utility_refund_answers r
      where r.company_id = p_company and r.state = 'rejected' and r.payment_transaction_id = x.pay_id
        and r.bill_transaction_id in (select (bills[q]).id from unnest(s.ords) q)
    )
    order by s.owner, auto desc, rule, x.days_apart, s.size, x.off_by, x.pay_id
  loop
    if c.owner <> cur then
      cur := c.owner;
      taken := false;
    end if;
    continue when taken or coalesce(done[c.owner], false) or coalesce(used[c.pord], false);
    clash := false;
    foreach o in array c.ords loop
      if coalesce(done[o], false) then
        clash := true;
        exit;
      end if;
    end loop;
    continue when clash;
    used[c.pord] := true;
    foreach o in array c.ords loop
      done[o] := true;
      res_state[o] := case when c.auto then 'refunded' else 'suggested' end;
      res_rule[o] := c.rule;
      res_pay[o] := c.pay_id;
      res_owner[o] := c.owner;
    end loop;
    taken := true;
  end loop;

  return query
  with rent_months as (
    select distinct t.project_id, date_trunc('month', t.doc_date)::date as month
    from public.transactions t
    where t.company_id = p_company
      and t.direction = 'income'
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.project_id is not null
      and t.category_id = any (rent)
  ),
  r as (
    select u.id, u.project_id, u.supplier_id, u.currency, u.category_id, u.doc_date, u.amount,
      closed[u.ord] as closing, closed_pay[u.ord] as closing_pay,
      case when closed[u.ord] is null then res_state[u.ord] end as matched_state,
      case when closed[u.ord] is null then res_rule[u.ord] end as matched_rule,
      case when closed[u.ord] is null then res_pay[u.ord] end as matched_pay,
      case when closed[u.ord] is null and res_owner[u.ord] is not null then res_owner[u.ord] else -u.ord::integer end as grp,
      u.ord
    from unnest(bills) with ordinality as u(id, project_id, supplier_id, currency, category_id, doc_date, amount, ord)
  ),
  g as (
    select r.*, array_agg(r.id) over (partition by r.grp order by r.ord
      rows between unbounded preceding and unbounded following) as ids
    from r
  )
  select g.id, g.project_id, g.supplier_id, g.currency, g.category_id, g.doc_date, g.amount,
    case
      when g.closing = 'matched' then 'refunded'
      when g.closing = 'seen' then 'seen'
      when g.matched_state is not null then g.matched_state
      when p_today - g.doc_date >= 30 then 'not_refunded'
      else 'waiting'
    end,
    case when g.closing is not null then 'owner' when g.matched_state = 'refunded' then 'auto' end,
    g.matched_rule,
    coalesce(g.closing_pay, g.matched_pay),
    g.ids,
    rm.project_id is null
  from g
  left join rent_months rm on rm.project_id = g.project_id and rm.month = date_trunc('month', g.doc_date)::date
  where p_project is null or g.project_id = p_project
  order by g.ord;
end;
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
      'state', x.state, 'payment_transaction_id', x.payment_transaction_id, 'refile', x.refile,
      'keep_category', x.keep_category
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
  insert into public.utility_refund_answers (
    company_id, bill_transaction_id, state, payment_transaction_id, refile, keep_category, set_by
  )
  select p_company, p_bill, e->>'state', (e->>'payment_transaction_id')::uuid,
    case when jsonb_typeof(e->'refile') = 'object' then e->'refile' end,
    coalesce((e->>'keep_category')::boolean, false), auth.uid()
  from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) e;
end;
$$;

revoke all on function private.utility_category_ids(uuid, text, public.category_kind) from public, anon, authenticated;
revoke all on function private.utility_keys(uuid) from public, anon, authenticated;
revoke all on function private.card_generic_words() from public, anon, authenticated;
revoke all on function private.card_name_keys(text) from public, anon, authenticated;
revoke all on function private.card_name_project_of(text, jsonb) from public, anon, authenticated;
revoke all on function private.card_name_projects(uuid) from public, anon, authenticated;
revoke all on function private.utility_bills(uuid, boolean) from public, anon, authenticated;
revoke all on function private.utility_refund_rows(uuid, date, uuid) from public, anon, authenticated;
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
    with r as materialized (
      select * from private.utility_refund_rows(cid, today, p_project_id)
    ),
    paid as materialized (
      select r.bill_id, pt.id, pt.doc_date, pt.amount_original, pt.currency, pt.description, pt.project_id,
        pt.category_id, coalesce(cu.name, ps.name) as party, pc.name as category_name,
        exists (select 1 from private.split_parts x where x.transaction_id = pt.id) as split,
        exists (select 1 from private.split_parts x
                where x.transaction_id = pt.id and x.category_id = r.category_id and not x.draft) as part_in_bill,
        x.keep_category, x.refile is not null as refiled
      from r
      join public.transactions pt on pt.id = r.payment_id and pt.company_id = cid
      left join public.customers cu on cu.id = pt.customer_id and cu.company_id = cid
      left join public.suppliers ps on ps.id = pt.supplier_id and ps.company_id = cid
      left join public.categories pc on pc.id = pt.category_id and pc.company_id = cid
      left join public.utility_refund_answers x
        on x.company_id = cid and x.bill_transaction_id = r.bill_id and x.state = 'matched' and x.payment_transaction_id = pt.id
    ),
    -- A payment filed elsewhere: neither its category (unsplit) nor one of its parts is the bill's, and the
    -- owner did not keep it as it is.
    flagged as (
      select r.*, p.bill_id is not null as has_payment, p.id as pay_id, p.doc_date as pay_date,
        p.amount_original as pay_amount, p.currency as pay_currency, p.description as pay_description,
        p.party as pay_party, p.project_id as pay_project_id, p.category_id as pay_category_id,
        p.category_name as pay_category_name, coalesce(p.split, false) as pay_split,
        coalesce(p.refiled, false) as refiled,
        coalesce(p.keep_category, false) as keep_category,
        p.bill_id is not null and r.category_id is not null and not coalesce(p.keep_category, false)
          and not (p.category_id is not distinct from r.category_id and not p.split)
          and not p.part_in_bill as wrong_category
      from r
      left join paid p on p.bill_id = r.bill_id
    )
    select jsonb_agg(jsonb_build_object(
        'bill_transaction_id', f.bill_id,
        'project_id', f.project_id,
        'project_name', pr.name,
        'supplier_id', f.supplier_id,
        'supplier_name', s.name,
        'currency', f.currency,
        'category_id', f.category_id,
        'category_name', c.name,
        'amount_minor', f.amount,
        'doc_date', f.doc_date,
        'days', today - f.doc_date,
        'state', f.state,
        'source', f.source,
        'rule', case f.rule when 1 then 'bill' when 2 then 'bills' when 3 then 'rent_and_bills' end,
        'group_bill_transaction_ids', to_jsonb(f.group_ids),
        'no_rent', f.no_rent,
        'payment', case when f.has_payment then jsonb_build_object(
          'transaction_id', f.pay_id,
          'doc_date', f.pay_date,
          'amount_minor', f.pay_amount,
          'currency', f.pay_currency,
          'description', f.pay_description,
          'party', f.pay_party,
          'project_id', f.pay_project_id,
          'category_id', f.pay_category_id,
          'category_name', f.pay_category_name,
          'split', f.pay_split
        ) end,
        'wrong_category', f.wrong_category,
        'keep_category', f.keep_category,
        'refiled', f.refiled
      ) order by case f.state when 'suggested' then 0 when 'not_refunded' then 1 when 'refunded' then 2 else 3 end,
        pr.name, f.doc_date, f.bill_id)
    from flagged f
    join public.projects pr on pr.id = f.project_id and pr.company_id = cid
    left join public.suppliers s on s.id = f.supplier_id and s.company_id = cid
    left join public.categories c on c.id = f.category_id and c.company_id = cid
    -- The app's list: what asks for an answer (a suggestion, a bill not refunded) and a refund the
    -- owner matched that sits in another category (the one-tap fix). p_all (the MCP): every bill.
    where coalesce(p_all, false)
      or f.state in ('suggested', 'not_refunded')
      or (f.state = 'refunded' and f.source = 'owner' and f.wrong_category)
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
    with allbills as materialized (select * from private.utility_bills(cid, true))
    select jsonb_agg(jsonb_build_object(
        'supplier_id', k.supplier_id,
        'supplier_name', s.name,
        'currency', k.currency,
        'payer', k.payer,
        'added', k.added,
        'found', k.found,
        'usual_minor', u.usual,
        'bill_count', u.bills,
        'last_bill_date', u.last_date,
        'category_id', u.category_id,
        'category_name', (select c.name from public.categories c where c.id = u.category_id and c.company_id = cid)
      ) order by s.name, k.currency, k.supplier_id)
    from private.utility_keys(cid) k
    join public.suppliers s on s.id = k.supplier_id and s.company_id = cid
    -- The usual amount: the median of the utility's last 3 bills.
    cross join lateral (
      select (select round(percentile_cont(0.5) within group (order by l.amount))::bigint
              from (select b.amount from allbills b
                    where b.project_id = k.project_id and b.supplier_id = k.supplier_id and b.currency = k.currency
                    order by b.doc_date desc, b.id desc limit 3) l
              having count(*) > 0) as usual,
        (select count(*) from allbills b
         where b.project_id = k.project_id and b.supplier_id = k.supplier_id and b.currency = k.currency) as bills,
        (select max(b.doc_date) from allbills b
         where b.project_id = k.project_id and b.supplier_id = k.supplier_id and b.currency = k.currency) as last_date,
        -- The latest bill's category.
        (select b.category_id from allbills b
         where b.project_id = k.project_id and b.supplier_id = k.supplier_id and b.currency = k.currency
         order by b.doc_date desc, b.id desc limit 1) as category_id
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
  p_bill_transaction_id uuid, p_state text, p_payment_transaction_id uuid default null, p_today date default null,
  p_keep_category boolean default null
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
    or (p_keep_category is not null and p_state is distinct from 'matched')
  then
    raise exception 'validation';
  end if;
  if not exists (
    select 1 from private.utility_keys(cid) k
    where k.project_id = bill.project_id and k.supplier_id = bill.supplier_id and k.currency = bill.currency
  ) or bill.direction <> 'expense' or bill.doc_kind = 'credit' or bill.removed_at is not null
    or bill.line_status <> 'posted' or bill.amount_original <= 100 then
    raise exception 'not a utility bill';
  end if;
  if pay.id is not null and (
    pay.removed_at is not null or pay.currency <> bill.currency or pay.id = bill.id
    or pay.direction <> 'income'
  ) then
    raise exception 'not a refund payment';
  end if;

  perform 1 from public.utility_refund_answers x
  where x.company_id = cid and x.bill_transaction_id = bill.id
  for update;
  before := private.utility_answer_rows(cid, bill.id);
  select x.state, x.payment_transaction_id, x.refile, x.keep_category into closing
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
      insert into public.utility_refund_answers (
        company_id, bill_transaction_id, state, payment_transaction_id, keep_category, set_by
      )
      values (cid, bill.id, 'matched', pay.id, coalesce(p_keep_category, false), auth.uid());
    elsif p_keep_category is not null then
      -- The same pair: keep (להשאיר) or drop the keep.
      update public.utility_refund_answers x
      set keep_category = p_keep_category, set_by = auth.uid(), set_at = clock_timestamp()
      where x.company_id = cid and x.bill_transaction_id = bill.id and x.state = 'matched';
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
    'keep_category', (select x.keep_category from public.utility_refund_answers x
      where x.company_id = cid and x.bill_transaction_id = bill.id and x.state = 'matched'),
    'before', before,
    'after', private.utility_answer_rows(cid, bill.id)
  );
end;
$$;
revoke all on function public.answer_utility_refund(uuid, text, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.answer_utility_refund(uuid, text, uuid, date, boolean) to authenticated;
comment on function public.answer_utility_refund(uuid, text, uuid, date, boolean) is
  'FLOW-1134 (decision 0265): answer a utility bill: matched (the payment is its refund; p_keep_category keeps a payment filed elsewhere as it is), rejected (it is not; never suggested again), seen (nothing to do), or null to take the answer back (taking back a refund Flow counted by itself rejects the pair). Owner or editor.';

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

-- The one-tap fix: a refund the owner matched that sits in another category. When the payment is the
-- bills it refunds and they are of one category, it moves to that category (reassign_transaction, with
-- the bill's property). Otherwise (rent plus the bills, or bills of two categories) it is split in one call
-- (save_line_split): one part per bill category on the bill's property, and the rest, when more than one
-- unit is left, staying in the payment's own category. What it changed is kept on every answer that
-- matched the payment (refile), for undo_utility_refile.
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
  cats integer;
  parts jsonb;
  matched jsonb;
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
  -- A refund the owner keeps where it is (keep_category) is not moved, not even by a sibling's refile.
  if answer.keep_category then
    raise exception 'refund already in the bill''s category';
  end if;
  perform 1 from public.utility_refund_answers x
  where x.company_id = cid and x.state = 'matched' and x.payment_transaction_id = pay.id
  for update;
  -- The bills this payment refunds (the owner matched it to each), by category.
  select coalesce(jsonb_agg(jsonb_build_object(
      'category_id', t.category_id, 'amount', t.amount_original, 'doc_date', t.doc_date,
      'wrong', private.utility_wrong_category(cid, pay.id, t.category_id)
    ) order by t.doc_date, t.id), '[]'::jsonb)
  into matched
  from public.utility_refund_answers x
  join public.transactions t on t.id = x.bill_transaction_id and t.company_id = cid
  where x.company_id = cid and x.state = 'matched' and x.payment_transaction_id = pay.id
    and not x.keep_category and t.category_id is not null and t.project_id is not null;
  if answer.refile is not null or not exists (
    select 1 from jsonb_to_recordset(matched) r(category_id uuid, amount bigint, wrong boolean) where r.wrong
  ) then
    raise exception 'refund already in the bill''s category';
  end if;
  if bill.project_id is null then
    raise exception 'project not found';
  end if;
  if exists (select 1 from private.split_parts x where x.transaction_id = pay.id) then
    raise exception 'line has a split by category';
  end if;

  select coalesce(sum(r.amount), 0), count(distinct r.category_id) into total, cats
  from jsonb_to_recordset(matched) r(category_id uuid, amount bigint, wrong boolean);

  if pay.amount_original - total > 100 or cats > 1 then
    -- One part per bill category, in the payment's own units (the net, when it differs from the amount).
    select jsonb_agg(jsonb_build_object(
        'category_id', s.category_id, 'project_id', bill.project_id,
        'amount_minor', round(s.amount::numeric * abs(pay.amount_net) / pay.amount_original)::bigint
      ) order by s.first_seen, s.category_id)
    into parts
    from (
      select r.category_id, sum(r.amount) as amount, min(r.doc_date) as first_seen
      from jsonb_to_recordset(matched) r(category_id uuid, amount bigint, doc_date date)
      group by r.category_id
    ) s;
    part := (select sum((e->>'amount_minor')::bigint) from jsonb_array_elements(parts) e);
    if pay.amount_original - total > 100 then
      parts := parts || jsonb_build_array(jsonb_build_object('rest', true));
    elsif part <> abs(pay.amount_net) then
      -- Within one unit of the bills: the last part takes the difference, so the parts make the line.
      parts := jsonb_set(parts, array[(jsonb_array_length(parts) - 1)::text, 'amount_minor'],
        to_jsonb((parts->-1->>'amount_minor')::bigint + abs(pay.amount_net) - part));
      part := abs(pay.amount_net);
    end if;
    perform public.save_line_split(pay.id, parts, false);
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

  update public.utility_refund_answers x set refile = changed
  where x.company_id = cid and x.state = 'matched' and x.payment_transaction_id = pay.id and not x.keep_category;
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
  update public.utility_refund_answers x set refile = null
  where x.company_id = cid and x.state = 'matched' and x.payment_transaction_id = pay.id;
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
    when deadlock_detected or serialization_failure or lock_not_available or unique_violation then
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
  p_today date default null, p_keep_category boolean default null
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
    || '|' || coalesce(p_payment_transaction_id::text, 'null') || '|' || coalesce(p_today::text, 'today')
    || '|' || coalesce(p_keep_category::text, 'null');
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
    written := public.answer_utility_refund(p_bill_transaction_id, p_state, p_payment_transaction_id, p_today,
      p_keep_category);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior, created_at)
    values (token, auth.uid(), 'utility_refund', p_bill_transaction_id,
      jsonb_build_object('before', written->'before', 'after', written->'after'), clock_timestamp())
    returning id into write_id;
    response := jsonb_build_object('ok', true, 'data', (written - 'before' - 'after') || jsonb_build_object(
      'undo_kind', 'utility_refund', 'id', write_id));
  exception
    when deadlock_detected or serialization_failure or lock_not_available or unique_violation then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.utility_mcp_failure(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_answer_utility_refund(text, uuid, text, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.mcp_answer_utility_refund(text, uuid, text, uuid, date, boolean) to authenticated;

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
    when deadlock_detected or serialization_failure or lock_not_available or unique_violation then
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
    when deadlock_detected or serialization_failure or lock_not_available or unique_violation then
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
