-- FLOW-153 + FLOW-152. Decision 0232: the ledger is the only booking model, and the chart of accounts is open.
--
--   1. A line's parts are its item legs. public.legs gains split_part, part_ordinal, loan_id, scheduled_minor,
--      needs_review and draft. A part that no longer matches its line stays as a draft leg (not on the
--      books) and the line posts whole from its header, as the old fallback did.
--   2. private.post_lines posts lines (replaces rebuild_legs_many); private.set_line_parts,
--      set_loan_parts and set_loan_parts_review are the only writers of parts and run the split and loan
--      rules; private.split_parts and private.loan_parts read the parts back in the old tables' shape.
--   3. Every function that read or wrote line_splits / loan_splits is rewritten onto the legs. Public
--      RPCs keep their names, arguments, refusals and return shapes.
--   4. FLOW-152: accounts gain is_system, archived_at, description and an equity type (Owner capital);
--      MCP create/update/archive/restore/merge_account, balance-sheet-only journal entries,
--      get_balance_sheet.
--   5. The gate: every company's legs and P&L rows are snapshotted, the parts move into the legs, every
--      line is posted again, and the migration aborts if one leg or P&L row differs. Then line_splits,
--      loan_splits, pnl_lines_legacy, ledger_pnl_diff and rebuild_legs_many are dropped, and the
--      migration aborts if any function still names them.
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

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
  -- The P&L rows, one per item leg: loan parts, split parts, or the whole line (decision 0209's rules).
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

-- ===========================================================================
-- 10 line splits: the split-by-category functions read and write the parts through the legs.
-- ===========================================================================

CREATE OR REPLACE FUNCTION private.line_has_loose_reversal(p_transaction_id uuid, p_parts jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with parts as (
    select s.category_id, s.project_id
    from private.split_parts s
    where p_parts is null and s.transaction_id = p_transaction_id
    union all
    select (b->>'category_id')::uuid, (b->>'project_id')::uuid
    from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) b
    where p_parts is not null
  )
  select exists (
    select 1
    from parts s
    join public.transactions t on t.id = p_transaction_id
    join public.categories pc on pc.id = s.category_id and pc.company_id = t.company_id
    left join public.categories lc on lc.id = t.category_id and lc.company_id = t.company_id
    where s.project_id is null
      and s.category_id is distinct from t.category_id
      and pc.kind::text is distinct from coalesce(lc.kind::text, t.direction::text)
  );
$function$;

CREATE OR REPLACE FUNCTION private.line_pnl_state(p_transaction_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when t.line_status = 'posted' then coalesce(
      -- The parts on this project and category, when the caller names them. A shared line's
      -- parts sit on the line's own project, so they match the category alone.
      (
        select case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end
        from private.pnl_lines pl
        where pl.transaction_id = t.id
          and (p_project_id is not null or p_category_id is not null)
          and (p_project_id is null or pl.project_id = p_project_id or pl.pnl_role = 'shared')
          and (p_category_id is null or pl.category_id = p_category_id)
        having count(*) > 0
      ),
      -- Every part of the line.
      (
        select case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end
        from private.pnl_lines pl
        where pl.transaction_id = t.id
        having count(*) > 0
      ),
      pending.state
    )
    else pending.state
  end
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
  cross join lateral (
    select case when private.line_in_pnl(
      case when not exists (
        select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ) then 'in' else 'out' end as state
  ) pending
  where t.id = p_transaction_id
    -- Definer, so the reads skip row security, which kept the planner off the line's own index
    -- (11 ms a line on a 3,600-line company). The caller still sees only its own company.
    and (auth.role() = 'service_role' or t.company_id = private.readable_company_id());
$function$;

CREATE OR REPLACE FUNCTION private.line_pnl_states(p_ids uuid[], p_project_id uuid, p_category_id uuid)
 RETURNS TABLE(transaction_id uuid, state text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    with parts as (
      select pl.transaction_id,
        case
          when count(*) filter (where scoped.on_it) = 0 then null
          when bool_and(pl.in_pnl) filter (where scoped.on_it) then 'in'
          when not bool_or(pl.in_pnl) filter (where scoped.on_it) then 'out'
          else 'mixed'
        end as scoped_state,
        case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end as state
      from private.pnl_lines pl
      cross join lateral (
        select ($2 is not null or $3 is not null)
          and ($2 is null or pl.project_id = $2 or pl.pnl_role = 'shared')
          and ($3 is null or pl.category_id = $3) as on_it
      ) scoped
      where pl.transaction_id = any($1)
      group by pl.transaction_id
    ),
    states as (
      select coalesce(jsonb_object_agg(p.transaction_id, coalesce(p.scoped_state, p.state)), '{}'::jsonb) as map
      from parts p
    )
    select t.id,
      case
        when t.line_status = 'posted' then coalesce((select s.map from states s) ->> t.id::text, pending.state)
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
    cross join lateral (
      select case when private.line_in_pnl(
        case when not exists (
          select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
        ) then t.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
        c.loan_part
      ) then 'in' else 'out' end as state
    ) pending
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids, p_project_id, p_category_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.line_pnl_states(p_ids uuid[])
 RETURNS TABLE(transaction_id uuid, state text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    select t.id,
      case
        when t.line_status = 'posted' then coalesce(
          (
            select coalesce(jsonb_object_agg(parts.transaction_id, parts.state), '{}'::jsonb)
            from (
              select pl.transaction_id,
                case
                  when bool_and(pl.in_pnl) then 'in'
                  when not bool_or(pl.in_pnl) then 'out'
                  else 'mixed'
                end as state
              from private.pnl_lines pl
              where pl.transaction_id = any($1)
              group by pl.transaction_id
            ) parts
          ) ->> t.id::text,
          pending.state
        )
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
    cross join lateral (
      select case when private.line_in_pnl(
        case when not exists (
          select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
        ) then t.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
        c.loan_part
      ) then 'in' else 'out' end as state
    ) pending
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids;
end;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_parts(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', s.category_id,
    'project_id', s.project_id,
    'amount_minor', s.amount_minor,
    'gross_up', s.gross_up
  ) order by s.ordinal), '[]'::jsonb)
  from private.split_parts s
  where s.transaction_id = p_transaction_id;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_parts_full(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', s.category_id,
    'project_id', s.project_id,
    'amount_minor', s.amount_minor,
    'percent', s.percent,
    'is_rest', s.is_rest,
    'gross_up', s.gross_up
  ) order by s.ordinal), '[]'::jsonb)
  from private.split_parts s
  where s.transaction_id = p_transaction_id;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_review_sync(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line record;
  parts integer;
  parts_minor bigint;
  mismatch boolean;
begin
  select t.company_id, t.amount_net, t.removed_at, t.line_status
  into line
  from public.transactions t
  where t.id = p_transaction_id;
  if not found then
    return;
  end if;

  select count(*)::integer,
    coalesce(sum(case when s.gross_up then -s.amount_minor else s.amount_minor end), 0)
  into parts, parts_minor
  from private.split_parts s
  where s.transaction_id = p_transaction_id;

  mismatch := parts > 0
    and parts_minor <> abs(line.amount_net)
    and line.removed_at is null
    and line.line_status = 'posted'::public.line_status;

  if mismatch then
    insert into public.review_queue (company_id, transaction_id, status, reason)
    select line.company_id, p_transaction_id, 'open', 'split_mismatch'
    where not exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_transaction_id and q.status = 'open'
    );
  else
    delete from public.review_queue q
    where q.transaction_id = p_transaction_id
      and q.company_id = line.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_valid(p_transaction_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select count(*) >= 2
    and sum(case when s.gross_up then -s.amount_minor else s.amount_minor end)
      = (select abs(t.amount_net) from public.transactions t where t.id = p_transaction_id)
  from private.split_parts s
  where s.transaction_id = p_transaction_id;
$function$;

CREATE OR REPLACE FUNCTION private.review_queue_line_split_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.transaction_id is null
    or not exists (select 1 from private.split_parts s where s.transaction_id = old.transaction_id)
  then
    return null;
  end if;
  if old.status = 'open'
    and old.reason is distinct from 'split_mismatch'
    and (tg_op = 'DELETE' or new.status is distinct from 'open')
  then
    perform private.line_split_review_sync(old.transaction_id);
  elsif tg_op = 'UPDATE'
    and new.status = 'open'
    and old.status is distinct from 'open'
    and new.reason = 'split_mismatch'
  then
    perform private.line_split_review_sync(new.transaction_id);
  elsif tg_op = 'UPDATE'
    and new.status = 'open'
    and old.status is distinct from 'open'
    and new.reason is distinct from 'split_mismatch'
  then
    -- Another review came back (undo of a skip): it holds the line again, one open review.
    delete from public.review_queue q
    where q.transaction_id = new.transaction_id
      and q.company_id = new.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.transactions_line_split_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from private.split_parts s where s.transaction_id = new.id) then
    perform private.line_split_review_sync(new.id);
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_line_split(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'transaction_id', t.id,
    'currency', coalesce(t.currency, 'ILS'),
    'line_minor', abs(t.amount_net),
    'parts', coalesce((
      select jsonb_agg((jsonb_build_object(
        'category_id', s.category_id,
        'category_name', c.name,
        'project_id', s.project_id,
        'project_name', p.name,
        'amount_minor', s.amount_minor,
        'percent', s.percent,
        'rest', s.is_rest,
        'gross_up', s.gross_up
      ) || case when s.gross_up then jsonb_build_object(
        'effect', case when c.kind::text = t.direction::text then 'contra' else 'normal' end
      ) else '{}'::jsonb end) order by s.ordinal)
      from private.split_parts s
      join public.categories c on c.id = s.category_id
      left join public.projects p on p.id = s.project_id
      where s.transaction_id = t.id
    ), '[]'::jsonb),
    'parts_match', coalesce((
      select count(*) >= 2
        and sum(case when s.gross_up then -s.amount_minor else s.amount_minor end) = abs(t.amount_net)
      from private.split_parts s
      where s.transaction_id = t.id
      having count(*) > 0
    ), true)
  )
  from public.transactions t
  where t.id = p_transaction_id
    and t.removed_at is null
    and t.company_id = (select private.readable_company_id());
$function$;

CREATE OR REPLACE FUNCTION public.set_transaction_pnl(p_id uuid, p_in_pnl boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  line record;
begin
  -- The owner's own company comes first, so an owner who is also listed as a viewer is not refused.
  cid := private.current_company_id();
  if cid is null then
    if exists (
      select 1 where private.is_read_only()
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select t.id, c.loan_part,
    private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part) as excluded_from_pnl
  into line
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update of t;
  if not found then
    raise exception 'transaction not found';
  end if;
  if line.loan_part is not null
    or exists (select 1 from private.loan_parts s where s.transaction_id = p_id and s.company_id = cid)
  then
    raise exception 'loan line is fixed';
  end if;
  if p_in_pnl is true and private.line_has_loose_reversal(p_id) then
    raise exception 'a reversal part needs a project';
  end if;
  update public.transactions
  set in_pnl_override = p_in_pnl
  where id = p_id and company_id = cid;
  return jsonb_build_object(
    'id', p_id,
    'in_pnl_override', p_in_pnl,
    'in_pnl', private.line_in_pnl(p_in_pnl, line.excluded_from_pnl, null)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_assign_expense(p_idempotency_key text, p_transaction_id uuid, p_project_id uuid, p_category_id uuid, p_remember boolean DEFAULT false, p_unshare boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  review uuid;
  outcome jsonb;
  undo_id uuid;
  response jsonb;
  locked boolean;
  line record;
  shared boolean := false;
  category uuid := p_category_id;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or (p_category_id is null and not coalesce(p_unshare, false))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  -- Without unshare the hash is the one before FLOW-150, so a replay of an earlier key still matches.
  hash := 'assign|' || p_transaction_id::text || '|' || coalesce(p_project_id::text, '') || '|'
    || coalesce(p_category_id::text, '') || '|' || coalesce(p_remember, false)::text
    || case when coalesce(p_unshare, false) then '|unshare' else '' end;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Lock the line before the review so assign and category share one order.
    select t.category_id, t.pnl_role into line
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;
    locked := found;

    if locked and coalesce(p_unshare, false) then
      shared := line.pnl_role is not distinct from 'shared'::public.pnl_role or exists (
        select 1 from public.review_queue q
        where q.transaction_id = p_transaction_id and q.company_id = cid
          and q.status = 'open' and q.reason = 'unallocated_shared'
      );
      -- The line keeps its category unless a new one is given.
      category := coalesce(p_category_id, line.category_id);
    end if;

    if exists (
      select 1
      from public.review_queue q
      where q.id = p_transaction_id
        and q.company_id = cid
    ) and not locked then
      response := private.mcp_error(
        'validation',
        'id is not a transaction; list_review.id is the review id'
      );
    elsif not locked then
      response := private.mcp_refused('transaction not found');
    elsif category is null then
      response := private.mcp_refused('category is required');
    elsif shared and p_project_id is null then
      response := private.mcp_error('validation', 'validation');
    elsif shared and exists (
      select 1 from private.split_parts s where s.transaction_id = p_transaction_id and s.company_id = cid
    ) then
      -- A split line's parts carry their own shares: split_line moves them.
      response := private.mcp_refused('line has a split by category');
    elsif shared then
      -- FLOW-150: the shares go and the whole line goes to the one project. reassign_transaction keeps
      -- the shares and the shared role in its undo row, and resolves an open review as changed.
      if not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid) then
        response := private.mcp_refused('project or category not found');
      else
        perform set_config('flow.unshare', 'on', true);
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, category);
        perform set_config('flow.unshare', '', true);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
        if response->>'ok' = 'true' then
          response := jsonb_set(response, '{data,unshared}', 'true'::jsonb);
        end if;
      end if;
    else
      if p_project_id is null and not exists (
        select 1
        from public.categories c
        where c.id = category
          and c.company_id = cid
          and c.kind = 'income'
          and c.excluded_from_pnl
      ) then
        response := private.mcp_error('validation', 'validation');
      elsif p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        response := private.mcp_refused('project or category not found');
      else
      select q.id into review
      from public.review_queue q
      where q.transaction_id = p_transaction_id
        and q.company_id = cid
        and q.status = 'open'
      order by q.created_at desc
      limit 1
      for update;

      if review is not null then
        outcome := public.approve_review_item(
          review,
          p_project_id,
          category,
          coalesce(p_remember, false),
          null,
          null,
          false
        );
        if outcome->>'ok' is distinct from 'true' then
          response := outcome;
        else
          response := private.mcp_record_write(token, p_transaction_id, review, null, 'review');
        end if;
      else
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, category);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
      end if;
      end if;
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

CREATE OR REPLACE FUNCTION private.undo_line_split_write(p_company uuid, p_write private.mcp_writes)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid := p_company;
  p_id uuid := p_write.transaction_id;
  rec private.mcp_writes := p_write;
  response jsonb;
begin
  perform 1 from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    response := private.mcp_error('not_found', 'not found');
  elsif private.line_split_parts(p_id) is distinct from rec.prior->'written' then
    response := private.mcp_error('conflict', 'conflict');
  elsif (select t.in_pnl_override from public.transactions t where t.id = p_id and t.company_id = cid) is true
    and private.line_has_loose_reversal(p_id, rec.prior->'before') then
    response := private.mcp_error('conflict', 'conflict');
  else
    -- A write stored before FLOW-133 has no percent or rest in before: they stay empty.
    perform private.set_line_parts(
      cid, p_id,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'category_id', b.part->>'category_id', 'project_id', b.part->>'project_id',
        'amount_minor', (b.part->>'amount_minor')::bigint, 'percent', b.part->>'percent',
        'is_rest', coalesce((b.part->>'is_rest')::boolean, false),
        'gross_up', coalesce((b.part->>'gross_up')::boolean, false)
      ) order by b.ord), '[]'::jsonb)
      from jsonb_array_elements(rec.prior->'before') with ordinality as b(part, ord))
    );
    update public.transactions
    set user_assigned = (rec.prior->>'user_assigned')::boolean,
        category_suggested = (rec.prior->>'category_suggested')::boolean
    where id = p_id and company_id = cid;
    update private.mcp_writes
    set undone_at = clock_timestamp()
    where id = rec.id and undone_at is null;
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object('kind', 'line_split', 'id', p_id)
    );
  end if;
  return response;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_line_split(p_transaction_id uuid, p_parts jsonb, p_preview boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  line_net bigint;
  line_minor bigint;
  line_direction public.txn_direction;
  line_category uuid;
  line_project uuid;
  line_override boolean;
  kept_out boolean;
  line_kind text;
  item jsonb;
  n integer;
  i integer := 0;
  categories uuid[] := '{}';
  projects uuid[] := '{}';
  amounts bigint[] := '{}';
  percents numeric[] := '{}';
  gross_ups boolean[] := '{}';
  rest_at integer;
  category uuid;
  project uuid;
  gross_up boolean;
  kind text;
  fixed_total bigint := 0;
  percent_total numeric := 0;
  percent_minor bigint := 0;
  leftover bigint;
  rest_minor bigint;
  seen text[] := '{}'::text[];
  pair text;
  pick record;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' then
    raise exception 'validation';
  end if;
  n := jsonb_array_length(p_parts);
  if n = 1 or n > 50 then
    raise exception 'validation';
  end if;

  select t.amount_net, t.direction, t.category_id, t.project_id, t.in_pnl_override
  into line_net, line_direction, line_category, line_project, line_override
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  -- The line's role was set for its own category's kind (the direction when it has none).
  select coalesce(c.kind::text, line_direction::text) into line_kind
  from (select 1) one
  left join public.categories c on c.id = line_category and c.company_id = cid;

  if n = 0 then
    if p_preview then
      return '[]'::jsonb;
    end if;
    perform private.set_line_parts(cid, p_transaction_id, '[]'::jsonb);
    return '[]'::jsonb;
  end if;

  if line_net = 0 then
    raise exception 'line amount is zero';
  end if;
  line_minor := abs(line_net);
  if exists (select 1 from private.loan_parts s where s.transaction_id = p_transaction_id) then
    raise exception 'line has a loan split';
  end if;
  if exists (
    select 1 from public.review_queue q
    where q.transaction_id = p_transaction_id and q.company_id = cid and q.status = 'open'
      and coalesce(q.reason, '') not in ('split_mismatch', 'unallocated_shared')
  ) then
    raise exception 'line has an open review';
  end if;

  for item in select value from jsonb_array_elements(p_parts)
  loop
    i := i + 1;
    if jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) k
        where k not in ('category_id', 'project_id', 'amount_minor', 'percent', 'rest', 'gross_up', 'effect')
      )
      -- Exactly one of amount_minor, percent and rest.
      or ((item ? 'amount_minor')::integer + (item ? 'percent')::integer + (item ? 'rest')::integer) <> 1
      or (item ? 'rest' and item->'rest' is distinct from 'true'::jsonb)
      or (item ? 'gross_up' and jsonb_typeof(item->'gross_up') is distinct from 'boolean')
      -- 0207: effect is a gross-up-only string marker, one of 'contra' or 'normal'.
      or (item ? 'effect' and (
        jsonb_typeof(item->'effect') is distinct from 'string'
        or (item->>'effect') not in ('contra', 'normal')
        or item->'gross_up' is distinct from 'true'::jsonb))
      or (item ? 'amount_minor' and (
        jsonb_typeof(item->'amount_minor') is distinct from 'number'
        or (item->>'amount_minor') !~ '^[0-9]{1,15}$'))
      or (item ? 'percent' and (
        jsonb_typeof(item->'percent') is distinct from 'number'
        or (item->>'percent') !~ '^[0-9]{1,3}(\.[0-9]{1,4})?$'))
      or (not item ? 'rest' and not item ? 'category_id')
      or (item ? 'category_id' and (
        jsonb_typeof(item->'category_id') is distinct from 'string'
        or (item->>'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      or (item ? 'project_id' and jsonb_typeof(item->'project_id') not in ('string', 'null'))
      or (jsonb_typeof(item->'project_id') = 'string'
        and (item->>'project_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then
      raise exception 'validation';
    end if;

    gross_up := coalesce((item->>'gross_up')::boolean, false);
    -- v1: a gross_up part is an exact amount only.
    if gross_up and not (item ? 'amount_minor') then
      raise exception 'validation';
    end if;

    if item ? 'rest' then
      if rest_at is not null then
        raise exception 'validation';
      end if;
      rest_at := i;
    end if;
    if item ? 'amount_minor' and (item->>'amount_minor')::bigint <= 0 then
      raise exception 'validation';
    end if;
    if item ? 'percent' and ((item->>'percent')::numeric <= 0 or (item->>'percent')::numeric > 100) then
      raise exception 'validation';
    end if;

    category := (item->>'category_id')::uuid;
    if category is null then
      -- A rest part with no category keeps the line's own category.
      category := line_category;
      if category is null then
        raise exception 'line has no category for the rest';
      end if;
    end if;
    project := (item->>'project_id')::uuid;

    -- FLOW-949 (0207): one normal and one gross-up part per category and project.
    pair := category::text || '|' || coalesce(coalesce(project, line_project)::text, '')
      || case when gross_up then '|gross_up' else '' end;
    if pair = any(seen) then
      raise exception 'same category and project twice';
    end if;
    seen := seen || pair;

    select c.kind::text, c.excluded_from_pnl into kind, kept_out
    from public.categories c
    where c.id = category and c.company_id = cid;
    if kind is null then
      raise exception 'category not found';
    end if;
    -- 0207: a gross_up part may carry EITHER kind. The effect is derived from (category kind vs
    -- line direction): the SAME kind is a contra entry, the OPPOSITE kind a normal real item. An
    -- explicit effect, when given, must match the derived value. A gross_up part names its project.
    if gross_up then
      if project is null then
        raise exception 'a gross-up part needs a project';
      end if;
      if item ? 'effect'
        and (item->>'effect') is distinct from
          (case when kind is not distinct from line_direction::text then 'contra' else 'normal' end) then
        raise exception 'validation';
      end if;
    end if;
    -- A part of another kind than the line's own category needs its own project: the line's
    -- role was set for that kind, so the part cannot borrow it.
    if kind is distinct from line_kind and project is null
      and category is distinct from line_category
      and not (kept_out and line_override is distinct from true) then
      raise exception 'a reversal part needs a project';
    end if;
    if project is not null and not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;

    categories := categories || category;
    projects := projects || project;
    amounts := amounts || (item->>'amount_minor')::bigint;
    percents := percents || (item->>'percent')::numeric;
    gross_ups := gross_ups || gross_up;
    if item ? 'amount_minor' then
      -- Signed: a gross_up amount nets against the line's primary side.
      fixed_total := fixed_total
        + case when gross_up then -(item->>'amount_minor')::bigint else (item->>'amount_minor')::bigint end;
    elsif item ? 'percent' then
      percent_total := percent_total + (item->>'percent')::numeric;
    end if;
  end loop;

  if percent_total > 100 then
    raise exception 'parts exceed the line';
  end if;

  -- Percent parts: floor each share of the line, then hand the cents still missing from the
  -- rounded total to the largest remainders, first part first on a tie.
  if percent_total > 0 then
    percent_minor := case
      when percent_total = 100 then line_minor
      else round(line_minor * percent_total / 100)::bigint
    end;
    for pick in
      select u.ord, floor(line_minor * u.pct / 100)::bigint as base,
        line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) as frac
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
    loop
      amounts[pick.ord] := pick.base;
    end loop;
    select percent_minor - coalesce(sum(amounts[u.ord]), 0) into leftover
    from unnest(percents) with ordinality as u(pct, ord)
    where u.pct is not null;
    for pick in
      select u.ord
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
      order by line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) desc, u.ord
      limit leftover
    loop
      amounts[pick.ord] := amounts[pick.ord] + 1;
    end loop;
    if exists (
      select 1 from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null and amounts[u.ord] = 0
    ) then
      raise exception 'a part rounds to zero';
    end if;
  end if;

  if fixed_total + percent_minor > line_minor then
    raise exception 'parts exceed the line';
  end if;
  if rest_at is null then
    if fixed_total + percent_minor <> line_minor then
      raise exception 'parts must sum to the line';
    end if;
  else
    rest_minor := line_minor - fixed_total - percent_minor;
    amounts[rest_at] := rest_minor;
    -- Nothing left: the rest part is dropped, and the others must still be a split.
    if rest_minor = 0 and n - 1 < 2 then
      raise exception 'nothing is left for the rest';
    end if;
  end if;

  -- A preview returns what a save would store, with each part's percent, rest marker and
  -- gross_up flag, and writes nothing.
  if p_preview then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', categories[u.i],
        'project_id', projects[u.i],
        'amount_minor', amounts[u.i],
        'percent', percents[u.i],
        'rest', coalesce(u.i = rest_at, false),
        'gross_up', gross_ups[u.i]
      ) order by u.i)
      from generate_series(1, n) as u(i)
      where amounts[u.i] > 0
    ), '[]'::jsonb);
  end if;

  -- The parts without a cent are dropped; the others keep the person's order.
  perform private.set_line_parts(
    cid, p_transaction_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', categories[u.i],
        'project_id', projects[u.i],
        'amount_minor', amounts[u.i],
        'percent', percents[u.i],
        'is_rest', coalesce(u.i = rest_at, false),
        'gross_up', gross_ups[u.i]
      ) order by u.i)
      from generate_series(1, n) as u(i)
      where amounts[u.i] > 0
    ), '[]'::jsonb)
  );

  -- The owner chose these categories, so the line is no longer a suggestion.
  update public.transactions
  set user_assigned = true,
      category_suggested = false
  where id = p_transaction_id and company_id = cid;

  -- The split is the answer to a shared line's review: the queue's אישור opened it.
  update public.review_queue q
  set status = 'changed', resolved_at = now()
  where q.company_id = cid and q.transaction_id = p_transaction_id
    and q.status = 'open' and q.reason = 'unallocated_shared';

  return private.line_split_parts(p_transaction_id);
end;
$function$;

-- 20 categories. Moving, deleting and restoring categories, and the readers around them, on the
-- parts views and the part writers.

-- The parts a category move recorded, as (line, part). A move written before the parts were legs
-- holds the ids of the rows it moved (resolved through the part's leg when that id still exists);
-- a newer move holds {transaction_id, ordinal} for split parts and {transaction_id, part} for loan
-- parts. ref is the part's ordinal (split) or name (loan).
create or replace function private.category_moved_parts(p_list jsonb)
returns table (transaction_id uuid, ref text)
language sql
stable
security definer
set search_path = ''
as $$
  select (x->>'transaction_id')::uuid, coalesce(x->>'ordinal', x->>'part')
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
  where jsonb_typeof(x) = 'object'
  union all
  select l.transaction_id, case when l.split_part then l.part_ordinal::text else l.part::text end
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
  join public.legs l on l.id = (x #>> '{}')::uuid
  where jsonb_typeof(x) = 'string';
$$;

revoke all on function private.category_moved_parts(jsonb) from public, anon, authenticated, service_role;

create or replace function private.category_move(p_company_id uuid, p_from uuid, p_into uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- The snapshot keys an older move already holds.
  k_lines constant text := 'line' || '_splits';
  k_loans constant text := 'loan' || '_splits';
  txns jsonb;
  parts jsonb := '[]'::jsonb;
  loan_parts jsonb := '[]'::jsonb;
  loan_cols jsonb;
  loan_switches jsonb;
  remembered jsonb;
  r record;
  new_parts jsonb;
  here jsonb;
begin
  -- A line with a part on each category, on one project and both gross-up or both not, cannot
  -- take the move: the two would be one part.
  if exists (
    select 1
    from private.split_parts f
    join private.split_parts s
      on s.transaction_id = f.transaction_id
      and s.category_id = p_into
      and s.project_id is not distinct from f.project_id
      and s.gross_up = f.gross_up
    where f.company_id = p_company_id and f.category_id = p_from
  ) then
    raise exception 'a split line has both categories';
  end if;

  -- The loans that name the source, then the lines in id order, as loan writes take them.
  perform 1
  from public.loans l
  where l.company_id = p_company_id
    and p_from in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
  order by l.id
  for no key update;
  if exists (
    select 1
    from public.loans l
    cross join lateral (values
      ('interest'::public.loan_split_part, l.interest_category_id),
      ('escrow'::public.loan_split_part, l.escrow_category_id),
      ('principal'::public.loan_split_part, l.principal_category_id),
      ('fees'::public.loan_split_part, l.fees_category_id)
    ) v(part, category_id)
    where l.company_id = p_company_id
      and v.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, v.part, p_into)
  ) or exists (
    select 1
    from private.loan_parts s
    where s.company_id = p_company_id
      and s.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, s.part, p_into)
  ) or exists (
    select 1
    from public.loan_category_switches w
    where w.company_id = p_company_id
      and w.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, w.part, p_into)
  ) then
    raise exception 'a loan uses this category for a part the other category cannot take'
      using errcode = '23514';
  end if;

  perform 1
  from public.transactions t
  where t.company_id = p_company_id
    and (t.category_id = p_from
      or t.id in (select s.transaction_id from private.split_parts s where s.company_id = p_company_id and s.category_id = p_from)
      or t.id in (select s.transaction_id from private.loan_parts s where s.company_id = p_company_id and s.category_id = p_from))
  order by t.id
  for update;

  with moved as (
    update public.transactions t
    set category_id = p_into,
        user_assigned = true,
        category_assigned = true,
        category_suggested = false
    from public.transactions old
    where old.id = t.id
      and t.company_id = p_company_id
      and t.category_id = p_from
    returning t.id, old.user_assigned, old.category_suggested, old.category_assigned
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'user_assigned', m.user_assigned,
      'category_suggested', m.category_suggested,
      'category_assigned', m.category_assigned
    ) order by m.id), '[]'::jsonb)
  into txns
  from moved m;

  -- Split parts: each line's parts are read, the source swapped for the target, and written back.
  for r in
    select s.transaction_id
    from private.split_parts s
    where s.company_id = p_company_id and s.category_id = p_from
    group by s.transaction_id
    order by s.transaction_id
  loop
    select jsonb_agg(jsonb_build_object(
        'category_id', case when s.category_id = p_from then p_into else s.category_id end,
        'project_id', s.project_id,
        'amount_minor', s.amount_minor,
        'gross_up', s.gross_up
      ) order by s.ordinal),
      jsonb_agg(jsonb_build_object('transaction_id', r.transaction_id, 'ordinal', s.pos) order by s.ordinal)
        filter (where s.category_id = p_from)
    into new_parts, here
    from (
      select p.*, row_number() over (order by p.ordinal) as pos
      from private.split_parts p
      where p.company_id = p_company_id and p.transaction_id = r.transaction_id
    ) s;
    perform private.set_line_parts(p_company_id, r.transaction_id, new_parts);
    parts := parts || here;
  end loop;

  -- Loan parts, the same way.
  for r in
    select s.transaction_id, min(s.loan_id::text)::uuid as loan_id
    from private.loan_parts s
    where s.company_id = p_company_id and s.category_id = p_from
    group by s.transaction_id
    order by s.transaction_id
  loop
    select jsonb_agg(jsonb_build_object(
        'part', s.part,
        'amount_minor', s.amount_minor,
        'scheduled_minor', s.scheduled_minor,
        'category_id', case when s.category_id = p_from then p_into else s.category_id end,
        'needs_review', s.needs_review
      ) order by s.part),
      jsonb_agg(jsonb_build_object('transaction_id', r.transaction_id, 'part', s.part) order by s.part)
        filter (where s.category_id = p_from)
    into new_parts, here
    from private.loan_parts s
    where s.company_id = p_company_id and s.transaction_id = r.transaction_id;
    perform private.set_loan_parts(p_company_id, r.transaction_id, r.loan_id, new_parts);
    loan_parts := loan_parts || here;
  end loop;

  with moved as (
    update public.loans l
    set interest_category_id = case when l.interest_category_id = p_from then p_into else l.interest_category_id end,
        escrow_category_id = case when l.escrow_category_id = p_from then p_into else l.escrow_category_id end,
        principal_category_id = case when l.principal_category_id = p_from then p_into else l.principal_category_id end,
        fees_category_id = case when l.fees_category_id = p_from then p_into else l.fees_category_id end
    from public.loans old
    where old.id = l.id
      and l.company_id = p_company_id
      and p_from in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
    returning l.id, jsonb_build_object(
      'interest', old.interest_category_id = p_from,
      'escrow', old.escrow_category_id = p_from,
      'principal', old.principal_category_id = p_from,
      'fees', old.fees_category_id = p_from
    ) as cols
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cols', m.cols) order by m.id), '[]'::jsonb)
  into loan_cols
  from moved m;

  with moved as (
    update public.loan_category_switches w
    set category_id = p_into
    where w.company_id = p_company_id and w.category_id = p_from
    returning w.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into loan_switches from moved m;

  with moved as (
    update public.suppliers s
    set remembered_category_id = p_into
    where s.company_id = p_company_id and s.remembered_category_id = p_from
    returning s.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into remembered from moved m;

  return jsonb_build_object(
    'transactions', txns,
    k_lines, parts,
    k_loans, loan_parts,
    'loans', loan_cols,
    'loan_switches', loan_switches,
    'suppliers', remembered
  );
end;
$function$;

create or replace function private.category_move_undo(p_company_id uuid, p_move_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  k_lines constant text := 'line' || '_splits';
  k_loans constant text := 'loan' || '_splits';
  mv record;
  n integer;
  flipped integer;
  total integer;
  r record;
  new_parts jsonb;
begin
  select m.* into mv
  from private.category_moves m
  where m.id = p_move_id and m.company_id = p_company_id and m.undone_at is null
  for update;
  if not found then
    raise exception 'move not found';
  end if;
  if not exists (select 1 from public.categories c where c.company_id = p_company_id and c.id = mv.from_id) then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  perform 1 from public.categories c
  where c.company_id = p_company_id and c.id in (mv.from_id, mv.into_id)
  order by c.id
  for no key update;
  perform 1 from public.loans l
  where l.company_id = p_company_id
    and l.id in (select (x->>'id')::uuid from jsonb_array_elements(mv.moved->'loans') x)
  order by l.id
  for no key update;
  perform 1 from public.transactions t
  where t.company_id = p_company_id
    and (t.id in (select (x->>'id')::uuid from jsonb_array_elements(mv.moved->'transactions') x)
      or t.id in (select h.transaction_id from private.category_moved_parts(mv.moved->k_lines) h)
      or t.id in (select h.transaction_id from private.category_moved_parts(mv.moved->k_loans) h))
  order by t.id
  for update;

  update public.transactions t
  set category_id = mv.from_id,
      user_assigned = (x->>'user_assigned')::boolean,
      category_assigned = (x->>'category_assigned')::boolean,
      category_suggested = (x->>'category_suggested')::boolean
  from jsonb_array_elements(mv.moved->'transactions') x
  where t.id = (x->>'id')::uuid and t.company_id = p_company_id and t.category_id = mv.into_id;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(mv.moved->'transactions') then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  -- Split parts: each recorded part still on the target goes back to the source.
  flipped := 0;
  for r in
    select distinct h.transaction_id from private.category_moved_parts(mv.moved->k_lines) h order by 1
  loop
    select jsonb_agg(jsonb_build_object(
        'category_id', case when s.back then mv.from_id else s.category_id end,
        'project_id', s.project_id,
        'amount_minor', s.amount_minor,
        'gross_up', s.gross_up
      ) order by s.ordinal),
      count(*) filter (where s.back)
    into new_parts, n
    from (
      select p.*, p.category_id = mv.into_id and p.pos::text in (
          select h.ref from private.category_moved_parts(mv.moved->k_lines) h where h.transaction_id = r.transaction_id
        ) as back
      from (
        select q.*, row_number() over (order by q.ordinal) as pos
        from private.split_parts q
        where q.company_id = p_company_id and q.transaction_id = r.transaction_id
      ) p
    ) s;
    if n > 0 then
      perform private.set_line_parts(p_company_id, r.transaction_id, new_parts);
    end if;
    flipped := flipped + coalesce(n, 0);
  end loop;
  select count(*)::integer into total from private.category_moved_parts(mv.moved->k_lines);
  if flipped <> total then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  -- Loan parts, the same way.
  flipped := 0;
  for r in
    select h.transaction_id, min(s.loan_id::text)::uuid as loan_id
    from private.category_moved_parts(mv.moved->k_loans) h
    join private.loan_parts s on s.company_id = p_company_id and s.transaction_id = h.transaction_id
    group by h.transaction_id
    order by h.transaction_id
  loop
    select jsonb_agg(jsonb_build_object(
        'part', s.part,
        'amount_minor', s.amount_minor,
        'scheduled_minor', s.scheduled_minor,
        'category_id', case when s.back then mv.from_id else s.category_id end,
        'needs_review', s.needs_review
      ) order by s.part),
      count(*) filter (where s.back)
    into new_parts, n
    from (
      select p.*, p.category_id = mv.into_id and p.part::text in (
          select h.ref from private.category_moved_parts(mv.moved->k_loans) h where h.transaction_id = r.transaction_id
        ) as back
      from private.loan_parts p
      where p.company_id = p_company_id and p.transaction_id = r.transaction_id
    ) s;
    if n > 0 then
      perform private.set_loan_parts(p_company_id, r.transaction_id, r.loan_id, new_parts);
    end if;
    flipped := flipped + coalesce(n, 0);
  end loop;
  select count(*)::integer into total from private.category_moved_parts(mv.moved->k_loans);
  if flipped <> total then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  update public.loans l
  set interest_category_id = case when (x->'cols'->>'interest')::boolean then mv.from_id else l.interest_category_id end,
      escrow_category_id = case when (x->'cols'->>'escrow')::boolean then mv.from_id else l.escrow_category_id end,
      principal_category_id = case when (x->'cols'->>'principal')::boolean then mv.from_id else l.principal_category_id end,
      fees_category_id = case when (x->'cols'->>'fees')::boolean then mv.from_id else l.fees_category_id end
  from jsonb_array_elements(mv.moved->'loans') x
  where l.id = (x->>'id')::uuid
    and l.company_id = p_company_id
    and (not (x->'cols'->>'interest')::boolean or l.interest_category_id = mv.into_id)
    and (not (x->'cols'->>'escrow')::boolean or l.escrow_category_id = mv.into_id)
    and (not (x->'cols'->>'principal')::boolean or l.principal_category_id = mv.into_id)
    and (not (x->'cols'->>'fees')::boolean or l.fees_category_id = mv.into_id);
  get diagnostics n = row_count;
  if n <> jsonb_array_length(mv.moved->'loans') then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  -- FLOW-148: the loans' category switches (a move from before them has none).
  update public.loan_category_switches w
  set category_id = mv.from_id
  where w.company_id = p_company_id
    and w.category_id = mv.into_id
    and w.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(mv.moved->'loan_switches', '[]'::jsonb)) x);
  get diagnostics n = row_count;
  if n <> jsonb_array_length(coalesce(mv.moved->'loan_switches', '[]'::jsonb)) then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  -- A remembered category the owner changed since stays as it is now.
  update public.suppliers s
  set remembered_category_id = mv.from_id
  where s.company_id = p_company_id
    and s.remembered_category_id = mv.into_id
    and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(mv.moved->'suppliers') x);

  update private.category_moves set undone_at = clock_timestamp() where id = p_move_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_category(p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  cat jsonb;
  cat_loan_part public.loan_split_part;
  split_txns uuid[];
  lines jsonb;
  parts jsonb;
  split_txn uuid;
  k_lines constant text := 'line' || '_splits'; -- the snapshot key older deletions already hold
  remembered jsonb;
  review_refs jsonb;
  reassign_refs jsonb;
  opened jsonb;
  deletion_id uuid;
begin
  cid := private.category_owner_company();
  if p_category_id is null then
    raise exception 'validation';
  end if;

  select to_jsonb(c.*), c.loan_part into cat, cat_loan_part
  from public.categories c
  where c.id = p_category_id and c.company_id = cid
  for update;
  if cat is null then
    raise exception 'category not found';
  end if;
  if cat_loan_part is not null then
    raise exception 'loan category is fixed';
  end if;
  if exists (
    select 1 from public.loans l
    where l.company_id = cid
      and p_category_id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
  ) or exists (
    select 1 from private.loan_parts s where s.company_id = cid and s.category_id = p_category_id
  ) or exists (
    select 1 from public.loan_category_switches w where w.company_id = cid and w.category_id = p_category_id
  ) then
    raise exception 'a loan uses this category';
  end if;

  select coalesce(array_agg(distinct s.transaction_id), '{}') into split_txns
  from private.split_parts s
  where s.company_id = cid and s.category_id = p_category_id;

  perform 1 from public.transactions t
  where t.company_id = cid
    and (t.category_id = p_category_id or t.id = any (split_txns))
  order by t.id
  for update;

  -- Every part of a split line that has one in this category: the split goes.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.leg_id,
      'company_id', s.company_id,
      'transaction_id', s.transaction_id,
      'ordinal', s.ordinal,
      'category_id', s.category_id,
      'project_id', s.project_id,
      'amount_minor', s.amount_minor,
      'gross_up', s.gross_up
    ) order by s.transaction_id, s.ordinal), '[]'::jsonb) into parts
  from private.split_parts s
  where s.company_id = cid and s.transaction_id = any (split_txns);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'category_id', t.category_id,
      'category_assigned', t.category_assigned,
      'category_suggested', t.category_suggested
    ) order by t.id), '[]'::jsonb)
  into lines
  from public.transactions t
  where t.company_id = cid
    and (t.category_id = p_category_id or t.id = any (split_txns));

  -- A split mismatch review goes with the split (the split sync would close it at commit and
  -- leave the line out of review); the line gets a missing_category row below instead. Restore
  -- puts the split back, and the sync opens a mismatch review again if it still does not add up.
  delete from public.review_queue q
  where q.company_id = cid
    and q.status = 'open'
    and q.reason = 'split_mismatch'
    and q.transaction_id = any (split_txns);

  foreach split_txn in array split_txns loop
    perform private.set_line_parts(cid, split_txn, null);
  end loop;

  -- category_assigned true: the owner left the line with no category, so nothing guesses one.
  update public.transactions t
  set category_id = null,
      category_assigned = true,
      category_suggested = false
  where t.company_id = cid
    and (t.category_id = p_category_id or t.id = any (split_txns));

  with changed as (
    update public.suppliers s
    set remembered_category_id = null
    where s.company_id = cid and s.remembered_category_id = p_category_id
    returning s.id
  )
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into remembered from changed c;

  -- Earlier reviews and reassigns that would restore this category on undo restore none.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'prior', q.prior_category_id = p_category_id,
      'prior_remembered', q.prior_remembered_category_id = p_category_id,
      'written_remembered', q.written_remembered_category_id = p_category_id
    ) order by q.id), '[]'::jsonb)
  into review_refs
  from public.review_queue q
  where q.company_id = cid
    and p_category_id in (q.prior_category_id, q.prior_remembered_category_id, q.written_remembered_category_id);
  update public.review_queue q
  set prior_category_id = nullif(q.prior_category_id, p_category_id),
      prior_remembered_category_id = nullif(q.prior_remembered_category_id, p_category_id),
      written_remembered_category_id = nullif(q.written_remembered_category_id, p_category_id)
  where q.company_id = cid
    and p_category_id in (q.prior_category_id, q.prior_remembered_category_id, q.written_remembered_category_id);

  with changed as (
    update public.reassign_undo r
    set prior_category_id = null
    where r.company_id = cid and r.prior_category_id = p_category_id
    returning r.id
  )
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into reassign_refs from changed c;

  -- Back to לאישור: an open review for each line still on the books that has none.
  with opened_rows as (
    insert into public.review_queue (company_id, transaction_id, status, reason)
    select cid, t.id, 'open', 'missing_category'
    from public.transactions t
    where t.company_id = cid
      and t.id in (select (x->>'id')::uuid from jsonb_array_elements(lines) x)
      and t.removed_at is null
      and t.line_status is distinct from 'void'::public.line_status
      and not exists (
        select 1 from public.review_queue q where q.transaction_id = t.id and q.status = 'open'
      )
    returning id
  )
  select coalesce(jsonb_agg(o.id order by o.id), '[]'::jsonb) into opened from opened_rows o;

  delete from public.categories c where c.id = p_category_id and c.company_id = cid;

  insert into private.category_deletions (company_id, category_id, snapshot)
  values (cid, p_category_id, jsonb_build_object(
    'category', cat,
    'lines', lines,
    k_lines, parts,
    'suppliers', remembered,
    'review_refs', review_refs,
    'reassign_refs', reassign_refs,
    'opened_reviews', opened
  ))
  returning id into deletion_id;

  return jsonb_build_object(
    'deletion_id', deletion_id,
    'name', cat->>'name',
    'lines', (select count(*)::integer from jsonb_array_elements(lines) x
              join public.transactions t on t.id = (x->>'id')::uuid
              where t.removed_at is null and t.line_status is distinct from 'void'::public.line_status)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.category_restore(p_company_id uuid, p_deletion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d record;
  n integer;
  k_lines constant text := 'line' || '_splits'; -- the snapshot key older deletions already hold
  line_id uuid;
begin
  select x.* into d
  from private.category_deletions x
  where x.id = p_deletion_id and x.company_id = p_company_id and x.restored_at is null
  for update;
  if not found then
    raise exception 'category not found';
  end if;

  perform 1 from public.transactions t
  where t.company_id = p_company_id
    and t.id in (select (x->>'id')::uuid from jsonb_array_elements(d.snapshot->'lines') x)
  order by t.id
  for update;

  -- Every line must still have no category and no split.
  if exists (
    select 1 from jsonb_array_elements(d.snapshot->'lines') x
    left join public.transactions t on t.id = (x->>'id')::uuid and t.company_id = p_company_id
    where t.id is null or t.category_id is not null
      or exists (select 1 from private.split_parts s where s.transaction_id = t.id)
  ) then
    raise exception 'category cannot be restored' using errcode = '23514';
  end if;

  begin
    insert into public.categories
    select * from jsonb_populate_record(null::public.categories, d.snapshot->'category');
  exception
    when unique_violation then
      raise exception 'category cannot be restored' using errcode = '23514';
  end;
  -- The insert trigger sets the P&L switch from the name; put back the owner's own setting.
  update public.categories
  set excluded_from_pnl = (d.snapshot->'category'->>'excluded_from_pnl')::boolean
    , in_cash = coalesce((d.snapshot->'category'->>'in_cash')::boolean, in_cash)
  where id = (d.snapshot->'category'->>'id')::uuid;

  begin
    update public.transactions t
    set category_id = (x->>'category_id')::uuid,
        category_assigned = (x->>'category_assigned')::boolean,
        category_suggested = (x->>'category_suggested')::boolean
    from jsonb_array_elements(d.snapshot->'lines') x
    where t.id = (x->>'id')::uuid and t.company_id = p_company_id;
  exception
    when foreign_key_violation then
      raise exception 'category cannot be restored' using errcode = '23514';
  end;

  begin
    for line_id in
      select distinct (x->>'transaction_id')::uuid
      from jsonb_array_elements(coalesce(d.snapshot->k_lines, '[]'::jsonb)) x
      order by 1
    loop
      perform private.set_line_parts(p_company_id, line_id, (
        select jsonb_agg(jsonb_build_object(
          'category_id', x->>'category_id',
          'project_id', x->>'project_id',
          'amount_minor', (x->>'amount_minor')::bigint,
          'gross_up', coalesce((x->>'gross_up')::boolean, false)
        ) order by (x->>'ordinal')::integer)
        from jsonb_array_elements(d.snapshot->k_lines) x
        where (x->>'transaction_id')::uuid = line_id
      ));
    end loop;
  exception
    when unique_violation or check_violation or foreign_key_violation then
      raise exception 'category cannot be restored' using errcode = '23514';
  end;

  -- The reviews the delete opened go, unless they were resolved since.
  delete from public.review_queue q
  where q.company_id = p_company_id
    and q.status in ('open', 'skipped')
    and q.id in (select (x #>> '{}')::uuid from jsonb_array_elements(d.snapshot->'opened_reviews') x);

  update public.suppliers s
  set remembered_category_id = (d.snapshot->'category'->>'id')::uuid
  where s.company_id = p_company_id
    and s.remembered_category_id is null
    and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(d.snapshot->'suppliers') x);

  update public.review_queue q
  set prior_category_id = case when (x->>'prior')::boolean and q.prior_category_id is null
        then (d.snapshot->'category'->>'id')::uuid else q.prior_category_id end,
      prior_remembered_category_id = case when (x->>'prior_remembered')::boolean and q.prior_remembered_category_id is null
        then (d.snapshot->'category'->>'id')::uuid else q.prior_remembered_category_id end,
      written_remembered_category_id = case when (x->>'written_remembered')::boolean and q.written_remembered_category_id is null
        then (d.snapshot->'category'->>'id')::uuid else q.written_remembered_category_id end
  from jsonb_array_elements(d.snapshot->'review_refs') x
  where q.id = (x->>'id')::uuid and q.company_id = p_company_id;

  update public.reassign_undo r
  set prior_category_id = (d.snapshot->'category'->>'id')::uuid
  where r.company_id = p_company_id
    and r.prior_category_id is null
    and r.id in (select (x #>> '{}')::uuid from jsonb_array_elements(d.snapshot->'reassign_refs') x);

  update private.category_deletions set restored_at = clock_timestamp() where id = p_deletion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.move_category_lines(p_from uuid, p_into uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  moved jsonb;
  move_id uuid;
begin
  cid := private.category_owner_company();
  perform private.category_move_check(cid, p_from, p_into);
  moved := private.category_move(cid, p_from, p_into);
  insert into private.category_moves (company_id, from_id, into_id, moved)
  values (cid, p_from, p_into, moved)
  returning id into move_id;
  -- The count, like delete_category's, is of lines on the books: not removed, not void.
  return jsonb_build_object(
    'move_id', move_id,
    'lines', (select count(*)::integer
              from public.transactions t
              where t.company_id = cid
                and t.removed_at is null
                and t.line_status is distinct from 'void'::public.line_status
                and (t.id in (select (x->>'id')::uuid from jsonb_array_elements(moved->'transactions') x)
                  or t.id in (select h.transaction_id from private.category_moved_parts(moved->('line' || '_splits')) h)))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.categories_loan_pnl_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.excluded_from_pnl is distinct from old.excluded_from_pnl
     and (
       exists (
         select 1 from private.loan_parts s
         where s.company_id = new.company_id
           and s.category_id = new.id
           and (
             new.loan_part is not null
             or (s.part = 'principal'::public.loan_split_part and not new.excluded_from_pnl)
           )
       )
       or exists (
         select 1 from public.loan_category_switches w
         where w.company_id = new.company_id
           and w.category_id = new.id
           and (
             new.loan_part is not null
             or (w.part = 'principal'::public.loan_split_part and not new.excluded_from_pnl)
           )
       )
       or exists (
         select 1 from public.loans l
         where l.company_id = new.company_id
           and (
             (l.principal_category_id = new.id and not new.excluded_from_pnl)
             or (
               new.loan_part is not null
               and new.id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id)
             )
           )
       )
     )
  then
    raise exception 'loan category is fixed' using errcode = '23514';
  end if;
  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION private.dedupe_loan_money_categories()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  removed integer;
begin
  create temporary table loan_money_dupes on commit drop as
  select s.company_id, s.id
  from public.categories s
  where s.kind = 'income'
    and s.is_default
    and s.name = 'כסף שהתקבל מהלוואות'
    and exists (
      select 1 from public.categories o
      where o.company_id = s.company_id
        and o.id <> s.id
        and private.loan_money_category(o.kind, o.excluded_from_pnl, o.name)
    );

  -- Nothing may point at a duplicate that goes: no line, part, loan, supplier, sub-category,
  -- review row, undo row, Jev row or MCP write. A duplicate that is used stays as it is.
  delete from loan_money_dupes d
  where exists (select 1 from public.transactions t where t.company_id = d.company_id and t.category_id = d.id)
    or exists (select 1 from private.split_parts s where s.company_id = d.company_id and s.category_id = d.id)
    or exists (select 1 from private.loan_parts s where s.company_id = d.company_id and s.category_id = d.id)
    or exists (
      select 1 from public.loans l
      where l.company_id = d.company_id
        and d.id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
    )
    or exists (select 1 from public.suppliers s where s.company_id = d.company_id and s.remembered_category_id = d.id)
    or exists (select 1 from public.categories c where c.company_id = d.company_id and c.parent_id = d.id)
    or exists (
      select 1 from public.review_queue q
      where q.company_id = d.company_id
        and d.id in (q.prior_category_id, q.paired_category_id, q.prior_remembered_category_id, q.written_remembered_category_id)
    )
    or exists (select 1 from public.reassign_undo r where r.prior_category_id = d.id)
    or exists (select 1 from public.jev_outcomes j where d.id in (j.final_category_id, j.suggested_category_id))
    or exists (select 1 from public.jev_prefills j where d.id in (j.category_id, j.prior_category_id))
    or exists (select 1 from private.mcp_writes w where w.category_id = d.id)
    or exists (select 1 from private.category_deletions x where x.category_id = d.id);

  -- FLOW-436: the company's own loan money category keeps whether it counts in cash; the
  -- owner switches it with set_category_cash.
  delete from public.categories c
  using loan_money_dupes d
  where c.company_id = d.company_id
    and c.id = d.id;
  get diagnostics removed = row_count;

  drop table loan_money_dupes;
  return removed;
end;
$function$

;

CREATE OR REPLACE FUNCTION private.remember_line_category(p_company uuid, p_id uuid, p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line record;
  cat record;
  prior uuid;
  supplier_name text;
begin
  select t.direction, t.supplier_id, t.category_id, t.pnl_role into line
  from public.transactions t
  where t.id = p_id and t.company_id = p_company and t.removed_at is null;
  if not found then
    raise exception 'transaction not found';
  end if;
  if line.direction <> 'expense' or line.supplier_id is null then
    raise exception 'the line has no supplier';
  end if;
  if line.category_id is null then
    raise exception 'the line has no category';
  end if;
  if line.category_id is distinct from p_category_id then
    raise exception 'conflict';
  end if;
  if line.pnl_role = 'shared'
    or exists (select 1 from private.split_parts s where s.transaction_id = p_id)
  then
    raise exception 'a split line is not remembered';
  end if;

  select c.id, c.name, c.kind, c.loan_part into cat
  from public.categories c
  where c.id = line.category_id and c.company_id = p_company;
  if not found or cat.kind::text <> 'expense' then
    raise exception 'category not found';
  end if;
  if cat.loan_part is not null then
    raise exception 'a loan category is not remembered';
  end if;

  select s.remembered_category_id, s.name into prior, supplier_name
  from public.suppliers s
  where s.id = line.supplier_id and s.company_id = p_company
  for no key update;

  update public.suppliers s
  set remembered_category_id = cat.id
  where s.id = line.supplier_id and s.company_id = p_company;

  return jsonb_build_object(
    'supplier_id', line.supplier_id,
    'supplier_name', supplier_name,
    'category_id', cat.id,
    'category_name', cat.name,
    'prior_category_id', prior
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_setup_suggestions(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  cur text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.base_currency into cur from public.companies c where c.id = cid;

  return jsonb_build_object(
    'projects', '[]'::jsonb,
    'lenders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', s.name,
          'monthly_agorot', -r.typical_amount_minor,
          'since', f.first_doc_date
        )
        order by s.name, s.id
      )
      -- One lender per supplier: a servicer paying several loans has one charge per project (decision
      -- 0185), and its monthly amount is their sum.
      from (
        select rp.direction, rp.party_id, rp.currency, sum(rp.typical_amount_minor)::bigint as typical_amount_minor,
          max(rp.months_seen) as months_seen
        from private.recurring_parties(cid, today) rp
        where rp.months_seen >= 3
        group by rp.direction, rp.party_id, rp.currency
      ) r
      join public.suppliers s on s.company_id = cid and s.id = r.party_id
      join lateral (
        select min(t.doc_date) as first_doc_date
        from public.transactions t
        where t.company_id = cid
          and t.supplier_id = r.party_id
          and t.removed_at is null
          and t.line_status = 'posted'
      ) f on true
      where r.direction = 'expense'
        and r.currency = cur
        and r.months_seen >= 3
        and not exists (
          select 1 from public.loans l
          where l.company_id = cid
            and lower(btrim(l.name)) = lower(btrim(s.name))
        )
        and not exists (
          select 1
          from private.loan_parts ls
          join public.transactions lt on lt.company_id = cid and lt.id = ls.transaction_id
          where ls.company_id = cid
            and lt.supplier_id = r.party_id
        )
    ), '[]'::jsonb)
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.list_categories()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with co as (
    select private.readable_company_id() as id
  ),
  tagged as (
    select t.category_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = (select id from co)
      and t.category_id is not null
      and t.removed_at is null
      and t.line_status = 'posted'::public.line_status
    union
    select s.category_id, s.transaction_id
    from private.split_parts s
    join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
    where s.company_id = (select id from co)
      and t.removed_at is null
      and t.line_status = 'posted'::public.line_status
  ),
  counted as (
    select
      g.category_id,
      count(*)::integer as lines,
      count(*) filter (where exists (
        select 1 from private.split_parts s
        where s.transaction_id = g.transaction_id and s.category_id = g.category_id
      ))::integer as split_lines
    from tagged g
    group by g.category_id
  ),
  loan_used as (
    select v.category_id
    from public.loans l
    cross join lateral (values
      (l.interest_category_id), (l.escrow_category_id), (l.principal_category_id), (l.fees_category_id)
    ) v(category_id)
    where l.company_id = (select id from co) and v.category_id is not null
    union
    select s.category_id
    from private.loan_parts s
    where s.company_id = (select id from co) and s.category_id is not null
    union
    select w.category_id
    from public.loan_category_switches w
    where w.company_id = (select id from co)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'kind', c.kind,
    'hidden', c.hidden,
    'is_default', c.is_default,
    'excluded_from_pnl', c.excluded_from_pnl,
    'in_cash', c.in_cash,
    'loan_part', c.loan_part,
    'group_name', c.group_name,
    'parent_id', c.parent_id,
    'children_count', (select count(*)::integer from public.categories k where k.parent_id = c.id),
    'rollup_lines', coalesce(n.lines, 0) + coalesce((
      select sum(m.lines)::integer from counted m
      join public.categories k on k.id = m.category_id
      where k.parent_id = c.id
    ), 0),
    'rehab', c.rehab,
    'in_rehab', private.category_in_rehab(c.rehab, c.excluded_from_pnl, c.loan_part),
    'lines', coalesce(n.lines, 0),
    'split_lines', coalesce(n.split_lines, 0),
    'loan_used', lu.category_id is not null
  ) order by c.kind, c.sort_order, c.name), '[]'::jsonb)
  from public.categories c
  left join counted n on n.category_id = c.id
  left join loan_used lu on lu.category_id = c.id
  where c.company_id = (select id from co);
$function$

;


-- ===========================================================================
-- 30 loans. Loan payment parts are legs (decision 0232): the loan writers go through
-- private.set_loan_parts / set_loan_parts_review, the readers read private.loan_parts.
-- ===========================================================================

-- Move one part of a line's loan payment to another category: the line's parts are read, the
-- part's category changed, and the whole set written back (the writer checks and posts the line).
create or replace function private.set_loan_part_category(
  p_company uuid, p_txn uuid, p_part public.loan_split_part, p_category uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan uuid;
  parts jsonb;
begin
  select min(s.loan_id::text)::uuid,
    jsonb_agg(jsonb_build_object(
      'part', s.part,
      'amount_minor', s.amount_minor,
      'scheduled_minor', s.scheduled_minor,
      'category_id', case when s.part = p_part then p_category else s.category_id end,
      'needs_review', s.needs_review
    ) order by s.part)
  into loan, parts
  from private.loan_parts s
  where s.company_id = p_company and s.transaction_id = p_txn;
  if loan is null then
    raise exception 'line has no loan split';
  end if;
  perform private.set_loan_parts(p_company, p_txn, loan, parts);
end;
$$;

revoke all on function private.set_loan_part_category(uuid, uuid, public.loan_split_part, uuid)
  from public, anon, authenticated, service_role;

comment on function private.set_loan_part_category(uuid, uuid, public.loan_split_part, uuid) is
  'Decision 0232. Sets the category of one part of a line''s loan payment through set_loan_parts '
  '(the loan rules are checked and the line posted). Used by the MCP loan category writes and their undo.';

create or replace function public.save_loan_split(p_transaction_id uuid, p_loan_id uuid, p_parts jsonb, p_preview boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  txn record;
  loan record;
  attached uuid;
  balance bigint;
  own_principal bigint := 0;
  parts_ok boolean;
  part jsonb;
  part_sum bigint := 0;
  principal_amt bigint := 0;
  has_fees boolean := false;
  call_fees_cat uuid;
  call_interest_cat uuid;
  call_escrow_cat uuid;
  call_principal_cat uuid;
  cat_interest uuid;
  cat_escrow uuid;
  cat_principal uuid;
  cat_fees uuid;
  result jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 where private.is_read_only()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_transaction_id is null or p_loan_id is null
    or p_parts is null or jsonb_typeof(p_parts) <> 'array'
  then
    raise exception 'validation';
  end if;

  -- The loan first, then the line: the order every loan split write takes (no deadlock).
  select l.currency, l.kind, l.start_date, l.status, l.closed_on,
         l.interest_category_id, l.escrow_category_id, l.principal_category_id,
         l.fees_category_id
  into loan
  from public.loans l
  where l.id = p_loan_id and l.company_id = cid
  for update;
  if not found then
    raise exception 'loan not found';
  end if;

  select t.currency, t.amount_original, t.doc_date
  into txn
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  select s.loan_id into attached
  from private.loan_parts s
  where s.transaction_id = p_transaction_id
  limit 1;
  if attached is not null and attached <> p_loan_id then
    raise exception 'loan already attached';
  end if;

  if loan.currency is distinct from txn.currency then
    raise exception 'loan currency mismatch';
  end if;
  if loan.status <> 'open'::public.loan_status and txn.doc_date > loan.closed_on then
    raise exception 'loan closed';
  end if;
  if loan.kind = 'demand'::public.loan_kind then
    if txn.doc_date < loan.start_date then
      raise exception 'payment before the loan start';
    end if;
    -- Interest runs from the last payment, so a new payment comes after every other one. A
    -- line whose parts all wait for review counts as no payment, so confirming it is new too.
    if not exists (
      select 1 from private.loan_parts s
      where s.transaction_id = p_transaction_id and not s.needs_review
    ) and exists (
      select 1
      from private.loan_parts s
      join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
      where s.loan_id = p_loan_id
        and s.company_id = cid
        and t.removed_at is null
        and not s.needs_review
        and t.doc_date > txn.doc_date
    ) then
      raise exception 'a later payment is already attached';
    end if;
  end if;

  -- As in mcp_attach_loan_payment: interest, escrow and principal once each, plus at most one
  -- fees part above zero, as whole non-negative minor units. Unlike the MCP attach, which names
  -- only a fees category, any part here may name one.
  select count(*) in (3, 4)
     and count(distinct e.value->>'part') = count(*)
     and count(*) filter (where e.value->>'part' in ('interest', 'escrow', 'principal')) = 3
     and bool_and(coalesce(
       jsonb_typeof(e.value) = 'object'
       and not exists (
         select 1 from jsonb_object_keys(e.value) k
         where k not in ('part', 'amount_minor', 'scheduled_minor', 'category_id')
       )
       and e.value->>'part' in ('interest', 'escrow', 'principal', 'fees')
       and jsonb_typeof(e.value->'amount_minor') = 'number'
       and jsonb_typeof(e.value->'scheduled_minor') = 'number'
       and (e.value->>'amount_minor') ~ '^[0-9]{1,15}$'
       and (e.value->>'scheduled_minor') ~ '^[0-9]{1,15}$'
       and (e.value->>'part' <> 'fees' or (e.value->>'amount_minor') !~ '^0+$')
       and (
         not (e.value ? 'category_id')
         or (
           jsonb_typeof(e.value->'category_id') = 'string'
           and e.value->>'category_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         )
       ),
       false
     ))
  into parts_ok
  from jsonb_array_elements(p_parts) e;
  if not coalesce(parts_ok, false) then
    raise exception 'invalid loan parts';
  end if;

  for part in select value from jsonb_array_elements(p_parts)
  loop
    part_sum := part_sum + (part->>'amount_minor')::bigint;
    if part->>'part' = 'principal' then
      principal_amt := (part->>'amount_minor')::bigint;
      call_principal_cat := (part->>'category_id')::uuid;
    elsif part->>'part' = 'interest' then
      call_interest_cat := (part->>'category_id')::uuid;
    elsif part->>'part' = 'escrow' then
      call_escrow_cat := (part->>'category_id')::uuid;
    elsif part->>'part' = 'fees' then
      has_fees := true;
      call_fees_cat := (part->>'category_id')::uuid;
    end if;
  end loop;
  if part_sum is distinct from txn.amount_original then
    raise exception 'invalid loan parts';
  end if;

  -- The balance before this line: its own principal, when it is already attached, is added
  -- back. A part waiting for review, or on a line not posted, lowers no balance
  -- (public.loan_balances), so it is not added back.
  select coalesce(sum(s.amount_minor), 0) into own_principal
  from private.loan_parts s
  join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
  where s.transaction_id = p_transaction_id
    and s.part = 'principal'::public.loan_split_part
    and not s.needs_review
    and t.line_status = 'posted'::public.line_status;
  select b.balance_minor into balance
  from public.loan_balances b
  where b.company_id = cid and b.loan_id = p_loan_id;
  balance := coalesce(balance, 0) + own_principal;
  -- As in mcp_attach_loan_payment: a paid-off balance takes no payment, not even one of 0.
  if balance <= 0 or principal_amt > balance then
    raise exception 'loan balance exceeded';
  end if;

  -- A category named on a part must be the company's and fit that part (0128, 0130), so a part
  -- the owner moved to another fitting category keeps it through an edit or an unmatch undo.
  for part in select value from jsonb_array_elements(p_parts) where value ? 'category_id'
  loop
    if not exists (
      select 1 from public.categories c
      where c.company_id = cid and c.id = (part->>'category_id')::uuid
    ) then
      raise exception 'category not found';
    end if;
    if not private.loan_part_category_ok(
      cid, (part->>'part')::public.loan_split_part, (part->>'category_id')::uuid
    ) then
      raise exception 'category does not fit the loan part';
    end if;
  end loop;
  cat_fees := coalesce(call_fees_cat,
    private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date));
  if has_fees and cat_fees is null then
    raise exception 'fees category required';
  end if;

  cat_interest := coalesce(call_interest_cat,
    private.loan_part_category_on(cid, p_loan_id, 'interest', txn.doc_date));
  cat_escrow := coalesce(call_escrow_cat,
    private.loan_part_category_on(cid, p_loan_id, 'escrow', txn.doc_date));
  cat_principal := coalesce(call_principal_cat,
    private.loan_part_category_on(cid, p_loan_id, 'principal', txn.doc_date));
  if cat_interest is null or cat_escrow is null or cat_principal is null then
    raise exception 'loan categories missing';
  end if;

  select jsonb_agg(jsonb_build_object(
    'part', e.value->>'part',
    'amount_minor', (e.value->>'amount_minor')::bigint,
    'scheduled_minor', (e.value->>'scheduled_minor')::bigint,
    'category_id', case e.value->>'part'
      when 'interest' then cat_interest
      when 'escrow' then cat_escrow
      when 'principal' then cat_principal
      when 'fees' then cat_fees
    end
  ) order by array_position(array['interest', 'escrow', 'principal', 'fees'], e.value->>'part'))
  into result
  from jsonb_array_elements(p_parts) e;

  result := jsonb_build_object(
    'transaction_id', p_transaction_id,
    'loan_id', p_loan_id,
    'replaced', attached is not null,
    'balance_after_minor', balance - principal_amt,
    'parts', result
  );
  if p_preview then
    return result;
  end if;

  -- The new parts replace the line's (none flagged), checked and posted by the writer.
  perform private.set_loan_parts(cid, p_transaction_id, p_loan_id, result->'parts');
  return result;
exception
  when check_violation then
    if sqlerrm = 'loan_split_balance' then
      raise exception 'loan balance exceeded';
    elsif sqlerrm = 'loan_closed' then
      raise exception 'loan closed';
    end if;
    raise;
end;
$function$;

create or replace function public.clear_loan_split(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  attached uuid;
  removed jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 where private.is_read_only()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_transaction_id is null then
    raise exception 'validation';
  end if;

  select s.loan_id into attached
  from private.loan_parts s
  where s.transaction_id = p_transaction_id and s.company_id = cid
  limit 1;

  -- The loan first, then the line: the order every loan split write takes (no deadlock).
  if attached is not null then
    perform 1 from public.loans l where l.id = attached and l.company_id = cid for update;
  end if;
  perform 1
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  -- Attached or detached by another write while this one waited for the locks: the caller
  -- retries (40001 is a retry, not a refusal, so MCP does not store it under its key).
  if (select s.loan_id from private.loan_parts s
      where s.transaction_id = p_transaction_id and s.company_id = cid limit 1)
     is distinct from attached then
    raise exception 'loan split changed' using errcode = '40001';
  end if;

  select jsonb_agg(jsonb_build_object(
    'part', s.part,
    'amount_minor', s.amount_minor,
    'scheduled_minor', s.scheduled_minor,
    'category_id', s.category_id,
    'needs_review', s.needs_review
  ) order by s.part)
  into removed
  from private.loan_parts s
  where s.transaction_id = p_transaction_id
    and s.company_id = cid
    and s.loan_id = attached;

  if removed is null then
    raise exception 'line has no loan split';
  end if;

  -- The line posts whole again.
  perform private.set_loan_parts(cid, p_transaction_id, attached, null);

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'loan_id', attached,
    'parts', removed
  );
end;
$function$;

create or replace function public.clear_loan_split_review(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  company uuid;
  parts integer;
begin
  company := private.current_company_id();
  if company is null then
    raise exception 'loan_split_review_denied' using errcode = '42501';
  end if;

  select count(*)::integer
  into parts
  from private.loan_parts s
  where s.transaction_id = p_transaction_id
    and s.company_id = company;

  if parts = 0 then
    raise exception 'loan_split_review_denied' using errcode = '42501';
  end if;

  -- Clearing the flag re-checks the closed loan and the loan rules, and posts the line.
  perform private.set_loan_parts_review(company, p_transaction_id, false);
end;
$function$;

create or replace function public.mcp_attach_loan_payment(p_idempotency_key text, p_transaction_id uuid, p_loan_id uuid, p_parts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  txn record;
  loan record;
  balance bigint;
  part jsonb;
  part_sum bigint := 0;
  principal_amt bigint := 0;
  parts_ok boolean;
  written jsonb;
  cat_interest uuid;
  cat_escrow uuid;
  cat_principal uuid;
  cat_fees uuid;
  call_fees_cat uuid;
  call_interest_cat uuid;
  call_escrow_cat uuid;
  call_principal_cat uuid;
  has_fees boolean := false;
  line record;
  inherited boolean := false;
  inherit_reason text;
  reassign_id uuid;
  write_prior jsonb;
  cur_role public.pnl_role;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_loan_id is null
    or p_parts is null
    or jsonb_typeof(p_parts) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_split|' || p_transaction_id::text || '|' || p_loan_id::text || '|' || p_parts::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Lock the loan before the transaction: every loan part write takes its locks in
    -- that order (loan, then transaction), so the reverse deadlocks.
    perform 1 from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;

    select t.currency, t.amount_original, t.doc_date
    into txn
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;

    if not found then
      response := private.mcp_refused('transaction not found');
    elsif exists (
      select 1 from private.loan_parts s where s.transaction_id = p_transaction_id
    ) then
      response := private.mcp_refused('loan already attached');
    else
      select l.currency, l.project_id, l.kind, l.start_date,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id,
             l.fees_category_id
      into loan
      from public.loans l
      where l.id = p_loan_id
        and l.company_id = cid
      for update;

      if not found then
        response := private.mcp_refused('loan not found');
      elsif loan.currency is distinct from txn.currency then
        response := private.mcp_refused('loan currency mismatch');
      elsif loan.kind = 'demand'::public.loan_kind and txn.doc_date < loan.start_date then
        response := private.mcp_refused('payment before the loan start');
      elsif loan.kind = 'demand'::public.loan_kind and exists (
        select 1
        from private.loan_parts s
        join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
        where s.loan_id = p_loan_id
          and s.company_id = cid
          and t.removed_at is null
          and not s.needs_review
          and t.doc_date > txn.doc_date
      ) then
        -- Interest runs from the last payment, so payments are attached in date order.
        response := private.mcp_refused('a later payment is already attached');
      else
        select b.balance_minor into balance
        from public.loan_balances b
        where b.company_id = cid and b.loan_id = p_loan_id;

        if coalesce(balance, 0) <= 0 then
          response := private.mcp_refused('loan balance exceeded');
        else
          -- Exactly interest, escrow and principal, once each, plus at most one fees part
          -- above zero (0130), as whole non-negative minor units. Only the fees part may
          -- name a category_id (a uuid string): this payment's fees category.
          select count(*) in (3, 4)
             and count(distinct e.value->>'part') = count(*)
             and count(*) filter (where e.value->>'part' in ('interest', 'escrow', 'principal')) = 3
             -- coalesce: a missing key is null, and bool_and would skip it.
             and bool_and(coalesce(
               jsonb_typeof(e.value) = 'object'
               and e.value->>'part' in ('interest', 'escrow', 'principal', 'fees')
               and jsonb_typeof(e.value->'amount_minor') = 'number'
               and jsonb_typeof(e.value->'scheduled_minor') = 'number'
               and (e.value->>'amount_minor') ~ '^[0-9]{1,18}$'
               and (e.value->>'scheduled_minor') ~ '^[0-9]{1,18}$'
               and (e.value->>'part' <> 'fees' or (e.value->>'amount_minor') !~ '^0+$')
               and (
                 not (e.value ? 'category_id')
                 or (
                   jsonb_typeof(e.value->'category_id') = 'string'
                   and e.value->>'category_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 )
               ),
               false
             ))
          into parts_ok
          from jsonb_array_elements(p_parts) e;

          if coalesce(parts_ok, false) then
            for part in select value from jsonb_array_elements(p_parts)
            loop
              part_sum := part_sum + (part->>'amount_minor')::bigint;
              if part->>'part' = 'principal' then
                principal_amt := (part->>'amount_minor')::bigint;
              end if;
              if part->>'part' = 'fees' then
                has_fees := true;
                call_fees_cat := (part->>'category_id')::uuid;
              end if;
              if part->>'part' = 'interest' then
                call_interest_cat := (part->>'category_id')::uuid;
              elsif part->>'part' = 'escrow' then
                call_escrow_cat := (part->>'category_id')::uuid;
              elsif part->>'part' = 'principal' then
                call_principal_cat := (part->>'category_id')::uuid;
              end if;
            end loop;
          end if;

          if not coalesce(parts_ok, false) or part_sum is distinct from txn.amount_original then
            response := private.mcp_refused('invalid loan parts');
          elsif principal_amt > balance then
            response := private.mcp_refused('loan balance exceeded');
          elsif exists (
            select 1 from jsonb_array_elements(p_parts) e
            where e.value ? 'category_id'
              and not exists (
                select 1 from public.categories c
                where c.company_id = cid and c.id = (e.value->>'category_id')::uuid
              )
          ) then
            response := private.mcp_refused('category not found');
          elsif exists (
            select 1 from jsonb_array_elements(p_parts) e
            where e.value ? 'category_id'
              and not private.loan_part_category_ok(
                cid, (e.value->>'part')::public.loan_split_part, (e.value->>'category_id')::uuid
              )
          ) then
            response := private.mcp_refused('category does not fit the loan part');
          elsif has_fees and call_fees_cat is not null and not exists (
            select 1 from public.categories c where c.company_id = cid and c.id = call_fees_cat
          ) then
            response := private.mcp_refused('category not found');
          elsif has_fees and call_fees_cat is not null
            and not private.loan_part_category_ok(cid, 'fees', call_fees_cat)
          then
            response := private.mcp_refused('category does not fit the loan part');
          elsif has_fees and coalesce(
            call_fees_cat, private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date)
          ) is null then
            -- No default for fees: the call or the loan names the category (owner, 2026-10-08).
            response := private.mcp_refused('fees category required');
          else
            -- The loan's own category for a part wins; null keeps the keyed default (0128).
            cat_interest := coalesce(call_interest_cat,
              private.loan_part_category_on(cid, p_loan_id, 'interest', txn.doc_date));
            cat_escrow := coalesce(call_escrow_cat,
              private.loan_part_category_on(cid, p_loan_id, 'escrow', txn.doc_date));
            cat_principal := coalesce(call_principal_cat,
              private.loan_part_category_on(cid, p_loan_id, 'principal', txn.doc_date));
            if cat_interest is null then
              select c.id into cat_interest
              from public.categories c
              where c.company_id = cid and c.loan_part = 'interest'::public.loan_split_part;
            end if;
            if cat_escrow is null then
              select c.id into cat_escrow
              from public.categories c
              where c.company_id = cid and c.loan_part = 'escrow'::public.loan_split_part;
            end if;
            if cat_principal is null then
              select c.id into cat_principal
              from public.categories c
              where c.company_id = cid and c.loan_part = 'principal'::public.loan_split_part;
            end if;
            -- Fees go to this call's category, else the loan's; there is no default (0130).
            cat_fees := coalesce(call_fees_cat,
              private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date));

            if cat_interest is null or cat_escrow is null or cat_principal is null then
              response := private.mcp_refused('loan categories missing');
            else
              -- The writer checks the loan rules and posts the line.
              perform private.set_loan_parts(cid, p_transaction_id, p_loan_id, (
                select jsonb_agg(jsonb_build_object(
                  'part', e.value->>'part',
                  'amount_minor', (e.value->>'amount_minor')::bigint,
                  'scheduled_minor', (e.value->>'scheduled_minor')::bigint,
                  'category_id', case (e.value->>'part')
                    when 'interest' then cat_interest
                    when 'escrow' then cat_escrow
                    when 'principal' then cat_principal
                    when 'fees' then cat_fees
                  end
                ))
                from jsonb_array_elements(p_parts) e
              ));

              -- The split parts count under the loan's project through the line's
              -- own project. Only a line with no project, no shares and no role
              -- inherits it. Anything the owner already set is left alone.
              select t.project_id, t.pnl_role, t.category_id, t.category_suggested
              into line
              from public.transactions t
              where t.id = p_transaction_id
                and t.company_id = cid;

              if loan.project_id is null then
                inherit_reason := 'loan has no project';
              elsif line.project_id is not null then
                inherit_reason := 'line already has a project';
              elsif line.pnl_role is not distinct from 'shared'::public.pnl_role
                or exists (
                  select 1 from public.allocations a
                  where a.transaction_id = p_transaction_id and a.company_id = cid
                )
              then
                inherit_reason := 'line has shares';
              elsif line.pnl_role is not null then
                inherit_reason := 'line has a role';
              elsif line.category_id is null then
                inherit_reason := 'line has no category';
              elsif line.category_suggested then
                -- Filing the line would confirm a guess and close its review item.
                inherit_reason := 'line category is a guess';
              else
                -- The same rule as assign_expense: a direct cost on the project.
                -- A failure here leaves the line as it was; the parts stay attached.
                begin
                  reassign_id := public.reassign_transaction(
                    p_transaction_id, loan.project_id, line.category_id
                  );
                  inherited := true;
                exception
                  when deadlock_detected or serialization_failure or lock_not_available then
                    raise;
                  when others then
                    inherit_reason := 'project not set';
                end;
              end if;

              if inherited then
                -- The role reassign_transaction gave the line: project for an expense
                -- category, none for an income (reversal) category. Undo checks it.
                select t.pnl_role into cur_role
                from public.transactions t
                where t.id = p_transaction_id
                  and t.company_id = cid;
                write_prior := jsonb_build_object(
                  'project_id', loan.project_id,
                  'category_id', line.category_id,
                  'pnl_role', cur_role
                );
              end if;

              -- Kept so undo can tell whether the app corrected the split afterwards.
              select jsonb_agg(jsonb_build_object(
                'part', s.part,
                'amount_minor', s.amount_minor,
                'category_id', s.category_id
              ) order by s.part)
              into written
              from private.loan_parts s
              where s.transaction_id = p_transaction_id;
              write_prior := coalesce(write_prior, '{}'::jsonb)
                || jsonb_build_object('parts', written);

              -- FLOW-151: the line had no loan split, so an open loan_split write on it is stale
              -- (detach_loan_payment leaves it open). Supersede it, as a review write is, so the
              -- one open write per line is this attach, which undo targets.
              update private.mcp_writes
              set undone_at = clock_timestamp()
              where user_id = auth.uid()
                and kind = 'loan_split'
                and transaction_id = p_transaction_id
                and undone_at is null;

              insert into private.mcp_writes (
                token_id, user_id, kind, loan_id, transaction_id, reassign_id, prior
              )
              values (
                token, auth.uid(), 'loan_split', p_loan_id, p_transaction_id, reassign_id, write_prior
              );

              response := jsonb_build_object(
                'ok', true,
                'data', jsonb_build_object(
                  'loan_id', p_loan_id,
                  'transaction_id', p_transaction_id,
                  'project_inherited', inherited,
                  'project_id', case when inherited then loan.project_id end,
                  'project_inherited_reason', inherit_reason,
                  'undo_kind', 'loan_split'
                )
              );
            end if;
          end if;
        end if;
      end if;
    end if;
  exception
    when check_violation then
      if sqlerrm = 'loan_split_balance' then
        response := private.mcp_refused('loan balance exceeded');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function public.mcp_set_loan_category_from(p_idempotency_key text, p_loan_id uuid, p_part text, p_effective_date date, p_category_id uuid, p_apply_to_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  part_key public.loan_split_part;
  loan record;
  cur record;
  switch_id uuid;
  next_date date;
  item record;
  target uuid;
  moved jsonb := '[]'::jsonb;
  shown jsonb := '[]'::jsonb;
  write_id uuid;
  refusal text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or p_part is null
    or p_part not in ('interest', 'escrow', 'principal', 'fees')
    or p_effective_date is null
    or p_apply_to_existing is null
  then
    return private.mcp_error('validation', 'validation');
  end if;
  part_key := p_part::public.loan_split_part;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_category_from|' || p_loan_id::text || '|' || p_part || '|' || p_effective_date::text || '|'
    || coalesce(p_category_id::text, 'null') || '|' || p_apply_to_existing::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    select l.id, l.start_date into loan
    from public.loans l
    where l.id = p_loan_id and l.company_id = cid
    for no key update;

    if not found then
      refusal := 'loan not found';
    elsif p_effective_date < loan.start_date then
      refusal := 'switch before the loan start';
    elsif p_category_id is not null and not exists (
      select 1 from public.categories c where c.company_id = cid and c.id = p_category_id
    ) then
      refusal := 'category not found';
    elsif p_category_id is not null and not private.loan_part_category_ok(cid, part_key, p_category_id) then
      refusal := 'category does not fit the loan part';
    end if;

    if refusal is null then
      select w.id, w.category_id into cur
      from public.loan_category_switches w
      where w.company_id = cid and w.loan_id = p_loan_id and w.part = part_key
        and w.effective_date = p_effective_date
      for update;
      if not found and p_category_id is null then
        refusal := 'switch not found';
      end if;
    end if;

    if refusal is not null then
      response := private.mcp_refused(refusal);
    else
      if p_category_id is null then
        delete from public.loan_category_switches w where w.id = cur.id;
        switch_id := cur.id;
      elsif cur.id is null then
        insert into public.loan_category_switches (company_id, loan_id, part, effective_date, category_id)
        values (cid, p_loan_id, part_key, p_effective_date, p_category_id)
        returning id into switch_id;
      else
        update public.loan_category_switches w set category_id = p_category_id where w.id = cur.id;
        switch_id := cur.id;
      end if;

      if p_apply_to_existing then
        -- The payments this switch now decides: from its date until the next switch.
        select min(w.effective_date) into next_date
        from public.loan_category_switches w
        where w.company_id = cid and w.loan_id = p_loan_id and w.part = part_key
          and w.effective_date > p_effective_date;
        perform 1 from public.transactions t
        where t.company_id = cid
          and t.id in (select s.transaction_id from private.loan_parts s
                       where s.company_id = cid and s.loan_id = p_loan_id and s.part = part_key)
        order by t.id
        for update;
        for item in
          -- split_id keeps the undo payload's shape; a part's leg is rewritten on every posting, so the undo
          -- finds the part by its line and part.
          select s.leg_id as split_id, s.transaction_id, s.category_id, t.doc_date
          from private.loan_parts s
          join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
          where s.company_id = cid
            and s.loan_id = p_loan_id
            and s.part = part_key
            and t.removed_at is null
            and t.doc_date >= p_effective_date
            and (next_date is null or t.doc_date < next_date)
          order by t.doc_date, s.transaction_id
        loop
          target := private.loan_part_category_on(cid, p_loan_id, part_key, item.doc_date);
          if target is null then
            raise exception 'fees category required';
          end if;
          if target is distinct from item.category_id then
            perform private.set_loan_part_category(cid, item.transaction_id, part_key, target);
            moved := moved || jsonb_build_object(
              'split_id', item.split_id, 'transaction_id', item.transaction_id,
              'before', item.category_id, 'written', target);
            shown := shown || jsonb_build_object(
              'transaction_id', item.transaction_id, 'doc_date', item.doc_date,
              'previous_category_id', item.category_id, 'category_id', target);
          end if;
        end loop;
      end if;

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, company_id, prior, created_at)
      values (
        token, auth.uid(), 'loan_category_from', p_loan_id, cid,
        jsonb_build_object(
          'part', p_part,
          'effective_date', p_effective_date,
          'switch_id', switch_id,
          'before', cur.category_id,
          'after', p_category_id,
          'moved', moved
        ),
        clock_timestamp()
      )
      returning id into write_id;

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', write_id,
          'loan_id', p_loan_id,
          'part', p_part,
          'effective_date', p_effective_date,
          'category_id', p_category_id,
          'previous_category_id', cur.category_id,
          'moved', shown,
          'undo_kind', 'loan_category_from'
        )
      );
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function public.mcp_set_loan_part_category(p_idempotency_key text, p_transaction_ids uuid[], p_part text, p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  part_key public.loan_split_part;
  ids uuid[];
  item record;
  target uuid;
  written_rows jsonb := '[]'::jsonb;
  shown jsonb := '[]'::jsonb;
  write_id uuid;
  refusal text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_ids is null
    or cardinality(p_transaction_ids) < 1
    or cardinality(p_transaction_ids) > 100
    or array_position(p_transaction_ids, null) is not null
    or p_part is null
    or p_part not in ('interest', 'escrow', 'principal', 'fees')
  then
    return private.mcp_error('validation', 'validation');
  end if;
  ids := array(select distinct x from unnest(p_transaction_ids) x order by x);
  if cardinality(ids) <> cardinality(p_transaction_ids) then
    return private.mcp_error('validation', 'validation');
  end if;
  part_key := p_part::public.loan_split_part;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_part_category|' || p_part || '|' || coalesce(p_category_id::text, 'null') || '|'
    || array_to_string(ids, ',');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- The loans first, in id order, then the lines: the order every loan split write takes.
    perform 1 from public.loans l
    where l.company_id = cid
      and l.id in (
        select s.loan_id from private.loan_parts s
        where s.company_id = cid and s.transaction_id = any (ids)
      )
    order by l.id
    for no key update;
    perform 1 from public.transactions t
    where t.company_id = cid and t.id = any (ids)
    order by t.id
    for update;

    if (
      select count(*) from public.transactions t
      where t.company_id = cid and t.id = any (ids) and t.removed_at is null
    ) <> cardinality(ids) then
      refusal := 'transaction not found';
    elsif exists (
      select 1 from unnest(ids) x
      where not exists (
        select 1 from private.loan_parts s where s.company_id = cid and s.transaction_id = x
      )
    ) then
      refusal := 'line has no loan split';
    elsif exists (
      select 1 from unnest(ids) x
      where not exists (
        select 1 from private.loan_parts s
        where s.company_id = cid and s.transaction_id = x and s.part = part_key
      )
    ) then
      refusal := 'payment has no such part';
    elsif p_category_id is not null and not exists (
      select 1 from public.categories c where c.company_id = cid and c.id = p_category_id
    ) then
      refusal := 'category not found';
    elsif p_category_id is not null and not private.loan_part_category_ok(cid, part_key, p_category_id) then
      refusal := 'category does not fit the loan part';
    end if;

    if refusal is not null then
      response := private.mcp_refused(refusal);
    else
      for item in
        -- split_id keeps the undo payload's shape; a part's leg is rewritten on every posting, so the undo
        -- finds the part by its line and part.
        select s.leg_id as split_id, s.transaction_id, s.loan_id, s.category_id, t.doc_date
        from private.loan_parts s
        join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
        where s.company_id = cid and s.transaction_id = any (ids) and s.part = part_key
        order by s.transaction_id
      loop
        -- null: back to the category the payment would take today (a switch, the loan's, or
        -- the default), for its own date.
        target := coalesce(p_category_id, private.loan_part_category_on(cid, item.loan_id, part_key, item.doc_date));
        if target is null then
          raise exception 'fees category required';
        end if;
        if target is distinct from item.category_id then
          perform private.set_loan_part_category(cid, item.transaction_id, part_key, target);
        end if;
        written_rows := written_rows || jsonb_build_object(
          'split_id', item.split_id, 'transaction_id', item.transaction_id, 'loan_id', item.loan_id,
          'before', item.category_id, 'written', target);
        shown := shown || jsonb_build_object(
          'transaction_id', item.transaction_id, 'loan_id', item.loan_id,
          'previous_category_id', item.category_id, 'category_id', target);
      end loop;

      insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
      values (
        token, auth.uid(), 'loan_part_category', cid,
        jsonb_build_object('part', p_part, 'category_id', p_category_id, 'rows', written_rows),
        clock_timestamp()
      )
      returning id into write_id;

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', write_id,
          'part', p_part,
          'category_id', p_category_id,
          'lines', shown,
          'undo_kind', 'loan_part_category'
        )
      );
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function private.loan_restore(p_company_id uuid, p_snapshot jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  loan_row public.loans;
  lines uuid[];
  locked integer;
  line uuid;
begin
  loan_row := jsonb_populate_record(null::public.loans, p_snapshot->'loan');
  if loan_row.id is null or loan_row.company_id is distinct from p_company_id then
    raise exception 'loan cannot be restored' using errcode = '23514';
  end if;
  if not exists (select 1 from public.projects p where p.id = loan_row.project_id and p.company_id = p_company_id) then
    loan_row.project_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.interest_category_id and c.company_id = p_company_id) then
    loan_row.interest_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.escrow_category_id and c.company_id = p_company_id) then
    loan_row.escrow_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.principal_category_id and c.company_id = p_company_id) then
    loan_row.principal_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.fees_category_id and c.company_id = p_company_id) then
    loan_row.fees_category_id := null;
  end if;
  -- FLOW-962: a new loan deleted since leaves no link, as its on delete set null would have.
  if loan_row.refinanced_into_id is not null and not exists (
    select 1 from public.loans l where l.id = loan_row.refinanced_into_id and l.company_id = p_company_id
  ) then
    loan_row.refinanced_into_id := null;
  end if;

  select coalesce(array_agg(distinct (e.value->>'transaction_id')::uuid), '{}')
  into lines
  from jsonb_array_elements(coalesce(p_snapshot->'parts', '[]'::jsonb)) e;

  select count(*) into locked
  from (
    select t.id
    from public.transactions t
    where t.company_id = p_company_id
      and t.id = any (lines)
    order by t.id
    for update
  ) l;
  if locked <> cardinality(lines)
     or exists (select 1 from public.loans l where l.id = loan_row.id)
     or exists (
       select 1 from private.loan_parts s
       where s.company_id = p_company_id and s.transaction_id = any (lines)
     )
  then
    raise exception 'loan cannot be restored' using errcode = '23514';
  end if;

  insert into public.loans select (loan_row).*;
  insert into public.loan_rates (id, company_id, loan_id, effective_date, annual_rate_ppm, created_at, updated_at)
  select r.id, r.company_id, r.loan_id, r.effective_date, r.annual_rate_ppm, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.loan_rates, coalesce(p_snapshot->'rates', '[]'::jsonb)) r;
  insert into public.loan_category_switches (id, company_id, loan_id, part, effective_date, category_id, created_at, updated_at)
  select w.id, w.company_id, w.loan_id, w.part, w.effective_date, w.category_id, w.created_at, w.updated_at
  from jsonb_populate_recordset(null::public.loan_category_switches, coalesce(p_snapshot->'switches', '[]'::jsonb)) w
  where private.loan_part_category_ok(w.company_id, w.part, w.category_id);
  -- Each line gets its parts back through the writer, which checks the loan rules and posts it.
  foreach line in array lines loop
    perform private.set_loan_parts(p_company_id, line, loan_row.id, (
      select jsonb_agg(jsonb_build_object(
        'part', e.value->>'part',
        'amount_minor', (e.value->>'amount_minor')::bigint,
        'scheduled_minor', (e.value->>'scheduled_minor')::bigint,
        'category_id', (e.value->>'category_id')::uuid,
        'needs_review', coalesce((e.value->>'needs_review')::boolean, false)
      ))
      from jsonb_array_elements(coalesce(p_snapshot->'parts', '[]'::jsonb)) e
      where (e.value->>'transaction_id')::uuid = line
    ));
  end loop;
  -- FLOW-962: the loans that named this one before the delete, while they are still unlinked.
  update public.loans l
  set refinanced_into_id = loan_row.id
  where l.company_id = p_company_id
    and l.refinanced_into_id is null
    and l.id <> loan_row.id
    and l.id in (
      select e.value::uuid from jsonb_array_elements_text(coalesce(p_snapshot->'referrers', '[]'::jsonb)) e
    );
exception
  when check_violation or foreign_key_violation or unique_violation or not_null_violation then
    raise exception 'loan cannot be restored' using errcode = '23514';
end;
$function$;

create or replace function public.delete_loan(p_loan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  loan_row public.loans;
  rates jsonb;
  switches jsonb;
  parts jsonb;
  payments integer;
  deletion uuid;
  referrers jsonb;
  line record;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 where private.is_read_only()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_loan_id is null then
    raise exception 'validation';
  end if;

  -- The loan first, then its lines: the order every loan split write takes (no deadlock).
  select * into loan_row
  from public.loans l
  where l.id = p_loan_id and l.company_id = cid
  for update;
  if not found then
    raise exception 'loan not found';
  end if;
  perform 1
  from public.transactions t
  where t.company_id = cid
    and t.id in (select s.transaction_id from private.loan_parts s where s.loan_id = p_loan_id and s.company_id = cid)
  order by t.id
  for update;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.effective_date), '[]'::jsonb)
  into rates
  from public.loan_rates r
  where r.loan_id = p_loan_id and r.company_id = cid;
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', s.transaction_id,
      'part', s.part,
      'amount_minor', s.amount_minor,
      'scheduled_minor', s.scheduled_minor,
      'category_id', s.category_id,
      'needs_review', s.needs_review
    ) order by s.transaction_id, s.part), '[]'::jsonb),
    count(distinct s.transaction_id) filter (where t.removed_at is null)::integer
  into parts, payments
  from private.loan_parts s
  join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
  where s.loan_id = p_loan_id and s.company_id = cid;

  -- FLOW-962: the loans that name this one as their refinance, for the restore to relink.
  select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb)
  into referrers
  from public.loans r
  where r.company_id = cid and r.refinanced_into_id = p_loan_id;

  select coalesce(jsonb_agg(to_jsonb(w) order by w.part, w.effective_date), '[]'::jsonb)
  into switches
  from public.loan_category_switches w
  where w.loan_id = p_loan_id and w.company_id = cid;

  -- Each payment line loses its loan parts and posts whole again; the rates and switches go
  -- with the loan (on delete cascade).
  for line in
    select distinct s.transaction_id from private.loan_parts s
    where s.loan_id = p_loan_id and s.company_id = cid
    order by s.transaction_id
  loop
    perform private.set_loan_parts(cid, line.transaction_id, p_loan_id, null);
  end loop;
  delete from public.loans l where l.id = p_loan_id and l.company_id = cid;

  insert into private.loan_deletions (company_id, loan_id, user_id, snapshot)
  values (cid, p_loan_id, auth.uid(),
    jsonb_build_object('loan', to_jsonb(loan_row), 'rates', rates, 'parts', parts, 'referrers', referrers,
      'switches', switches))
  returning id into deletion;

  return jsonb_build_object(
    'loan_id', p_loan_id,
    'name', loan_row.name,
    'payments', payments,
    'deletion_id', deletion
  );
end;
$function$;

create or replace function public.get_loan_split(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with parts as (
    select s.part, s.amount_minor, s.needs_review, s.loan_id, s.category_id
    from private.loan_parts s
    join public.transactions t on t.id = s.transaction_id
    where s.transaction_id = p_transaction_id
      and t.removed_at is null
      and s.company_id = (select private.readable_company_id())
  ),
  counted as (
    select l.part, l.in_pnl
    from private.pnl_lines l
    where l.transaction_id = p_transaction_id
      and l.part is not null
  )
  select case when not exists (select 1 from parts) then null else jsonb_build_object(
    'loan_id', (select min(loan_id::text)::uuid from parts),
    'loan_name', (
      select l.name from public.loans l
      where l.id = (select min(loan_id::text)::uuid from parts)
    ),
    'needs_review', (select bool_or(needs_review) from parts),
    'by_parts', exists (select 1 from counted),
    'parts', (
      select jsonb_agg(jsonb_build_object(
        'part', p.part,
        'amount_minor', p.amount_minor,
        'in_pnl', c.in_pnl,
        'category_id', p.category_id,
        'category_name', cat.name
      ) order by case p.part::text when 'interest' then 0 when 'escrow' then 1 when 'principal' then 2 else 3 end)
      from parts p
      left join counted c on c.part = p.part
      left join public.categories cat on cat.id = p.category_id
    )
  ) end;
$function$;

create or replace function public.mcp_list_loans()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'currency', l.currency,
    'principal_minor', l.principal_minor,
    'annual_rate_ppm', l.annual_rate_ppm,
    'term_months', l.term_months,
    'start_date', l.start_date,
    'payment_minor', l.payment_minor,
    'escrow_minor', l.escrow_minor,
    'balance_minor', b.balance_minor,
    'flagged_parts', b.flagged_parts,
    'flagged_transaction_ids', coalesce((
      select jsonb_agg(f.transaction_id order by f.transaction_id)
      from (
        select distinct s.transaction_id
        from private.loan_parts s
        join public.transactions t
          on t.company_id = s.company_id
         and t.id = s.transaction_id
        where s.company_id = l.company_id
          and s.loan_id = l.id
          and s.needs_review
          and t.removed_at is null
          and t.line_status is distinct from 'void'::public.line_status
      ) f
    ), '[]'::jsonb),
    'project_id', l.project_id,
    'project_name', pr.name,
    'status', l.status,
    'closed_on', l.closed_on,
    'interest_category_id', l.interest_category_id,
    'interest_category_name', ci.name,
    'escrow_category_id', l.escrow_category_id,
    'escrow_category_name', ce.name,
    'principal_category_id', l.principal_category_id,
    'principal_category_name', cp.name,
    'fees_category_id', l.fees_category_id,
    'fees_category_name', cf.name,
    'kind', l.kind,
    'interest_only_months', l.interest_only_months,
    'amortization_months', l.amortization_months,
    'rate_index', l.rate_index,
    'rate_margin_ppm', l.rate_margin_ppm,
    'refinanced_into_id', l.refinanced_into_id,
    'category_switches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'part', w.part,
        'effective_date', w.effective_date,
        'category_id', w.category_id,
        'category_name', wc.name
      ) order by w.part, w.effective_date)
      from public.loan_category_switches w
      left join public.categories wc on wc.company_id = w.company_id and wc.id = w.category_id
      where w.company_id = l.company_id
        and w.loan_id = l.id
    ), '[]'::jsonb),
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'effective_date', r.effective_date,
        'annual_rate_ppm', r.annual_rate_ppm
      ) order by r.effective_date)
      from public.loan_rates r
      where r.company_id = l.company_id
        and r.loan_id = l.id
    ), '[]'::jsonb)
  ) order by l.sort_order nulls last, l.name, l.id), '[]'::jsonb)
  from public.loans l
  join public.loan_balances b
    on b.company_id = l.company_id
   and b.loan_id = l.id
  left join public.projects pr
    on pr.company_id = l.company_id
   and pr.id = l.project_id
  left join public.categories ci
    on ci.company_id = l.company_id
   and ci.id = l.interest_category_id
  left join public.categories ce
    on ce.company_id = l.company_id
   and ce.id = l.escrow_category_id
  left join public.categories cp
    on cp.company_id = l.company_id
   and cp.id = l.principal_category_id
  left join public.categories cf
    on cf.company_id = l.company_id
   and cf.id = l.fees_category_id
  where l.company_id = (select private.current_company_id());
$function$;

create or replace function public.mcp_loan_payments(p_loan_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id', p.transaction_id,
    'doc_date', p.doc_date,
    'line_status', p.line_status,
    'needs_review', p.needs_review,
    'interest_minor', p.interest_minor,
    'escrow_minor', p.escrow_minor,
    'principal_minor', p.principal_minor,
    'fees_minor', p.fees_minor
  ) order by p.doc_date, p.transaction_id), '[]'::jsonb)
  from (
    select
      s.transaction_id,
      t.doc_date,
      t.line_status,
      bool_or(s.needs_review) as needs_review,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'interest'), 0)::bigint as interest_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'escrow'), 0)::bigint as escrow_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'principal'), 0)::bigint as principal_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'fees'), 0)::bigint as fees_minor
    from private.loan_parts s
    join public.transactions t
      on t.company_id = s.company_id
     and t.id = s.transaction_id
    where s.loan_id = p_loan_id
      and s.company_id = (select private.readable_company_id())
      and t.removed_at is null
      and t.line_status <> 'pending'
    group by s.transaction_id, t.doc_date, t.line_status
  ) p;
$function$;

create or replace function private.loans_close_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status <> 'open'::public.loan_status
     and (
       old.status is distinct from new.status
       or old.closed_on is distinct from new.closed_on
     )
  then
    perform 1
    from public.transactions t
    where t.company_id = new.company_id
      and t.id in (
        select s.transaction_id from private.loan_parts s
        where s.company_id = new.company_id and s.loan_id = new.id
      )
    order by t.id
    for share;
    if exists (
      select 1
      from private.loan_parts s
      join public.transactions t
        on t.company_id = s.company_id
       and t.id = s.transaction_id
      where s.company_id = new.company_id
        and s.loan_id = new.id
        and t.removed_at is null
        and t.doc_date > new.closed_on
    ) then
      raise exception 'loan_payments_after_close' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.loans_lock_currency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.currency is distinct from old.currency
     and exists (
       select 1
       from private.loan_parts s
       where s.company_id = old.company_id
         and s.loan_id = old.id
     )
  then
    raise exception 'loan_currency_locked' using errcode = '23514';
  end if;
  return new;
end;
$function$;


-- ===========================================================================
-- 40 book_line, journal entries, undo and the legs readers (decision 0232).
-- book_line writes its split through the writer API; every read of legs on the books skips draft legs.
-- FLOW-152: a journal entry may be on balance-sheet accounts only, and takes user accounts.
-- ===========================================================================

-- 50_accounts adds these with the chart of accounts; here too, so this fragment stands on its own.
alter table public.accounts add column if not exists archived_at timestamptz;
alter table public.accounts add column if not exists is_system boolean not null default false;

-- ---------------------------------------------------------------------------
-- book_line's core: validate the legs, write the line and its parts, check the posted legs.
-- ---------------------------------------------------------------------------
create or replace function private.book_line_core(p_company uuid, p_direction text, p_doc_date date, p_currency text, p_description text, p_legs jsonb, p_project_id uuid, p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rid uuid;
  line public.transactions%rowtype;
  bank_legs integer;
  bank_amt bigint;
  content integer;
  leg jsonb;
  ord integer;
  acct public.accounts%rowtype;
  cat public.categories%rowtype;
  amt bigint;
  post_to uuid;
  part_cat uuid;
  resolved jsonb := '[]'::jsonb;
  parts jsonb;
  part_count integer;
  one_part jsonb;
  default_project uuid;
  want jsonb;
  got jsonb;
  before_parts jsonb;
  written jsonb;
begin
  -- The existing line first: the caller's, posted, the same direction, VAT-free, no loan split and no
  -- open review (split_line's own messages).
  if p_transaction_id is not null then
    select * into line from public.transactions t
    where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
    for update;
    if not found then
      raise exception 'transaction not found';
    end if;
    if line.line_status is distinct from 'posted' then
      raise exception 'book_line: the line is not posted';
    end if;
    if line.direction::text is distinct from p_direction then
      raise exception 'book_line: direction does not match the line';
    end if;
    if coalesce(line.vat_amount, 0) <> 0 then
      raise exception 'book_line: a line with VAT is a later phase';
    end if;
    if exists (select 1 from private.loan_parts s where s.company_id = cid and s.transaction_id = line.id) then
      raise exception 'line has a loan split';
    end if;
    if exists (
      select 1 from public.review_queue q
      where q.transaction_id = line.id and q.company_id = cid and q.status = 'open'
        and q.reason is distinct from 'split_mismatch'
    ) then
      raise exception 'line has an open review';
    end if;
    if line.in_pnl_override is false then
      raise exception 'book_line: the line is kept out of the P&L';
    end if;
  end if;
  if p_project_id is not null
    and not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid)
  then
    raise exception 'project not found';
  end if;

  -- Validate every leg (shape, company ownership, project ownership) and resolve it: the account it
  -- posts to and the category of its part (none for the bank leg).
  bank_legs := 0;
  bank_amt := 0;
  content := 0;
  for leg, ord in select e.value, e.ord from jsonb_array_elements(p_legs) with ordinality as e(value, ord)
  loop
    if jsonb_typeof(leg) <> 'object'
      or not (leg ? 'account_id') or not (leg ? 'amount_minor')
      or jsonb_typeof(leg->'amount_minor') <> 'number'
      or (leg->>'amount_minor') !~ '^-?[0-9]{1,15}$'
      or exists (select 1 from jsonb_object_keys(leg) k where k not in ('account_id', 'amount_minor', 'project_id'))
    then
      raise exception 'validation';
    end if;
    select * into acct from public.accounts a
    where a.id = (leg->>'account_id')::uuid and a.company_id = cid;
    if not found then
      raise exception 'account not found';
    end if;
    if (leg ? 'project_id') and jsonb_typeof(leg->'project_id') = 'string'
      and not exists (select 1 from public.projects p where p.id = (leg->>'project_id')::uuid and p.company_id = cid)
    then
      raise exception 'project not found';
    end if;
    amt := (leg->>'amount_minor')::bigint;
    if acct.is_bank then
      bank_legs := bank_legs + 1;
      bank_amt := amt;
      continue;
    end if;
    if amt = 0 then
      raise exception 'validation';
    end if;
    if acct.archived_at is not null then
      raise exception 'account is archived';
    end if;
    if acct.category_id is not null then
      -- A category account, read from the live category (the bridge row's copy is never trusted):
      -- in the P&L it posts to itself; kept out, to the category's balance-sheet account.
      select * into cat from public.categories c
      where c.id = acct.category_id and c.company_id = cid;
      if not found then
        raise exception 'account not found';
      end if;
      part_cat := cat.id;
      post_to := case when coalesce(cat.excluded_from_pnl, false)
                   then private.kept_out_account(cid, cat.id, cat.loan_part) else acct.id end;
    elsif acct.name = 'VAT control' then
      raise exception 'book_line: a VAT leg is a later phase';
    elsif acct.type not in ('income', 'expense') and acct.name <> 'Suspense' then
      -- A balance-sheet account (a system one or the person's own): a part in the kept-out category
      -- of the leg's side there.
      part_cat := private.ledger_mirror_category(cid, acct.id, amt > 0);
      post_to := acct.id;
    else
      raise exception 'book_line: unsupported account — use a category account or a balance-sheet account';
    end if;
    content := content + 1;
    resolved := resolved || jsonb_build_object(
      'ord', ord, 'acct', post_to, 'cat', part_cat,
      'proj', nullif(leg->>'project_id', '')::uuid, 'amt', amt);
  end loop;

  if bank_legs <> 1 then
    raise exception 'exactly one bank leg is required';
  end if;
  if content < 1 then
    raise exception 'at least one category leg is required';
  end if;
  if (select sum((value->>'amount_minor')::bigint) from jsonb_array_elements(p_legs)) <> 0 then
    raise exception 'legs do not balance';
  end if;
  -- The bank movement's sign is the line's direction (deposit = income, payment = expense).
  if bank_amt = 0 or (bank_amt > 0) <> (p_direction = 'income') then
    raise exception 'the bank leg sign must match the direction';
  end if;
  if p_transaction_id is not null and bank_amt <> line.amount_gross then
    raise exception 'book_line: the bank leg must equal the line amount';
  end if;
  -- A line switched into the P&L counts every part that has no loan part (decision 0112), so a kept-out
  -- part would land in profit.
  if p_transaction_id is not null and line.in_pnl_override is true and exists (
    select 1 from jsonb_to_recordset(resolved) as r(cat uuid)
    join public.categories c on c.id = r.cat and c.company_id = cid
    where c.excluded_from_pnl and c.loan_part is null
  ) then
    raise exception 'book_line: the line is switched into the P&L — clear set_line_pnl first';
  end if;

  -- The parts: one per (category, effective project, side). A leg opposite to the bank leg is a
  -- normal part; one with the bank leg's sign a gross-up part. Same category, project and sign merge.
  default_project := case when p_transaction_id is null then null else line.project_id end;
  select coalesce(jsonb_agg(jsonb_build_object(
        'category_id', g.category_id,
        'project_id', g.project_id,
        'amount_minor', g.amount_minor,
        'gross_up', g.gross_up
      ) order by g.first_at), '[]'::jsonb),
    count(*)
  into parts, part_count
  from (
    select r.cat as category_id,
      -- A normal part with no project stays on the line's project (and role); a gross-up part must
      -- name one, so it falls back to the line's project.
      coalesce(r.proj, p_project_id,
        case when sign(r.amt) = sign(bank_amt) then default_project end) as project_id,
      sign(r.amt) = sign(bank_amt) as gross_up,
      sum(abs(r.amt)) as amount_minor,
      min(r.ord) as first_at
    from jsonb_to_recordset(resolved) as r(ord integer, acct uuid, cat uuid, proj uuid, amt bigint)
    group by 1, 2, 3
  ) g;

  if p_transaction_id is null then
    if part_count = 1 then
      -- One category: a whole line of its own kind, as FLOW-948 booked it.
      one_part := parts->0;
      if (select c.kind::text from public.categories c
          where c.id = (one_part->>'category_id')::uuid and c.company_id = cid) is distinct from p_direction then
        raise exception 'category kind must match the direction';
      end if;
    end if;
    -- A posted line whose net is the bank movement (VAT-free).
    insert into public.transactions (
      company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date,
      source, idempotency_key, project_id, category_id, description, user_assigned
    )
    values (
      cid, p_direction::public.txn_direction,
      case
        when coalesce(current_setting('flow.journal_entry', true), '') <> 'on' then 'receipt'
        -- FLOW-151: income counts by its document kind, and invoice_receipt counts on both bases.
        when p_direction = 'income' then 'invoice_receipt'
        else 'other'
      end::public.doc_kind,
      'project', 'posted', p_currency,
      bank_amt, bank_amt, abs(bank_amt), 0, 'source', p_doc_date, p_doc_date,
      'manual', 'book:' || gen_random_uuid()::text,
      case when part_count = 1 then (one_part->>'project_id')::uuid else p_project_id end,
      case when part_count = 1 then (one_part->>'category_id')::uuid else null end,
      btrim(p_description), true
    )
    returning id into rid;
  else
    if part_count = 1 then
      raise exception 'book_line: one category leg on an existing line — use assign_expense';
    end if;
    rid := line.id;
    -- Exactly as mcp_split_line: the parts before (with percent, rest and gross_up), then the save.
    before_parts := private.line_split_parts_full(rid);
  end if;

  -- More than one part: a split. split_line's rules check it (a preview writes nothing), the writer API
  -- writes the parts as the line's legs, and the line becomes the person's choice, as a save does.
  if part_count > 1 then
    parts := public.save_line_split(rid, parts, true);
    perform private.set_line_parts(cid, rid, parts);
    update public.transactions t
    set user_assigned = true, category_suggested = false
    where t.id = rid and t.company_id = cid
      and (t.user_assigned is not true or t.category_suggested is not false);
    update public.review_queue q
    set status = 'changed', resolved_at = now()
    where q.company_id = cid and q.transaction_id = rid
      and q.status = 'open' and q.reason = 'unallocated_shared';
    if p_transaction_id is not null then
      written := private.line_split_parts(rid);
    end if;
  end if;

  -- Self-check: the item legs on the books must equal the request, per account (the one each leg
  -- posts to), effective project and sign. Parts the posting kept as draft do not count. Otherwise
  -- refuse (the whole write rolls back) rather than mis-book.
  want := coalesce((
    select jsonb_agg(jsonb_build_object('a', g.a, 'p', g.p, 'n', g.n) order by g.a::text, coalesce(g.p::text, ''), g.n)
    from (
      select r.acct as a, coalesce(r.proj, p_project_id, default_project) as p, sum(r.amt)::bigint as n
      from jsonb_to_recordset(resolved) as r(acct uuid, proj uuid, amt bigint)
      group by 1, 2, sign(r.amt)
    ) g
  ), '[]'::jsonb);
  got := coalesce((
    select jsonb_agg(jsonb_build_object('a', g.a, 'p', g.p, 'n', g.n) order by g.a::text, coalesce(g.p::text, ''), g.n)
    from (
      select l.account_id as a, l.project_id as p, sum(l.amount_minor)::bigint as n
      from public.legs l
      where l.company_id = cid and l.transaction_id = rid and l.leg_kind = 'item' and not l.draft
      group by 1, 2, sign(l.amount_minor)
    ) g
  ), '[]'::jsonb);
  if want is distinct from got then
    raise exception 'book_line: could not represent the legs in the ledger';
  end if;

  return jsonb_build_object(
    'id', rid,
    'bank_amt', bank_amt,
    'before', before_parts,
    'written', written,
    'user_assigned', coalesce(line.user_assigned, false),
    'category_suggested', coalesce(line.category_suggested, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The fingerprint of a booked line (amount, date, its legs on the books) that an undo compares.
-- Draft legs are not on the books, so a fingerprint taken before decision 0232 still matches.
-- ---------------------------------------------------------------------------
create or replace function private.booked_line_print(p_company uuid, p_transaction_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'amount_gross', t.amount_gross, 'doc_date', t.doc_date,
    'legs', (select md5(coalesce(string_agg(
               l.account_id::text || ':' || coalesce(l.project_id::text, '') || ':' || l.amount_minor::text,
               '|' order by l.ordinal), ''))
             from public.legs l
             where l.transaction_id = p_transaction_id and l.company_id = p_company and not l.draft)
  )
  from public.transactions t where t.id = p_transaction_id and t.company_id = p_company;
$$;

revoke all on function private.booked_line_print(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.undo_book_line_write(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rec private.mcp_writes := p_write;
  response jsonb;
begin
  perform 1 from public.transactions t
  where t.id = rec.transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    response := private.mcp_error('conflict', 'conflict');
  elsif private.booked_line_print(cid, rec.transaction_id) is distinct from rec.prior->'after' then
    response := private.mcp_error('conflict', 'conflict');
  else
    begin
      -- Its parts and legs go with the line.
      delete from public.transactions t
      where t.id = rec.transaction_id and t.company_id = cid and t.source = 'manual';
      update private.mcp_writes
      set undone_at = clock_timestamp()
      where id = rec.id and undone_at is null;
      response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', 'book_line', 'id', rec.transaction_id));
    exception
      when sqlstate '23503' then
        response := private.mcp_error('conflict', 'conflict');
    end;
  end if;
  return response;
end;
$$;

create or replace function private.undo_journal_entry_write(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rec private.mcp_writes := p_write;
begin
  perform 1 from public.transactions t
  where t.id = rec.transaction_id and t.company_id = cid and t.removed_at is null
    and exists (select 1 from public.journal_entries j where j.transaction_id = t.id)
  for update;
  if not found then
    return private.mcp_error('conflict', 'conflict');
  end if;
  if private.booked_line_print(cid, rec.transaction_id) is distinct from rec.prior->'after' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  -- Its parts, entry and legs cascade with it.
  delete from public.transactions t where t.id = rec.transaction_id and t.company_id = cid;
  update private.mcp_writes set undone_at = clock_timestamp() where id = rec.id and undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', 'journal_entry', 'id', rec.transaction_id));
end;
$$;

create or replace function private.jev_booking_standing(p_company uuid, p_write private.mcp_writes)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.transactions t
    where t.id = p_write.transaction_id and t.company_id = p_company and t.removed_at is null
  ) and case p_write.kind
    when 'line_split' then private.line_split_parts(p_write.transaction_id) is not distinct from p_write.prior->'written'
    when 'book_line' then
      private.booked_line_print(p_company, p_write.transaction_id) is not distinct from p_write.prior->'after'
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- book_line: the MCP write.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_book_line(p_idempotency_key text, p_doc_date date, p_direction text, p_currency text, p_description text, p_legs jsonb, p_project_id uuid DEFAULT NULL::uuid, p_transaction_id uuid DEFAULT NULL::uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  cid uuid;
  hash text;
  prior jsonb;
  response jsonb;
  rid uuid;
  core jsonb;
  write_id uuid;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_direction is null or p_direction not in ('income', 'expense')
    or p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 2
    or jsonb_array_length(p_legs) > 50
    or (p_transaction_id is null and (
      p_doc_date is null
      or p_currency is null or p_currency !~ '^[A-Z]{3}$'
      or p_description is null or char_length(btrim(p_description)) < 1 or char_length(p_description) > 120))
    or (p_transaction_id is not null and (
      p_doc_date is not null or p_currency is not null or p_description is not null))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  cid := private.current_company_id();

  -- A new line keeps FLOW-948's hash, so a stored key still replays.
  hash := case
    when p_transaction_id is null then
      'book_line|' || p_direction || '|' || p_doc_date::text || '|' || p_currency
        || '|' || btrim(p_description) || '|' || coalesce(p_project_id::text, '') || '|' || p_legs::text
    else
      'book_line|line|' || p_transaction_id::text || '|' || p_direction
        || '|' || coalesce(p_project_id::text, '') || '|' || p_legs::text
  end;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    core := private.book_line_core(cid, p_direction, p_doc_date, p_currency, p_description,
      p_legs, p_project_id, p_transaction_id);
    rid := (core->>'id')::uuid;

    if p_transaction_id is null then
      insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
      values (token, auth.uid(), cid, 'book_line', rid,
        jsonb_build_object('after', private.booked_line_print(cid, rid)));
      response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'id', rid, 'direction', p_direction, 'undo_kind', 'book_line'));
    else
      -- The split_line write record, so undo kind line_split restores the parts before.
      insert into private.mcp_writes (token_id, user_id, company_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), cid, rid, 'line_split',
        jsonb_build_object(
          'before', core->'before',
          'written', core->'written',
          'user_assigned', (core->>'user_assigned')::boolean,
          'category_suggested', (core->>'category_suggested')::boolean
        ),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'id', rid, 'transaction_id', rid, 'direction', p_direction, 'parts', core->'written',
        'undo_kind', 'line_split', 'write_id', write_id));
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_journal_entry. FLOW-152: the P&L legs are optional; an entry on balance-sheet accounts only
-- is a line of amount 0, kept out of the P&L and of cash, whose journal legs are the whole entry.
-- ---------------------------------------------------------------------------
create or replace function public.mcp_create_journal_entry(p_idempotency_key text, p_doc_date date, p_currency text, p_description text, p_reference text, p_legs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  leg jsonb;
  ord integer;
  acct public.accounts%rowtype;
  cat public.categories%rowtype;
  amt bigint;
  pnl_legs jsonb := '[]'::jsonb;
  counter jsonb := '[]'::jsonb;
  pnl_sum bigint := 0;
  total bigint := 0;
  bank_id uuid;
  core jsonb;
  rid uuid;
  direction text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_doc_date is null
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_description is null or char_length(btrim(p_description)) not between 1 and 120
    or (p_reference is not null and char_length(btrim(p_reference)) not between 1 and 60)
    or p_legs is null or jsonb_typeof(p_legs) <> 'array'
    or jsonb_array_length(p_legs) not between 2 and 50
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'journal_entry|' || p_doc_date::text || '|' || p_currency || '|' || btrim(p_description) || '|'
    || coalesce(btrim(p_reference), '') || '|' || p_legs::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Each leg: its shape, then where it goes. A leg on a category counted in the P&L is a P&L leg,
    -- booked by book_line's rules; one on a kept-out category or a balance-sheet account is a counter
    -- leg, which stands in for the bank leg.
    for leg, ord in select e.value, e.ord from jsonb_array_elements(p_legs) with ordinality as e(value, ord)
    loop
      if jsonb_typeof(leg) <> 'object'
        or jsonb_typeof(leg->'account_id') is distinct from 'string'
        or (leg->>'account_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(leg->'amount_minor') is distinct from 'number'
        or (leg->>'amount_minor') !~ '^-?[0-9]{1,15}$'
        or (leg->>'amount_minor')::bigint = 0
        or ((leg ? 'project_id') and jsonb_typeof(leg->'project_id') not in ('string', 'null'))
        or ((leg ? 'project_id') and jsonb_typeof(leg->'project_id') = 'string'
          and (leg->>'project_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        or exists (select 1 from jsonb_object_keys(leg) k where k not in ('account_id', 'amount_minor', 'project_id'))
      then
        raise exception 'validation';
      end if;
      select * into acct from public.accounts a
      where a.id = (leg->>'account_id')::uuid and a.company_id = cid;
      if not found then
        raise exception 'account not found';
      end if;
      if jsonb_typeof(leg->'project_id') = 'string'
        and not exists (select 1 from public.projects p where p.id = (leg->>'project_id')::uuid and p.company_id = cid)
      then
        raise exception 'project not found';
      end if;
      amt := (leg->>'amount_minor')::bigint;
      total := total + amt;
      if acct.is_bank then
        raise exception 'a journal entry has no bank leg';
      end if;
      if acct.archived_at is not null then
        raise exception 'account is archived';
      end if;
      if acct.category_id is not null then
        select * into cat from public.categories c where c.id = acct.category_id and c.company_id = cid;
        if not found then
          raise exception 'account not found';
        end if;
        if not coalesce(cat.excluded_from_pnl, false) then
          pnl_legs := pnl_legs || (leg - 'project_id'
            || case when jsonb_typeof(leg->'project_id') = 'string'
                 then jsonb_build_object('project_id', leg->'project_id') else '{}'::jsonb end);
          pnl_sum := pnl_sum + amt;
          continue;
        end if;
        -- FLOW-151: a category with no balance-sheet account would land on Suspense; bind it
        -- (set_category_account) or book the balance-sheet account itself.
        if private.kept_out_account(cid, cat.id, cat.loan_part) = (
          select a.id from public.accounts a
          where a.company_id = cid and a.category_id is null and a.name = 'Suspense'
        ) then
          raise exception 'the category posts to Suspense';
        end if;
        counter := counter || jsonb_build_object(
          'account_id', private.kept_out_account(cid, cat.id, cat.loan_part),
          'project_id', nullif(leg->>'project_id', ''), 'amount_minor', amt, 'ordinal', ord);
      elsif acct.type not in ('income', 'expense') and acct.name not in ('Suspense', 'VAT control') then
        -- FLOW-152: any balance-sheet account (asset, liability or equity), a system one or the
        -- person's own, but not Suspense or VAT control.
        counter := counter || jsonb_build_object(
          'account_id', acct.id, 'project_id', nullif(leg->>'project_id', ''), 'amount_minor', amt, 'ordinal', ord);
      else
        raise exception 'a journal entry takes category and balance-sheet accounts';
      end if;
    end loop;

    if total <> 0 then
      raise exception 'legs do not balance';
    end if;
    -- P&L legs that net to 0 have no line to carry them (a line's parts sum to its amount).
    if jsonb_array_length(pnl_legs) > 0 and pnl_sum = 0 then
      raise exception 'a journal entry must change the P&L';
    end if;

    perform set_config('flow.journal_entry', 'on', true);
    if jsonb_array_length(pnl_legs) > 0 then
      -- The P&L side through book_line's rules, its bank leg the counter legs' sum (the P&L legs'
      -- opposite): a debit to an expense makes an expense line.
      select a.id into bank_id from public.accounts a where a.company_id = cid and a.is_bank;
      direction := case when pnl_sum < 0 then 'income' else 'expense' end;
      core := private.book_line_core(
        cid, direction, p_doc_date, p_currency, p_description,
        pnl_legs || jsonb_build_array(jsonb_build_object('account_id', bank_id, 'amount_minor', -pnl_sum)),
        null, null
      );
      rid := (core->>'id')::uuid;
      -- Out of the cash view (the line is fixed once it is marked).
      update public.transactions t set in_cash_override = false, idempotency_key = 'journal:' || rid::text
      where t.id = rid and t.company_id = cid;
    else
      -- Balance-sheet legs only: a line of amount 0 that moves nothing, out of the P&L and of cash.
      rid := gen_random_uuid();
      insert into public.transactions (
        id, company_id, direction, doc_kind, pnl_role, line_status, currency,
        amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date,
        source, idempotency_key, description, user_assigned, in_pnl_override, in_cash_override
      )
      values (
        rid, cid, 'expense', 'other', 'project', 'posted', p_currency,
        0, 0, 0, 0, 'source', p_doc_date, p_doc_date,
        'manual', 'journal:' || rid::text, btrim(p_description), true, false, false
      );
    end if;
    perform set_config('flow.journal_entry', '', true);

    -- Marked (after which the line is fixed), and posted again so the counter legs replace the bank leg.
    insert into public.journal_entries (transaction_id, company_id, reference)
    values (rid, cid, nullif(btrim(p_reference), ''));
    insert into public.journal_counter_legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal)
    select cid, rid, (c->>'account_id')::uuid, (c->>'project_id')::uuid, (c->>'amount_minor')::bigint,
      (row_number() over (order by (c->>'ordinal')::integer))::smallint
    from jsonb_array_elements(counter) c;
    perform private.post_lines(cid, array[rid]);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'journal_entry', rid,
      jsonb_build_object('after', private.booked_line_print(cid, rid)));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', rid,
      'doc_date', p_doc_date,
      'currency', p_currency,
      'description', btrim(p_description),
      'reference', nullif(btrim(p_reference), ''),
      'pnl_minor', -pnl_sum,
      'legs', (
        select jsonb_agg(jsonb_build_object(
            'account_id', l.account_id, 'project_id', l.project_id, 'amount_minor', l.amount_minor,
            'in_pnl', a.type in ('income', 'expense')
          ) order by l.ordinal)
        from public.legs l
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        where l.company_id = cid and l.transaction_id = rid and not l.draft and l.amount_minor <> 0
      ),
      'undo_kind', 'journal_entry'
    ));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- ---------------------------------------------------------------------------
-- Legs readers: the legs on the books (draft parts are not).
-- ---------------------------------------------------------------------------
create or replace function private.journal_entry_legs(p_company uuid, p_transaction_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', case when coalesce(c.hidden, false) then l.account_id else coalesce(b.id, l.account_id) end,
      'project_id', l.project_id,
      'amount_minor', l.amount_minor
    ) order by l.ordinal), '[]'::jsonb)
  from public.legs l
  join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
  left join public.accounts b on b.company_id = l.company_id and b.category_id = l.category_id
  left join public.categories c on c.company_id = l.company_id and c.id = l.category_id
  where l.company_id = p_company and l.transaction_id = p_transaction_id and not a.is_bank and not l.draft;
$$;

create or replace function private.line_journal(p_company uuid, p_transaction_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'transaction_id', t.id,
    'currency', coalesce(t.currency, 'ILS'),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'ordinal', l.ordinal,
          'account_id', l.account_id,
          'account_name', coalesce(c.name, a.name),
          'account_type', coalesce(c.kind::text, a.type),
          'system', a.category_id is null,
          'is_bank', a.is_bank,
          -- Only income and expense legs count in profit (decision 0208: the projection).
          'in_pnl', coalesce(c.kind::text, a.type) in ('income', 'expense'),
          -- The leg's own category (FLOW-951: a kept-out leg on a system account names it too), live.
          'category_name', lc.name,
          'project_id', l.project_id,
          'project_name', p.name,
          'amount_minor', l.amount_minor,
          -- The account book_line takes for this leg (the composer edits on it): a kept-out leg on its
          -- category's own account, a leg of a hidden ledger category on the system account it posts to.
          'book_account_id', case when a.is_bank or coalesce(lc.hidden, false) then l.account_id
                                  else coalesce(b.id, l.account_id) end
        ) order by l.ordinal)
      from public.legs l
      join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
      left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
      left join public.categories lc on lc.id = coalesce(l.category_id, a.category_id) and lc.company_id = l.company_id
      left join public.accounts b on b.company_id = l.company_id and b.category_id = l.category_id
      left join public.projects p on p.id = l.project_id and p.company_id = l.company_id
      where l.company_id = p_company and l.transaction_id = t.id and not l.draft
    ), '[]'::jsonb),
    'balanced', coalesce((
      select sum(l.amount_minor) = 0 from public.legs l
      where l.company_id = p_company and l.transaction_id = t.id and not l.draft
    ), true),
    'booked_by_ai', exists (
      select 1 from private.mcp_writes w
      where w.company_id = p_company and w.transaction_id = t.id
        and w.kind in ('book_line', 'line_split') and w.undone_at is null
    )
  )
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = p_company and t.removed_at is null;
$$;

-- get_line_legs: the legs on the books; a split or loan payment the posting keeps as draft (it no
-- longer matches the line, or is flagged) is listed apart in draft_parts.
create or replace function public.mcp_line_legs(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  t public.transactions%rowtype;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into t from public.transactions x
  where x.id = p_transaction_id and x.company_id = cid and x.removed_at is null;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'transaction_id', t.id,
    'direction', t.direction,
    'line_status', t.line_status,
    'currency', coalesce(t.currency, 'ILS'),
    'amount_gross', t.amount_gross,
    'vat_amount', t.vat_amount,
    'journal_entry', (select jsonb_build_object('reference', j.reference)
                      from public.journal_entries j
                      where j.transaction_id = t.id and j.company_id = cid),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'ordinal', l.ordinal,
          'account_id', l.account_id,
          'account_name', coalesce(c.name, a.name),
          'account_type', coalesce(c.kind::text, a.type),
          'category_id', coalesce(l.category_id, a.category_id),
          'category_name', lc.name,
          'is_bank', a.is_bank,
          'project_id', l.project_id,
          'amount_minor', l.amount_minor
        ) order by l.ordinal)
      from public.legs l
      join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
      left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
      left join public.categories lc on lc.id = coalesce(l.category_id, a.category_id) and lc.company_id = l.company_id
      where l.company_id = cid and l.transaction_id = t.id and not l.draft
    ), '[]'::jsonb),
    'balanced', coalesce((
      select sum(l.amount_minor) = 0 from public.legs l
      where l.company_id = cid and l.transaction_id = t.id and not l.draft
    ), true),
    'draft_parts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'category_id', l.category_id,
          'category_name', lc.name,
          'project_id', l.project_id,
          'loan_id', l.loan_id,
          'part', l.part,
          'needs_review', l.needs_review,
          'amount_minor', l.amount_minor
        ) order by l.part_ordinal)
      from public.legs l
      left join public.categories lc on lc.id = l.category_id and lc.company_id = l.company_id
      where l.company_id = cid and l.transaction_id = t.id and l.draft
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The worded refusals the MCP shows (patched in place, as 70_accounts adds its own): the parts writer
-- API's reasons that reach a tool, and no more "a journal entry needs a leg in the P&L" (FLOW-152).
-- 'account is archived' is 70_accounts'.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $refused$
declare
  def text := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  a_list constant text := $a$        'a category posts only to a balance-sheet account'
      ) then p_message$a$;
  a_gone constant text := $a$        'a journal entry needs a leg in the P&L',
$a$;
  a_note constant text := $a$      -- private.loan_splits_check's names, in the words the tools use.$a$;
begin
  if pg_temp.anchor_count(def, a_list) <> 1 or pg_temp.anchor_count(def, a_gone) <> 1
    or pg_temp.anchor_count(def, a_note) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, a_list, $n$        'a category posts only to a balance-sheet account',
        -- Decision 0232: the parts writer API's reasons.
        'too many parts',
        'part amount must be above zero',
        'category or project not found',
        'duplicate part',
        'loan part amount below zero'
      ) then p_message$n$);
  def := replace(def, a_gone, '');
  def := replace(def, a_note, $n$      -- The loan payment rules' names, in the words the tools use.$n$);
  execute def;
end
$refused$;

-- ---------------------------------------------------------------------------
-- mcp_undo (87 KB) is patched in place with counted anchors: the kinds that read or wrote the old split
-- tables read the part views and restore parts through the writer API.
-- ---------------------------------------------------------------------------
do $patch$
declare
  def text := pg_get_functiondef('public.mcp_undo(text, text, uuid)'::regprocedure);
  -- (anchor, replacement) pairs; each anchor must occur exactly once.
  pairs text[][] := array[
    -- loan_part_category / loan_category_from: a line has one part of each kind, so the part is found
    -- by its line (the write's split_id named a row that is gone).
    [$a$            select s.loan_id from public.loan_splits s
            where s.company_id = cid
              and s.id in (select (x->>'split_id')::uuid from jsonb_array_elements(rec.prior->rows_key) x)$a$,
     $n$            select s.loan_id from private.loan_parts s
            where s.company_id = cid and s.part = part_key
              and s.transaction_id in (
                select (x->>'transaction_id')::uuid from jsonb_array_elements(rec.prior->rows_key) x)$n$],
    [$a$          select s.category_id into held
          from public.loan_splits s
          where s.company_id = cid and s.id = (row_item.item->>'split_id')::uuid
          for update;$a$,
     $n$          select s.category_id into held
          from private.loan_parts s
          where s.company_id = cid and s.transaction_id = (row_item.item->>'transaction_id')::uuid
            and s.part = part_key
            and s.loan_id = coalesce((row_item.item->>'loan_id')::uuid, rec.loan_id);$n$],
    [$a$          update public.loan_splits s
          set category_id = (x->>'before')::uuid
          from jsonb_array_elements(rec.prior->rows_key) x
          where s.company_id = cid and s.id = (x->>'split_id')::uuid
            and s.category_id is distinct from (x->>'before')::uuid;
          for row_item in
            select distinct (x->>'transaction_id')::uuid as txn_id
            from jsonb_array_elements(rec.prior->rows_key) x
          loop
            perform private.loan_splits_check(row_item.txn_id);
          end loop;$a$,
     $n$          -- Each line's loan parts go back through the writer API, the part on its category before.
          for row_item in
            select (x->>'transaction_id')::uuid as txn_id, (x->>'before')::uuid as before_category
            from jsonb_array_elements(rec.prior->rows_key) x
          loop
            perform private.set_loan_parts(cid, row_item.txn_id, p.loan_id, p.parts)
            from (
              select s.loan_id, jsonb_agg(jsonb_build_object(
                  'part', s.part, 'amount_minor', s.amount_minor, 'scheduled_minor', s.scheduled_minor,
                  'category_id', case when s.part = part_key then row_item.before_category else s.category_id end,
                  'needs_review', s.needs_review) order by s.part) as parts
              from private.loan_parts s
              where s.company_id = cid and s.transaction_id = row_item.txn_id
              group by s.loan_id
            ) p;
          end loop;$n$],
    -- loan: not while a payment has parts on it.
    [$a$        select 1 from public.loan_splits s
        where s.company_id = cid and s.loan_id = p_id$a$,
     $n$        select 1 from private.loan_parts s
        where s.company_id = cid and s.loan_id = p_id$n$],
    -- loan_detach: the parts go back through the writer API.
    [$a$        select 1 from public.loan_splits s where s.transaction_id = p_id and s.company_id = cid$a$,
     $n$        select 1 from private.loan_parts s where s.transaction_id = p_id and s.company_id = cid$n$],
    [$a$          from public.loan_splits s
          join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id$a$,
     $n$          from private.loan_parts s
          join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id$n$],
    [$a$          insert into public.loan_splits (
            company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id,
            needs_review
          )
          select cid, rec.loan_id, p_id, (e.value->>'part')::public.loan_split_part,
            (e.value->>'amount_minor')::bigint, (e.value->>'scheduled_minor')::bigint,
            (e.value->>'category_id')::uuid, coalesce((e.value->>'needs_review')::boolean, false)
          from jsonb_array_elements(rec.prior->'parts') e;
          perform private.loan_splits_check(p_id);$a$,
     $n$          perform private.set_loan_parts(cid, p_id, rec.loan_id, rec.prior->'parts');$n$],
    -- loan_split: the parts are the line's loan part legs; the undo clears them through the API.
    [$a$      perform 1 from public.loan_splits s
      where s.company_id = cid
        and s.transaction_id = p_id
        and s.loan_id = rec.loan_id
      for update;$a$,
     $n$      perform 1 from public.legs s
      where s.company_id = cid
        and s.transaction_id = p_id
        and s.loan_id = rec.loan_id
      for update;$n$],
    [$a$          from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
        )$a$,
     $n$          from private.loan_parts s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
        )$n$],
    [$a$        -- Written before the parts were kept: any later touch counts as a correction.
        rec.prior->'parts' is null
        and exists (
          select 1 from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
            and s.updated_at > rec.created_at
        )$a$,
     $n$        -- Written before the parts were kept: any later posting of the parts counts as a correction.
        rec.prior->'parts' is null
        and exists (
          select 1 from public.legs s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
            and s.created_at > rec.created_at
        )$n$],
    [$a$        delete from public.loan_splits s
        where s.company_id = cid
          and s.transaction_id = p_id
          and s.loan_id = rec.loan_id;$a$,
     $n$        perform private.set_loan_parts(cid, p_id, rec.loan_id, null);$n$],
    -- project and category: not while a part names them.
    [$a$        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.project_id = p_id$a$,
     $n$        select 1 from private.split_parts lsp
        where lsp.company_id = cid and lsp.project_id = p_id$n$],
    [$a$        select 1 from public.loan_splits ls
        where ls.company_id = cid and ls.category_id = p_id$a$,
     $n$        select 1 from private.loan_parts ls
        where ls.company_id = cid and ls.category_id = p_id$n$],
    [$a$        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.category_id = p_id$a$,
     $n$        select 1 from private.split_parts lsp
        where lsp.company_id = cid and lsp.category_id = p_id$n$]
  ];
  i integer;
begin
  for i in 1 .. array_length(pairs, 1) loop
    if pg_temp.anchor_count(def, pairs[i][1]) <> 1 then
      raise exception 'mcp_undo is not the expected definition (anchor %)', i;
    end if;
    def := replace(def, pairs[i][1], pairs[i][2]);
  end loop;
  if def ~ '\m(line_splits|loan_splits|loan_splits_check)\M' then
    raise exception 'mcp_undo still reads the old split tables';
  end if;
  execute def;
end
$patch$;

-- 50 project and P&L readers: split and loan parts now come from the part views (decision 0232).

create or replace function public.get_project(p_id uuid, p_basis text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
  ids uuid[];
  pl_rows private.pnl_lines[];
  share_base bigint;
  available_base boolean;
  cats_ils jsonb;
  cats_in jsonb;
  cats_out jsonb;
  base text;
begin
  select c.id into cid
    from public.companies c
    where c.id = (select private.readable_company_id());
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  basis := private.pnl_basis(cid, p_basis);

  waiting := public.project_waiting(p_id);
  -- Every line this project can count: filed to it, shared to it, or split to it. The totals
  -- below read only these lines, so the page costs the project's lines, not the company's.
  ids := array(
    select t.id from public.transactions t where t.company_id = cid and t.project_id = p_id
    union
    select a.transaction_id from public.allocations a where a.company_id = cid and a.project_id = p_id
    union
    select s.transaction_id from private.split_parts s where s.company_id = cid and s.project_id = p_id
  );
  -- The project's lines, read once. Every total below reads this array instead of reading
  -- private.pnl_lines again with the same filter (eight times before).
  pl_rows := array(
    select u from private.pnl_lines u
    where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
      and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)
  );
  -- One pass over the project's category entries feeds the three category lists (three before).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'amount_agorot', s.amount,
      'has_shared_share', s.shared
    ) order by s.amount desc, c.name) filter (where s.in_pnl and s.currency = 'ILS'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)
  into cats_ils, cats_in, cats_out
  from (
    select e.currency,
      e.category_id,
      private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      ) as in_pnl,
      (-sum(e.amount_net))::bigint as amount,
      bool_or(e.shared) as shared
    from private.project_category_entries_by_currency(p_id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
      and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
    group by 1, 2, 3
  ) s
  left join public.categories c on c.id = s.category_id;

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'is_overhead', p.id is not distinct from (select c.overhead_project_id from public.companies c where c.id = cid),
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'income'
        and l.in_pnl
        and l.currency = 'ILS'
        and (
          l.direction = 'expense'
          or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
    ), 0),
    'direct_agorot', -coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from unnest(pl_rows) l
      -- Lines first, then each line's share by index, so the allocations never drive the join.
      cross join lateral (
        select a.amount_net from public.allocations a
        where a.transaction_id = l.transaction_id and a.project_id = p.id
        offset 0 -- keeps this a per-line lookup
      ) a
      where l.kind = 'expense' and l.pnl_role = 'shared' and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', b.currency,
        'income_minor', b.income_minor,
        'direct_minor', b.direct_minor,
        'shared_minor', b.shared_minor,
        'profit_minor', b.income_minor - b.direct_minor - b.shared_minor
      ) order by b.currency)
      from (
        select
          parts.currency,
          coalesce(sum(parts.income_minor), 0)::bigint as income_minor,
          coalesce(sum(parts.direct_minor), 0)::bigint as direct_minor,
          coalesce(sum(parts.shared_minor), 0)::bigint as shared_minor
        from (
          select l.currency as currency,
            case when l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ) then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' and l.pnl_role = 'project' then -l.amount_net else 0 end as direct_minor,
            0::bigint as shared_minor
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', cats_ils,
    'categories_by_currency', cats_in,
    'excluded_categories_by_currency', cats_out,
    -- FLOW-121: income filed to this project that is out of the P&L, by category, on the
    -- same basis as income_agorot. Positive minor units.
    'excluded_income_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'count', s.line_count
      ) order by s.currency, s.amount desc, c.name)
      from (
        select l.currency,
          l.category_id,
          sum(l.amount_net)::bigint as amount,
          count(distinct l.transaction_id)::integer as line_count
        from unnest(pl_rows) l
        where l.project_id = p.id
          and l.company_id = cid
          and l.kind = 'income'
          and not l.in_pnl
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        group by l.currency, l.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          parts.currency,
          sum(parts.income_minor)::bigint as income_minor,
          sum(parts.expense_minor)::bigint as expense_minor,
          count(distinct parts.transaction_id)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            l.transaction_id
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
            and l.currency <> 'ILS'
            and (
              (l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ))
              or (l.kind = 'expense' and l.pnl_role = 'project')
            )
          union all
          select l.currency, 0, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0), l.transaction_id
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum(t.amount_net))::bigint
      from jsonb_array_elements(waiting) row
      join public.transactions t on t.id = (row->>'transaction_id')::uuid
      where coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'pending_other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as expense_minor,
          count(*)::integer as line_count
        from jsonb_array_elements(waiting) row
        join public.transactions t on t.id = (row->>'transaction_id')::uuid
        where coalesce(t.currency, 'ILS') <> 'ILS'
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'currency', coalesce(t.currency, 'ILS'),
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'line_status', t.line_status,
        'category', c.name,
        'kept_out', case
          when t.line_status = 'posted' then not coalesce((
            select bool_or(pl.in_pnl)
            from private.pnl_lines pl
            where pl.transaction_id = t.id
              and (pl.project_id = p.id or exists (
                select 1 from public.allocations a
                where a.transaction_id = t.id and a.project_id = p.id
              ))
          ), false)
          else not private.line_in_pnl(
            case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = t.id)
              then t.in_pnl_override end,
            private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
            c.loan_part
          )
        end,
        'parts_minor', case when exists (
          select 1 from private.split_parts s0
          where s0.transaction_id = t.id and s0.company_id = cid
        ) then coalesce((
          select sum(case
              when pc.kind::text is not distinct from coalesce(
                (select lc.kind::text from public.categories lc
                 where lc.id = t.category_id and lc.company_id = t.company_id),
                t.direction::text) then s.amount_minor
              else -s.amount_minor
            end)
          from private.split_parts s
          left join public.categories pc on pc.id = s.category_id and pc.company_id = s.company_id
          where s.transaction_id = t.id
            and s.company_id = cid
            and coalesce(s.project_id, t.project_id) = p.id
        ), 0)::bigint end
      ) order by t.doc_date desc, t.created_at desc, t.id desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and t.line_status <> 'pending'
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ) or exists (
            select 1 from private.split_parts s
            where s.transaction_id = t.id and s.company_id = cid and s.project_id = p.id
          ))
          and private.pnl_in_range(t.direction::text, basis, t.doc_date, t.cash_date, p_from, p_to)
        order by t.doc_date desc, t.created_at desc, t.id desc
        limit 40
      ) t
      left join public.categories c on c.id = t.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.projects p
  where p.id = p_id and p.company_id = cid;
  if result is null then
    return null;
  end if;
  profit :=
    (result->>'income_agorot')::bigint
    - (result->>'direct_agorot')::bigint
    - (result->>'shared_agorot')::bigint;
  base := private.company_base_currency(cid);
  -- The shekel and base-currency overhead shares in one pass over the company's lines. A
  -- currency with no row has no weighted share.
  select
    bool_or(s.available) filter (where s.currency = 'ILS'),
    max(s.share_agorot) filter (where s.currency = 'ILS'),
    bool_or(s.available) filter (where s.currency = base),
    max(s.share_agorot) filter (where s.currency = base)
  into available, share, available_base, share_base
  from private.overhead_shares(cid, p_id, basis, p_from, p_to, array['ILS', base], false) s;
  -- FLOW-406: parent_id on each category row and the parent roll-ups beside them.
  result := result || jsonb_build_object(
    'categories', private.category_rows_with_parent(result->'categories', cid),
    'categories_by_currency', private.category_rows_with_parent(result->'categories_by_currency', cid),
    'excluded_categories_by_currency', private.category_rows_with_parent(result->'excluded_categories_by_currency', cid),
    'category_rollups', private.category_rollup_rows(result->'categories', 'amount_agorot', cid),
    'category_rollups_by_currency', private.category_rollup_rows(result->'categories_by_currency', 'amount_minor', cid),
    'excluded_category_rollups_by_currency', private.category_rollup_rows(result->'excluded_categories_by_currency', 'amount_minor', cid)
  );
  return result || jsonb_build_object(
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'base_currency', base,
    'overhead_share_minor', case when coalesce(available_base, false) then coalesce(share_base, 0) else null end,
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
    -- FLOW-404: purchase, ARV, value, rehab and equity. Nothing above reads them.
    'investment', private.project_investment(cid, p_id),
    -- FLOW-105: the loans filed under this project. Nothing above reads them.
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'currency', l.currency,
        'balance_minor', b.balance_minor,
        'status', l.status,
        'closed_on', l.closed_on,
        'kind', l.kind,
        'principal_minor', l.principal_minor,
        'annual_rate_ppm', l.annual_rate_ppm,
        'term_months', l.term_months,
        'start_date', l.start_date,
        'payment_minor', l.payment_minor,
        'escrow_minor', l.escrow_minor,
        'interest_only_months', l.interest_only_months,
        'amortization_months', l.amortization_months,
        'rates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'effective_date', r.effective_date,
            'annual_rate_ppm', r.annual_rate_ppm
          ) order by r.effective_date)
          from public.loan_rates r
          where r.company_id = l.company_id
            and r.loan_id = l.id
        ), '[]'::jsonb)
      ) order by l.name, l.id)
      from public.loans l
      join public.loan_balances b
        on b.company_id = l.company_id
       and b.loan_id = l.id
      where l.company_id = cid
        and l.project_id = p_id
    ), '[]'::jsonb)
  );
end;
$function$

;

create or replace function public.get_profit_months(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_basis text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
  ids uuid[];
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  if p_from is not null and p_to >= (date_trunc('month', p_from) + interval '240 months')::date then
    raise exception 'range too long' using errcode = '22023';
  end if;
  if p_project_id is not null
    and not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid)
  then
    return null;
  end if;
  basis := private.pnl_basis(cid, p_basis);
  -- A project's months read only its lines: filed, shared or split to it (as get_project).
  if p_project_id is not null then
    ids := array(
      select t.id from public.transactions t where t.company_id = cid and t.project_id = p_project_id
      union
      select a.transaction_id from public.allocations a where a.company_id = cid and a.project_id = p_project_id
      union
      select s.transaction_id from private.split_parts s where s.company_id = cid and s.project_id = p_project_id
    );
  end if;

  with src as (
    select
      l.*,
      case when l.kind = 'income' and basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end as d
    from private.pnl_lines l
    where l.company_id = cid
      and (p_project_id is null or l.transaction_id = any(ids))
      and l.in_pnl
      and (basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and private.pnl_in_range(l.kind, basis, l.doc_date, l.cash_date, p_from, p_to)
  ),
  parts as (
    select date_trunc('month', s.d)::date as month, s.currency,
      case when s.kind = 'income' then s.amount_net else 0 end as income_minor,
      case when s.kind = 'expense' then -s.amount_net else 0 end as expense_minor
    from src s
    where p_project_id is null
       or (s.project_id = p_project_id and (s.kind = 'income' or s.pnl_role = 'project'))
    union all
    select date_trunc('month', s.d)::date, s.currency,
      0,
      -coalesce(private.div_half_even(a.amount_net::numeric * s.amount_net, s.line_amount_net), 0)
    from src s
    join public.allocations a on a.transaction_id = s.transaction_id
    where p_project_id is not null
      and a.project_id = p_project_id
      and s.kind = 'expense'
      and s.pnl_role = 'shared'
  ),
  bounds as (
    select
      case when p_from is null then (select min(x.month) from parts x) else date_trunc('month', p_from)::date end as lo,
      case when p_from is null then greatest(
        date_trunc('month', current_date)::date,
        (select max(x.month) from parts x)
      ) else date_trunc('month', p_to)::date end as hi
  ),
  months as (
    select
      m::date as month,
      greatest(m::date, coalesce(p_from, m::date)) as mfrom,
      least((m + interval '1 month' - interval '1 day')::date, coalesce(p_to, (m + interval '1 month' - interval '1 day')::date)) as mto
    from bounds b
    cross join lateral generate_series(b.lo, b.hi, interval '1 month') m
    where b.lo is not null
  ),
  sums as (
    select x.month, x.currency, sum(x.income_minor)::bigint as income_minor, sum(x.expense_minor)::bigint as expense_minor
    from parts x
    group by x.month, x.currency
  ),
  cells as (
    select m.month, k.currency, coalesce(s.income_minor, 0) as income_minor, coalesce(s.expense_minor, 0) as expense_minor
    from months m
    cross join (select private.company_base_currency(cid) as currency union select x.currency from parts x) k
    left join sums s on s.month = m.month and s.currency = k.currency
    where k.currency = private.company_base_currency(cid) or s.month is not null
  ),
  -- The months run back to back, so the share of each is the share of its days in the whole
  -- span, bucketed by month: one pass for every month and both currencies.
  shares as (
    select o.month, o.currency, o.available, o.share_agorot
    from (select min(m.mfrom) as lo, max(m.mto) as hi from months m) r
    cross join lateral private.overhead_shares(
      cid, p_project_id, basis, r.lo, r.hi,
      array['ILS', private.company_base_currency(cid)], true
    ) o
    where p_project_id is not null
      and r.lo is not null
  ),
  overhead as (
    select s.month, s.available, s.share_agorot
    from shares s
    where s.currency = 'ILS'
  ),
  overhead_base as (
    select s.month, s.available, s.share_agorot
    from shares s
    where s.currency = private.company_base_currency(cid)
  )
  select jsonb_build_object(
    'basis', basis,
    'base_currency', private.company_base_currency(cid),
    'from', p_from,
    'to', p_to,
    'project_id', p_project_id,
    'after_overhead', case when p_project_id is null then null else (
      select coalesce(p.after_overhead, c.after_overhead)
      from public.projects p
      join public.companies c on c.id = p.company_id
      where p.id = p_project_id
    ) end,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM'),
        'from', m.mfrom,
        'to', m.mto,
        'open', current_date between m.month and (m.month + interval '1 month' - interval '1 day')::date,
        'by_currency', (
          select jsonb_agg(jsonb_build_object(
            'currency', c.currency,
            'income_minor', c.income_minor,
            'expense_minor', c.expense_minor,
            'profit_minor', c.income_minor - c.expense_minor
          ) order by c.currency <> private.company_base_currency(cid), c.currency)
          from cells c
          where c.month = m.month
        ),
        'overhead_weighted', case when p_project_id is null then null else coalesce(o.available, false) end,
        'overhead_share_agorot', case when coalesce(o.available, false) then coalesce(o.share_agorot, 0) else null end,
        'overhead_share_minor', case when coalesce(ob.available, false) then coalesce(ob.share_agorot, 0) else null end
      ) order by m.month desc)
      from months m
      left join overhead o on o.month = m.month
      left join overhead_base ob on ob.month = m.month
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', t.currency,
        'income_minor', t.income_minor,
        'expense_minor', t.expense_minor,
        'profit_minor', t.income_minor - t.expense_minor
      ) order by t.currency <> private.company_base_currency(cid), t.currency)
      from (
        select c.currency, sum(c.income_minor)::bigint as income_minor, sum(c.expense_minor)::bigint as expense_minor
        from cells c
        group by c.currency
      ) t
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$function$

;

create or replace function public.projects_cash_month(p_month date DEFAULT NULL::date, p_today date DEFAULT NULL::date, p_project uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  month_start date;
  month_end date;
  basis text;
  base text;
  overhead_id uuid;
  pnl_basis text;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) then
    return null;
  end if;
  select c.cash_basis, c.base_currency, c.overhead_project_id
  into basis, base, overhead_id
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', coalesce(p_month, today))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  -- The project totals below count as company_pnl(cid, month, basis) and
  -- company_pnl(cid, all time, basis) count their projects' by_currency, and company_pnl reads
  -- anything but 'invoiced' as the cash basis.
  pnl_basis := case when basis = 'invoiced' then 'invoiced' else 'cash' end;

  with parts as (
    select * from private.cash_parts(cid, basis, month_start, month_end)
    where in_cash
  ),
  direct_parts as (
    select p.transaction_id, p.currency, p.kind, p.project_id as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is not null
  ),
  unfiled_parts as (
    select p.transaction_id, p.currency, p.kind, null::uuid as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is null
  ),
  shared_parts as (
    select
      p.transaction_id, p.part, p.category_id, p.project_id as part_project_id, p.currency, p.kind, p.amount_minor,
      least(coalesce(sum(a.share_bp), 0), 10000) as total_bp
    from parts p
    left join public.allocations a on a.transaction_id = p.transaction_id and a.company_id = cid
    where p.pnl_role = 'shared'
    group by p.transaction_id, p.part, p.category_id, p.project_id, p.currency, p.kind, p.amount_minor
  ),
  shared_alloc as (
    select
      sp.transaction_id, sp.part, sp.category_id, sp.part_project_id, sp.currency, sp.kind, sp.amount_minor,
      a.project_id,
      a.share_bp,
      private.div_half_even(sp.amount_minor::numeric * a.share_bp, 10000::numeric) as share_minor,
      private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric) as alloc_total
    from shared_parts sp
    join public.allocations a on a.transaction_id = sp.transaction_id and a.company_id = cid
  ),
  shared_owned as (
    select
      x.transaction_id, x.currency, x.kind, x.project_id as owner_id,
      (x.share_minor + case
        when row_number() over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor order by x.share_bp desc, x.project_id) = 1
          then x.alloc_total - sum(x.share_minor) over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor)
        else 0
      end)::bigint as amount_minor
    from shared_alloc x
  ),
  shared_unassigned as (
    select
      sp.transaction_id, sp.currency, sp.kind, null::uuid as owner_id,
      (sp.amount_minor - private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric))::bigint as amount_minor
    from shared_parts sp
  ),
  attributed as (
    select * from direct_parts
    union all select * from unfiled_parts
    union all select * from shared_owned
    union all select * from shared_unassigned
  ),
  project_cash as (
    select
      a.owner_id, a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is not null
    group by a.owner_id, a.currency
  ),
  unassigned_cash as (
    select
      a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is null
    group by a.currency
  ),
  unassigned_lines as (
    select count(distinct a.transaction_id)::integer as n
    from attributed a
    where a.owner_id is null and a.amount_minor <> 0
  ),
  -- The company's lines, read once: the project totals and every project's first month.
  pnl as materialized (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.currency,
      l.amount_net, l.line_amount_net, l.in_pnl, l.unpaid, l.doc_date, l.cash_date
    from private.pnl_lines l
    where l.company_id = cid
  ),
  pnl_counted as (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.currency, l.amount_net, l.line_amount_net,
      coalesce(
        case when l.kind = 'income' and pnl_basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
          between month_start and month_end,
        false
      ) as in_month
    from pnl l
    where l.in_pnl
      and (pnl_basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (pnl_basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (pnl_basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        )
      )
  ),
  pnl_parts as (
    select l.project_id, l.currency, l.in_month, l.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
    from pnl_counted l
    where l.kind = 'income'
    union all
    select l.project_id, l.currency, l.in_month, 0::bigint, l.amount_net, 0::bigint
    from pnl_counted l
    where l.kind = 'expense' and l.pnl_role = 'project' and l.project_id is not null
    union all
    select a.project_id, l.currency, l.in_month, 0::bigint, 0::bigint,
      coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from pnl_counted l
    join public.allocations a on a.transaction_id = l.transaction_id
    where l.kind = 'expense' and l.pnl_role = 'shared'
  ),
  -- Per project and currency, company_pnl's income_net, direct_net and shared_net for the month
  -- and for all time.
  pnl_sums as (
    select
      x.project_id,
      x.currency,
      coalesce(sum(x.income_net) filter (where x.in_month), 0)::bigint as month_income,
      coalesce(sum(x.direct_net) filter (where x.in_month), 0)::bigint as month_direct,
      coalesce(sum(x.shared_net) filter (where x.in_month), 0)::bigint as month_shared,
      coalesce(sum(x.income_net), 0)::bigint as all_income,
      coalesce(sum(x.direct_net), 0)::bigint as all_direct,
      coalesce(sum(x.shared_net), 0)::bigint as all_shared
    from pnl_parts x
    where x.project_id is not null
    group by x.project_id, x.currency
  ),
  pnl_projects as (
    select
      s.project_id,
      s.currency,
      s.month_income + s.month_direct + s.month_shared as profit_month,
      s.all_income + s.all_direct + s.all_shared as profit_all,
      (-s.all_direct) + (-s.all_shared) as spent_all
    from pnl_sums s
  ),
  -- Every project's lines (filed, shared or split to it, as private.project_line_ids lists them)
  -- and the month of the earliest.
  project_lines as (
    select t.project_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = cid and t.project_id is not null
    union
    select a.project_id, a.transaction_id
    from public.allocations a
    where a.company_id = cid
    union
    select s.project_id, s.transaction_id
    from private.split_parts s
    where s.company_id = cid and s.project_id is not null
  ),
  first_months as (
    select pl.project_id, to_char(date_trunc('month', min(l.doc_date)), 'YYYY-MM-DD') as first_month
    from project_lines pl
    join pnl l on l.transaction_id = pl.transaction_id
    group by pl.project_id
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.state_label as type,
      p.status::text as status,
      p.id is not distinct from overhead_id as is_overhead,
      p.group_id,
      p.created_at,
      p.finished_on,
      p.budget_agorot as budget_minor,
      coalesce((select r.spent_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as spent_minor,
      coalesce((select r.profit_month from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_month_minor,
      coalesce((select r.profit_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_all_minor,
      (select f.first_month from first_months f where f.project_id = p.id) as first_month,
      jsonb_array_length(public.project_waiting(p.id)) as pending_count,
      private.project_is_empty(cid, p.id) as deletable,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', pc.currency,
          'in_minor', pc.in_minor,
          'out_minor', pc.out_minor,
          'net_minor', pc.in_minor - pc.out_minor
        ) order by pc.currency is distinct from base, pc.currency)
        from project_cash pc
        where pc.owner_id = p.id
      ), '[]'::jsonb) as cash
    from public.projects p
    where p.company_id = cid
      and (p_project is null or p.id = p_project)
  )
  select jsonb_build_object(
    'month', to_char(month_start, 'YYYY-MM-DD'),
    'base_currency', base,
    'basis', basis,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'is_overhead', r.is_overhead,
        'group_id', r.group_id,
        'created_at', r.created_at,
        'finished_on', r.finished_on,
        'budget_minor', r.budget_minor,
        'spent_minor', r.spent_minor,
        'cash', r.cash,
        'profit_month_minor', r.profit_month_minor,
        'profit_all_minor', r.profit_all_minor,
        'first_month', r.first_month,
        'pending_count', r.pending_count,
        'deletable', r.deletable
      ) order by r.name)
      from project_rows r
    ), '[]'::jsonb),
    'unassigned', jsonb_build_object(
      'count', (select n from unassigned_lines),
      'cash', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', uc.currency,
          'in_minor', uc.in_minor,
          'out_minor', uc.out_minor,
          'net_minor', uc.in_minor - uc.out_minor
        ) order by uc.currency is distinct from base, uc.currency)
        from unassigned_cash uc
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$function$

;

create or replace function public.company_next_month_inputs(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  this_month date;
  first_month date;
  next_month text;
  overhead uuid;
  projects jsonb;
  general jsonb;
  edits jsonb;
  rest_edits jsonb;
  rest_months text[];
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  this_month := date_trunc('month', today)::date;
  first_month := (this_month - interval '6 months')::date;
  next_month := to_char(this_month + interval '1 month', 'YYYY-MM');
  -- The months left in this year after this one: none in December.
  rest_months := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', date_trunc('year', today) + interval '11 months', interval '1 month') m
  );
  select c.overhead_project_id into overhead from public.companies c where c.id = cid;

  -- Every active project's category months in one pass (FLOW-977), not one project_category_months
  -- call per project.
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'categories', coalesce(m.categories, '[]'::jsonb)
    ) order by p.id), '[]'::jsonb)
  into projects
  from public.projects p
  left join private.project_category_months_many(array(
    select ap.id from public.projects ap
    where ap.company_id = cid and ap.status = 'active' and ap.id is distinct from overhead
  ), 6, today) m on m.project_id = p.id
  where p.company_id = cid
    and p.status = 'active'
    and p.id is distinct from overhead;

  with streams as (
    -- The lines of each recurring charge of an active project but the overhead one: that project counts them.
    select sl.id
    from private.recurring_stream_lines(cid, today) sl
    join private.recurring_parties(cid, today) rp
      on rp.direction = sl.direction and rp.party_id = sl.party_id and rp.currency = sl.currency
      and rp.project_id = sl.stream_project
    join public.projects sp on sp.id = sl.stream_project and sp.status = 'active'
    where sl.stream_project is not null
      and sl.stream_project is distinct from overhead
  ),
  entries as (
    select l.category_id, l.currency, date_trunc('month', l.doc_date)::date as month, -l.amount_net as amount
    from private.pnl_lines l
    join public.transactions lt on lt.id = l.transaction_id
    left join public.categories cat on cat.id = l.category_id
    where l.company_id = cid
      and l.kind = 'expense'
      and (l.unassigned or l.pnl_role = 'overhead')
      and not lt.category_suggested
      and not exists (
        select 1 from public.review_queue q
        where q.transaction_id = lt.id and q.company_id = lt.company_id and q.status = 'open'
      )
      and l.doc_date >= first_month
      and l.doc_date < this_month
      and not exists (select 1 from streams st where st.id = lt.id)
      and private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select e.category_id, e.currency, e.month, sum(e.amount)::bigint as amount
    from entries e
    group by e.category_id, e.currency, e.month
  ),
  keys as (
    select distinct s.category_id, s.currency from sums s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.category_id,
      'name', c.name,
      'currency', k.currency,
      'months_minor', (
        select jsonb_agg(coalesce(s.amount, 0) order by m)
        from generate_series(first_month, this_month - interval '1 month', interval '1 month') m
        left join sums s on s.category_id is not distinct from k.category_id
          and s.currency = k.currency and s.month = m::date
      )
    ) order by k.currency, c.name), '[]'::jsonb)
  into general
  from keys k
  left join public.categories c on c.id = k.category_id;

  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matched_transaction_id', m.transaction_id) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  left join public.forecast_line_matches m on m.edit_id = e.id and m.month = next_month and m.company_id = e.company_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and private.pfe_hits(e.start_month, e.pace, next_month);

  -- The rest of the year's edits: every edit (of the same projects) that applies to any month left in the
  -- year, with each added edit's matched line by month, so the year's forecast applies each month's own.
  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matches', coalesce((
          select jsonb_object_agg(m.month, m.transaction_id order by m.month)
          from public.forecast_line_matches m
          where m.edit_id = e.id and m.company_id = e.company_id and m.month = any(rest_months)
        ), '{}'::jsonb)) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into rest_edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and exists (select 1 from unnest(rest_months) rm where private.pfe_hits(e.start_month, e.pace, rm));

  return jsonb_build_object(
    'today', today,
    'month', next_month,
    'overhead_project_id', overhead,
    'projects', projects,
    'general', general,
    'edits', edits,
    'rest_edits', rest_edits
  );
end;
$function$

;

create or replace function private.overhead_shares(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date, p_currencies text[], p_by_month boolean)
 RETURNS TABLE(month date, currency text, available boolean, share_agorot bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with cid as (
    select
      p_company as id,
      (select c.overhead_project_id from public.companies c where c.id = p_company) as overhead_project,
      case when p_basis = 'invoiced' then 'invoiced' else 'cash' end as basis
  ),
  -- One pass over the company's income and overhead lines, as overhead_share_for reads them.
  lines as (
    select
      case when p_by_month then date_trunc('month',
        case when l.kind = 'income' and (select basis from cid) = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
      )::date end as month,
      l.currency,
      l.project_id,
      l.kind,
      l.pnl_role,
      l.amount_net,
      l.kind = 'income'
        and (
          l.direction = 'expense'
          or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
        and l.project_id is not null
        and l.project_id is distinct from (select overhead_project from cid) as is_income
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = any(p_currencies)
      and l.in_pnl
      and (l.kind = 'income' or l.pnl_role = 'overhead')
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
      -- Only lines that can be income or overhead reach the view's per-line work, as in
      -- overhead_share_for (20261014093004): a line of an income kind or direction, filed to
      -- the overhead project, or split (its parts can be either). A superset: the filters
      -- above still decide.
      and l.transaction_id = any(array(
        select t.id
        from public.transactions t
        left join public.categories k on k.id = t.category_id
        where t.company_id = p_company
          and (t.direction = 'income' or k.kind = 'income' or t.pnl_role = 'overhead'
            or t.project_id = (select overhead_project from cid))
        union
        select s.transaction_id from private.split_parts s where s.company_id = p_company
        union
        select s.transaction_id from private.loan_parts s where s.company_id = p_company
      ))
  ),
  totals as (
    select
      l.month,
      l.currency,
      coalesce(sum(l.amount_net) filter (where l.is_income), 0)::bigint as total_income,
      coalesce(-(sum(l.amount_net) filter (where l.kind = 'expense' and l.pnl_role = 'overhead'))::bigint, 0) as overhead_cost
    from lines l
    group by l.month, l.currency
  ),
  project_income as (
    select l.month, l.currency, l.project_id, sum(l.amount_net)::bigint as income
    from lines l
    where l.is_income
    group by l.month, l.currency, l.project_id
    having sum(l.amount_net) > 0
  ),
  -- Only the months and currencies where the project has a weighted share need the rounding;
  -- elsewhere its share is 0.
  rounded as (
    select
      s.month,
      s.currency,
      p.id as project_id,
      p.name as project_name,
      s.income,
      t.overhead_cost,
      t.overhead_cost::numeric * s.income / t.total_income as exact,
      private.round_agorot_shekel_hundreds(t.overhead_cost::numeric * s.income / t.total_income) as rounded
    from project_income s
    join totals t on t.month is not distinct from s.month and t.currency = s.currency
    join public.projects p on p.id = s.project_id
    where p.company_id = (select id from cid)
      and t.total_income <> 0
      and exists (
        select 1 from project_income x
        where x.month is not distinct from s.month and x.currency = s.currency and x.project_id = p_project
      )
  ),
  spread as (
    select
      r.*,
      max(r.exact - r.rounded) over (partition by r.month, r.currency) as max_gap,
      coalesce(sum(r.rounded) over (partition by r.month, r.currency), 0) as rounded_sum
    from rounded r
  ),
  -- The remainder goes to one project, picked as overhead_share_for picks it.
  ranked as (
    select
      s.*,
      row_number() over (
        partition by s.month, s.currency
        order by
          case when s.max_gap > 0 then (s.exact - s.rounded) end desc nulls last,
          case when s.max_gap <= 0 then s.income end desc nulls last,
          s.project_name asc
      ) as pick
    from spread s
  )
  select
    t.month,
    t.currency,
    (select id from cid) is not null and t.total_income <> 0,
    case
      when (select id from cid) is null or t.total_income = 0 then null::bigint
      else coalesce((
        select (k.rounded + case when k.pick = 1 then k.overhead_cost - k.rounded_sum else 0 end)::bigint
        from ranked k
        where k.month is not distinct from t.month and k.currency = t.currency and k.project_id = p_project
      ), 0)
    end
  from totals t;
$function$

;

create or replace function private.overhead_share_for(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date)
 RETURNS TABLE(available boolean, share_agorot bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with cid as (
    select
      p_company as id,
      (select c.overhead_project_id from public.companies c where c.id = p_company) as overhead_project,
      case when p_basis = 'invoiced' then 'invoiced' else 'cash' end as basis
  ),
  -- One pass over the company's lines feeds both the income weights and the overhead cost.
  lines as (
    select l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.amount_net
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = 'ILS'
      and l.in_pnl
      -- Only income and overhead lines feed the share. Filtering on them here lets the planner
      -- drop the company's project costs before it looks up any line's splits.
      and (l.kind = 'income' or l.pnl_role = 'overhead')
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
      -- Only lines that can be income or overhead reach the view's per-line work: a line of an
      -- income kind or direction, filed to the overhead project, or split (its parts can be
      -- either). A superset: the filters above still decide.
      and l.transaction_id = any(array(
        select t.id
        from public.transactions t
        left join public.categories k on k.id = t.category_id
        where t.company_id = p_company
          and (t.direction = 'income' or k.kind = 'income' or t.pnl_role = 'overhead'
            or t.project_id = (select overhead_project from cid))
        union
        select s.transaction_id from private.split_parts s where s.company_id = p_company
        union
        select s.transaction_id from private.loan_parts s where s.company_id = p_company
      ))
  ),
  income as (
    select l.project_id, l.amount_net
    from lines l
    where l.kind = 'income'
      and (
        l.direction = 'expense'
        or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and l.project_id is not null
      and l.project_id is distinct from (select overhead_project from cid)
  ),
  totals as (
    select
      coalesce((select sum(i.amount_net) from income i), 0)::bigint as total_income,
      coalesce((
        select -sum(l.amount_net)::bigint
        from lines l
        where l.kind = 'expense' and l.pnl_role = 'overhead'
      ), 0) as overhead_cost
  ),
  rounded as (
    select
      p.id as project_id,
      p.name as project_name,
      s.income,
      (select overhead_cost from totals)::numeric * s.income / (select total_income from totals) as exact,
      private.round_agorot_shekel_hundreds(
        (select overhead_cost from totals)::numeric * s.income / (select total_income from totals)
      ) as rounded
    from public.projects p
    join (
      select i.project_id, sum(i.amount_net)::bigint as income
      from income i
      group by i.project_id
      having sum(i.amount_net) > 0
    ) s on s.project_id = p.id
    where p.company_id = (select id from cid)
      and (select id from cid) is not null
      and (select total_income from totals) <> 0
  ),
  chosen as (
    select r.project_id
    from rounded r
    order by
      case when (select max(x.exact - x.rounded) from rounded x) > 0 then (r.exact - r.rounded) end desc nulls last,
      case when (select max(x.exact - x.rounded) from rounded x) <= 0 then r.income end desc nulls last,
      r.project_name asc
    limit 1
  ),
  adjusted as (
    select
      r.project_id,
      r.rounded + case
        when r.project_id = (select c.project_id from chosen c)
          then (select overhead_cost from totals) - (select coalesce(sum(x.rounded), 0) from rounded x)
        else 0
      end as share
    from rounded r
  )
  select
    (select id from cid) is not null and (select total_income from totals) <> 0,
    case
      when (select id from cid) is null or (select total_income from totals) = 0 then null::bigint
      else coalesce((select a.share from adjusted a where a.project_id = p_project), 0)
    end;
$function$

;

create or replace function private.project_category_entries_by_currency(p_project uuid)
 RETURNS TABLE(category_id uuid, transaction_id uuid, description text, doc_date date, amount_net bigint, created_at timestamp with time zone, shared boolean, currency text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Each branch reads the project's lines first and looks up each line's own rows by index
  -- (lateral, offset 0 so the planner can't flatten it), whatever row counts it guesses.
  select l.category_id, l.transaction_id, t.description, l.doc_date, l.amount_net, t.created_at, false, l.currency
  from private.pnl_lines l
  cross join lateral (
    select t.description, t.created_at
    from public.transactions t
    where t.id = l.transaction_id
      and not t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
    offset 0
  ) t
  where l.project_id = p_project
    and l.transaction_id = any(array(
      select t2.id from public.transactions t2 where t2.project_id = p_project
      union
      select s2.transaction_id from private.split_parts s2 where s2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'project'
  union all
  select l.category_id, l.transaction_id, t.description, l.doc_date,
    case
      when l.part is null and l.amount_net = l.line_amount_net then a.amount_net
      else coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    end,
    t.created_at, true, l.currency
  from private.pnl_lines l
  cross join lateral (
    select a.amount_net from public.allocations a
    where a.transaction_id = l.transaction_id and a.project_id = p_project
    offset 0
  ) a
  cross join lateral (
    select t.description, t.created_at
    from public.transactions t
    where t.id = l.transaction_id
      and not t.category_suggested
    offset 0
  ) t
  where l.transaction_id = any(array(
      select a2.transaction_id from public.allocations a2 where a2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'shared'
    and l.category_id is not null;
$function$

;

create or replace function private.project_category_months_many(p_projects uuid[], p_months integer, p_today date)
 RETURNS TABLE(project_id uuid, categories jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today)::date - make_interval(months => p_months))::date as first_month,
      private.company_base_currency((select private.readable_company_id())) as base_currency
  ),
  entries as (
    select pr.id as project_id, e.category_id, e.currency, date_trunc('month', e.doc_date)::date as month,
      extract(day from e.doc_date)::integer as day, -e.amount_net as amount
    from bounds b
    cross join unnest(p_projects) pr(id)
    cross join lateral private.project_category_entries_by_currency(pr.id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where e.doc_date >= b.first_month
      and e.doc_date < (b.this_month + interval '1 month')::date
      and private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select e.project_id, e.category_id, e.currency, e.month, sum(e.amount)::bigint as amount
    from entries e
    group by e.project_id, e.category_id, e.currency, e.month
  ),
  keys as (
    select s.project_id, s.category_id, s.currency,
      coalesce(sum(s.amount) filter (where s.month = b.this_month), 0)::bigint as this_month_minor
    from sums s, bounds b
    group by s.project_id, s.category_id, s.currency
  ),
  per_month as (
    select k.project_id, k.category_id, k.currency, m::date as month, coalesce(s.amount, 0)::bigint as amount
    from keys k
    cross join bounds b
    cross join generate_series(b.first_month, b.this_month - interval '1 month', interval '1 month') m
    left join sums s on s.project_id = k.project_id and s.category_id is not distinct from k.category_id
      and s.currency = k.currency and s.month = m::date
  ),
  -- A month counts as seen only with a positive cost, so a refund-only month is not a cost.
  past as (
    select pm.project_id, pm.category_id, pm.currency,
      jsonb_agg(pm.amount order by pm.month) as months_minor,
      (count(*) filter (where pm.amount > 0))::integer as months_seen,
      round(percentile_cont(0.5) within group (order by pm.amount) filter (where pm.amount > 0))::bigint as median_minor
    from per_month pm
    group by pm.project_id, pm.category_id, pm.currency
  ),
  days as (
    select e.project_id, e.category_id, e.currency,
      round(percentile_cont(0.5) within group (order by e.day))::integer as typical_day
    from entries e, bounds b
    where e.month < b.this_month
    group by e.project_id, e.category_id, e.currency
  ),
  rows as (
    select k.project_id, k.category_id, k.currency, k.this_month_minor, p.months_minor, p.months_seen,
      p.median_minor, d.typical_day
    from keys k
    join past p on p.project_id = k.project_id and p.category_id is not distinct from k.category_id
      and p.currency = k.currency
    left join days d on d.project_id = k.project_id and d.category_id is not distinct from k.category_id
      and d.currency = k.currency
  )
  select r.project_id, jsonb_agg(jsonb_build_object(
      'id', r.category_id,
      'name', c.name,
      'group_name', c.group_name,
      'parent_id', c.parent_id,
      'currency', r.currency,
      'this_month_minor', r.this_month_minor,
      'months_minor', r.months_minor,
      'months_seen', r.months_seen,
      'expected_minor', case when r.months_seen >= 3 then r.median_minor end,
      'typical_day', r.typical_day,
      'flag', private.category_flag(
        r.currency, r.this_month_minor,
        case when r.months_seen >= 3 then r.median_minor end,
        r.months_seen, r.typical_day, p_today
      )
    ) order by r.currency is distinct from b.base_currency, r.currency, r.this_month_minor desc, c.name)
  from rows r
  cross join bounds b
  left join public.categories c on c.id = r.category_id
  group by r.project_id;
$function$

;

create or replace function private.project_is_empty(p_company uuid, p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select not exists (
    select 1 from public.transactions t
    where t.company_id = p_company and t.project_id = p_project
  ) and not exists (
    select 1 from public.allocations a
    where a.company_id = p_company and a.project_id = p_project
  ) and not exists (
    select 1 from private.split_parts s
    where s.company_id = p_company and s.project_id = p_project
  ) and not exists (
    select 1 from public.split_rule_targets r
    where r.company_id = p_company and r.project_id = p_project
  ) and not exists (
    select 1 from public.suppliers sup
    where sup.company_id = p_company and sup.remembered_project_id = p_project
  ) and not exists (
    select 1 from public.loans l
    where l.company_id = p_company and l.project_id = p_project
  );
$function$

;

create or replace function private.project_line_ids(p_company uuid, p_project uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select array(
    select t.id from public.transactions t where t.company_id = p_company and t.project_id = p_project
    union
    select a.transaction_id from public.allocations a where a.company_id = p_company and a.project_id = p_project
    union
    select s.transaction_id from private.split_parts s where s.company_id = p_company and s.project_id = p_project
  );
$function$

;

-- P6: line lists, review, recurring and Jev readers read parts through the split_parts / loan_parts views.

CREATE OR REPLACE FUNCTION public.search_transactions(p_query text DEFAULT NULL::text, p_scope text DEFAULT 'all'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_project text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_amount_min bigint DEFAULT NULL::bigint, p_amount_max bigint DEFAULT NULL::bigint, p_category_exact boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  lim integer;
  off integer;
  needle text;
  scope text;
  want_project uuid;
  no_project boolean := false;
  want_category uuid;
  want_categories uuid[];
  no_category boolean := false;
begin
  if p_scope is not null and p_scope not in ('pending', 'filed', 'all') then
    raise exception 'validation';
  end if;
  if p_direction is not null and p_direction not in ('income', 'expense') then
    raise exception 'validation';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'validation';
  end if;
  -- An amount is the line's bank amount (gross) without its sign, in minor units of the line's
  -- own currency; both ends are included, so min = max finds one figure (FLOW-211).
  if p_amount_min < 0 or p_amount_max < 0
     or (p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max) then
    raise exception 'validation';
  end if;
  -- A project or category is an id, or 'none' for lines with none.
  if p_project = 'none' then
    no_project := true;
  elsif p_project is not null then
    if p_project !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'validation';
    end if;
    want_project := p_project::uuid;
  end if;
  if p_category = 'none' then
    no_category := true;
  elsif p_category is not null then
    if p_category !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'validation';
    end if;
    want_category := p_category::uuid;
  end if;

  cid := private.readable_company_id();
  if cid is null then
    return jsonb_build_object('total', 0, 'expenses', '[]'::jsonb);
  end if;
  -- FLOW-406: a parent category also matches its sub-categories' lines, unless exact.
  if want_category is not null then
    if coalesce(p_category_exact, false) then
      want_categories := array[want_category];
    else
      select array_agg(c.id) into want_categories
      from public.categories c
      where c.company_id = cid and (c.id = want_category or c.parent_id = want_category);
      want_categories := coalesce(want_categories, array[want_category]);
    end if;
  end if;
  scope := coalesce(p_scope, 'all');
  lim := least(greatest(coalesce(p_limit, 50), 0), 100);
  off := greatest(coalesce(p_offset, 0), 0);
  -- The text is matched literally: % and _ in it are not wildcards.
  needle := nullif(btrim(coalesce(p_query, '')), '');
  needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');

  return (
    with matched as (
      select
        t.id,
        t.description,
        t.doc_date,
        t.doc_kind,
        t.amount_net,
        t.amount_gross,
        t.vat_amount,
        t.direction,
        t.currency,
        t.amount_original,
        t.line_status,
        t.project_id,
        t.category_id,
        p.name as project_name,
        c.name as category_name,
        s.name as supplier_name,
        cu.name as customer_name,
        waiting.open as waiting_review
      from public.transactions t
      left join public.projects p on p.id = t.project_id
      left join public.categories c on c.id = t.category_id
      left join public.suppliers s on s.id = t.supplier_id
      left join public.customers cu on cu.id = t.customer_id
      cross join lateral (
        select exists (
          select 1
          from public.review_queue q
          where q.transaction_id = t.id
            and q.company_id = cid
            and q.status = 'open'
        ) as open
      ) waiting
      where t.company_id = cid
        and t.removed_at is null
        and t.line_status <> 'pending'
        and (
          scope = 'all'
          or (scope = 'pending' and waiting.open)
          or (scope = 'filed' and not waiting.open)
        )
        and (p_from is null or t.doc_date >= p_from)
        and (p_to is null or t.doc_date <= p_to)
        and (p_direction is null or t.direction::text = p_direction)
        and (p_amount_min is null or abs(t.amount_gross) >= p_amount_min)
        and (p_amount_max is null or abs(t.amount_gross) <= p_amount_max)
        and (
          needle is null
          or t.description ilike '%' || needle || '%'
          or coalesce(s.name, '') ilike '%' || needle || '%'
          or coalesce(cu.name, '') ilike '%' || needle || '%'
        )
        -- A project: the line's own, a share of a shared cost, or a split part on it. A split
        -- part with no project is on the line's project (0138); a line split whose parts all
        -- name a project holds none of it on the line's own.
        and (
          want_project is null
          or (
            t.project_id = want_project
            and not exists (
              select 1 from private.split_parts sp
              where sp.transaction_id = t.id and sp.company_id = cid
              having bool_and(sp.project_id is not null)
            )
          )
          or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.company_id = cid and a.project_id = want_project
          )
          or exists (
            select 1 from private.split_parts sp
            where sp.transaction_id = t.id and sp.company_id = cid and sp.project_id = want_project
          )
        )
        and (
          not no_project
          or (
            t.project_id is null
            and not exists (
              select 1 from public.allocations a
              where a.transaction_id = t.id and a.company_id = cid
            )
            and not exists (
              select 1 from private.split_parts sp
              where sp.transaction_id = t.id and sp.company_id = cid and sp.project_id is not null
            )
          )
        )
        -- A category: the line's own, or a part of its line split or its loan split. A split
        -- line counts by its parts, so its own category matches only through a part. A loan
        -- payment with a part waiting for review counts whole under its own category (0136).
        and (
          want_category is null
          or (
            t.category_id = any(want_categories)
            and not exists (
              select 1 from private.split_parts sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from private.loan_parts ls
              where ls.transaction_id = t.id and ls.company_id = cid
              having not bool_or(ls.needs_review)
            )
          )
          or exists (
            select 1 from private.split_parts sp
            where sp.transaction_id = t.id and sp.company_id = cid and sp.category_id = any(want_categories)
          )
          or exists (
            select 1 from private.loan_parts ls
            where ls.transaction_id = t.id and ls.company_id = cid and ls.category_id = any(want_categories)
          )
        )
        and (
          not no_category
          or (
            t.category_id is null
            and not exists (
              select 1 from private.split_parts sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from private.loan_parts ls
              where ls.transaction_id = t.id and ls.company_id = cid
            )
          )
        )
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      -- Every matching line's month totals, on the first page only.
      'months', case when off = 0 then coalesce((
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'currency', m.currency,
          'income_minor', m.income_minor,
          'expense_minor', m.expense_minor
        ) order by m.month desc, m.currency)
        from (
          select
            to_char(mt.doc_date, 'YYYY-MM') as month,
            mt.currency,
            coalesce(sum(abs(mt.amount_net)) filter (
              where mt.direction = 'income' and mt.amount_net >= 0
            ), 0)::bigint as income_minor,
            coalesce(sum(abs(mt.amount_net)) filter (
              where not (mt.direction = 'income' and mt.amount_net >= 0)
            ), 0)::bigint as expense_minor
          from matched mt
          -- The states as one id-keyed map, read once: a join of the lines to the states could
          -- nested-loop 4,000 x 4,000 when the planner had no statistics.
          where (
            (select coalesce(jsonb_object_agg(st.transaction_id, st.state), '{}'::jsonb)
             from private.line_pnl_states(array(select id from matched)) st)
            ->> mt.id::text
          ) is distinct from 'out'
          group by 1, 2
        ) m
      ), '[]'::jsonb) end,
      'expenses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', page.id,
          'description', page.description,
          'doc_date', page.doc_date,
          'doc_kind', page.doc_kind,
          'amount_net', page.amount_net,
          'amount_gross', page.amount_gross,
          'vat_agorot', page.vat_amount,
          'direction', page.direction,
          'currency', page.currency,
          'amount_original', page.amount_original,
          'line_status', page.line_status,
          'project_id', page.project_id,
          'category_id', page.category_id,
          'project_name', page.project_name,
          'category_name', page.category_name,
          'supplier_name', page.supplier_name,
          'customer_name', page.customer_name,
          'waiting_review', page.waiting_review,
          'kept_out', private.line_pnl_state(page.id) = 'out',
          'split_parts', (
            select count(*)::int from private.split_parts sp
            where sp.transaction_id = page.id and sp.company_id = cid
          ),
          'loan_matched', exists (
            select 1 from private.loan_parts ls
            where ls.transaction_id = page.id and ls.company_id = cid
          )
        ) order by page.doc_date desc, page.description, page.id)
        from (
          select *
          from matched
          order by doc_date desc, description, id
          limit lim
          offset off
        ) page
      ), '[]'::jsonb)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_review_queue(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inserted integer;
  income_inserted integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
          union all select 1 from private.split_parts s where s.transaction_id = t.id
        )
        then 'unallocated_shared'
      when t.category_id is null then 'missing_category'
      when coalesce(t.pnl_role, 'project') = 'project' and t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'expense'
    and t.line_status = 'posted'
    and (
      (
        t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
          union all select 1 from private.split_parts s where s.transaction_id = t.id
        )
      )
      or t.category_id is null
      or (
        coalesce(t.pnl_role, 'project') = 'project'
        and t.project_id is null
      )
      or (t.category_suggested and not t.user_assigned)
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    -- FLOW-941: a line in a confirmed transfer pair is not queued.
    and not exists (
      select 1 from public.transfer_matches m
      where m.company_id = t.company_id and m.same
        and t.id in (m.out_transaction_id, m.in_transaction_id)
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    );
  get diagnostics inserted = row_count;


  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.category_id is null then 'missing_category'
      -- FLOW-309: a guessed category with no project still waits for its category.
      when t.project_id is null and not t.user_assigned and not t.category_assigned then 'missing_category'
      when t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'income'
    and t.line_status = 'posted'
    -- FLOW-309: a receipt waits with its invoice (decision 0165).
    and not (t.doc_kind = 'receipt' and t.linked_external_id is not null and private.receipt_waits(t.id))
    and (
      -- FLOW-121: a guessed kept-out category counts, so the line waits for review like any
      -- other unfiled income until the guess is confirmed.
      (t.project_id is null
        and (t.category_id is null
          or not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part)))
      -- FLOW-126: income that already has a project but only a guess of a kept-out category
      -- counts until the guess is confirmed, so it waits for review too. A guessed loan
      -- category is already out (line_category_out), so it is not queued (FLOW-127).
      -- user_assigned / category_assigned stay next to category_suggested: not every owner
      -- write clears category_suggested (assign_expense sets user_assigned only), and the
      -- closing update below keys on the same pair.
      or (t.project_id is not null
        and t.category_suggested
        and not t.user_assigned
        and not t.category_assigned
        and coalesce(c.excluded_from_pnl, false)
        and not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part))
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    -- FLOW-941: a line in a confirmed transfer pair is not queued.
    and not exists (
      select 1 from public.transfer_matches m
      where m.company_id = t.company_id and m.same
        and t.id in (m.out_transaction_id, m.in_transaction_id)
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    )
    and not exists (
      -- A row the owner approved or changed is settled; it is not queued again (FLOW-309).
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status in ('approved', 'changed')
    );
  get diagnostics income_inserted = row_count;



  -- 0184: no row is queued as pending_income any more; the rows below were queued before it.
  -- FLOW-309: an open pending_income row whose line has posted takes the reason the income
  -- insert above would give it, or is removed when the posted line needs no review. A settled
  -- row only drops the pending label, as before. An open income row with a null reason (a
  -- settled row reopened after its line posted) takes the same reason; it is never removed.
  update public.review_queue q
  set reason = case
      when t.category_id is null then 'missing_category'
      when t.project_id is null and not t.user_assigned and not t.category_assigned then 'missing_category'
      when t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and (q.reason = 'pending_income' or q.reason is null)
    and private.is_connector_source(t.source)
    and t.direction = 'income'
    and t.line_status = 'posted'
    and t.removed_at is null
    -- Same as the income insert: a line with a settled row is not queued, so an open row
    -- the old code queued after a changed row is removed below, not relabelled.
    and not exists (
      select 1 from public.review_queue s
      where s.transaction_id = t.id and s.status in ('approved', 'changed')
    )
    and (
      (t.project_id is null
        and (t.category_id is null
          or not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part)))
      or (t.project_id is not null
        and t.category_suggested
        and not t.user_assigned
        and not t.category_assigned
        and coalesce(c.excluded_from_pnl, false)
        and not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part))
    );

  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  update public.review_queue q
  set reason = null
  from public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status <> 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    -- 0184: a line still pending at the bank waits in no review until it posts.
    and (t.line_status in ('void', 'pending') or t.removed_at is not null);

  update public.transactions t
  set category_suggested = true
  from public.review_queue q
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and t.company_id = p_company_id
    and t.direction = 'income'
    and not t.user_assigned
    and not t.category_assigned;

  -- FLOW-309: an open income missing_category row whose category the owner has since set.
  perform private.relabel_income_category_pick(p_company_id, q.transaction_id)
  from public.review_queue q
  where q.company_id = p_company_id
    and q.status = 'open'
    and q.reason = 'missing_category';

  return inserted + income_inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_transaction(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', t.id,
    'description', t.description,
    'direction', t.direction,
    'doc_kind', t.doc_kind,
    'doc_date', t.doc_date,
    'amount_gross', t.amount_gross,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'vat_amount', t.vat_amount,
    'vat_status', t.vat_status,
    'currency', t.currency,
    'source', t.source,
    'pnl_role', t.pnl_role,
    'project_id', t.project_id,
    'project_name', p.name,
    'category_id', t.category_id,
    'category_name', c.name,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'in_pnl_override', t.in_pnl_override,
    'category_excluded_from_pnl', coalesce(c.excluded_from_pnl, false),
    -- FLOW-121: a guessed category. A guessed kept-out category still counts.
    'category_suggested', t.category_suggested,
    'in_pnl', private.line_in_pnl(
      case when not exists (
        select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ),
    'loan_split', public.get_loan_split(t.id),
    -- FLOW-149: a journal entry (it moves no money) and its reference; null for any other line.
    'journal_entry', (select jsonb_build_object('reference', j.reference)
                      from public.journal_entries j
                      where j.transaction_id = t.id and j.company_id = t.company_id),
    'pnl_state', private.line_pnl_state(t.id),
    'in_cash_override', t.in_cash_override,
    'cash_state', private.line_cash_state(t.id),
    'pnl_fixed', c.loan_part is not null
      or exists (select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id),
    'review_status', (
      select q.status
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id
      order by case when q.status = 'open' then 0 else 1 end, q.created_at desc
      limit 1
    ),
    'review_id', (
      select q.id
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
    'review_reason', (
      select q.reason
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
    'paid', t.cash_date is not null,
    'open_gross_agorot', case
      when t.doc_kind = 'invoice' and t.external_id is not null then
        t.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = t.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = t.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = t.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = t.external_id
        ), 0)
      else null
    end,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id,
        'project_name', ap.name,
        'share_bp', a.share_bp,
        'amount_net', a.amount_net
      ) order by ap.name)
      from public.allocations a
      join public.projects ap on ap.id = a.project_id
      where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = p_id
    and t.removed_at is null
    and t.line_status <> 'pending'
    and t.company_id = (select private.readable_company_id());
$function$
;

CREATE OR REPLACE FUNCTION private.follow_invoice(p_invoice uuid, p_owner boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv record;
  receipt_ids uuid[];
  waiting boolean;
  filed boolean;
  settled_id uuid;
  settled_status public.review_status;
  r record;
  own_row uuid;
  paired_row uuid;
  open_row uuid;
  prior_shares jsonb;
  want_shares jsonb;
  want_user boolean;
  want_suggested boolean;
  want_cat_assigned boolean;
  want_proj_assigned boolean;
  owner_filed boolean;
  receipt_filed boolean;
begin
  receipt_ids := array(select private.invoice_receipts(p_invoice));
  if cardinality(receipt_ids) = 0 then
    return;
  end if;

  select t.id, t.company_id, t.project_id, t.category_id, t.pnl_role, t.user_assigned,
         t.category_suggested, t.category_assigned, t.project_assigned,
         c.excluded_from_pnl, c.loan_part
  into inv
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.id = p_invoice;

  -- Rule 1: the invoice waits. A split_mismatch row is the receipt's own review and stays.
  waiting := private.invoice_waits(inv.id);
  if waiting then
    delete from public.review_queue q
    where q.company_id = inv.company_id
      and q.transaction_id = any(receipt_ids)
      and q.status = 'open'
      and q.reason is distinct from 'split_mismatch';
    return;
  end if;

  -- Rule 2 needs a filed invoice on one project or on none: a category, and a project unless
  -- the category keeps the line out of the P&L. A shared or overhead invoice, or one split by
  -- category, is left alone.
  filed := inv.category_id is not null
    and coalesce(inv.pnl_role, 'project') = 'project'
    and not exists (
      select 1 from private.split_parts sp
      where sp.transaction_id = inv.id and sp.company_id = inv.company_id
    )
    and (
      inv.project_id is not null
      or private.line_category_out(inv.excluded_from_pnl, inv.category_suggested, inv.loan_part)
    );
  if not filed then
    return;
  end if;

  select q.id, q.status into settled_id, settled_status
  from public.review_queue q
  where q.transaction_id = inv.id
    and q.company_id = inv.company_id
    and q.status in ('approved', 'changed')
  order by q.resolved_at desc nulls last, q.created_at desc, q.id desc
  limit 1;

  for r in
    select t.*
    from public.transactions t
    where t.id = any(receipt_ids) and t.company_id = inv.company_id
    order by t.doc_date, t.id
    -- A receipt another transaction holds (a sync writing it) is skipped rather than waited
    -- for, which could deadlock with a sync that holds the receipt and waits for the invoice.
    -- A skipped receipt that is still unfiled is queued by the next sync, and its row's insert
    -- pairs it then.
    for update skip locked
  loop
    select q.id into paired_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id
      and q.paired_with is not null and q.status in ('approved', 'changed')
    order by q.created_at desc, q.id desc
    limit 1;

    select q.id into open_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id and q.status = 'open'
    order by q.created_at desc, q.id desc
    limit 1;

    -- The owner filed this receipt on their own: it keeps that filing.
    select q.id into own_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id
      and q.paired_with is null and q.status in ('approved', 'changed')
    limit 1;
    -- So is a receipt split by category, whose split this would lose.
    owner_filed := (paired_row is null and open_row is null and (own_row is not null or r.user_assigned))
      or exists (
        select 1 from private.split_parts sp
        where sp.transaction_id = r.id and sp.company_id = r.company_id
      );
    if owner_filed then
      continue;
    end if;
    -- A receipt the owner refiled after the joint approval is theirs too: it stops following.
    if paired_row is not null and exists (
      select 1 from public.review_queue q
      where q.id = paired_row
        -- A null left by a deleted project or category is not the owner's choice.
        and ((r.project_id is not null and r.project_id is distinct from q.paired_project_id)
          or (r.category_id is not null and r.category_id is distinct from q.paired_category_id))
    ) then
      update public.review_queue set paired_with = null where id = paired_row;
      continue;
    end if;
    if not coalesce(p_owner, false) and paired_row is null and open_row is null then
      select r.category_id is not null and (
        r.project_id is not null
        or private.line_category_out(c.excluded_from_pnl, r.category_suggested, c.loan_part)
      )
      into receipt_filed
      from (select 1) one
      left join public.categories c on c.id = r.category_id and c.company_id = r.company_id;
      if receipt_filed then
        continue;
      end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', a.project_id,
      'share_bp', a.share_bp,
      'amount_net', a.amount_net
    )), '[]'::jsonb)
    into prior_shares
    from public.allocations a
    where a.transaction_id = r.id and a.company_id = r.company_id;

    want_user := case when settled_id is null then inv.user_assigned else true end;
    want_suggested := case when settled_id is null then inv.category_suggested else false end;
    want_cat_assigned := case when settled_id is null then inv.category_assigned else true end;
    want_proj_assigned := case when settled_id is null then inv.project_assigned else inv.project_id is not null end;
    want_shares := case
      when inv.pnl_role = 'project' and inv.project_id is not null then jsonb_build_array(jsonb_build_object(
        'project_id', inv.project_id,
        'share_bp', 10000,
        'amount_net', r.amount_net
      ))
      else '[]'::jsonb
    end;

    -- Only a real change writes, so a sync that touches the pair again adds no audit rows.
    if r.project_id is distinct from inv.project_id
      or r.category_id is distinct from inv.category_id
      or r.pnl_role is distinct from inv.pnl_role
      or r.user_assigned is distinct from want_user
      or r.category_suggested is distinct from want_suggested
      or r.category_assigned is distinct from want_cat_assigned
      or r.project_assigned is distinct from want_proj_assigned
    then
      update public.transactions
      set project_id = inv.project_id,
          category_id = inv.category_id,
          pnl_role = inv.pnl_role,
          user_assigned = want_user,
          category_suggested = want_suggested,
          category_assigned = want_cat_assigned,
          project_assigned = want_proj_assigned
      where id = r.id and company_id = r.company_id;
    end if;

    if prior_shares is distinct from want_shares then
      delete from public.allocations where transaction_id = r.id and company_id = r.company_id;
      if jsonb_array_length(want_shares) > 0 then
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (r.company_id, r.id, inv.project_id, 10000, r.amount_net);
      end if;
    end if;

    if paired_row is not null then
      -- Already settled with the invoice: the snapshot from then stays.
      update public.review_queue
      set paired_with = coalesce(settled_id, paired_with),
          status = coalesce(settled_status, status),
          paired_project_id = inv.project_id,
          paired_category_id = inv.category_id
      where id = paired_row
        and (paired_with is distinct from coalesce(settled_id, paired_with)
          or status is distinct from coalesce(settled_status, status)
          or paired_project_id is distinct from inv.project_id
          or paired_category_id is distinct from inv.category_id);
    elsif settled_id is not null then
      if open_row is not null then
        delete from public.review_queue q
        where q.transaction_id = r.id and q.company_id = r.company_id
          and q.status = 'open' and q.id <> open_row;
        update public.review_queue
        set status = settled_status,
            resolved_at = now(),
            paired_with = settled_id,
            paired_project_id = inv.project_id,
            paired_category_id = inv.category_id,
            prior_project_id = r.project_id,
            prior_category_id = r.category_id,
            prior_pnl_role = r.pnl_role,
            prior_user_assigned = r.user_assigned,
            prior_category_suggested = r.category_suggested,
            prior_category_assigned = r.category_assigned,
            prior_project_assigned = r.project_assigned,
            prior_allocations = prior_shares,
            doc_fingerprint = private.doc_fingerprint(
              r.direction::text, r.doc_kind::text, r.amount_gross, r.doc_date, r.description, r.external_id
            )
        where id = open_row;
      else
        insert into public.review_queue (
          company_id, transaction_id, status, reason, resolved_at, paired_with,
          paired_project_id, paired_category_id, prior_project_id, prior_category_id, prior_pnl_role, prior_user_assigned,
          prior_category_suggested, prior_category_assigned, prior_project_assigned,
          prior_allocations, doc_fingerprint
        ) values (
          r.company_id, r.id, settled_status, null, now(), settled_id,
          inv.project_id, inv.category_id, r.project_id, r.category_id, r.pnl_role, r.user_assigned,
          r.category_suggested, r.category_assigned, r.project_assigned,
          prior_shares,
          private.doc_fingerprint(
            r.direction::text, r.doc_kind::text, r.amount_gross, r.doc_date, r.description, r.external_id
          )
        );
      end if;
    else
      -- Filed without review: the receipt is filed the same way and waits for nothing.
      delete from public.review_queue q
      where q.transaction_id = r.id and q.company_id = r.company_id and q.status = 'open';
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.line_anomalies(p_company uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with target as (
    select t.id, t.direction, coalesce(t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.amount_net, t.amount_gross, t.doc_kind, t.external_id, t.linked_external_id
    from public.transactions t
    where t.company_id = p_company
      and t.id = any (p_ids)
      and t.removed_at is null
      and t.line_status <> 'void'
  ),
  -- The company's 90th percentile posted line, per direction and currency, over the year up to
  -- the newest target line. Materialized, so it is read once and not per line.
  p90 as materialized (
    select c.direction, c.currency,
      percentile_disc(0.9) within group (order by abs(c.amount_net)) as amount
    from public.transactions c
    where c.company_id = p_company
      and c.removed_at is null and c.line_status = 'posted'
      and (c.direction = 'expense' or c.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and c.doc_date >= (select max(doc_date) from target) - 365
      and c.doc_date <= (select max(doc_date) from target)
      and (c.direction, c.currency) in (select direction, currency from target)
    group by c.direction, c.currency
    having count(*) >= 20
  ),
  duplicate as (
    select tg.id, 'duplicate' as kind, jsonb_build_object(
        'other_transaction_id', d.id,
        'other_doc_date', d.doc_date
      ) as detail
    from target tg
    cross join lateral (
      select o.id, o.doc_date
      from public.transactions o
      where o.company_id = p_company
        and o.id <> tg.id
        and o.direction = tg.direction
        and coalesce(o.supplier_id, o.customer_id) = tg.party_id
        and o.currency = tg.currency
        and o.amount_gross = tg.amount_gross
        and o.doc_kind = tg.doc_kind
        and o.removed_at is null
        and o.line_status = 'posted'
        and o.doc_date between tg.doc_date - 7 and tg.doc_date + 7
        -- Not a document and the one it links to.
        and coalesce(o.linked_external_id <> tg.external_id, true)
        and coalesce(tg.linked_external_id <> o.external_id, true)
        -- Not an invoice that a credit note cancels (cancelled and issued again).
        and not exists (
          select 1 from public.transactions cr
          where cr.company_id = p_company and cr.doc_kind = 'credit' and cr.removed_at is null
            and cr.line_status <> 'void'
            and cr.linked_external_id is not null
            and cr.linked_external_id in (o.external_id, tg.external_id)
        )
        -- Not two loans' payments to the same lender.
        and not exists (
          select 1 from private.loan_parts a
          join private.loan_parts b on b.company_id = a.company_id and b.loan_id <> a.loan_id
          where a.company_id = p_company and a.transaction_id = tg.id and b.transaction_id = o.id
        )
      order by abs(o.doc_date - tg.doc_date), o.id
      limit 1
    ) d
    where tg.party_id is not null and tg.amount_gross <> 0
  ),
  history as (
    select tg.id, tg.amount_net,
      (select count(*) from public.transactions h
       where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
         and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
         and h.removed_at is null and h.line_status = 'posted'
         and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and h.doc_date < tg.doc_date) as earlier,
      (select percentile_disc(0.5) within group (order by abs(h.amount_net))
       from (
         select h.amount_net from public.transactions h
         where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
           and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
           and h.removed_at is null and h.line_status = 'posted'
           and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
           and h.doc_date < tg.doc_date and h.doc_date >= tg.doc_date - 365
         order by h.doc_date desc limit 12
       ) h) as typical,
      (select count(*) from public.transactions h
       where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
         and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
         and h.removed_at is null and h.line_status = 'posted'
         and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and h.doc_date < tg.doc_date and h.doc_date >= tg.doc_date - 365) as recent,
      (select p.amount from p90 p
       where p.direction = tg.direction and p.currency = tg.currency) as company_p90
    from target tg
    where tg.party_id is not null
      -- A receipt that pays several invoices is not compared with single invoices.
      and (tg.direction = 'expense' or tg.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
  ),
  spike as (
    select h.id, 'amount_spike' as kind, jsonb_build_object(
        'typical_amount_minor', h.typical,
        'ratio', round(abs(h.amount_net)::numeric / h.typical, 1)
      ) as detail
    from history h
    where h.recent >= 3
      and h.typical > 0
      and abs(h.amount_net) >= 3 * h.typical
      and abs(h.amount_net) - h.typical >= 10000
  ),
  new_party as (
    select h.id, 'new_party_large' as kind, jsonb_build_object(
        'company_p90_minor', h.company_p90
      ) as detail
    from history h
    where h.earlier = 0
      and h.company_p90 is not null
      and abs(h.amount_net) >= h.company_p90
      and abs(h.amount_net) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id', a.id, 'kind', a.kind) || a.detail
    order by a.id, a.kind), '[]'::jsonb)
  from (
    select * from duplicate
    union all select * from spike
    union all select * from new_party
  ) a;
$function$
;

CREATE OR REPLACE FUNCTION public.answer_transfer_match(p_out_transaction_id uuid, p_in_transaction_id uuid, p_same boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  o public.transactions%rowtype;
  i public.transactions%rowtype;
  cur public.transfer_matches%rowtype;
  prior_same boolean;
  lo record;
  li record;
  written jsonb := '{}'::jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_out_transaction_id is null or p_in_transaction_id is null or p_out_transaction_id = p_in_transaction_id then
    raise exception 'validation';
  end if;
  -- Both lines locked, in id order.
  perform 1 from public.transactions t
  where t.company_id = cid and t.id in (p_out_transaction_id, p_in_transaction_id)
  order by t.id
  for update;
  select * into o from public.transactions t where t.id = p_out_transaction_id and t.company_id = cid;
  select * into i from public.transactions t where t.id = p_in_transaction_id and t.company_id = cid;
  if o.id is null or i.id is null or o.source <> 'mercury' or i.source <> 'mercury' then
    raise exception 'transaction not found';
  end if;
  if o.direction <> 'expense' or o.doc_kind = 'credit' or i.direction <> 'income' then
    raise exception 'not a transfer pair';
  end if;

  select * into cur
  from public.transfer_matches m
  where m.company_id = cid and m.out_transaction_id = o.id and m.in_transaction_id = i.id
  for update;
  prior_same := case when found then cur.same end;

  if p_same is distinct from prior_same then
    if prior_same is not null then
      if prior_same then
        perform private.transfer_restore_line(cid, cur.prior->'out');
        perform private.transfer_restore_line(cid, cur.prior->'in');
      end if;
      delete from public.transfer_matches m
      where m.company_id = cid and m.out_transaction_id = o.id and m.in_transaction_id = i.id;
    end if;

    if p_same then
      if exists (
        select 1 from public.transfer_matches m
        where m.company_id = cid and m.same
          and (m.out_transaction_id = o.id or m.in_transaction_id = i.id
            or m.out_transaction_id = i.id or m.in_transaction_id = o.id)
      ) then
        raise exception 'already matched';
      end if;
      if exists (select 1 from private.loan_parts x where x.company_id = cid and x.transaction_id in (o.id, i.id)) then
        raise exception 'loan line is fixed';
      end if;
      if exists (select 1 from private.split_parts x where x.company_id = cid and x.transaction_id in (o.id, i.id)) then
        raise exception 'line has a split by category';
      end if;
      -- The list's own rule (transfer_match_lines: posted, synced, still in the P&L, not a credit note,
      -- not an invoice's deposit, …) for both lines, then the pair's: two connections, the same amount
      -- and currency, 3 days apart at most.
      select l.* into lo from private.transfer_match_lines(cid, array[o.id]) l where l.direction = 'expense';
      select l.* into li from private.transfer_match_lines(cid, array[i.id]) l where l.direction = 'income';
      if lo.id is null or li.id is null
        or lo.currency <> li.currency or lo.amount <> li.amount
        or lo.slot = li.slot
        or abs(lo.doc_date - li.doc_date) > 3
      then
        raise exception 'not a transfer pair';
      end if;
      written := jsonb_build_object(
        'out', private.transfer_mark_line(cid, o.id),
        'in', private.transfer_mark_line(cid, i.id)
      );
    end if;

    if p_same is not null then
      insert into public.transfer_matches (company_id, out_transaction_id, in_transaction_id, same, prior, set_by, set_at)
      values (cid, o.id, i.id, p_same, written, auth.uid(), now());
    end if;
  end if;

  return jsonb_build_object(
    'out_transaction_id', o.id,
    'in_transaction_id', i.id,
    'same', p_same,
    'prior_same', prior_same
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.transfer_match_lines(p_company uuid, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, direction txn_direction, doc_date date, currency text, amount bigint, slot smallint, org_label text, party text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select t.id, t.direction, t.doc_date, t.currency, t.amount_original, a.slot, a.org_label,
    case when t.direction = 'expense' then s.name else cu.name end
  from public.transactions t
  join private.mercury_synced_accounts(p_company) a on a.account_id = t.provider_meta->>'account_id'
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  left join public.suppliers s on s.id = t.supplier_id and s.company_id = t.company_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  where t.company_id = p_company
    and (p_ids is null or t.id = any (p_ids))
    and t.source = 'mercury'
    and t.removed_at is null
    and t.line_status = 'posted'
    and t.doc_kind <> 'credit'
    and t.amount_original > 0
    and private.line_in_pnl(
      t.in_pnl_override,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part)
    and not exists (select 1 from private.loan_parts x where x.company_id = p_company and x.transaction_id = t.id)
    and not exists (select 1 from private.split_parts x where x.company_id = p_company and x.transaction_id = t.id)
    and not exists (
      select 1 from public.invoice_payment_links x where x.company_id = p_company and x.bank_transaction_id = t.id
    )
    and not exists (
      select 1 from public.transfer_matches m
      where m.company_id = p_company and m.same and t.id in (m.out_transaction_id, m.in_transaction_id)
    );
$function$
;

CREATE OR REPLACE FUNCTION private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, months_seen integer, typical_day integer, typical_amount_minor bigint, last_doc_date date, seen_this_month boolean, project_id uuid, category_id uuid, last_amount_minor bigint, source text, pace text, pace_source text, next_due_month date, typical_amount_source text, pays_loan boolean, this_month_minor bigint, this_month_transaction_id uuid, this_month_line_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6
  ),
  -- One recurring charge per party and project (recurring_stream_lines): a servicer paying two
  -- loans, or a utility billing two properties, is two charges, each with its own usual amount.
  -- A split line counts only its parts for the charge (decision 0189).
  lines as (
    select sl.direction, sl.party_id, sl.currency, sl.stream_project,
      sl.doc_date, sl.amount_net, sl.project_id, sl.category_id,
      date_trunc('month', sl.doc_date)::date as month, true as posted,
      sl.id, sl.created_at
    from private.recurring_stream_lines(p_company, p_today) sl
  ),
  -- The owner's words: a row with a project is that charge's; a row with none is the party's (decision 0188).
  overrides as (
    select o.direction, o.party_id, o.currency, o.project_id, o.recurring, o.pace, o.typical_amount_minor
    from public.recurring_overrides o
    where o.company_id = p_company and p_overrides
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month and l.posted
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  gapped as (
    select m.*,
      private.month_diff(m.month, lag(m.month) over w) as gap,
      row_number() over (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month desc) as back
    from monthly m
    window w as (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month)
  ),
  stats as (
    select g.direction, g.party_id, g.currency, g.stream_project,
      (count(*) filter (where g.month >= b.window6))::integer as months6,
      coalesce(bool_or(g.month >= (b.this_month - interval '2 months')::date), false) as recent,
      percentile_disc(0.5) within group (order by g.first_day) filter (where g.month >= b.window6) as day6,
      percentile_disc(0.5) within group (order by abs(g.amount)) filter (where g.month >= b.window6) as amount6,
      count(*)::integer as months24,
      percentile_disc(0.5) within group (order by g.first_day) as day24,
      percentile_disc(0.5) within group (order by abs(g.amount)) as amount24,
      max(g.month) as last_month,
      max(g.gap) filter (where g.back = 1) as gap_last,
      max(g.gap) filter (where g.back = 2) as gap_prev
    from gapped g, bounds b
    group by g.direction, g.party_id, g.currency, g.stream_project
  ),
  detected as (
    select s.*,
      case
        when s.months24 >= 3 and s.gap_last = 2 and s.gap_prev = 2
          and private.month_diff(b.this_month, s.last_month) <= 4 then '2months'
        when s.months24 >= 3 and s.gap_last = 3 and s.gap_prev = 3
          and private.month_diff(b.this_month, s.last_month) <= 6 then 'quarter'
        when s.months6 >= 3 and s.recent then 'month'
        when s.months24 >= 2 and s.gap_last between 11 and 13
          and private.month_diff(b.this_month, s.last_month) <= 13 then 'year'
      end as auto_pace
    from stats s, bounds b
  ),
  -- The party's main charge: the project it billed in the most of the last six complete months (then the
  -- latest). A party-wide "recurring" (a row with no project) makes only this charge recurring (decision 0185).
  main as (
    select distinct on (l.direction, l.party_id, l.currency) l.direction, l.party_id, l.currency, l.stream_project
    from lines l, bounds b
    group by l.direction, l.party_id, l.currency, l.stream_project
    order by l.direction, l.party_id, l.currency,
      count(distinct l.month) filter (where l.month >= b.window6 and l.month < b.this_month) desc, max(l.doc_date) desc,
      l.stream_project nulls last
  ),
  -- The owner's word on each charge (decision 0188). The charge's own row wins, field by field. Else the
  -- party-wide row: "not recurring" ends every charge, "recurring" makes the main charge recurring, and its
  -- pace is every charge's. The usual amount is only the charge's own (decision 0189): a charge with no
  -- project reads it from the row with no project.
  words as (
    select s.direction, s.party_id, s.currency, s.stream_project,
      coalesce(own.recurring, case
        when pw.recurring is false then false
        when pw.recurring and s.stream_project is not distinct from mn.stream_project then true
      end) as recurring,
      coalesce(own.pace, pw.pace) as pace,
      coalesce(own.typical_amount_minor, case when s.stream_project is null then pw.typical_amount_minor end) as amount
    from (select distinct l.direction, l.party_id, l.currency, l.stream_project from lines l) s
    left join main mn on mn.direction = s.direction and mn.party_id = s.party_id and mn.currency = s.currency
    left join overrides own on own.direction = s.direction and own.party_id = s.party_id and own.currency = s.currency
      and own.project_id = s.stream_project
    left join overrides pw on pw.direction = s.direction and pw.party_id = s.party_id and pw.currency = s.currency
      and pw.project_id is null
  ),
  parties as (
    select d.direction, d.party_id, d.currency, d.stream_project, d.auto_pace,
      coalesce(w.pace, d.auto_pace, 'month') as pace,
      w.recurring, w.pace as pace_override, w.amount as owner_amount,
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24, d.last_month, d.gap_last
    from detected d
    left join words w on w.direction = d.direction and w.party_id = d.party_id and w.currency = d.currency
      and w.stream_project is not distinct from d.stream_project
    where case
      when w.recurring is false then false
      when d.auto_pace is not null then true
      else coalesce(w.recurring, false)
    end
  ),
  -- A charge that comes every 2 months, quarter or year (decision 0199): its usual day and amount come only
  -- from the months on its cycle, counted back from its last complete month (last, last - pace, last - 2 x
  -- pace, ... within the 24 months the lines cover). The months before a switch to yearly billing (the old
  -- monthly bills) and an off-cycle extra no longer pull the median down. The same median rule: by size,
  -- the direction's sign added in chosen. A yearly charge steps by its last gap when that is 11 to 13 months,
  -- the drift the yearly rule allows (0175), so a bill a month early or late still finds last year's.
  cycle_months as (
    select p.direction, p.party_id, p.currency, p.stream_project, g.month, g.first_day, g.amount
    from parties p
    join gapped g on g.direction = p.direction and g.party_id = p.party_id and g.currency = p.currency
      and g.stream_project is not distinct from p.stream_project
    where p.pace <> 'month'
      and private.month_diff(p.last_month, g.month)
        % case when p.pace = 'year' and p.gap_last between 11 and 13 then p.gap_last else private.pace_months(p.pace) end = 0
  ),
  cycle as (
    select cm.direction, cm.party_id, cm.currency, cm.stream_project,
      percentile_disc(0.5) within group (order by cm.first_day) as day_cycle,
      percentile_disc(0.5) within group (order by abs(cm.amount)) as amount_cycle
    from cycle_months cm
    group by cm.direction, cm.party_id, cm.currency, cm.stream_project
  ),
  -- A charge the owner marked recurring with no complete posted month yet: its latest month, this one
  -- included, is its usual day and amount (the owner's amount, when set).
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join words w on w.direction = l.direction and w.party_id = l.party_id and w.currency = l.currency
      and w.stream_project is not distinct from l.stream_project
    where w.recurring
      and not exists (
        select 1 from stats s
        where s.direction = l.direction and s.party_id = l.party_id and s.currency = l.currency
          and s.stream_project is not distinct from l.stream_project
      )
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  forced as (
    select distinct on (fm.direction, fm.party_id, fm.currency, fm.stream_project)
      fm.direction, fm.party_id, fm.currency, fm.stream_project, coalesce(w.pace, 'month') as pace, w.pace as pace_override,
      0 as months_seen, fm.first_day as typical_day,
      coalesce((case when fm.direction = 'expense' then -1 else 1 end) * w.amount, fm.amount)::bigint as typical_amount_minor,
      case when w.amount is null then 'computed' else 'owner' end as amount_source
    from forced_monthly fm
    join words w on w.direction = fm.direction and w.party_id = fm.party_id and w.currency = fm.currency
      and w.stream_project is not distinct from fm.stream_project
    order by fm.direction, fm.party_id, fm.currency, fm.stream_project, fm.month desc
  ),
  chosen as (
    select p.direction, p.party_id, p.currency, p.stream_project, p.pace, p.pace_override,
      case when p.pace = 'month' and p.months6 > 0 then p.months6 else p.months24 end as months_seen,
      case
        when p.pace = 'month' and p.months6 > 0 then p.day6
        -- The last month is always on its own cycle, so every known pace has cycle months; the fallback
        -- to the 24 months is only for a pace pace_months does not know.
        when p.pace <> 'month' then coalesce(c.day_cycle, p.day24)
        else p.day24
      end::integer as typical_day,
      -- The owner's amount, else the median by size (of the last 6 months for a monthly charge, of the
      -- cycle's months for any other pace), with the direction's sign, so an even count does not lean one way.
      ((case when p.direction = 'expense' then -1 else 1 end)
        * coalesce(p.owner_amount, case
            when p.pace = 'month' and p.months6 > 0 then p.amount6
            when p.pace <> 'month' then coalesce(c.amount_cycle, p.amount24)
            else p.amount24
          end))::bigint
        as typical_amount_minor,
      case when p.recurring is null then 'auto' else 'user' end as source,
      case when p.owner_amount is null then 'computed' else 'owner' end as amount_source
    from parties p
    left join cycle c on c.direction = p.direction and c.party_id = p.party_id and c.currency = p.currency
      and c.stream_project is not distinct from p.stream_project
    union all
    select f.direction, f.party_id, f.currency, f.stream_project, f.pace, f.pace_override,
      f.months_seen, f.typical_day, f.typical_amount_minor, 'user', f.amount_source
    from forced f
  ),
  -- The charges in the order they come out of chosen, kept to the end: the joins below may reorder
  -- them, and readers that list charges with equal sort keys keep the order they had.
  ordered as (
    select c.*, row_number() over () as ord
    from chosen c
  ),
  -- Each charge's last posted bill: its date and every posted line of the charge on that date, read for
  -- every charge in one pass (FLOW-943; a subquery per charge before). Every stream line is posted, so the
  -- bill's month is also the last month the charge was seen.
  bills as (
    select distinct on (l.direction, l.party_id, l.currency, l.stream_project)
      l.direction, l.party_id, l.currency, l.stream_project, l.doc_date, sum(l.amount_net)::bigint as amount
    from lines l
    where l.posted
    group by l.direction, l.party_id, l.currency, l.stream_project, l.doc_date
    order by l.direction, l.party_id, l.currency, l.stream_project, l.doc_date desc
  ),
  -- This month's lines of each charge: their sum, the latest (by date, then entry, then id) and how many.
  this_month as (
    select l.direction, l.party_id, l.currency, l.stream_project, sum(l.amount_net)::bigint as amount,
      (array_agg(l.id order by l.doc_date desc, l.created_at desc, l.id desc))[1] as transaction_id,
      count(*)::integer as line_count
    from lines l, bounds b
    where l.doc_date >= b.this_month
    group by l.direction, l.party_id, l.currency, l.stream_project
  ),
  -- The charges that pay a loan: any of the charge's lines is split into loan parts.
  loan_charges as (
    select distinct l.direction, l.party_id, l.currency, l.stream_project
    from lines l
    where exists (
      select 1 from private.loan_parts ls
      where ls.company_id = p_company and ls.transaction_id = l.id
    )
  ),
  seen as (
    select c.*,
      date_trunc('month', bl.doc_date)::date as last_seen_month,
      bl.doc_date as last_doc_date,
      bl.amount as last_amount,
      lc.direction is not null as pays_loan,
      tm.amount as this_month_minor,
      tm.transaction_id as this_month_transaction_id,
      coalesce(tm.line_count, 0) as this_month_line_count
    from ordered c
    left join bills bl on bl.direction = c.direction and bl.party_id = c.party_id and bl.currency = c.currency
      and bl.stream_project is not distinct from c.stream_project
    left join loan_charges lc on lc.direction = c.direction and lc.party_id = c.party_id and lc.currency = c.currency
      and lc.stream_project is not distinct from c.stream_project
    left join this_month tm on tm.direction = c.direction and tm.party_id = c.party_id and tm.currency = c.currency
      and tm.stream_project is not distinct from c.stream_project
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    p.last_doc_date,
    p.last_seen_month = b.this_month,
    -- The charge's project is its stream's (null when none of the party's lines has one).
    p.stream_project,
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.stream_project is not distinct from p.stream_project
       and l.category_id is not null
       -- A monthly charge's category is from its last 6 months; any other pace's from its cycle's months
       -- and this month (decision 0199), so the old monthly bills before a switch don't name it. A charge
       -- with no cycle months (marked recurring before a complete month) reads all its lines.
       and case
         when p.pace = 'month' then l.doc_date >= b.window6
         else l.month >= b.this_month
           or exists (
             select 1 from cycle_months cm
             where cm.direction = p.direction and cm.party_id = p.party_id and cm.currency = p.currency
               and cm.stream_project is not distinct from p.stream_project and cm.month = l.month)
           or not exists (
             select 1 from cycle_months cm
             where cm.direction = p.direction and cm.party_id = p.party_id and cm.currency = p.currency
               and cm.stream_project is not distinct from p.stream_project)
       end
     group by l.category_id order by count(*) desc, max(l.doc_date) desc limit 1),
    p.last_amount,
    p.source,
    p.pace,
    case when p.pace_override is null then 'auto' else 'user' end,
    -- Monthly: this month until its bill comes, then next month. Otherwise one pace after the
    -- last month it was seen (earlier than this month when it is late).
    case
      when p.pace = 'month' then
        case when p.last_seen_month = b.this_month then (b.this_month + interval '1 month')::date else b.this_month end
      else (p.last_seen_month + make_interval(months => private.pace_months(p.pace)))::date
    end,
    p.amount_source,
    p.pays_loan,
    p.this_month_minor,
    p.this_month_transaction_id,
    p.this_month_line_count
  from seen p
  cross join bounds b
  order by p.ord;
$function$
;

CREATE OR REPLACE FUNCTION private.recurring_line_parts(p_company uuid, p_from date, p_to date)
 RETURNS TABLE(id uuid, direction txn_direction, party_id uuid, line_party_id uuid, currency text, doc_date date, created_at timestamp with time zone, amount_net bigint, project_id uuid, category_id uuid, split boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lines as (
    select t.id, t.direction, coalesce(mm.party_id, t.supplier_id, t.customer_id) as party_id,
      coalesce(t.supplier_id, t.customer_id) as line_party_id, t.currency,
      t.doc_date, t.created_at, t.amount_net::bigint as amount_net, t.project_id, t.category_id
    from public.transactions t
    -- FLOW-430: a party answered "the same" counts as the recurring one.
    left join public.recurring_matches mm
      on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
      and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status = 'posted'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= p_from
      and t.doc_date <= p_to
  ),
  -- A split the P&L counts (pnl_lines, decision 0104): two or more parts that sum to the line, no loan split.
  split as (
    select l.id
    from lines l
    join private.split_parts s on s.company_id = p_company and s.transaction_id = l.id
    where not exists (select 1 from private.loan_parts ls where ls.transaction_id = l.id)
    group by l.id, l.amount_net
    having count(*) >= 2 and sum(s.amount_minor) = abs(l.amount_net)
  ),
  -- The counted parts (a kept-out category never counts), each with the project it is for: its own, else
  -- the line's. Of a line's parts for one project the charge takes one: the line's own category, else the
  -- largest part.
  parts as (
    select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at,
      (sign(l.amount_net) * s.amount_minor)::bigint as amount_net,
      coalesce(s.project_id, l.project_id) as project_id, s.category_id,
      row_number() over (
        partition by l.id, coalesce(s.project_id, l.project_id)
        order by (s.category_id = l.category_id) desc, s.amount_minor desc, s.ordinal
      ) as pick
    from lines l
    join split sp on sp.id = l.id
    join private.split_parts s on s.company_id = p_company and s.transaction_id = l.id
    join public.categories c on c.company_id = p_company and c.id = s.category_id
    where not c.excluded_from_pnl
  )
  select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at, l.amount_net,
    l.project_id, l.category_id, false
  from lines l
  where not exists (select 1 from split sp where sp.id = l.id)
  union all
  select p.id, p.direction, p.party_id, p.line_party_id, p.currency, p.doc_date, p.created_at, p.amount_net,
    p.project_id, p.category_id, true
  from parts p
  where p.pick = 1;
$function$
;

CREATE OR REPLACE FUNCTION private.party_charges_json(p_company uuid, p_transaction_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with line as (
    select t.id, t.amount_net, t.doc_date, t.project_id, t.category_id,
      date_trunc('month', t.doc_date)::date as anchor
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = p_company and t.removed_at is null
      and t.line_status = 'posted'
  ),
  party as (
    select pp.direction, pp.party_id, pp.currency, pp.name, l.anchor,
      -- The usual amount as of the line's own month: this month's line reads today's usual.
      least(p_today, (l.anchor + interval '1 month' - interval '1 day')::date) as as_of
    from line l, private.payment_party(p_company, p_transaction_id) pp
  ),
  -- The party's lines in the window, a split line as its counted parts (recurring_line_parts).
  pieces as (
    select lp.*
    from party p,
      private.recurring_line_parts(p_company, (p.anchor - interval '24 months')::date,
        -- A line dated after today still reads its own month.
        greatest(p_today, (p.anchor + interval '1 month' - interval '1 day')::date)) lp
    where lp.direction = p.direction and lp.line_party_id = p.party_id and lp.currency = p.currency
  ),
  -- The line's own context: its loan when it pays one, else the project and category of its own part (a
  -- split line's part for its own project, else its largest), so a supplier with two loans (or two
  -- projects) compares this one with its own earlier charges.
  scope as (
    select
      case when own.id is not null then own.project_id else l.project_id end as project_id,
      case when own.id is not null then own.category_id else l.category_id end as category_id,
      (select ls.loan_id from private.loan_parts ls where ls.transaction_id = l.id limit 1) as loan_id
    from line l
    left join lateral (
      select pc.id, pc.project_id, pc.category_id
      from pieces pc
      where pc.id = l.id
      order by (pc.project_id is not distinct from l.project_id) desc, abs(pc.amount_net) desc
      limit 1
    ) own on true
  ),
  party_lines as (
    select pc.id, pc.doc_date, pc.amount_net as amount, pc.created_at, pc.project_id,
      date_trunc('month', pc.doc_date)::date as month,
      case
        when s.loan_id is not null then exists (
          select 1 from private.loan_parts ls where ls.transaction_id = pc.id and ls.loan_id = s.loan_id
        )
        else pc.project_id is not distinct from s.project_id and pc.category_id is not distinct from s.category_id
          and not exists (select 1 from private.loan_parts ls where ls.transaction_id = pc.id)
      end as in_scope
    from pieces pc
    cross join scope s
  ),
  lines as (
    select pl.id, pl.doc_date, pl.amount, pl.created_at, pl.month from party_lines pl where pl.in_scope
  ),
  recurring as (
    select r.typical_amount_minor as usual
    from party p, private.recurring_parties(p_company, p.as_of) r
    where r.direction = p.direction and r.party_id = p.party_id and r.currency = p.currency
      and r.typical_amount_minor <> 0
      -- As in recurring_arrivals: a party marked recurring with no complete month yet has no usual,
      -- unless the owner set it.
      and (r.months_seen > 0 or r.typical_amount_source = 'owner')
      -- The charge's usual stands for this context only when every one of its project's lines is in it.
      and not exists (
        select 1 from party_lines pl, scope s
        where not pl.in_scope and pl.project_id is not distinct from s.project_id
      )
      -- A party has one charge per project (decision 0185): the line's own charge. A line the streams
      -- leave out (dated after today, or an income receipt) reads its own project's.
      and r.project_id is not distinct from coalesce(
        (select sl.stream_project from private.recurring_stream_lines(p_company, p.as_of) sl, line l
         where sl.id = p_transaction_id
         order by (sl.project_id is not distinct from l.project_id) desc, abs(sl.amount_net) desc
         limit 1),
        (select s.project_id from scope s)
      )
  ),
  -- Otherwise: the median of the context's earlier complete months, at least 2 of the last 6.
  earlier as (
    select ((case when p.direction = 'expense' then -1 else 1 end)
        * percentile_disc(0.5) within group (order by abs(m.amount)))::bigint as usual
    from party p, (
      select l.month, sum(l.amount) as amount
      from lines l, party p
      where l.month >= (p.anchor - interval '6 months')::date and l.month < p.anchor
      group by l.month
    ) m
    group by p.direction
    having count(*) >= 2
  ),
  usual as (
    select coalesce((select r.usual from recurring r limit 1), (select nullif(e.usual, 0) from earlier e)) as amount,
      case
        when exists (select 1 from recurring) then 'recurring'
        when exists (select 1 from earlier e where e.usual <> 0) then 'earlier_months'
      end as source
  ),
  month_total as (
    select (select sum(l.amount)::bigint from lines l, party p where l.month = p.anchor) as amount,
      -- An income receipt is not one of the counted lines (its invoice is), so it gets no comparison.
      exists (select 1 from lines l where l.id = p_transaction_id) as counted
  ),
  -- The percent only when the month and the usual amount go the same way (a refund month gets none)
  -- and it fits a readable figure.
  change as (
    select case
      when u.amount is null or not mt.counted or mt.amount is null or sign(mt.amount) <> sign(u.amount) then null
      else round((abs(mt.amount) - abs(u.amount)) * 100.0 / abs(u.amount))
    end as percent
    from usual u, month_total mt
  )
  select case
    when not exists (select 1 from line) then null
    when not exists (select 1 from party) then jsonb_build_object(
      'transaction_id', p_transaction_id, 'party', null, 'month', null, 'month_amount_minor', null,
      'typical_amount_minor', null, 'typical_source', null, 'change_percent', null,
      'others', 0, 'months', '[]'::jsonb, 'charges', '[]'::jsonb
    )
    else (
      select jsonb_build_object(
        'transaction_id', p_transaction_id,
        'party', jsonb_build_object('direction', p.direction, 'id', p.party_id, 'name', p.name, 'currency', p.currency),
        'month', to_char(p.anchor, 'YYYY-MM'),
        'month_amount_minor', mt.amount,
        'typical_amount_minor', u.amount,
        'typical_source', u.source,
        'change_percent', case when abs(c.percent) < 100000 then c.percent::integer end,
        'others', (select count(*) from lines l where l.id <> p_transaction_id),
        'months', (
          select jsonb_agg(jsonb_build_object(
              'month', to_char(g.month, 'YYYY-MM'),
              'amount_minor', coalesce((select sum(l.amount)::bigint from lines l where l.month = g.month::date), 0)
            ) order by g.month)
          from generate_series(p.anchor - interval '5 months', p.anchor, interval '1 month') g(month)
        ),
        'charges', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', c.id, 'doc_date', c.doc_date, 'amount_minor', c.amount
            ) order by c.doc_date desc, c.created_at desc)
          -- The 12 newest up to the line's month, so an older line sits among its own neighbours.
          from (
            select * from lines l where l.month <= p.anchor order by l.doc_date desc, l.created_at desc limit 12
          ) c
        ), '[]'::jsonb)
      )
      from party p, usual u, month_total mt, change c
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION private.reassign_charge_line(p_company uuid, p_id uuid, p_project uuid, p_category uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line record;
  undo_id uuid;
begin
  select t.project_id, t.category_id, t.pnl_role into line
  from public.transactions t
  where t.id = p_id and t.company_id = p_company and t.removed_at is null
  for update;
  if not found then
    return null;
  end if;
  if line.pnl_role = 'shared'
    or exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_id and q.company_id = p_company
        and q.status = 'open' and q.reason = 'unallocated_shared'
    )
    or exists (select 1 from private.split_parts s where s.transaction_id = p_id and s.company_id = p_company)
  then
    return null;
  end if;
  if p_project is not null then
    if line.project_id is not distinct from p_project
      and (p_category is null or line.category_id is not distinct from p_category)
    then
      return null;
    end if;
    if coalesce(p_category, line.category_id) is null then
      return null;
    end if;
    undo_id := public.reassign_transaction(p_id, p_project, coalesce(p_category, line.category_id));
  else
    if line.category_id is not distinct from p_category then
      return null;
    end if;
    undo_id := public.set_transaction_category(p_id, p_category, true);
  end if;
  update public.reassign_undo u
  set charge_pick = true, after_project_id = t.project_id, after_category_id = t.category_id, after_pnl_role = t.pnl_role
  from public.transactions t
  where u.id = undo_id and u.company_id = p_company and t.id = p_id and t.company_id = p_company;
  return undo_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.jev_outcome_sync(p_company uuid, p_transaction uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  review public.review_status;
  sugg public.tag_suggestions%rowtype;
  line public.transactions%rowtype;
  s_project uuid;
  s_category uuid;
  f_project uuid;
  project_comparable boolean;
  category_comparable boolean;
begin
  select q.status into review
  from public.review_queue q
  where q.company_id = p_company and q.transaction_id = p_transaction
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;

  select * into sugg
  from public.tag_suggestions s
  where s.company_id = p_company and s.transaction_id = p_transaction
  order by s.created_at desc
  limit 1;

  select * into line
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction;

  if review is null or review not in ('approved', 'changed') or sugg.id is null or line.id is null
     or line.removed_at is not null then
    delete from public.jev_outcomes o where o.transaction_id = p_transaction;
    return;
  end if;

  s_project := private.jev_uuid_or_null(sugg.answers -> 'project' ->> 'choice');
  s_category := private.jev_uuid_or_null(sugg.answers -> 'category' ->> 'choice');

  project_comparable := s_project is not null
    and coalesce(line.pnl_role::text, '') not in ('shared', 'overhead')
    and (select count(*) from public.allocations a
         where a.company_id = p_company and a.transaction_id = p_transaction) <= 1
    -- A split part with no project stays on the line's project.
    and (
      not exists (
        select 1 from private.split_parts ls
        where ls.company_id = p_company and ls.transaction_id = p_transaction
      )
      or (
        select bool_and(coalesce(ls.project_id, line.project_id) is not null)
          and count(distinct coalesce(ls.project_id, line.project_id)) = 1
        from private.split_parts ls
        where ls.company_id = p_company and ls.transaction_id = p_transaction
      )
    );
  f_project := case when project_comparable then coalesce((
    select coalesce(ls.project_id, line.project_id) from private.split_parts ls
    where ls.company_id = p_company and ls.transaction_id = p_transaction
    limit 1
  ), line.project_id, (
    select a.project_id from public.allocations a
    where a.company_id = p_company and a.transaction_id = p_transaction
    limit 1
  )) end;
  category_comparable := s_category is not null
    and not exists (
      select 1 from private.split_parts ls
      where ls.company_id = p_company and ls.transaction_id = p_transaction
    );

  insert into public.jev_outcomes (
    company_id, transaction_id, suggestion_id, model_version, confidence,
    suggested_project_id, suggested_category_id, final_project_id, final_category_id,
    project_match, category_match, review_status, resolved_at
  ) values (
    p_company, p_transaction, sugg.id, sugg.model_version, sugg.confidence,
    s_project, s_category, f_project, line.category_id,
    case when project_comparable then f_project is not distinct from s_project end,
    case when category_comparable then line.category_id is not distinct from s_category end,
    review, now()
  )
  on conflict (transaction_id) do update
    set suggestion_id = excluded.suggestion_id,
        model_version = excluded.model_version,
        confidence = excluded.confidence,
        suggested_project_id = excluded.suggested_project_id,
        suggested_category_id = excluded.suggested_category_id,
        final_project_id = excluded.final_project_id,
        final_category_id = excluded.final_category_id,
        project_match = excluded.project_match,
        category_match = excluded.category_match,
        review_status = excluded.review_status,
        resolved_at = case
          when public.jev_outcomes.review_status = excluded.review_status
           and public.jev_outcomes.suggestion_id = excluded.suggestion_id
          then public.jev_outcomes.resolved_at
          else excluded.resolved_at
        end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.jev_supplier_history(p_company uuid, p_suppliers uuid[], p_per integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_per is null or p_per < 1 or p_per > 20
     or coalesce(cardinality(p_suppliers), 0) > 500 then
    raise exception 'validation';
  end if;

  with latest as (
    -- The current (newest) review row of each line of these parties, read once.
    select distinct on (q.transaction_id) q.transaction_id, q.status
    from public.review_queue q
    join public.transactions t on t.company_id = q.company_id and t.id = q.transaction_id
    where q.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
    order by q.transaction_id, q.created_at desc, q.updated_at desc, q.id desc
  ),
  filed as (
    select coalesce(t.supplier_id, t.customer_id) as party_id, t.id, t.direction, t.doc_date,
      t.description, t.amount_net, t.project_id, t.category_id, t.pnl_role,
      exists (
        select 1 from private.split_parts ls
        where ls.company_id = t.company_id and ls.transaction_id = t.id
      ) as split,
      (select count(*) from public.allocations a
       where a.company_id = t.company_id and a.transaction_id = t.id) as allocation_count,
      row_number() over (
        partition by coalesce(t.supplier_id, t.customer_id), t.direction order by t.doc_date desc, t.id desc
      ) as n
    from public.transactions t
    join latest l on l.transaction_id = t.id and l.status in ('approved', 'changed')
    where t.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
      and t.removed_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', f.party_id,
      'direction', f.direction,
      'doc_date', f.doc_date,
      'description', left(coalesce(f.description, ''), 120),
      'amount_net', f.amount_net,
      'project_id', f.project_id,
      'category_id', f.category_id,
      'pnl_role', f.pnl_role,
      'split', f.split or f.allocation_count > 1,
      'jev_project_id', o.suggested_project_id,
      'jev_category_id', o.suggested_category_id,
      'jev_corrected', o.project_match is false or o.category_match is false
    ) order by f.party_id, f.direction, f.n), '[]'::jsonb)
  into result
  from filed f
  left join public.jev_outcomes o on o.company_id = p_company and o.transaction_id = f.id
  where f.n <= p_per;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.forecast_line_candidates(p_company uuid, p_ids uuid[])
 RETURNS TABLE(line_id uuid, line_date date, edit_id uuid, month text, project_id uuid, category_id uuid, expected_minor bigint, diff bigint, edit_created timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with l as (
    select t.id, t.direction::text as direction, t.amount_net, t.amount_gross, t.category_id, t.doc_date,
      to_char(t.doc_date, 'YYYY-MM') as line_month,
      -- A category the line did not guess: a supplier rule or a bank hint, never the default.
      (t.category_id is not null and not t.category_suggested and not exists (
        select 1 from public.categories dc where dc.id = t.category_id and dc.is_default
      )) as firm
    from public.transactions t
    where t.company_id = p_company
      and t.id = any (coalesce(p_ids, array[]::uuid[]))
      and t.removed_at is null
      and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = private.company_base_currency(p_company)
      and ((t.direction = 'expense' and t.amount_net < 0) or (t.direction = 'income' and t.amount_net > 0))
      -- A line the owner split is several lines, never one forecast line.
      and coalesce(t.pnl_role::text, 'project') = 'project'
      and (select count(*) from public.allocations a where a.transaction_id = t.id) <= 1
      and not exists (select 1 from private.split_parts ls where ls.transaction_id = t.id)
  )
  select l.id, l.doc_date, e.id, l.line_month, e.project_id, e.category_id, x.expected, x.diff, e.created_at
  from l
  join public.project_forecast_edits e
    on e.company_id = p_company and e.kind = 'add' and e.direction = l.direction
   and private.pfe_hits(e.start_month, e.pace, l.line_month)
  join public.projects p on p.id = e.project_id and p.company_id = p_company and p.status = 'active'
  cross join lateral (
    select coalesce((
      select ch.amount_minor from public.project_forecast_edits ch
      where ch.company_id = p_company and ch.project_id = e.project_id and ch.kind = 'change'
        and ch.row_key = 'add:' || e.id::text
        and private.pfe_hits(ch.start_month, ch.pace, l.line_month)
      order by ch.start_month desc, ch.created_at desc
      limit 1
    ), e.amount_minor) as expected
  ) a
  cross join lateral (
    select a.expected,
      least(abs(abs(l.amount_net) - a.expected), abs(abs(l.amount_gross) - a.expected)) as diff
  ) x
  where private.pfe_category_ok(p_company, e.category_id)
    and not exists (
      select 1 from public.project_forecast_edits r
      where r.company_id = p_company and r.project_id = e.project_id and r.kind = 'remove'
        and r.row_key = 'add:' || e.id::text
        and private.pfe_hits(r.start_month, r.pace, l.line_month)
    )
    and x.expected > 0
    and x.diff <= greatest(x.expected / 10, 100)
    and (not l.firm or l.category_id = e.category_id);
$function$
;

-- FLOW-152: the chart of accounts and the balance sheet from the ledger.
-- The 12 system accounts stay fixed; the company adds, renames, archives and merges its own
-- balance-sheet accounts (asset, liability, equity) through the MCP. Owner capital is equity.
-- Patches to functions other packages own use counted anchors (a miss raises, never skips).

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 1. Columns, type check, backfill. `add column if not exists`, so the order with other packages never matters.
alter table public.accounts add column if not exists is_system boolean not null default false;
alter table public.accounts add column if not exists archived_at timestamptz;
alter table public.accounts add column if not exists description text;

alter table public.accounts drop constraint if exists accounts_description_len;
alter table public.accounts add constraint accounts_description_len
  check (description is null or char_length(description) <= 200);
alter table public.accounts drop constraint if exists accounts_type_check;
alter table public.accounts add constraint accounts_type_check
  check (type in ('income', 'expense', 'asset', 'liability', 'equity'));

update public.accounts a set is_system = true
where a.category_id is null and not a.is_system
  and a.name in ('Bank/Clearing', 'Loan principal', 'Escrow', 'Owner capital', 'Security deposit held',
    'Transfers in transit', 'Property', 'Accumulated depreciation', 'Suspense', 'VAT control',
    'Uncategorized income', 'Uncategorized expense');
update public.accounts a set type = 'equity'
where a.category_id is null and a.name = 'Owner capital' and a.type <> 'equity';

-- Only the company's own balance-sheet accounts are ever archived.
alter table public.accounts drop constraint if exists accounts_archived_user_only;
alter table public.accounts add constraint accounts_archived_user_only
  check (archived_at is null or (category_id is null and not is_system));

create or replace function private.ensure_accounts(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A bridge account for every category (type = category kind; excluded + loan_part copied).
  insert into public.accounts (company_id, name, type, category_id, loan_part, excluded_from_pnl)
  select c.company_id, c.name, c.kind::text, c.id, c.loan_part, coalesce(c.excluded_from_pnl, false)
  from public.categories c
  where c.company_id = p_company
  on conflict (company_id, category_id) where category_id is not null do nothing;

  -- System accounts (category_id null, is_system), keyed by name. Owner capital is equity (FLOW-152).
  insert into public.accounts (company_id, name, type, is_bank, excluded_from_pnl, is_system)
  values
    (p_company, 'Bank/Clearing', 'asset', true, true, true),
    (p_company, 'Loan principal', 'liability', false, true, true),
    (p_company, 'Escrow', 'asset', false, true, true),
    (p_company, 'Owner capital', 'equity', false, true, true),
    (p_company, 'Security deposit held', 'liability', false, true, true),
    (p_company, 'Transfers in transit', 'asset', false, true, true),
    (p_company, 'Property', 'asset', false, true, true),
    (p_company, 'Accumulated depreciation', 'asset', false, true, true),
    (p_company, 'Suspense', 'asset', false, true, true),
    (p_company, 'VAT control', 'liability', false, true, true),
    (p_company, 'Uncategorized income', 'income', false, false, true),
    (p_company, 'Uncategorized expense', 'expense', false, false, true)
  on conflict (company_id, name) where category_id is null do nothing;
end;
$$;

-- 2. Helpers (private; definers call them).
-- The balance the account holds, as text, when it is not zero in some project x currency of its
-- legs on the books (not draft); null when it nets to zero everywhere.
create or replace function private.account_balance_text(p_company uuid, p_account uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when b.m < 0 then '-' else '' end || (abs(b.m) / 100)::text || '.' || lpad((abs(b.m) % 100)::text, 2, '0')
  from (
    select sum(l.amount_minor)::bigint as m
    from public.legs l
    join public.transactions t
      on t.id = l.transaction_id and t.company_id = l.company_id
     and t.removed_at is null and t.line_status = 'posted'
    where l.company_id = p_company and l.account_id = p_account and not l.draft
    group by l.project_id, coalesce(t.currency, 'ILS')
    having sum(l.amount_minor) <> 0
    order by abs(sum(l.amount_minor)) desc, coalesce(t.currency, 'ILS')
    limit 1
  ) b;
$$;

-- Why an account can't be archived: a balance, or a category bound to it (a hidden '· ledger' category
-- is bound the same way). Null when it can.
create or replace function private.account_archive_blocker(p_company uuid, p_account uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bal text;
begin
  bal := private.account_balance_text(p_company, p_account);
  if bal is not null then
    return 'account has a balance of ' || bal;
  end if;
  if exists (
    select 1 from public.categories c where c.company_id = p_company and c.ledger_account_id = p_account
  ) then
    return 'account has linked categories';
  end if;
  return null;
end;
$$;

-- A clean account name, or the reason it is refused. A system name is reserved (the system accounts are
-- found by name in many functions); a name is unique among the company's accounts without a category.
create or replace function private.account_clean_name(p_company uuid, p_name text, p_exclude uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n text;
begin
  n := btrim(regexp_replace(private.plain_spaces(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if private.name_has_hidden_char(n) then
    raise exception 'validation';
  end if;
  if char_length(n) < 1 then
    raise exception 'account name is too short';
  end if;
  if char_length(n) > 60 then
    raise exception 'account name is too long';
  end if;
  if lower(n) in ('bank/clearing', 'loan principal', 'escrow', 'owner capital', 'security deposit held',
    'transfers in transit', 'property', 'accumulated depreciation', 'suspense', 'vat control',
    'uncategorized income', 'uncategorized expense')
  then
    raise exception 'that name belongs to a system account';
  end if;
  if exists (
    select 1 from public.accounts a
    where a.company_id = p_company and a.category_id is null and lower(a.name) = lower(n)
      and a.id is distinct from p_exclude
  ) or exists (
    -- The hidden category book_line makes for an account is named '<account> · ledger'.
    select 1 from public.categories c
    where c.company_id = p_company and lower(c.name) = lower(n || ' · ledger')
      and c.ledger_account_id is distinct from p_exclude
  ) then
    raise exception 'account already exists';
  end if;
  return n;
end;
$$;

-- A company account the caller may change: not a category's account, not a system account. Locked.
create or replace function private.account_for_change(p_company uuid, p_account uuid)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.accounts%rowtype;
begin
  select * into acct from public.accounts a where a.id = p_account and a.company_id = p_company for update;
  if not found then
    raise exception 'account not found';
  end if;
  if acct.category_id is not null then
    raise exception 'category account can''t be changed';
  end if;
  if acct.is_system then
    raise exception 'system account can''t be changed';
  end if;
  return acct;
end;
$$;

create or replace function private.account_has_postings(p_company uuid, p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.legs l where l.company_id = p_company and l.account_id = p_account)
    or exists (select 1 from public.journal_counter_legs j where j.company_id = p_company and j.account_id = p_account);
$$;

create or replace function private.account_json(p_company uuid, p_account uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'type', a.type, 'description', a.description,
    'is_system', a.is_system, 'archived', a.archived_at is not null, 'archived_at', a.archived_at)
  from public.accounts a where a.id = p_account and a.company_id = p_company;
$$;

-- Undo of the five account writes. The account must read as the write left it; else a conflict.
create or replace function private.undo_account_write(p_company uuid, p_rec private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid := (p_rec.prior->>'account_id')::uuid;
  acct public.accounts%rowtype;
  after_j jsonb := p_rec.prior->'after';
  before_j jsonb := p_rec.prior->'before';
  into_id uuid;
  cat_ids uuid[];
  leg_ids uuid[];
  txns uuid[];
  blocker text;
begin
  select * into acct from public.accounts a where a.id = pid and a.company_id = p_company for update;
  if not found then
    return private.mcp_error('conflict', 'conflict');
  end if;

  if p_rec.kind = 'account_create' then
    if acct.archived_at is not null or acct.is_system
      or acct.name is distinct from after_j->>'name'
      or acct.type is distinct from after_j->>'type'
      or acct.description is distinct from after_j->>'description'
      or private.account_has_postings(p_company, pid)
      or exists (select 1 from public.categories c where c.company_id = p_company and c.ledger_account_id = pid)
    then
      return private.mcp_error('conflict', 'conflict');
    end if;
    delete from public.accounts a where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_update' then
    if acct.name is distinct from after_j->>'name'
      or acct.type is distinct from after_j->>'type'
      or acct.description is distinct from after_j->>'description'
      or acct.archived_at is not null
      or (before_j->>'type' is distinct from acct.type and private.account_has_postings(p_company, pid))
      or exists (
        select 1 from public.accounts o
        where o.company_id = p_company and o.category_id is null and o.id <> pid
          and lower(o.name) = lower(before_j->>'name'))
    then
      return private.mcp_error('conflict', 'conflict');
    end if;
    update public.accounts a
    set name = before_j->>'name', type = before_j->>'type', description = before_j->>'description'
    where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_archive' then
    if acct.archived_at is distinct from (after_j->>'archived_at')::timestamptz then
      return private.mcp_error('conflict', 'conflict');
    end if;
    update public.accounts a set archived_at = null where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_restore' then
    if acct.archived_at is not null or private.account_archive_blocker(p_company, pid) is not null then
      return private.mcp_error('conflict', 'conflict');
    end if;
    update public.accounts a set archived_at = clock_timestamp() where a.id = pid and a.company_id = p_company;

  elsif p_rec.kind = 'account_merge' then
    into_id := (p_rec.prior->>'into_id')::uuid;
    select coalesce(array_agg(x::uuid), '{}') into cat_ids from jsonb_array_elements_text(p_rec.prior->'category_ids') x;
    select coalesce(array_agg(x::uuid), '{}') into leg_ids from jsonb_array_elements_text(p_rec.prior->'counter_leg_ids') x;
    if acct.archived_at is distinct from (after_j->>'archived_at')::timestamptz
      or not exists (select 1 from public.accounts i where i.id = into_id and i.company_id = p_company and i.archived_at is null)
      or (select count(*) from public.categories c
          where c.company_id = p_company and c.id = any (cat_ids) and c.ledger_account_id = into_id) <> cardinality(cat_ids)
      or (select count(*) from public.journal_counter_legs j
          where j.company_id = p_company and j.id = any (leg_ids) and j.account_id = into_id) <> cardinality(leg_ids)
    then
      return private.mcp_error('conflict', 'conflict');
    end if;
    select coalesce(array_agg(distinct j.transaction_id), '{}') into txns
    from public.journal_counter_legs j where j.company_id = p_company and j.id = any (leg_ids);
    update public.journal_counter_legs j set account_id = pid
    where j.company_id = p_company and j.id = any (leg_ids);
    -- The categories trigger re-posts their lines.
    update public.categories c set ledger_account_id = pid
    where c.company_id = p_company and c.id = any (cat_ids);
    perform private.post_lines(p_company, txns);
    update public.accounts a set archived_at = null where a.id = pid and a.company_id = p_company;
  else
    return private.mcp_error('validation', 'validation');
  end if;

  update private.mcp_writes w set undone_at = clock_timestamp()
  where w.id = p_rec.id and w.user_id = auth.uid() and w.undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_rec.kind, 'id', pid));
end;
$$;

revoke all on function private.account_balance_text(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_archive_blocker(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_clean_name(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.account_for_change(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_has_postings(uuid, uuid) from public, anon, authenticated;
revoke all on function private.account_json(uuid, uuid) from public, anon, authenticated;
revoke all on function private.undo_account_write(uuid, private.mcp_writes) from public, anon, authenticated;

-- 3. The write kinds: the check constraints, mcp_refused, mcp_undo.
do $kinds$
declare
  def text;
  kinds constant text := $k$'account_create'::text, 'account_update'::text, 'account_archive'::text, 'account_restore'::text, 'account_merge'::text$k$;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  if pg_temp.anchor_count(def, ']))') <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, ']))', ', ' || kinds || ']))');

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 1) <> ')' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 1)
    || ' OR ((kind = ANY (ARRAY[' || kinds || '])) AND (prior ? ''account_id''::text) AND (prior ? ''before''::text) AND (prior ? ''after''::text)))';
end
$kinds$;

do $refused$
declare
  def text;
  anchor constant text := $a$      when p_message = 'loan_closed' then 'loan closed'$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, $n$      -- FLOW-152: the chart of accounts. "account not found" stays out (no existence leak).
      when p_message in (
        'account name is too short',
        'account name is too long',
        'description is too long',
        'that name belongs to a system account',
        'account already exists',
        'category account can''t be changed',
        'system account can''t be changed',
        'account has linked categories',
        'account has postings, so its type can''t change',
        'account is archived',
        'account is not archived',
        'nothing to change',
        'pick a different account',
        'the account must be a balance-sheet account',
        'accounts must be the same type'
      ) or p_message ~ '^account has a balance of -?[0-9]+\.[0-9]{2}$' then p_message
$n$ || anchor);
  execute def;
end
$refused$;

do $undo$
declare
  def text;
  a_kinds constant text := $a$p_kind not in ('supplier_category', $a$;
  a_lookup constant text := $a$(p_kind = 'supplier_category' and w.kind = 'supplier_category' and w.transaction_id = p_id)$a$;
  a_branch constant text := $a$    elsif p_kind = 'supplier_category' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_kinds,
    $n$p_kind not in ('account_create', 'account_update', 'account_archive', 'account_restore', 'account_merge', 'supplier_category', $n$);
  def := replace(def, a_lookup, a_lookup || $n$
        or (p_kind in ('account_create', 'account_update', 'account_archive', 'account_restore', 'account_merge')
          and w.kind = p_kind and w.prior->>'account_id' = p_id::text)$n$);
  def := replace(def, a_branch, $n$    elsif p_kind in ('account_create', 'account_update', 'account_archive', 'account_restore', 'account_merge') then
      -- FLOW-152: the account goes back while it reads as the write left it.
      response := private.undo_account_write(cid, rec);
$n$ || a_branch);
  execute def;
end
$undo$;

-- 4. Equity and archived accounts: book_line and journal entries (40_book_line) take any balance-sheet
-- account that is open; set_category_account does here.
do $bookable$
declare
  def text;
begin
  def := pg_get_functiondef('public.mcp_set_category_account(text,uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, $a$select a.id, a.type, a.is_bank, a.name, a.category_id into acct$a$) <> 1
    or pg_temp.anchor_count(def, $a$if acct.category_id is not null or acct.type not in ('asset', 'liability') or acct.is_bank$a$) <> 1
  then
    raise exception 'mcp_set_category_account is not the expected definition';
  end if;
  def := replace(def, $a$select a.id, a.type, a.is_bank, a.name, a.category_id into acct$a$,
    $n$select a.id, a.type, a.is_bank, a.name, a.category_id, a.archived_at into acct$n$);
  def := replace(def, $a$if acct.category_id is not null or acct.type not in ('asset', 'liability') or acct.is_bank$a$,
    $n$if acct.archived_at is not null then
        raise exception 'account is archived';
      end if;
      if acct.category_id is not null or acct.type not in ('asset', 'liability', 'equity') or acct.is_bank$n$);
  execute def;
end
$bookable$;

-- 5. Reads.
-- list_accounts: type, is_system, archived, description, the balance per currency (legs on the books)
-- and the categories bound to the account. An archived account is hidden unless include_archived.
create or replace function public.mcp_accounts(p_include_archived boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object('accounts', coalesce((
    with bal as (
      select l.account_id, coalesce(t.currency, 'ILS') as currency, sum(l.amount_minor)::bigint as m
      from public.legs l
      join public.transactions t
        on t.id = l.transaction_id and t.company_id = l.company_id
       and t.removed_at is null and t.line_status = 'posted'
      where l.company_id = cid and not l.draft
      group by l.account_id, coalesce(t.currency, 'ILS')
      having sum(l.amount_minor) <> 0
    )
    select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', coalesce(c.name, a.name),
        'type', coalesce(c.kind::text, a.type),
        'category_id', a.category_id,
        'system', a.is_system,
        'is_system', a.is_system,
        'archived', a.archived_at is not null,
        'description', a.description,
        'is_bank', a.is_bank,
        'excluded_from_pnl', case when c.id is null then a.excluded_from_pnl else coalesce(c.excluded_from_pnl, false) end,
        'loan_part', coalesce(c.loan_part, a.loan_part),
        'hidden', coalesce(c.hidden, false),
        'bookable', a.archived_at is null and (a.is_bank or c.id is not null
          or (a.category_id is null and a.type in ('asset', 'liability', 'equity') and a.name not in ('Suspense', 'VAT control'))),
        'posts_to', case when coalesce(c.excluded_from_pnl, false)
                      then private.kept_out_account(cid, c.id, c.loan_part) end,
        'balances', coalesce((
          select jsonb_agg(jsonb_build_object('currency', b.currency, 'balance_minor', b.m) order by b.currency)
          from bal b where b.account_id = a.id), '[]'::jsonb),
        'categories', coalesce((
          select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'hidden', k.hidden) order by k.name, k.id)
          from public.categories k where k.company_id = cid and k.ledger_account_id = a.id), '[]'::jsonb)
      ) order by a.category_id is not null, a.is_bank desc, coalesce(c.kind::text, a.type),
        lower(coalesce(c.name, a.name)), a.id)
    from public.accounts a
    left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
    where a.company_id = cid
      and (a.archived_at is null or coalesce(p_include_archived, false))
  ), '[]'::jsonb));
end;
$$;

-- The old signature keeps working: archived accounts hidden.
create or replace function public.mcp_accounts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select public.mcp_accounts(false); $$;

-- get_account_balances: user accounts and equity too; draft legs are not on the books.
create or replace function public.mcp_account_balances(p_as_of date default null::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  as_of date := coalesce(p_as_of, current_date);
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'as_of', as_of,
    -- Every balance-sheet account but the bank, per project and currency: debit +, credit −.
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object(
          'account_id', b.account_id, 'account_name', b.account_name, 'type', b.type,
          'project_id', b.project_id, 'project_name', b.project_name,
          'currency', b.currency, 'balance_minor', b.balance_minor
        ) order by b.account_name, b.project_name nulls first, b.currency)
      from (
        select l.account_id, a.name as account_name, a.type, l.project_id, p.name as project_name,
          coalesce(t.currency, 'ILS') as currency, sum(l.amount_minor)::bigint as balance_minor
        from public.legs l
        join public.transactions t
          on t.id = l.transaction_id and t.company_id = l.company_id
         and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        left join public.projects p on p.id = l.project_id and p.company_id = l.company_id
        where l.company_id = cid and not l.draft
          and a.type in ('asset', 'liability', 'equity') and not a.is_bank
        group by l.account_id, a.name, a.type, l.project_id, p.name, coalesce(t.currency, 'ILS')
        having sum(l.amount_minor) <> 0
      ) b
    ), '[]'::jsonb),
    -- Each project's net book value: what it holds on Property less what Accumulated depreciation took.
    'book_value', coalesce((
      select jsonb_agg(jsonb_build_object(
          'project_id', v.project_id, 'project_name', v.project_name, 'currency', v.currency,
          'property_minor', v.property_minor, 'accumulated_depreciation_minor', v.accumulated_minor,
          'net_book_value_minor', v.property_minor + v.accumulated_minor
        ) order by v.project_name nulls first, v.currency)
      from (
        select l.project_id, p.name as project_name, coalesce(t.currency, 'ILS') as currency,
          coalesce(sum(l.amount_minor) filter (where a.name = 'Property'), 0)::bigint as property_minor,
          coalesce(sum(l.amount_minor) filter (where a.name = 'Accumulated depreciation'), 0)::bigint as accumulated_minor
        from public.legs l
        join public.transactions t
          on t.id = l.transaction_id and t.company_id = l.company_id
         and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        left join public.projects p on p.id = l.project_id and p.company_id = l.company_id
        where l.company_id = cid and not l.draft
          and a.category_id is null and a.name in ('Property', 'Accumulated depreciation')
        group by l.project_id, p.name, coalesce(t.currency, 'ILS')
        having sum(l.amount_minor) <> 0
          or sum(l.amount_minor) filter (where a.name = 'Accumulated depreciation') <> 0
      ) v
    ), '[]'::jsonb)
  );
end;
$$;

-- get_balance_sheet: per currency, assets / liabilities / equity as of a date, retained earnings (the
-- running P&L) and the check. Rule: a line's legs count from the line's doc_date (every leg of a line,
-- the bank leg too), on posted, non-removed lines; draft legs are not on the books. Debit is positive;
-- liabilities and equity are shown positive (credit). retained = -(income + expense account legs), so
-- assets = liabilities + equity + retained whenever the legs balance.
create or replace function public.mcp_balance_sheet(p_as_of date default null, p_project_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  as_of date := coalesce(p_as_of, current_date);
  proj_name text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_project_id is not null then
    select p.name into proj_name from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      raise exception 'project not found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object(
    'as_of', as_of,
    'project_id', p_project_id,
    'project_name', proj_name,
    'rule', 'a line''s legs count from its doc_date; posted, non-removed lines; draft legs excluded',
    'currencies', coalesce((
      with bal as (
        select coalesce(t.currency, 'ILS') as currency, a.id as account_id, a.name as account_name, a.type,
          a.is_system, a.category_id, sum(l.amount_minor)::bigint as m
        from public.legs l
        join public.transactions t
          on t.id = l.transaction_id and t.company_id = l.company_id
         and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
        join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
        where l.company_id = cid and not l.draft
          and (p_project_id is null or l.project_id = p_project_id)
        group by coalesce(t.currency, 'ILS'), a.id, a.name, a.type, a.is_system, a.category_id
      ),
      cur as (
        select b.currency,
          coalesce(sum(b.m) filter (where b.type = 'asset'), 0)::bigint as assets,
          coalesce(-sum(b.m) filter (where b.type = 'liability'), 0)::bigint as liabilities,
          coalesce(-sum(b.m) filter (where b.type = 'equity'), 0)::bigint as equity,
          coalesce(-sum(b.m) filter (where b.type in ('income', 'expense')), 0)::bigint as retained
        from bal b group by b.currency
      )
      select jsonb_agg(jsonb_build_object(
          'currency', c.currency,
          'assets', jsonb_build_object('total_minor', c.assets, 'accounts', coalesce((
            select jsonb_agg(jsonb_build_object('account_id', b.account_id, 'name', b.account_name,
              'is_system', b.is_system, 'balance_minor', b.m) order by b.account_name, b.account_id)
            from bal b where b.currency = c.currency and b.type = 'asset' and b.m <> 0), '[]'::jsonb)),
          'liabilities', jsonb_build_object('total_minor', c.liabilities, 'accounts', coalesce((
            select jsonb_agg(jsonb_build_object('account_id', b.account_id, 'name', b.account_name,
              'is_system', b.is_system, 'balance_minor', -b.m) order by b.account_name, b.account_id)
            from bal b where b.currency = c.currency and b.type = 'liability' and b.m <> 0), '[]'::jsonb)),
          'equity', jsonb_build_object('total_minor', c.equity, 'accounts', coalesce((
            select jsonb_agg(jsonb_build_object('account_id', b.account_id, 'name', b.account_name,
              'is_system', b.is_system, 'balance_minor', -b.m) order by b.account_name, b.account_id)
            from bal b where b.currency = c.currency and b.type = 'equity' and b.m <> 0), '[]'::jsonb)),
          'retained_earnings_minor', c.retained,
          'total_assets_minor', c.assets,
          'total_liabilities_and_equity_minor', c.liabilities + c.equity + c.retained,
          'difference_minor', c.assets - (c.liabilities + c.equity + c.retained),
          'balanced', c.assets = c.liabilities + c.equity + c.retained,
          'warnings', coalesce((
            select jsonb_agg(jsonb_build_object(
              'code', case when b.account_name = 'Suspense' then 'suspense' else 'uncategorized' end,
              'account_id', b.account_id, 'account_name', b.account_name, 'balance_minor', b.m,
              'message', b.account_name || ' is not zero')
              order by b.account_name)
            from bal b
            where b.currency = c.currency and b.category_id is null and b.m <> 0
              and b.account_name in ('Suspense', 'Uncategorized income', 'Uncategorized expense')), '[]'::jsonb)
        ) order by c.currency)
      from cur c
    ), '[]'::jsonb)
  );
end;
$$;

-- 6. The write RPCs (the shape of public.mcp_set_category_account).
create or replace function public.mcp_create_account(
  p_idempotency_key text,
  p_name text,
  p_type text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  clean text;
  descr text;
  new_id uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_type is null or p_type not in ('asset', 'liability', 'equity')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_create|' || p_name || '|' || p_type || '|' || coalesce(p_description, '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    clean := private.account_clean_name(cid, p_name, null);
    descr := nullif(btrim(coalesce(p_description, '')), '');
    if char_length(coalesce(descr, '')) > 200 then
      raise exception 'description is too long';
    end if;

    insert into public.accounts (company_id, name, type, excluded_from_pnl, description)
    values (cid, clean, p_type, true, descr)
    returning id into new_id;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_create', jsonb_build_object(
      'account_id', new_id, 'before', null,
      'after', jsonb_build_object('name', clean, 'type', p_type, 'description', descr)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, new_id) || jsonb_build_object('undo_kind', 'account_create'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when unique_violation then
      response := private.mcp_refused('account already exists');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

create or replace function public.mcp_update_account(
  p_idempotency_key text,
  p_account_id uuid,
  p_name text default null,
  p_description text default null,
  p_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  acct public.accounts%rowtype;
  new_name text;
  new_descr text;
  new_type text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_account_id is null
    or (p_name is null and p_description is null and p_type is null)
    or (p_type is not null and p_type not in ('asset', 'liability', 'equity'))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_update|' || p_account_id::text || '|' || coalesce(p_name, '') || '|'
    || coalesce(p_description, '') || '|' || coalesce(p_type, '')
    || '|' || (p_name is null)::text || (p_description is null)::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    acct := private.account_for_change(cid, p_account_id);
    if acct.archived_at is not null then
      raise exception 'account is archived';
    end if;
    new_name := acct.name;
    new_descr := acct.description;
    new_type := acct.type;
    if p_name is not null then
      new_name := private.account_clean_name(cid, p_name, p_account_id);
    end if;
    if p_description is not null then
      -- An empty description clears it.
      new_descr := nullif(btrim(p_description), '');
      if char_length(coalesce(new_descr, '')) > 200 then
        raise exception 'description is too long';
      end if;
    end if;
    if p_type is not null and p_type <> acct.type then
      if private.account_has_postings(cid, p_account_id) then
        raise exception 'account has postings, so its type can''t change';
      end if;
      new_type := p_type;
    end if;
    if (new_name, new_descr, new_type) is not distinct from (acct.name, acct.description, acct.type) then
      raise exception 'nothing to change';
    end if;

    update public.accounts a set name = new_name, description = new_descr, type = new_type
    where a.id = p_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_update', jsonb_build_object(
      'account_id', p_account_id,
      'before', jsonb_build_object('name', acct.name, 'type', acct.type, 'description', acct.description),
      'after', jsonb_build_object('name', new_name, 'type', new_type, 'description', new_descr)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, p_account_id) || jsonb_build_object('undo_kind', 'account_update'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when unique_violation then
      response := private.mcp_refused('account already exists');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

create or replace function public.mcp_archive_account(
  p_idempotency_key text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  acct public.accounts%rowtype;
  blocker text;
  stamp timestamptz;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_account_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_archive|' || p_account_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    acct := private.account_for_change(cid, p_account_id);
    if acct.archived_at is not null then
      raise exception 'account is archived';
    end if;
    blocker := private.account_archive_blocker(cid, p_account_id);
    if blocker is not null then
      raise exception '%', blocker;
    end if;
    stamp := clock_timestamp();
    update public.accounts a set archived_at = stamp where a.id = p_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_archive', jsonb_build_object(
      'account_id', p_account_id,
      'before', jsonb_build_object('archived_at', null),
      'after', jsonb_build_object('archived_at', stamp)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, p_account_id) || jsonb_build_object('undo_kind', 'account_archive'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

create or replace function public.mcp_restore_account(
  p_idempotency_key text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  acct public.accounts%rowtype;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_account_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_restore|' || p_account_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    acct := private.account_for_change(cid, p_account_id);
    if acct.archived_at is null then
      raise exception 'account is not archived';
    end if;
    update public.accounts a set archived_at = null where a.id = p_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_restore', jsonb_build_object(
      'account_id', p_account_id,
      'before', jsonb_build_object('archived_at', acct.archived_at),
      'after', jsonb_build_object('archived_at', null)));

    response := jsonb_build_object('ok', true, 'data',
      private.account_json(cid, p_account_id) || jsonb_build_object('undo_kind', 'account_restore'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- Merge: the categories bound to `from` (hidden '· ledger' ones too) and its journal counter legs move
-- to `into`, the affected lines are posted again, `from` is archived. The legs move between two
-- balance-sheet accounts, so no P&L figure moves.
create or replace function public.mcp_merge_account(
  p_idempotency_key text,
  p_from_account_id uuid,
  p_into_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  src public.accounts%rowtype;
  dst public.accounts%rowtype;
  cat_ids uuid[];
  leg_ids uuid[];
  txns uuid[];
  stamp timestamptz;
  left_over integer;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_from_account_id is null or p_into_account_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'account_merge|' || p_from_account_id::text || '|' || p_into_account_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    if p_from_account_id = p_into_account_id then
      raise exception 'pick a different account';
    end if;
    -- Both locked in id order, so two merges the other way round cannot deadlock.
    perform 1 from public.accounts a
    where a.company_id = cid and a.id in (p_from_account_id, p_into_account_id)
    order by a.id for update;
    src := private.account_for_change(cid, p_from_account_id);
    select * into dst from public.accounts a where a.id = p_into_account_id and a.company_id = cid;
    if not found then
      raise exception 'account not found';
    end if;
    if src.archived_at is not null or dst.archived_at is not null then
      raise exception 'account is archived';
    end if;
    -- The target may be a system account, but a balance-sheet one the books take.
    if dst.category_id is not null or dst.is_bank or dst.type not in ('asset', 'liability', 'equity')
      or dst.name in ('Suspense', 'VAT control')
    then
      raise exception 'the account must be a balance-sheet account';
    end if;
    if src.type <> dst.type then
      raise exception 'accounts must be the same type';
    end if;

    select coalesce(array_agg(c.id order by c.id), '{}') into cat_ids
    from public.categories c where c.company_id = cid and c.ledger_account_id = p_from_account_id;
    select coalesce(array_agg(j.id order by j.id), '{}'),
      coalesce(array_agg(distinct j.transaction_id), '{}')
    into leg_ids, txns
    from public.journal_counter_legs j where j.company_id = cid and j.account_id = p_from_account_id;

    update public.journal_counter_legs j set account_id = p_into_account_id
    where j.company_id = cid and j.id = any (leg_ids);
    -- The categories trigger posts their lines again.
    update public.categories c set ledger_account_id = p_into_account_id
    where c.company_id = cid and c.id = any (cat_ids);
    perform private.post_lines(cid, txns);

    select count(*) into left_over from public.legs l
    where l.company_id = cid and l.account_id = p_from_account_id;
    if left_over > 0 then
      raise exception 'account could not be merged';
    end if;

    stamp := clock_timestamp();
    update public.accounts a set archived_at = stamp where a.id = p_from_account_id and a.company_id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'account_merge', jsonb_build_object(
      'account_id', p_from_account_id, 'into_id', p_into_account_id,
      'category_ids', to_jsonb(cat_ids), 'counter_leg_ids', to_jsonb(leg_ids),
      'before', jsonb_build_object('archived_at', null),
      'after', jsonb_build_object('archived_at', stamp)));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'from', private.account_json(cid, p_from_account_id),
      'into', private.account_json(cid, p_into_account_id),
      'categories_moved', cardinality(cat_ids),
      'journal_legs_moved', cardinality(leg_ids),
      'undo_kind', 'account_merge'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- 7. Grants.
revoke all on function public.mcp_create_account(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_update_account(text, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_archive_account(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mcp_restore_account(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mcp_merge_account(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mcp_accounts(boolean) from public, anon, authenticated, service_role;
revoke all on function public.mcp_balance_sheet(date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_create_account(text, text, text, text) to authenticated;
grant execute on function public.mcp_update_account(text, uuid, text, text, text) to authenticated;
grant execute on function public.mcp_archive_account(text, uuid) to authenticated;
grant execute on function public.mcp_restore_account(text, uuid) to authenticated;
grant execute on function public.mcp_merge_account(text, uuid, uuid) to authenticated;
grant execute on function public.mcp_accounts(boolean) to authenticated;
grant execute on function public.mcp_balance_sheet(date, uuid) to authenticated;

comment on function public.mcp_create_account(text, text, text, text) is
  'MCP create_account: a company balance-sheet account (asset, liability or equity); undo kind account_create. FLOW-152.';
comment on function public.mcp_update_account(text, uuid, text, text, text) is
  'MCP update_account: name, description, type (no postings yet) of a company account; a system account is refused; undo kind account_update. FLOW-152.';
comment on function public.mcp_archive_account(text, uuid) is
  'MCP archive_account: refused with a balance, linked categories or a system account; undo kind account_archive. FLOW-152.';
comment on function public.mcp_restore_account(text, uuid) is
  'MCP restore_account: an archived account is open again; undo kind account_restore. FLOW-152.';
comment on function public.mcp_merge_account(text, uuid, uuid) is
  'MCP merge_account: categories and journal legs move from one account to another of the same type, which is archived; no P&L figure moves; undo kind account_merge. FLOW-152.';
comment on function public.mcp_accounts(boolean) is
  'MCP list_accounts: the chart of accounts with type, system flag, archived, description, balance per currency and linked categories; include_archived shows archived accounts. FLOW-152.';
comment on function public.mcp_balance_sheet(date, uuid) is
  'MCP get_balance_sheet: per currency, assets, liabilities, equity and retained earnings as of a date (a line''s legs count from its doc_date), the check and warnings; optionally one project. FLOW-152.';

-- ===========================================================================
-- 90 seed and gate. The parts move from line_splits and loan_splits into the legs; every line of
-- every company is posted again; the books must come out exactly as they went in.
-- ===========================================================================

create temp table ledger_only_legs_before on commit drop as
  select company_id, transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id,
    part, gross_up, loan_split_fallback, project_explicit
  from public.legs;

create temp table ledger_only_pnl_before on commit drop as
  select company_id, transaction_id, project_id, pnl_role, direction, doc_kind, doc_date, cash_date, currency,
    category_id, part, amount_net, line_amount_net, in_pnl, loan_split_fallback, unassigned, kind, unpaid,
    gross_up
  from private.pnl_lines_legacy;

-- The lines with parts: their legs come back from the parts below.
delete from public.legs l
where exists (select 1 from public.line_splits s where s.transaction_id = l.transaction_id)
   or exists (select 1 from public.loan_splits s where s.transaction_id = l.transaction_id);

-- A part leg takes its old row's id, so a snapshot that names the row (a category move) still finds it.
insert into public.legs (id, created_at, company_id, transaction_id, account_id, project_id, amount_minor, ordinal,
  leg_kind, category_id, gross_up, project_explicit, split_part, part_ordinal, draft, part_percent, part_rest)
select s.id, s.created_at, s.company_id, s.transaction_id, a.id, s.project_id, s.amount_minor, s.ordinal, 'item',
  s.category_id, s.gross_up, s.project_id is not null, true, s.ordinal, true, s.percent, s.is_rest
from public.line_splits s
join public.accounts a on a.company_id = s.company_id and a.category_id = s.category_id;

insert into public.legs (id, created_at, company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind,
  category_id, part, loan_id, scheduled_minor, needs_review, part_ordinal, draft)
select s.id, s.updated_at, s.company_id, s.transaction_id, a.id, s.amount_minor, 1, 'item',
  s.category_id, s.part, s.loan_id, s.scheduled_minor, s.needs_review,
  case s.part::text when 'interest' then 1 when 'escrow' then 2 when 'principal' then 3 else 4 end, true
from public.loan_splits s
join public.accounts a on a.company_id = s.company_id and a.category_id = s.category_id;

do $seed$
declare
  r record;
  missing bigint;
begin
  select (select count(*) from public.line_splits) + (select count(*) from public.loan_splits)
    - (select count(*) from public.legs where split_part or loan_id is not null)
  into missing;
  if missing <> 0 then
    raise exception 'ledger-only gate: % parts did not move to the legs', missing;
  end if;
  for r in select t.company_id, array_agg(t.id) as txns from public.transactions t group by t.company_id loop
    perform private.post_lines(r.company_id, r.txns);
  end loop;
end
$seed$;

do $gate$
declare
  diff bigint;
begin
  select count(*) into diff from (
    (select * from ledger_only_legs_before
     except all
     select company_id, transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id,
       part, gross_up, loan_split_fallback, project_explicit
     from public.legs where not draft)
    union all
    (select company_id, transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id,
       part, gross_up, loan_split_fallback, project_explicit
     from public.legs where not draft
     except all
     select * from ledger_only_legs_before)
  ) d;
  if diff <> 0 then
    raise exception 'ledger-only gate: % legs differ after the parts moved to the legs', diff;
  end if;
  select count(*) into diff from (
    (select * from ledger_only_pnl_before
     except all
     select company_id, transaction_id, project_id, pnl_role, direction, doc_kind, doc_date, cash_date, currency,
       category_id, part, amount_net, line_amount_net, in_pnl, loan_split_fallback, unassigned, kind, unpaid,
       gross_up
     from private.pnl_lines)
    union all
    (select company_id, transaction_id, project_id, pnl_role, direction, doc_kind, doc_date, cash_date, currency,
       category_id, part, amount_net, line_amount_net, in_pnl, loan_split_fallback, unassigned, kind, unpaid,
       gross_up
     from private.pnl_lines
     except all
     select * from ledger_only_pnl_before)
  ) d;
  if diff <> 0 then
    raise exception 'ledger-only gate: % P&L rows differ from the posting rules', diff;
  end if;
end
$gate$;

-- ===========================================================================
-- 99 drop. The legacy write model goes; nothing may still name it.
-- ===========================================================================

drop trigger if exists legs_txn_ins_legacy on public.transactions;
drop function private.ledger_pnl_diff(uuid);
drop view private.pnl_lines_legacy;
drop table public.line_splits;
drop table public.loan_splits;
drop function private.rebuild_legs_many(uuid, uuid[]);
drop function private.legs_sync_child_new();
drop function private.legs_sync_child_old();
drop function private.line_splits_exclusive();
drop function private.loan_splits_match();
drop function private.loan_splits_check(uuid);
drop function private.loan_splits_closed_check();
drop function private.line_splits_review();

do $scan$
declare
  left_over text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into left_over
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prosrc ~ '\m(line_splits|loan_splits|pnl_lines_legacy|rebuild_legs_many|ledger_pnl_diff|loan_splits_check)\M';
  if left_over is not null then
    raise exception 'ledger-only: still names the legacy model: %', left_over;
  end if;
end
$scan$;

commit;
