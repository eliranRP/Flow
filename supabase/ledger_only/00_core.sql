-- ===========================================================================
-- 00 core. The legs become the only booking store (decision 0232).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A line's parts are its item legs.
-- ---------------------------------------------------------------------------
alter table public.legs
  add column split_part boolean not null default false,
  add column part_ordinal smallint,
  add column loan_id uuid,
  add column scheduled_minor bigint,
  add column needs_review boolean not null default false,
  add column draft boolean not null default false,
  add column part_percent numeric(7,4),
  add column part_rest boolean not null default false;

alter table public.legs
  add constraint legs_part_shape check (
    (not split_part or (leg_kind = 'item' and loan_id is null and part is null
                        and part_ordinal between 1 and 50))
    and (loan_id is null or (leg_kind = 'item' and part is not null and not split_part
                             and scheduled_minor >= 0 and abs(amount_minor) >= 0))
    and (loan_id is not null or (scheduled_minor is null and not needs_review))
    and (not draft or split_part or loan_id is not null)
    and (part_percent is null or (split_part and part_percent > 0 and part_percent <= 100))
    and (not part_rest or split_part)
  ),
  add constraint legs_company_id_loan_id_fkey
    foreign key (company_id, loan_id) references public.loans (company_id, id);

create index legs_loan_idx on public.legs (company_id, loan_id) where loan_id is not null;
create index legs_parts_idx on public.legs (transaction_id, company_id) where split_part or loan_id is not null;

comment on column public.legs.split_part is
  'Decision 0232. A part of a split by category (was a line_splits row). Its magnitude is abs(amount_minor); '
  'post_lines re-derives its sign, account and project on every posting.';
comment on column public.legs.part_ordinal is
  'Decision 0232. The part''s place in the split the person made (1-based), or the loan part order.';
comment on column public.legs.loan_id is
  'Decision 0232. A loan payment part (was a loan_splits row): part is interest, escrow, principal or fees.';
comment on column public.legs.scheduled_minor is
  'Decision 0232. The loan schedule''s amount for this part (loan parts only).';
comment on column public.legs.needs_review is
  'Decision 0232. A loan part a re-sync flagged (was loan_splits.needs_review). Flagged parts are draft.';
comment on column public.legs.part_percent is
  'Decision 0232. The percent the person gave for a split part (null for an exact amount).';
comment on column public.legs.part_rest is
  'Decision 0232. The split part is the rest of the line (the person gave no amount).';
comment on column public.legs.draft is
  'Decision 0232. A part kept for the person but not on the books: the split no longer matches the line, '
  'or the loan split is flagged, incomplete or carries VAT. The line then posts whole from its header. '
  'Draft legs are left out of the balance check, pnl_lines and every money read.';

-- ---------------------------------------------------------------------------
-- 2. Read views over the part legs, with the old tables' column names.
-- ---------------------------------------------------------------------------
create view private.split_parts with (security_invoker = true) as
  select l.company_id, l.transaction_id, l.part_ordinal as ordinal, l.category_id,
    case when l.project_explicit then l.project_id end as project_id,
    abs(l.amount_minor) as amount_minor, l.gross_up, l.draft, l.id as leg_id,
    l.part_percent as percent, l.part_rest as is_rest
  from public.legs l
  where l.split_part;

create view private.loan_parts with (security_invoker = true) as
  select l.company_id, l.transaction_id, l.loan_id, l.part, abs(l.amount_minor) as amount_minor,
    l.scheduled_minor, l.category_id, l.needs_review, l.draft, l.id as leg_id
  from public.legs l
  where l.loan_id is not null;

revoke all on private.split_parts, private.loan_parts from public, anon, authenticated, service_role;
grant select on private.split_parts, private.loan_parts to authenticated, service_role;

comment on view private.split_parts is
  'Decision 0232. A split line''s parts (the line_splits shape) read from its item legs. project_id is the '
  'part''s own project, null for the line''s; amount_minor is the unsigned part amount.';
comment on view private.loan_parts is
  'Decision 0232. A loan payment''s parts (the loan_splits shape) read from its item legs; amount_minor '
  'is the unsigned part amount.';

-- ---------------------------------------------------------------------------
-- 3. Posting: every leg of the lines, from the header and the part legs.
-- ---------------------------------------------------------------------------
create or replace function private.post_lines(p_company uuid, p_txns uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company is null or coalesce(cardinality(p_txns), 0) = 0 then
    return;
  end if;

  -- One statement: the CTEs read the legs before the delete, so the part legs are read, every leg of
  -- the lines is deleted, and all of them are written back with their accounts, signs and ordinals.
  with sys as (
    select
      (array_agg(id) filter (where name = 'Bank/Clearing'))[1] as bank,
      (array_agg(id) filter (where name = 'VAT control'))[1] as vat,
      (array_agg(id) filter (where name = 'Uncategorized income'))[1] as uinc,
      (array_agg(id) filter (where name = 'Uncategorized expense'))[1] as uexp
    from public.accounts
    where company_id = p_company and category_id is null
  ),
  parts as materialized (
    select l.id, l.created_at, l.transaction_id, l.category_id, l.project_id, l.project_explicit, abs(l.amount_minor) as m,
      l.gross_up, l.split_part, l.part_ordinal, l.loan_id, l.part, l.scheduled_minor, l.needs_review,
      l.part_percent, l.part_rest
    from public.legs l
    where l.company_id = p_company and l.transaction_id = any (p_txns)
      and (l.split_part or l.loan_id is not null)
  ),
  lines as materialized (
    select t.id, t.direction, t.amount_net, t.amount_gross, t.vat_amount, t.project_id, t.pnl_role,
      t.category_id, t.category_suggested, t.in_pnl_override,
      (t.removed_at is null and t.line_status = 'posted') as live,
      exists (select 1 from public.journal_entries j where j.transaction_id = t.id) as journal,
      coalesce(ln.n, 0) as loan_n, coalesce(sp.n, 0) as split_n,
      case
        when coalesce(ln.n, 0) > 0 then
          ln.n in (3, 4) and not ln.flagged and ln.s = abs(t.amount_net) and t.vat_amount = 0
        when coalesce(sp.n, 0) > 0 then
          sp.n >= 2 and sp.s = abs(t.amount_net)
        else false
      end as parts_ok
    from public.transactions t
    left join (
      select p.transaction_id, count(*) as n, sum(p.m) as s, bool_or(p.needs_review) as flagged
      from parts p where p.loan_id is not null group by p.transaction_id
    ) ln on ln.transaction_id = t.id
    left join (
      select p.transaction_id, count(*) as n,
        sum(case when p.gross_up then -p.m else p.m end) as s
      from parts p where p.split_part group by p.transaction_id
    ) sp on sp.transaction_id = t.id
    where t.company_id = p_company and t.id = any (p_txns)
  ),
  gone as (
    delete from public.legs l
    where l.company_id = p_company and l.transaction_id = any (p_txns)
    returning 1
  ),
  -- The P&L rows: the old pnl_lines_legacy branches, one per item leg.
  rows as (
    -- Loan parts.
    select x.id as transaction_id, p.category_id, x.project_id, false as project_explicit,
      case when x.direction = 'expense' then -p.m else p.m end as amount_net,
      private.line_in_pnl(null, c.excluded_from_pnl, c.loan_part) as in_pnl,
      coalesce(c.kind::text, x.direction::text) as kind, c.loan_part,
      p.part, false as gross_up, false as loan_split_fallback,
      false as split_part, p.part_ordinal, p.loan_id, p.scheduled_minor, p.needs_review,
      not (x.live and x.parts_ok) as draft, p.id as leg_id, null::numeric as part_percent, false as part_rest,
      p.created_at
    from lines x
    join parts p on p.transaction_id = x.id and p.loan_id is not null
    left join public.categories c on c.id = p.category_id
    union all
    -- Split parts.
    select x.id, p.category_id,
      case when p.project_explicit then p.project_id else x.project_id end, p.project_explicit,
      case
        when p.gross_up then
          case when coalesce(c.kind::text, x.direction::text) = 'expense' then -p.m else p.m end
          * case when coalesce(c.kind::text, x.direction::text) = x.direction::text then -1 else 1 end
        else case when x.direction = 'expense' then -p.m else p.m end
      end,
      private.line_in_pnl(x.in_pnl_override, c.excluded_from_pnl, c.loan_part),
      coalesce(c.kind::text, x.direction::text), c.loan_part,
      null::public.loan_split_part, p.gross_up, false,
      true, p.part_ordinal, null::uuid, null::bigint, false,
      not (x.live and x.parts_ok), p.id, p.part_percent, p.part_rest, p.created_at
    from lines x
    join parts p on p.transaction_id = x.id and p.split_part
    left join public.categories c on c.id = p.category_id
    union all
    -- The whole line, when it has no parts on the books.
    select x.id, x.category_id, x.project_id, false, x.amount_net,
      private.line_in_pnl(
        case when x.loan_n = 0 then x.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, x.category_suggested, c.loan_part),
        c.loan_part),
      coalesce(c.kind::text, x.direction::text), c.loan_part,
      null::public.loan_split_part, false, x.loan_n > 0,
      false, null::smallint, null::uuid, null::bigint, false,
      false, null::uuid, null::numeric, false, null::timestamptz
    from lines x
    left join public.categories c on c.id = x.category_id
    -- A journal entry on balance-sheet accounts only has no P&L amount: its counter legs are the entry.
    where x.live and not x.parts_ok and not (x.journal and x.amount_net = 0)
  ),
  entries as (
    select r.transaction_id,
      case
        when r.in_pnl and r.kind in ('income', 'expense') then
          case
            when r.category_id is not null then ba.id
            when r.kind = 'income' then sys.uinc
            else sys.uexp
          end
        else private.kept_out_account(p_company, r.category_id, r.loan_part)
      end as account_id,
      r.project_id, -r.amount_net as amount_minor,
      case when r.draft then 3 else 0 end as grp,
      r.category_id as k1, r.project_id as k2, r.amount_net as k3,
      'item' as leg_kind, r.category_id, r.part, r.gross_up, r.loan_split_fallback, r.project_explicit,
      r.split_part, r.part_ordinal, r.loan_id, r.scheduled_minor, r.needs_review, r.draft,
      r.leg_id, r.part_percent, r.part_rest, r.created_at
    from rows r
    left join public.accounts ba on ba.company_id = p_company and ba.category_id = r.category_id
    cross join sys
    union all
    -- The bank leg: the signed statement movement = amount_gross.
    select x.id, sys.bank, null, x.amount_gross, 1, null, null, null,
      'bank', null, null, false, false, false, false, null, null, null, false, false, null, null, false, null
    from lines x cross join sys
    where x.live and not x.journal
    union all
    -- A journal entry moves no money; its balance-sheet legs stand in for the bank leg.
    select j.transaction_id, j.account_id, j.project_id, j.amount_minor, 1, null, null, j.ordinal::bigint,
      'journal', null, null, false, false, false, false, null, null, null, false, false, null, null, false, null
    from public.journal_counter_legs j
    join lines x on x.id = j.transaction_id and x.live
    where j.company_id = p_company
    union all
    -- VAT is one more leg so the net + VAT legs balance the gross bank movement.
    select x.id, sys.vat, null, -x.vat_amount, 2, null, null, null,
      'vat', null, null, false, false, false, false, null, null, null, false, false, null, null, false, null
    from lines x cross join sys
    where x.live and coalesce(x.vat_amount, 0) <> 0
  )
  -- A part leg keeps its id and its created_at across postings, so a snapshot that names it (a category
  -- move) still finds it, and an undo that checks when the parts were written still matches.
  insert into public.legs (id, created_at, company_id, transaction_id, account_id, project_id, amount_minor, ordinal,
    leg_kind, category_id, part, gross_up, loan_split_fallback, project_explicit,
    split_part, part_ordinal, loan_id, scheduled_minor, needs_review, draft, part_percent, part_rest)
  select coalesce(e.leg_id, gen_random_uuid()), coalesce(e.created_at, now()), p_company, e.transaction_id, e.account_id, e.project_id, e.amount_minor,
    (row_number() over (partition by e.transaction_id
                        order by e.grp, e.k1 nulls first, e.k2 nulls first, e.k3, e.part_ordinal))::smallint,
    e.leg_kind, e.category_id, e.part, e.gross_up, e.loan_split_fallback, e.project_explicit,
    e.split_part, e.part_ordinal, e.loan_id, e.scheduled_minor, e.needs_review, e.draft,
    e.part_percent, e.part_rest
  from entries e
  where (select count(*) from gone) >= 0;
end;
$$;

revoke all on function private.post_lines(uuid, uuid[]) from public, anon, authenticated, service_role;

comment on function private.post_lines(uuid, uuid[]) is
  'Decision 0232. Posts the lines: keeps each line''s part legs (re-deriving their sign, account, project '
  'and draft flag), and rebuilds the bank, VAT, journal and whole-line legs. Replaces rebuild_legs_many.';

-- ---------------------------------------------------------------------------
-- 4. The writer API. Nothing else writes part legs.
-- ---------------------------------------------------------------------------
create or replace function private.part_line_lock(p_company uuid, p_txn uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.transactions t
  where t.id = p_txn and t.company_id = p_company
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  if exists (select 1 from public.journal_entries j where j.transaction_id = p_txn)
    and coalesce(current_setting('flow.journal_entry', true), '') <> 'on'
  then
    raise exception 'journal entry is fixed' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.part_line_lock(uuid, uuid) from public, anon, authenticated, service_role;

-- Replace a line's split by category. p_parts: [{category_id, project_id, amount_minor, gross_up,
-- percent, is_rest}],
-- in the person's order; null or [] clears the split.
create or replace function private.set_line_parts(p_company uuid, p_txn uuid, p_parts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := coalesce(jsonb_array_length(case when jsonb_typeof(p_parts) = 'array' then p_parts end), 0);
begin
  perform private.part_line_lock(p_company, p_txn);
  if n > 0 and exists (
    select 1 from public.legs l
    where l.company_id = p_company and l.transaction_id = p_txn and l.loan_id is not null
  ) then
    raise exception 'line has a loan split' using errcode = '23514';
  end if;
  if n > 50 then
    raise exception 'too many parts' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) e
    where coalesce((e->>'amount_minor')::bigint, 0) <= 0
  ) then
    raise exception 'part amount must be above zero' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) e
    where not exists (
      select 1 from public.categories c
      where c.company_id = p_company and c.id = (e->>'category_id')::uuid
    )
    or (e->>'project_id' is not null and not exists (
      select 1 from public.projects pr
      where pr.company_id = p_company and pr.id = (e->>'project_id')::uuid
    ))
  ) then
    raise exception 'category or project not found' using errcode = '23503';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) e
    group by (e->>'category_id'), (e->>'project_id'), coalesce((e->>'gross_up')::boolean, false)
    having count(*) > 1
  ) then
    raise exception 'duplicate part' using errcode = '23505';
  end if;

  delete from public.legs l
  where l.company_id = p_company and l.transaction_id = p_txn and l.split_part;

  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal,
    leg_kind, category_id, gross_up, project_explicit, split_part, part_ordinal, draft, part_percent, part_rest)
  select p_company, p_txn, a.id, (e->>'project_id')::uuid, (e->>'amount_minor')::bigint, x.ord::smallint,
    'item', (e->>'category_id')::uuid, coalesce((e->>'gross_up')::boolean, false),
    e->>'project_id' is not null, true, x.ord::smallint, true,
    (e->>'percent')::numeric, coalesce((e->>'is_rest')::boolean, false)
  from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) with ordinality as x(e, ord)
  join public.accounts a on a.company_id = p_company and a.category_id = (x.e->>'category_id')::uuid;

  perform private.post_lines(p_company, array[p_txn]);
  perform private.line_split_review_sync(p_txn);
  if exists (select 1 from public.tag_suggestions s where s.company_id = p_company and s.transaction_id = p_txn) then
    perform private.jev_outcome_sync(p_company, p_txn);
  end if;
end;
$$;

revoke all on function private.set_line_parts(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

comment on function private.set_line_parts(uuid, uuid, jsonb) is
  'Decision 0232. Replaces a line''s split by category with p_parts ([{category_id, project_id, '
  'amount_minor, gross_up}], in order; null or [] clears it) and posts the line.';

-- The loan payment rules (were the loan_splits triggers): parts, categories, currency, sum, balance.
create or replace function private.loan_parts_check(txn uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  parts integer;
  loan_count integer;
  actual bigint;
  stale boolean;
  loan uuid;
  core_parts integer;
  empty_fees integer;
  expected bigint;
begin
  select count(*)::integer,
         count(distinct s.loan_id)::integer,
         coalesce(sum(s.amount_minor), 0),
         bool_and(s.needs_review),
         count(*) filter (where s.part::text in ('interest', 'escrow', 'principal'))::integer,
         count(*) filter (where s.part::text = 'fees' and s.amount_minor <= 0)::integer
  into parts, loan_count, actual, stale, core_parts, empty_fees
  from private.loan_parts s
  where s.transaction_id = txn;
  if parts = 0 then
    return;
  end if;
  if parts not in (3, 4) or core_parts <> 3 or empty_fees <> 0 or loan_count <> 1 then
    raise exception 'loan_split_incomplete' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.transactions t
    where t.id = txn and t.direction = 'income'::public.txn_direction
  ) then
    raise exception 'loan_split_income' using errcode = '23514';
  end if;
  perform 1
  from public.categories c
  where c.id in (select s.category_id from private.loan_parts s where s.transaction_id = txn)
  for share;
  if exists (
    select 1 from private.loan_parts s
    where s.transaction_id = txn
      and not private.loan_part_category_ok(s.company_id, s.part, s.category_id)
  ) then
    raise exception 'loan_split_category' using errcode = '23514';
  end if;
  -- Only a re-sync flags the parts; the sum and the currency wait for the review.
  if coalesce(stale, false) then
    return;
  end if;
  if exists (
    select 1
    from private.loan_parts s
    join public.loans l on l.company_id = s.company_id and l.id = s.loan_id
    join public.transactions t on t.company_id = s.company_id and t.id = s.transaction_id
    where s.transaction_id = txn
      and t.currency is distinct from l.currency
  ) then
    raise exception 'loan_split_currency' using errcode = '23514';
  end if;
  select t.amount_original into expected from public.transactions t where t.id = txn;
  if actual is distinct from expected then
    raise exception 'loan_split_sum' using errcode = '23514';
  end if;
  select s.loan_id into loan from private.loan_parts s where s.transaction_id = txn limit 1;
  perform 1 from public.transactions t where t.id = txn for share;
  perform 1 from public.loans l where l.id = loan for no key update;
  if exists (
    select 1 from public.loans l
    where l.id = loan and l.principal_minor < private.loan_paid_principal(l.id)
  ) then
    raise exception 'loan_split_balance' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.loan_parts_check(uuid) from public, anon, authenticated, service_role;

-- A part on a loan closed before the line's date is refused (was loan_splits_closed_check).
create or replace function private.loan_parts_closed_check(p_company uuid, p_txn uuid, p_loan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_status public.loan_status;
  loan_closed_on date;
begin
  select l.status, l.closed_on
  into cur_status, loan_closed_on
  from public.loans l
  where l.company_id = p_company and l.id = p_loan
  for no key update;
  if cur_status is distinct from 'open'::public.loan_status
     and exists (
       select 1 from public.transactions t
       where t.company_id = p_company and t.id = p_txn and t.doc_date > loan_closed_on
     )
  then
    raise exception 'loan_closed' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.loan_parts_closed_check(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Replace a line's loan payment parts. p_parts: [{part, amount_minor, scheduled_minor, category_id,
-- needs_review}]; null or [] clears them.
create or replace function private.set_loan_parts(p_company uuid, p_txn uuid, p_loan uuid, p_parts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := coalesce(jsonb_array_length(case when jsonb_typeof(p_parts) = 'array' then p_parts end), 0);
begin
  perform private.part_line_lock(p_company, p_txn);
  if n > 0 then
    if exists (
      select 1 from public.legs l
      where l.company_id = p_company and l.transaction_id = p_txn and l.split_part
    ) then
      raise exception 'line has a split by category' using errcode = '23514';
    end if;
    if not exists (select 1 from public.loans l where l.company_id = p_company and l.id = p_loan) then
      raise exception 'loan not found' using errcode = '23503';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_parts) e
      where not exists (
        select 1 from public.categories c
        where c.company_id = p_company and c.id = (e->>'category_id')::uuid
      )
    ) then
      raise exception 'category not found' using errcode = '23503';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_parts) e
      group by e->>'part' having count(*) > 1
    ) then
      raise exception 'duplicate key value violates unique constraint "loan_splits_transaction_id_part_key"'
        using errcode = '23505';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_parts) e
      where coalesce((e->>'amount_minor')::bigint, -1) < 0
         or coalesce((e->>'scheduled_minor')::bigint, (e->>'amount_minor')::bigint, -1) < 0
    ) then
      raise exception 'loan part amount below zero' using errcode = '23514';
    end if;
  end if;

  delete from public.legs l
  where l.company_id = p_company and l.transaction_id = p_txn and l.loan_id is not null;

  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal,
    leg_kind, category_id, part, loan_id, scheduled_minor, needs_review, part_ordinal, draft)
  select p_company, p_txn, a.id, null, (e->>'amount_minor')::bigint, 1,
    'item', (e->>'category_id')::uuid, (e->>'part')::public.loan_split_part, p_loan,
    coalesce((e->>'scheduled_minor')::bigint, (e->>'amount_minor')::bigint),
    coalesce((e->>'needs_review')::boolean, false),
    case e->>'part' when 'interest' then 1 when 'escrow' then 2 when 'principal' then 3 else 4 end,
    true
  from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) e
  join public.accounts a on a.company_id = p_company and a.category_id = (e->>'category_id')::uuid;

  if n > 0 and exists (
    select 1 from jsonb_array_elements(p_parts) e where not coalesce((e->>'needs_review')::boolean, false)
  ) then
    perform private.loan_parts_closed_check(p_company, p_txn, p_loan);
  end if;
  perform private.post_lines(p_company, array[p_txn]);
  perform private.loan_parts_check(p_txn);
  if exists (select 1 from public.tag_suggestions s where s.company_id = p_company and s.transaction_id = p_txn) then
    perform private.jev_outcome_sync(p_company, p_txn);
  end if;
end;
$$;

revoke all on function private.set_loan_parts(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

comment on function private.set_loan_parts(uuid, uuid, uuid, jsonb) is
  'Decision 0232. Replaces a line''s loan payment parts with p_parts ([{part, amount_minor, '
  'scheduled_minor, category_id, needs_review}]; null or [] clears them), checks the loan rules and posts '
  'the line.';

-- Flag or clear the line's loan parts. Clearing re-checks the closed loan and the loan rules.
create or replace function private.set_loan_parts_review(p_company uuid, p_txn uuid, p_needs_review boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  loan uuid;
begin
  update public.legs l
  set needs_review = p_needs_review
  where l.company_id = p_company and l.transaction_id = p_txn and l.loan_id is not null
    and l.needs_review is distinct from p_needs_review;
  get diagnostics changed = row_count;
  if changed = 0 then
    return false;
  end if;
  if not p_needs_review then
    select l.loan_id into loan from public.legs l
    where l.company_id = p_company and l.transaction_id = p_txn and l.loan_id is not null
    limit 1;
    perform private.loan_parts_closed_check(p_company, p_txn, loan);
  end if;
  perform private.post_lines(p_company, array[p_txn]);
  if not p_needs_review then
    perform private.loan_parts_check(p_txn);
  end if;
  return true;
end;
$$;

revoke all on function private.set_loan_parts_review(uuid, uuid, boolean) from public, anon, authenticated, service_role;

comment on function private.set_loan_parts_review(uuid, uuid, boolean) is
  'Decision 0232. Flags (true) or clears (false) the line''s loan parts and posts the line; returns '
  'whether anything changed. Clearing re-checks the closed loan and the loan rules.';

-- ---------------------------------------------------------------------------
-- 5. Loan reads over the part legs.
-- ---------------------------------------------------------------------------
create or replace function private.loan_paid_principal(p_loan_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(s.amount_minor), 0)::bigint
  from private.loan_parts s
  join public.transactions t on t.company_id = s.company_id and t.id = s.transaction_id
  where s.loan_id = p_loan_id
    and s.part = 'principal'::public.loan_split_part
    and t.line_status = 'posted'::public.line_status
    and t.removed_at is null
    and s.needs_review is not true;
$$;

create or replace view public.loan_balances with (security_invoker = true) as
  select l.company_id, l.id as loan_id, l.currency,
    (l.principal_minor::numeric - coalesce(sum(s.amount_minor) filter (
      where s.part = 'principal'::public.loan_split_part and t.line_status = 'posted'::public.line_status
        and t.removed_at is null and s.needs_review is not true), 0::numeric))::bigint as balance_minor,
    count(*) filter (
      where s.needs_review and t.removed_at is null and t.line_status is distinct from 'void'::public.line_status
    )::integer as flagged_parts
  from public.loans l
  left join private.loan_parts s on s.company_id = l.company_id and s.loan_id = l.id
  left join public.transactions t on t.company_id = s.company_id and t.id = s.transaction_id
  group by l.company_id, l.id, l.currency, l.principal_minor;

-- A re-sync that changes a loan line's amount or currency flags its parts.
create or replace function private.loan_splits_mark_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount_original is distinct from old.amount_original
     or new.currency is distinct from old.currency
  then
    perform private.set_loan_parts_review(new.company_id, new.id, true);
  end if;
  return null;
end;
$$;

-- A loan line restored or posted again: its principal may not pass the loan's.
create or replace function private.loan_line_counts_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan uuid;
begin
  select s.loan_id into loan
  from private.loan_parts s
  where s.company_id = new.company_id and s.transaction_id = new.id
    and s.part = 'principal'::public.loan_split_part and s.needs_review is not true
  limit 1;
  if loan is null then
    return null;
  end if;
  -- Never wait here: the sync already holds row locks on other lines, and the MCP
  -- attach locks the loan before the line, so waiting can deadlock the whole sync.
  perform 1 from public.loans l where l.id = loan for no key update skip locked;
  if not found then
    perform private.set_loan_parts_review(new.company_id, new.id, true);
    return null;
  end if;
  if exists (
    select 1 from public.loans l
    where l.id = loan and l.principal_minor < private.loan_paid_principal(l.id)
  ) then
    perform private.set_loan_parts_review(new.company_id, new.id, true);
  end if;
  return null;
end;
$$;

-- A loan line dated after its loan closed is flagged.
create or replace function private.loan_line_closed_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan uuid;
  cur_status public.loan_status;
  loan_closed_on date;
begin
  select s.loan_id into loan
  from private.loan_parts s
  where s.company_id = new.company_id and s.transaction_id = new.id and s.needs_review is not true
  limit 1;
  if loan is null then
    return null;
  end if;
  select l.status into cur_status from public.loans l where l.id = loan;
  if cur_status = 'open'::public.loan_status then
    return null;
  end if;
  select l.status, l.closed_on into cur_status, loan_closed_on
  from public.loans l
  where l.id = loan
  for no key update skip locked;
  if not found
     or (cur_status <> 'open'::public.loan_status and new.doc_date > loan_closed_on)
  then
    perform private.set_loan_parts_review(new.company_id, new.id, true);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The posting triggers call post_lines.
-- ---------------------------------------------------------------------------
create or replace function private.legs_sync_txn_upd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select n.company_id, array_agg(distinct n.id) as txns
    from newtab n
    join oldtab o on o.id = n.id
    where (n.amount_net, n.amount_gross, n.vat_amount, n.direction, n.category_id, n.category_suggested,
           n.project_id, n.in_pnl_override, n.line_status, n.removed_at, n.company_id)
      is distinct from
          (o.amount_net, o.amount_gross, o.vat_amount, o.direction, o.category_id, o.category_suggested,
           o.project_id, o.in_pnl_override, o.line_status, o.removed_at, o.company_id)
    group by n.company_id
  loop
    perform private.post_lines(r.company_id, r.txns);
  end loop;
  return null;
end;
$$;

create or replace function private.legs_sync_txn_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select n.company_id, array_agg(distinct n.id) as txns from newtab n group by n.company_id loop
    perform private.post_lines(r.company_id, r.txns);
  end loop;
  return null;
end;
$$;

create or replace function private.legs_category_sync_tg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounts a
  set name = new.name,
      type = new.kind::text,
      loan_part = new.loan_part,
      excluded_from_pnl = coalesce(new.excluded_from_pnl, false)
  where a.company_id = new.company_id and a.category_id = new.id
    and (a.name, a.type, a.loan_part, a.excluded_from_pnl)
      is distinct from (new.name, new.kind::text, new.loan_part, coalesce(new.excluded_from_pnl, false));
  if new.kind is distinct from old.kind
    or new.excluded_from_pnl is distinct from old.excluded_from_pnl
    or new.loan_part is distinct from old.loan_part
    or new.ledger_account_id is distinct from old.ledger_account_id
  then
    perform private.post_lines(new.company_id, array(
      select t.id from public.transactions t
      where t.company_id = new.company_id and t.category_id = new.id
      union
      select l.transaction_id from public.legs l
      where l.company_id = new.company_id and l.category_id = new.id
        and (l.split_part or l.loan_id is not null)
    ));
  end if;
  return null;
end;
$$;

-- Draft legs are not on the books: the balance check reads the others.
create or replace function private.legs_balance_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  tid uuid;
  total bigint;
  banks integer;
  legcount integer;
begin
  if tg_op = 'DELETE' then
    cid := old.company_id; tid := old.transaction_id;
  else
    cid := new.company_id; tid := new.transaction_id;
  end if;
  select count(*), coalesce(sum(l.amount_minor), 0),
    count(*) filter (where a.is_bank)
  into legcount, total, banks
  from public.legs l
  join public.accounts a on a.id = l.account_id
  where l.company_id = cid and l.transaction_id = tid and not l.draft;
  if legcount = 0 then
    return null;
  end if;
  if total <> 0 then
    raise exception 'legs do not balance for transaction %: sum=%', tid, total;
  end if;
  if banks <> 1 and not (
    banks = 0 and exists (select 1 from public.journal_entries j where j.transaction_id = tid)
  ) then
    raise exception 'transaction % must have exactly one bank leg, has %', tid, banks;
  end if;
  return null;
end;
$$;

-- The P&L view reads the legs on the books only.
create or replace view private.pnl_lines with (security_invoker = true) as
 SELECT t.company_id,
    t.id AS transaction_id,
        CASE
            WHEN l.project_explicit THEN l.project_id
            ELSE t.project_id
        END AS project_id,
        CASE
            WHEN COALESCE(c.kind::text, t.direction::text) = 'expense'::text AND l.project_explicit AND l.project_id = co.overhead_project_id THEN 'overhead'::pnl_role
            WHEN COALESCE(c.kind::text, t.direction::text) = 'expense'::text AND l.project_explicit THEN 'project'::pnl_role
            WHEN COALESCE(c.kind::text, t.direction::text) = 'expense'::text AND t.pnl_role = 'project'::pnl_role AND t.project_id IS NOT NULL AND t.project_id = co.overhead_project_id THEN 'overhead'::pnl_role
            ELSE t.pnl_role
        END AS pnl_role,
    t.direction,
    t.doc_kind,
    t.doc_date,
    t.cash_date,
    COALESCE(t.currency, 'ILS'::text) AS currency,
    l.category_id,
    l.part,
    - l.amount_minor AS amount_net,
    t.amount_net AS line_amount_net,
    a.type = ANY (ARRAY['income'::text, 'expense'::text]) AS in_pnl,
    l.loan_split_fallback,
        CASE
            WHEN COALESCE(c.kind::text, t.direction::text) = 'income'::text THEN
            CASE
                WHEN l.project_explicit THEN l.project_id
                ELSE t.project_id
            END IS NULL
            WHEN l.project_explicit THEN false
            ELSE t.pnl_role IS NULL OR t.pnl_role = 'project'::pnl_role AND t.project_id IS NULL OR t.pnl_role = 'shared'::pnl_role AND NOT (EXISTS ( SELECT 1
               FROM allocations x
              WHERE x.transaction_id = t.id))
        END AS unassigned,
    COALESCE(c.kind::text, t.direction::text) AS kind,
    private.line_unpaid(t.direction, t.doc_kind, t.cash_date) AS unpaid,
    l.gross_up
   FROM transactions t
     CROSS JOIN LATERAL ( SELECT x.account_id,
            x.project_id,
            x.project_explicit,
            x.category_id,
            x.part,
            x.amount_minor,
            x.loan_split_fallback,
            x.gross_up
           FROM legs x
          WHERE x.company_id = t.company_id AND x.transaction_id = t.id AND x.leg_kind = 'item'::text
            AND NOT x.draft
         OFFSET 0) l
     JOIN accounts a ON a.company_id = t.company_id AND a.id = l.account_id
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN companies co ON co.id = t.company_id
  WHERE t.removed_at IS NULL AND t.line_status = 'posted'::line_status;
