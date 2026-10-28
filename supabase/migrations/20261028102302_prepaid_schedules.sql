-- FLOW-155 + FLOW-156: prepaid amortization schedules and the books-closed date.
-- 1. companies.books_closed_through (null: nothing closed) and MCP set_books_closed_through (owner
--    only, never after today, undo kind books_closed). Closing past a prepaid row that is due and not
--    posted is refused ('post the due prepaid rows first').
-- 2. private.post_journal_entry: the body of create_journal_entry (the FLOW-154 pre-lock, the legs'
--    rules, the line, its entry and its legs), so a prepaid month posts as the same journal entry.
--    public.mcp_create_journal_entry calls it; its arguments, refusals and answer are unchanged.
-- 3. public.prepaid_schedules, prepaid_rows and prepaid_refunds. A payment line is filed (whole, or a
--    part with the rest on its category) to the kept-out category bound to the prepaid asset account
--    (default "Prepaid expenses", made if missing), its coding kept in prior. A row is planned (off the
--    books) until private.prepaid_post_due posts it as a journal entry dated on its due date: Dr the
--    expense category, Cr the prepaid account, on the schedule's project, with no cash moved. The total
--    is split evenly, rounded half up, and the last month takes the rest. Refunds and changes spread
--    what remains over the months left; posted rows never change.
-- 4. A daily pg_cron job (flow-prepaid-post) posts every row due; a write posts its schedule's due
--    rows at once, so a start in the past backfills with the original dates. A re-run posts nothing.
-- 5. MCP create/list/get/attach_refund/update/end/delete prepaid schedules: idempotency key, owner or
--    editor, logged in private.mcp_writes with an undo kind each (prepaid_create, prepaid_refund,
--    prepaid_update, prepaid_end, prepaid_delete: the schedule id). A prepaid write refuses to add,
--    change or remove a posted row on or before the books-closed date. Undo puts back the schedule,
--    its rows, its refunds and its lines' coding while they read as the write left them.
-- mcp_refused, the mcp_writes kind and target checks and mcp_undo are patched in place with counted
-- anchors, as 20261028093217_ledger_only.sql does.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- ---------------------------------------------------------------------------
-- 1. The books-closed date.
-- ---------------------------------------------------------------------------
alter table public.companies add column books_closed_through date;

comment on column public.companies.books_closed_through is
  'FLOW-156: the books are closed through this date (null: nothing closed). Prepaid writes refuse to add, change or remove a posted row on or before it.';

-- ---------------------------------------------------------------------------
-- 2. The tables.
-- ---------------------------------------------------------------------------
create table public.prepaid_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  prepaid_account_id uuid not null,
  prepaid_category_id uuid not null,
  expense_category_id uuid not null,
  project_id uuid,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor bigint not null check (total_minor > 0),
  start_month date not null check (extract(day from start_month) = 1),
  months integer not null check (months between 1 and 120),
  day_of_month integer not null check (day_of_month between 1 and 28),
  status text not null default 'active' check (status in ('active', 'completed', 'ended')),
  ended_on date,
  end_mode text check (end_mode in ('expense', 'keep')),
  description text not null check (char_length(description) between 1 and 120),
  prior jsonb not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint prepaid_schedules_company_id_id_key unique (company_id, id),
  constraint prepaid_schedules_one_per_line unique (company_id, transaction_id),
  constraint prepaid_schedules_line_fkey foreign key (company_id, transaction_id)
    references public.transactions (company_id, id) on delete cascade,
  constraint prepaid_schedules_account_fkey foreign key (company_id, prepaid_account_id)
    references public.accounts (company_id, id),
  constraint prepaid_schedules_prepaid_category_fkey foreign key (company_id, prepaid_category_id)
    references public.categories (company_id, id),
  constraint prepaid_schedules_expense_category_fkey foreign key (company_id, expense_category_id)
    references public.categories (company_id, id),
  constraint prepaid_schedules_project_fkey foreign key (company_id, project_id)
    references public.projects (company_id, id) on delete set null (project_id),
  constraint prepaid_schedules_ended check ((status = 'ended') = (ended_on is not null and end_mode is not null))
);

comment on table public.prepaid_schedules is
  'FLOW-155: a payment spread over months as expense. The payment line is filed to prepaid_category_id (kept out, bound to prepaid_account_id); prior is the line''s coding before. Written only by the prepaid MCP tools.';

create table public.prepaid_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  schedule_id uuid not null,
  seq integer not null check (seq between 1 and 1000),
  due_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  kind text not null default 'amortization' check (kind in ('amortization', 'end_expense')),
  entry_id uuid,
  constraint prepaid_rows_one_seq unique (company_id, schedule_id, seq),
  constraint prepaid_rows_schedule_fkey foreign key (company_id, schedule_id)
    references public.prepaid_schedules (company_id, id) on delete cascade,
  -- An entry removed by any other path leaves its row planned, and the next run posts it again.
  constraint prepaid_rows_entry_fkey foreign key (company_id, entry_id)
    references public.transactions (company_id, id) on delete set null (entry_id)
);

comment on table public.prepaid_rows is
  'FLOW-155: one month of a prepaid schedule. Planned (entry_id null) rows are off the books; a posted row is on them only through its journal entry (entry_id).';

create table public.prepaid_refunds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  schedule_id uuid not null,
  transaction_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  prior jsonb not null,
  created_at timestamptz not null default now(),
  constraint prepaid_refunds_one_per_line unique (company_id, transaction_id),
  constraint prepaid_refunds_schedule_fkey foreign key (company_id, schedule_id)
    references public.prepaid_schedules (company_id, id) on delete cascade,
  constraint prepaid_refunds_line_fkey foreign key (company_id, transaction_id)
    references public.transactions (company_id, id) on delete cascade
);

comment on table public.prepaid_refunds is
  'FLOW-155: a refund line filed to a schedule''s prepaid category; prior is the line''s coding before.';

create index prepaid_schedules_account_idx on public.prepaid_schedules (company_id, prepaid_account_id);
create index prepaid_schedules_prepaid_category_idx on public.prepaid_schedules (company_id, prepaid_category_id);
create index prepaid_schedules_expense_category_idx on public.prepaid_schedules (company_id, expense_category_id);
create index prepaid_schedules_project_idx on public.prepaid_schedules (company_id, project_id);
create index prepaid_schedules_created_by_idx on public.prepaid_schedules (created_by) where created_by is not null;
create index prepaid_rows_entry_idx on public.prepaid_rows (company_id, entry_id) where entry_id is not null;
create index prepaid_rows_due_idx on public.prepaid_rows (due_date) where entry_id is null;
create index prepaid_refunds_schedule_idx on public.prepaid_refunds (company_id, schedule_id);

alter table public.prepaid_schedules enable row level security;
alter table public.prepaid_rows enable row level security;
alter table public.prepaid_refunds enable row level security;

create policy prepaid_schedules_select on public.prepaid_schedules
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
create policy prepaid_rows_select on public.prepaid_rows
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
create policy prepaid_refunds_select on public.prepaid_refunds
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

revoke all on public.prepaid_schedules, public.prepaid_rows, public.prepaid_refunds from public, anon, authenticated;
grant select on public.prepaid_schedules, public.prepaid_rows, public.prepaid_refunds to authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.post_journal_entry: create_journal_entry's core.
-- ---------------------------------------------------------------------------
-- Books one journal entry in p_company and returns its line id and its P&L effect (the P&L legs'
-- sum, negated). Raises 'validation' for a malformed leg and a worded reason for a refused one; the
-- caller maps them.
create function private.post_journal_entry(
  p_company uuid,
  p_doc_date date,
  p_currency text,
  p_description text,
  p_reference text,
  p_legs jsonb,
  out line_id uuid,
  out pnl_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
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
  -- FLOW-154: every account the legs name, and the account each named kept-out category posts to,
  -- is held first, in id order, as merge_account takes them.
  perform 1
  from public.accounts a
  where a.company_id = cid
    and a.id = any (array(
      select x.id
      from public.accounts n
      cross join lateral (values (n.id), (case when n.category_id is not null
                                            then private.kept_out_account(cid, n.category_id, null) end)) x(id)
      where n.company_id = cid and x.id is not null
        and n.id in (
          select (e.value->>'account_id')::uuid
          from jsonb_array_elements(case when jsonb_typeof(p_legs) = 'array' then p_legs else '[]'::jsonb end) e
          where jsonb_typeof(e.value) = 'object'
            and (e.value->>'account_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )))
  order by a.id
  for share;

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
    -- Held, so an archive of this account waits for the entry and then sees its legs.
    select * into acct from public.accounts a
    where a.id = (leg->>'account_id')::uuid and a.company_id = cid
    for share;
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
  line_id := rid;
  pnl_minor := -pnl_sum;
end;
$$;

revoke all on function private.post_journal_entry(uuid, date, text, text, text, jsonb) from public, anon, authenticated;

comment on function private.post_journal_entry(uuid, date, text, text, text, jsonb) is
  'FLOW-155: create_journal_entry''s core (decisions 0228, 0231, 0232): books one journal entry and returns its line id. Used by mcp_create_journal_entry and the prepaid posting.';

-- Same signature and grants: the gate, the idempotency and the answer around the core.
create or replace function public.mcp_create_journal_entry(
  p_idempotency_key text,
  p_doc_date date,
  p_currency text,
  p_description text,
  p_reference text,
  p_legs jsonb
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
  pnl bigint;
  rid uuid;
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
    select j.line_id, j.pnl_minor into rid, pnl
    from private.post_journal_entry(cid, p_doc_date, p_currency, p_description, p_reference, p_legs) j;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'journal_entry', rid,
      jsonb_build_object('after', private.booked_line_print(cid, rid)));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', rid,
      'doc_date', p_doc_date,
      'currency', p_currency,
      'description', btrim(p_description),
      'reference', nullif(btrim(p_reference), ''),
      'pnl_minor', pnl,
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
-- 4. The engine.
-- ---------------------------------------------------------------------------
-- The months' amounts: total over n, rounded half up, the last taking the rest. When n - 1 rounded
-- months would pass the total (a tiny total), each takes the floor. A month of 0 is left out.
create function private.prepaid_spread(p_total bigint, p_months integer)
returns table (k integer, amount_minor bigint)
language sql
immutable
set search_path = ''
as $$
  with per as (
    select case
      when (p_months - 1) * ((2 * p_total + p_months) / (2 * p_months)) > p_total then p_total / p_months
      else (2 * p_total + p_months) / (2 * p_months)
    end as m
  )
  select g.k, case when g.k = p_months then p_total - (p_months - 1) * per.m else per.m end
  from per, generate_series(1, p_months) as g(k)
  where p_total > 0 and p_months > 0
    and (case when g.k = p_months then p_total - (p_months - 1) * per.m else per.m end) > 0;
$$;

-- Row k is due on day_of_month of the k-th month from the start.
create function private.prepaid_due(p_start date, p_seq integer, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$ select (p_start + make_interval(months => p_seq - 1))::date + (p_day - 1); $$;

-- What the schedule still holds: total less the posted rows and the refunds.
create function private.prepaid_remaining(p_company uuid, p_schedule uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.total_minor
    - coalesce((select sum(r.amount_minor) from public.prepaid_rows r
                where r.company_id = s.company_id and r.schedule_id = s.id and r.entry_id is not null), 0)
    - coalesce((select sum(f.amount_minor) from public.prepaid_refunds f
                where f.company_id = s.company_id and f.schedule_id = s.id), 0)
  from public.prepaid_schedules s
  where s.company_id = p_company and s.id = p_schedule;
$$;

create function private.prepaid_closed_reason(p_closed date)
returns text
language sql
immutable
set search_path = ''
as $$ select 'the books are closed through ' || to_char(p_closed, 'YYYY-MM-DD'); $$;

-- A line's coding, as a prepaid write saves it and puts it back.
create function private.prepaid_line_print(p_company uuid, p_txn uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'transaction_id', t.id,
    'category_id', t.category_id,
    'user_assigned', t.user_assigned,
    'category_assigned', t.category_assigned,
    'category_suggested', t.category_suggested,
    'parts', private.line_split_parts_full(t.id)
  )
  from public.transactions t
  where t.company_id = p_company and t.id = p_txn;
$$;

-- Puts a line's coding back as a print says.
create function private.prepaid_restore_line(p_company uuid, p_print jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  txn uuid := (p_print->>'transaction_id')::uuid;
  cur jsonb;
  gone boolean;
begin
  select t.removed_at is not null into gone from public.transactions t
  where t.company_id = p_company and t.id = txn
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  -- A line a bank sync removed keeps the coding it has.
  if gone then
    return;
  end if;
  cur := private.prepaid_line_print(p_company, txn);
  if cur = p_print then
    return;
  end if;
  if cur->'parts' <> '[]'::jsonb and p_print->'parts' = '[]'::jsonb then
    perform private.set_line_parts(p_company, txn, '[]'::jsonb);
  end if;
  update public.transactions t
  set category_id = (p_print->>'category_id')::uuid,
      user_assigned = (p_print->>'user_assigned')::boolean,
      category_assigned = (p_print->>'category_assigned')::boolean,
      category_suggested = (p_print->>'category_suggested')::boolean
  where t.company_id = p_company and t.id = txn;
  if p_print->'parts' <> '[]'::jsonb and p_print->'parts' is distinct from cur->'parts' then
    perform private.set_line_parts(p_company, txn, p_print->'parts');
  end if;
end;
$$;

-- Checks a payment or refund line and files it (whole, or a part with the rest on its category) to
-- p_category. Returns the line's coding before and the amount filed.
create function private.prepaid_file_line(
  p_company uuid,
  p_txn uuid,
  p_direction text,
  p_category uuid,
  p_amount bigint,
  p_project uuid,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  line public.transactions%rowtype;
  line_amt bigint;
  amt bigint;
  before jsonb;
begin
  select * into line from public.transactions t
  where t.company_id = p_company and t.id = p_txn and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  if exists (select 1 from public.journal_entries j where j.company_id = p_company and j.transaction_id = p_txn) then
    raise exception 'the line is a journal entry';
  end if;
  if line.direction::text <> p_direction then
    raise exception '%', case when p_direction = 'expense' then 'the line is not an expense' else 'the line is not income' end;
  end if;
  if line.line_status::text <> 'posted' then
    raise exception 'the line is not posted';
  end if;
  if exists (select 1 from public.prepaid_schedules s where s.company_id = p_company and s.transaction_id = p_txn)
    or exists (select 1 from public.prepaid_refunds f where f.company_id = p_company and f.transaction_id = p_txn)
  then
    raise exception 'the line is already in a prepaid schedule';
  end if;
  if p_currency is not null and line.currency <> p_currency then
    raise exception 'the line is in another currency';
  end if;
  if exists (select 1 from public.legs l where l.company_id = p_company and l.transaction_id = p_txn and l.loan_id is not null) then
    raise exception 'line has a loan split';
  end if;
  if exists (select 1 from public.legs l where l.company_id = p_company and l.transaction_id = p_txn and l.split_part) then
    raise exception 'line is already split';
  end if;
  if line.vat_amount <> 0 then
    raise exception 'a line with VAT can''t be prepaid yet';
  end if;
  if line.in_pnl_override then
    raise exception 'the line is switched into the P&L';
  end if;
  line_amt := abs(line.amount_net);
  amt := coalesce(p_amount, line_amt);
  if amt > line_amt or line_amt = 0 then
    raise exception 'amount is above the line';
  end if;

  before := private.prepaid_line_print(p_company, p_txn);
  if amt = line_amt then
    update public.transactions t
    set category_id = p_category, user_assigned = true, category_assigned = true, category_suggested = false
    where t.company_id = p_company and t.id = p_txn;
  else
    if line.category_id is null then
      raise exception 'line has no category for the rest';
    end if;
    perform private.set_line_parts(p_company, p_txn, jsonb_build_array(
      jsonb_build_object('category_id', p_category, 'project_id', p_project, 'amount_minor', amt),
      jsonb_build_object('category_id', line.category_id, 'project_id', null, 'amount_minor', line_amt - amt, 'is_rest', true)
    ));
    update public.transactions t
    set user_assigned = true, category_suggested = false
    where t.company_id = p_company and t.id = p_txn;
  end if;
  return jsonb_build_object('before', before, 'amount_minor', amt, 'currency', line.currency, 'doc_date', line.doc_date);
end;
$$;

-- The planned rows spread again: what remains over the months after the last posted one.
create function private.prepaid_respread(p_company uuid, p_schedule uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.prepaid_schedules%rowtype;
  last_seq integer;
  rem bigint;
begin
  select * into s from public.prepaid_schedules x where x.company_id = p_company and x.id = p_schedule;
  delete from public.prepaid_rows r
  where r.company_id = p_company and r.schedule_id = p_schedule and r.entry_id is null;
  select coalesce(max(r.seq), 0) into last_seq
  from public.prepaid_rows r where r.company_id = p_company and r.schedule_id = p_schedule;
  rem := private.prepaid_remaining(p_company, p_schedule);
  if rem < 0 then
    raise exception 'amount is above what remains';
  end if;
  if rem > 0 and s.months <= last_seq then
    raise exception 'months must be above the months posted';
  end if;
  insert into public.prepaid_rows (company_id, schedule_id, seq, due_date, amount_minor, kind)
  select p_company, p_schedule, last_seq + x.k, private.prepaid_due(s.start_month, last_seq + x.k, s.day_of_month),
    x.amount_minor, 'amortization'
  from private.prepaid_spread(rem, s.months - last_seq) x;
end;
$$;

-- Active while a planned row or a balance is left, completed once both are gone; ended stays ended.
create function private.prepaid_settle_status(p_company uuid, p_schedule uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.prepaid_schedules s
  set status = case
    when exists (select 1 from public.prepaid_rows r
                 where r.company_id = s.company_id and r.schedule_id = s.id and r.entry_id is null)
      or private.prepaid_remaining(s.company_id, s.id) <> 0 then 'active'
    else 'completed' end
  where s.company_id = p_company and s.id = p_schedule and s.status <> 'ended'
    and s.status is distinct from case
      when exists (select 1 from public.prepaid_rows r
                   where r.company_id = s.company_id and r.schedule_id = s.id and r.entry_id is null)
        or private.prepaid_remaining(s.company_id, s.id) <> 0 then 'active'
      else 'completed' end;
$$;

-- Posts one planned row as a journal entry dated on its due date: Dr the expense category, Cr the
-- prepaid account, both on the schedule's project.
create function private.prepaid_post_row(p_row uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.prepaid_rows%rowtype;
  s public.prepaid_schedules%rowtype;
  expense_account uuid;
  suffix text;
  rid uuid;
begin
  select * into r from public.prepaid_rows x where x.id = p_row and x.entry_id is null for update;
  if not found then
    return null;
  end if;
  select * into s from public.prepaid_schedules x where x.company_id = r.company_id and x.id = r.schedule_id;
  select a.id into expense_account from public.accounts a
  where a.company_id = s.company_id and a.category_id = s.expense_category_id;
  suffix := case when r.kind = 'end_expense' then ' · end' else ' · ' || r.seq || '/' || s.months end;
  select j.line_id into rid from private.post_journal_entry(
    s.company_id, r.due_date, s.currency,
    left('Prepaid · ' || s.description, 120 - char_length(suffix)) || suffix,
    'prepaid:' || s.id::text || ':' || r.seq,
    jsonb_build_array(
      jsonb_build_object('account_id', expense_account, 'amount_minor', r.amount_minor, 'project_id', s.project_id),
      jsonb_build_object('account_id', s.prepaid_account_id, 'amount_minor', -r.amount_minor, 'project_id', s.project_id)
    )
  ) j;
  update public.prepaid_rows x set entry_id = rid where x.id = r.id;
  return rid;
end;
$$;

-- Posts every planned row due on or before p_today, oldest first, of one schedule or of all.
-- For one schedule (a write): a row in a closed period is refused and any failure raises. For all
-- (the daily job): a row in a closed period waits; a row another session holds, or that loses a
-- deadlock, waits for the next run; a row that fails otherwise is skipped with a warning. Either way
-- a schedule whose payment line a bank sync removed or voided posts nothing (its rows stay planned).
-- Returns the number of rows posted. A re-run posts nothing.
create function private.prepaid_post_due(p_today date default current_date, p_schedule uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  posted integer := 0;
begin
  for r in
    select x.id, x.company_id, x.schedule_id, x.due_date, c.books_closed_through as closed
    from public.prepaid_rows x
    join public.prepaid_schedules s on s.company_id = x.company_id and s.id = x.schedule_id
    join public.companies c on c.id = x.company_id
    join public.transactions p on p.company_id = s.company_id and p.id = s.transaction_id
      and p.removed_at is null and p.line_status = 'posted'
    where x.entry_id is null and x.due_date <= p_today
      and (p_schedule is null or x.schedule_id = p_schedule)
    order by x.due_date, x.company_id, x.schedule_id, x.seq
    for update of x skip locked
  loop
    if r.closed is not null and r.due_date <= r.closed then
      if p_schedule is not null then
        raise exception '%', private.prepaid_closed_reason(r.closed);
      end if;
      continue;
    end if;
    if p_schedule is not null then
      perform private.prepaid_post_row(r.id);
      perform private.prepaid_settle_status(r.company_id, r.schedule_id);
    else
      begin
        perform private.prepaid_post_row(r.id);
        perform private.prepaid_settle_status(r.company_id, r.schedule_id);
      exception
        when deadlock_detected or lock_not_available or serialization_failure then
          continue;
        when others then
          raise warning 'flow-prepaid-post: row % not posted: %', r.id, sqlerrm;
          continue;
      end;
    end if;
    posted := posted + 1;
  end loop;
  return posted;
end;
$$;

comment on function private.prepaid_post_due(date, uuid) is
  'FLOW-155: posts every planned prepaid row due on or before p_today (one schedule, or all: the daily flow-prepaid-post job). Idempotent.';

-- A schedule as a write leaves it, to compare and put back: the schedule (completed reads as active,
-- since posting completes it), its rows' plan (posted or not), its refunds, and the coding of its
-- lines and of p_lines.
create function private.prepaid_snapshot(p_company uuid, p_schedule uuid, p_lines uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schedule', (
      select to_jsonb(s) || jsonb_build_object('status', case when s.status = 'completed' then 'active' else s.status end)
      from public.prepaid_schedules s where s.company_id = p_company and s.id = p_schedule
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('seq', r.seq, 'due_date', r.due_date, 'amount_minor', r.amount_minor,
          'kind', r.kind) order by r.seq)
      from public.prepaid_rows r where r.company_id = p_company and r.schedule_id = p_schedule
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'transaction_id', f.transaction_id,
          'amount_minor', f.amount_minor, 'prior', f.prior, 'created_at', f.created_at) order by f.transaction_id)
      from public.prepaid_refunds f where f.company_id = p_company and f.schedule_id = p_schedule
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(private.prepaid_line_print(p_company, l.id) order by l.id)
      from (
        select s.transaction_id as id from public.prepaid_schedules s
        where s.company_id = p_company and s.id = p_schedule
        union
        select f.transaction_id from public.prepaid_refunds f
        where f.company_id = p_company and f.schedule_id = p_schedule
        union
        select unnest(coalesce(p_lines, '{}'::uuid[]))
      ) l
    ), '[]'::jsonb)
  );
$$;

-- Makes a schedule read as a snapshot: rows not in it go (a posted one's entry with it), rows missing
-- are planned, the schedule and its refunds are written as it says (or removed when its schedule is
-- null), its lines get their coding back, and the rows due are posted. A posted row removed or added
-- on or before the books-closed date is refused. Returns the number of entries removed.
create function private.prepaid_apply(p_company uuid, p_schedule uuid, p_target jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed date;
  r record;
  removed integer := 0;
  print jsonb;
  prev text := current_setting('flow.prepaid_apply', true);
begin
  -- The schedule's own lines and entries change here: the prepaid guards let this through.
  perform set_config('flow.prepaid_apply', 'on', true);
  select c.books_closed_through into closed from public.companies c where c.id = p_company;
  perform 1 from public.prepaid_schedules s where s.company_id = p_company and s.id = p_schedule for update;

  for r in
    select x.id, x.entry_id, x.due_date
    from public.prepaid_rows x
    where x.company_id = p_company and x.schedule_id = p_schedule
      and (p_target->'schedule' = 'null'::jsonb or p_target->'schedule' is null
        or not exists (
          select 1 from jsonb_array_elements(p_target->'rows') t
          where (t->>'seq')::integer = x.seq and (t->>'due_date')::date = x.due_date
            and (t->>'amount_minor')::bigint = x.amount_minor and t->>'kind' = x.kind))
    order by x.seq
    for update of x
  loop
    if r.entry_id is not null then
      if closed is not null and r.due_date <= closed then
        raise exception '%', private.prepaid_closed_reason(closed);
      end if;
      -- Its parts, entry and legs cascade with it, as a journal entry undo removes them.
      delete from public.transactions t where t.company_id = p_company and t.id = r.entry_id;
      removed := removed + 1;
    end if;
    delete from public.prepaid_rows x where x.id = r.id;
  end loop;

  if p_target->'schedule' is null or p_target->'schedule' = 'null'::jsonb then
    delete from public.prepaid_schedules s where s.company_id = p_company and s.id = p_schedule;
  else
    insert into public.prepaid_schedules
    select (jsonb_populate_record(null::public.prepaid_schedules, p_target->'schedule')).*
    on conflict (id) do update set
      prepaid_account_id = excluded.prepaid_account_id,
      prepaid_category_id = excluded.prepaid_category_id,
      expense_category_id = excluded.expense_category_id,
      project_id = excluded.project_id,
      total_minor = excluded.total_minor,
      start_month = excluded.start_month,
      months = excluded.months,
      day_of_month = excluded.day_of_month,
      status = excluded.status,
      ended_on = excluded.ended_on,
      end_mode = excluded.end_mode,
      description = excluded.description,
      prior = excluded.prior;
    delete from public.prepaid_refunds f where f.company_id = p_company and f.schedule_id = p_schedule;
    insert into public.prepaid_refunds (id, company_id, schedule_id, transaction_id, amount_minor, prior, created_at)
    select (f->>'id')::uuid, p_company, p_schedule, (f->>'transaction_id')::uuid, (f->>'amount_minor')::bigint,
      f->'prior', (f->>'created_at')::timestamptz
    from jsonb_array_elements(p_target->'refunds') f;
    insert into public.prepaid_rows (company_id, schedule_id, seq, due_date, amount_minor, kind)
    select p_company, p_schedule, (t->>'seq')::integer, (t->>'due_date')::date, (t->>'amount_minor')::bigint, t->>'kind'
    from jsonb_array_elements(p_target->'rows') t
    where not exists (
      select 1 from public.prepaid_rows x
      where x.company_id = p_company and x.schedule_id = p_schedule and x.seq = (t->>'seq')::integer);
  end if;

  for print in select value from jsonb_array_elements(coalesce(p_target->'lines', '[]'::jsonb))
  loop
    perform private.prepaid_restore_line(p_company, print);
  end loop;

  if p_target->'schedule' is not null and p_target->'schedule' <> 'null'::jsonb then
    perform private.prepaid_post_due(current_date, p_schedule);
    perform private.prepaid_settle_status(p_company, p_schedule);
  end if;
  perform set_config('flow.prepaid_apply', coalesce(prev, ''), true);
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4b. The guards: a schedule's lines and entries change only through the prepaid tools.
-- ---------------------------------------------------------------------------
-- Why a line can't change, or null: it is a schedule's payment line or an attached refund line, or
-- a posted month's entry. The prepaid writers set flow.prepaid_apply while they change them.
create function private.prepaid_line_held(p_company uuid, p_txn uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(current_setting('flow.prepaid_apply', true), '') = 'on' then null
    when exists (select 1 from public.prepaid_rows r where r.company_id = p_company and r.entry_id = p_txn)
      then 'the entry belongs to a prepaid schedule'
    when exists (select 1 from public.prepaid_schedules x where x.company_id = p_company and x.transaction_id = p_txn)
      or exists (select 1 from public.prepaid_refunds f where f.company_id = p_company and f.transaction_id = p_txn)
      then 'the line is in a prepaid schedule'
  end;
$$;

-- A person's write (the app or the MCP) that changes what a held line books is refused. A bank sync
-- or a job (no user) may still change, remove or void it; a schedule whose payment line is removed or
-- voided then posts nothing (prepaid_post_due).
create function private.prepaid_line_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text;
begin
  if auth.uid() is not null then
    why := private.prepaid_line_held(old.company_id, old.id);
    if why is not null then
      raise exception '%', why;
    end if;
  end if;
  return new;
end;
$$;

-- No delete of a held line or entry, but by the prepaid writers or with its company.
create function private.prepaid_line_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text;
begin
  if exists (select 1 from public.companies c where c.id = old.company_id) then
    why := private.prepaid_line_held(old.company_id, old.id);
    if why is not null then
      raise exception '%', why;
    end if;
  end if;
  return old;
end;
$$;

-- A person's split by category or loan parts on a held line, refused like the update.
create function private.prepaid_line_check(p_company uuid, p_txn uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  why text;
begin
  if auth.uid() is not null then
    why := private.prepaid_line_held(p_company, p_txn);
    if why is not null then
      raise exception '%', why;
    end if;
  end if;
end;
$$;

create trigger transactions_prepaid_held
  before update on public.transactions
  for each row
  when (old.direction is distinct from new.direction
    or old.doc_kind is distinct from new.doc_kind
    or old.amount_gross is distinct from new.amount_gross
    or old.amount_net is distinct from new.amount_net
    or old.vat_amount is distinct from new.vat_amount
    or old.amount_original is distinct from new.amount_original
    or old.category_id is distinct from new.category_id
    or old.project_id is distinct from new.project_id
    or old.pnl_role is distinct from new.pnl_role
    or old.in_pnl_override is distinct from new.in_pnl_override
    or old.in_cash_override is distinct from new.in_cash_override
    or old.line_status is distinct from new.line_status
    or old.removed_at is distinct from new.removed_at
    or old.doc_date is distinct from new.doc_date
    or old.cash_date is distinct from new.cash_date
    or old.currency is distinct from new.currency
    or old.company_id is distinct from new.company_id)
  execute function private.prepaid_line_guard_update();

create trigger transactions_prepaid_held_delete
  before delete on public.transactions
  for each row
  execute function private.prepaid_line_guard_delete();

do $parts$
declare
  def text;
  anchor constant text := $a$  perform private.part_line_lock(p_company, p_txn);$a$;
  fn text;
begin
  foreach fn in array array['private.set_line_parts(uuid,uuid,jsonb)', 'private.set_loan_parts(uuid,uuid,uuid,jsonb)'] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, anchor, anchor || $n$
  -- FLOW-155: a schedule's payment or refund line, or a prepaid entry, keeps its parts.
  perform private.prepaid_line_check(p_company, p_txn);$n$);
    execute def;
  end loop;
end
$parts$;

revoke all on function private.prepaid_line_held(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_line_guard_update() from public, anon, authenticated;
revoke all on function private.prepaid_line_guard_delete() from public, anon, authenticated;
revoke all on function private.prepaid_line_check(uuid, uuid) from public, anon, authenticated;

-- A schedule as the tools show it.
create function private.prepaid_json(p_company uuid, p_schedule uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schedule_id', s.id,
    'transaction_id', s.transaction_id,
    'description', s.description,
    'project_id', s.project_id,
    'project_name', p.name,
    'expense_category_id', s.expense_category_id,
    'expense_category_name', c.name,
    'prepaid_account_id', s.prepaid_account_id,
    'prepaid_category_id', s.prepaid_category_id,
    'currency', s.currency,
    'total_minor', s.total_minor,
    'posted_minor', coalesce((select sum(r.amount_minor) from public.prepaid_rows r
                              where r.company_id = s.company_id and r.schedule_id = s.id and r.entry_id is not null), 0),
    'refunded_minor', coalesce((select sum(f.amount_minor) from public.prepaid_refunds f
                                where f.company_id = s.company_id and f.schedule_id = s.id), 0),
    'remaining_minor', private.prepaid_remaining(s.company_id, s.id),
    'start_month', to_char(s.start_month, 'YYYY-MM'),
    'day_of_month', s.day_of_month,
    'months', s.months,
    -- The last amortization month posted (a month of 0 has no row, so this is not a row count).
    'months_posted', (select coalesce(max(r.seq), 0) from public.prepaid_rows r
                      where r.company_id = s.company_id and r.schedule_id = s.id and r.entry_id is not null
                        and r.kind = 'amortization'),
    'next_date', (select min(r.due_date) from public.prepaid_rows r
                  where r.company_id = s.company_id and r.schedule_id = s.id and r.entry_id is null),
    'status', s.status,
    'ended_on', s.ended_on,
    'end_mode', s.end_mode,
    'created_at', s.created_at,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('seq', r.seq, 'due_date', r.due_date, 'amount_minor', r.amount_minor,
          'kind', r.kind, 'status', case when r.entry_id is null then 'planned' else 'posted' end,
          'entry_id', r.entry_id) order by r.seq)
      from public.prepaid_rows r where r.company_id = s.company_id and r.schedule_id = s.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object('transaction_id', f.transaction_id, 'amount_minor', f.amount_minor)
        order by f.created_at, f.transaction_id)
      from public.prepaid_refunds f where f.company_id = s.company_id and f.schedule_id = s.id
    ), '[]'::jsonb)
  )
  from public.prepaid_schedules s
  left join public.projects p on p.company_id = s.company_id and p.id = s.project_id
  left join public.categories c on c.company_id = s.company_id and c.id = s.expense_category_id
  where s.company_id = p_company and s.id = p_schedule;
$$;

-- An expense category counted in the P&L, or a worded refusal.
create function private.prepaid_expense_category(p_company uuid, p_category uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.categories c where c.company_id = p_company and c.id = p_category) then
    raise exception 'category not found';
  end if;
  if not exists (
    select 1 from public.categories c
    where c.company_id = p_company and c.id = p_category and c.kind = 'expense'
      and not coalesce(c.excluded_from_pnl, false) and c.loan_part is null
  ) then
    raise exception 'the category must be an expense category counted in the P&L';
  end if;
end;
$$;

-- The schedule a write changes, held; another company's or a missing one is refused unworded.
create function private.prepaid_lock(p_company uuid, p_schedule uuid, p_active boolean)
returns public.prepaid_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.prepaid_schedules%rowtype;
begin
  select * into s from public.prepaid_schedules x where x.company_id = p_company and x.id = p_schedule for update;
  if not found then
    raise exception 'schedule not found';
  end if;
  if p_active and s.status <> 'active' then
    raise exception 'the schedule is not active';
  end if;
  return s;
end;
$$;

-- The undo of a prepaid write: puts back what the write found while the schedule reads as it left it.
-- Posting is not a change: a month the daily job posted since the write keeps its entry when the
-- restored plan has the same month, else the entry goes with it (and a month due today posts again
-- from the restored plan). The books-closed date still holds.
create function private.undo_prepaid_write(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rec private.mcp_writes := p_write;
  sid uuid;
  cur date;
  lines uuid[];
begin
  if rec.kind = 'books_closed' then
    select c.books_closed_through into cur from public.companies c
    where c.id = cid and c.owner_id = auth.uid()
    for update;
    if not found then
      raise exception 'only the owner can close the books';
    end if;
    if cur is distinct from (rec.prior->>'after')::date then
      return private.mcp_error('conflict', 'conflict');
    end if;
    if (rec.prior->>'before') is not null and exists (
      select 1 from public.prepaid_rows r
      where r.company_id = cid and r.entry_id is null and r.due_date <= (rec.prior->>'before')::date
    ) then
      raise exception 'post the due prepaid rows first';
    end if;
    update public.companies c set books_closed_through = (rec.prior->>'before')::date where c.id = cid;
    update private.mcp_writes set undone_at = clock_timestamp() where id = rec.id and undone_at is null;
    return jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'kind', rec.kind, 'id', cid, 'books_closed_through', rec.prior->>'before'));
  end if;

  perform 1 from public.companies c where c.id = cid for share;
  sid := (rec.prior->>'schedule_id')::uuid;
  perform 1 from public.prepaid_schedules s where s.company_id = cid and s.id = sid for update;
  select coalesce(array_agg((l->>'transaction_id')::uuid), '{}') into lines
  from jsonb_array_elements(rec.prior->'after'->'lines') l;
  if private.prepaid_snapshot(cid, sid, lines) is distinct from rec.prior->'after' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  perform private.prepaid_apply(cid, sid, rec.prior->'before');
  update private.mcp_writes set undone_at = clock_timestamp() where id = rec.id and undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', rec.kind, 'id', sid));
end;
$$;

revoke all on function private.prepaid_spread(bigint, integer) from public, anon, authenticated;
revoke all on function private.prepaid_due(date, integer, integer) from public, anon, authenticated;
revoke all on function private.prepaid_remaining(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_closed_reason(date) from public, anon, authenticated;
revoke all on function private.prepaid_line_print(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_restore_line(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.prepaid_file_line(uuid, uuid, text, uuid, bigint, uuid, text) from public, anon, authenticated;
revoke all on function private.prepaid_respread(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_settle_status(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_post_row(uuid) from public, anon, authenticated;
revoke all on function private.prepaid_post_due(date, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_snapshot(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.prepaid_apply(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.prepaid_json(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_expense_category(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_lock(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.undo_prepaid_write(uuid, private.mcp_writes) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The MCP tools.
-- ---------------------------------------------------------------------------
create function public.mcp_create_prepaid_schedule(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_expense_category_id uuid,
  p_start_month text,
  p_months integer,
  p_project_id uuid default null,
  p_amount_minor bigint default null,
  p_day_of_month integer default null,
  p_prepaid_account_id uuid default null,
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
  sid uuid := gen_random_uuid();
  acct public.accounts%rowtype;
  cat_id uuid;
  filed jsonb;
  before jsonb;
  descr text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_expense_category_id is null
    or p_start_month is null or p_start_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_months is null or p_months not between 1 and 120
    or (p_amount_minor is not null and p_amount_minor <= 0)
    or (p_day_of_month is not null and p_day_of_month not between 1 and 28)
    or (p_description is not null and char_length(btrim(p_description)) not between 1 and 120)
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'prepaid_create|' || p_transaction_id::text || '|' || p_expense_category_id::text || '|' || p_start_month
    || '|' || p_months || '|' || coalesce(p_project_id::text, '') || '|' || coalesce(p_amount_minor::text, '')
    || '|' || coalesce(p_day_of_month::text, '') || '|' || coalesce(p_prepaid_account_id::text, '')
    || '|' || md5(coalesce(btrim(p_description), ''));
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
    -- Held against a books-closed change until this write commits.
    perform 1 from public.companies c where c.id = cid for share;
    perform private.prepaid_expense_category(cid, p_expense_category_id);
    if p_project_id is not null
      and not exists (select 1 from public.projects p where p.company_id = cid and p.id = p_project_id)
    then
      raise exception 'project not found';
    end if;

    -- The prepaid asset account: the one named, or "Prepaid expenses" (made when missing).
    if p_prepaid_account_id is not null then
      select * into acct from public.accounts a where a.company_id = cid and a.id = p_prepaid_account_id;
      if not found then
        raise exception 'account not found';
      end if;
    else
      select * into acct from public.accounts a
      where a.company_id = cid and a.category_id is null and lower(a.name) = 'prepaid expenses'
      order by a.archived_at nulls first
      limit 1;
      if not found then
        insert into public.accounts (company_id, name, type, excluded_from_pnl)
        values (cid, 'Prepaid expenses', 'asset', true)
        returning * into acct;
      end if;
    end if;
    if acct.archived_at is not null then
      raise exception 'account is archived';
    end if;
    if acct.type <> 'asset' or acct.category_id is not null or acct.is_bank
      or (acct.is_system and acct.name in ('Suspense', 'Transfers in transit'))
    then
      raise exception 'the prepaid account must be an asset account';
    end if;
    cat_id := private.ledger_mirror_category(cid, acct.id, true);

    filed := private.prepaid_file_line(cid, p_transaction_id, 'expense', cat_id, p_amount_minor, p_project_id, null);
    before := jsonb_build_object('schedule', null, 'rows', '[]'::jsonb, 'refunds', '[]'::jsonb,
      'lines', jsonb_build_array(filed->'before'));
    descr := coalesce(btrim(p_description),
      left(nullif(btrim((select t.description from public.transactions t where t.company_id = cid and t.id = p_transaction_id)), ''), 120),
      'Prepaid');

    insert into public.prepaid_schedules (id, company_id, transaction_id, prepaid_account_id, prepaid_category_id,
      expense_category_id, project_id, currency, total_minor, start_month, months, day_of_month, description, prior)
    values (sid, cid, p_transaction_id, acct.id, cat_id, p_expense_category_id, p_project_id, filed->>'currency',
      (filed->>'amount_minor')::bigint, (p_start_month || '-01')::date, p_months,
      coalesce(p_day_of_month, least(extract(day from (filed->>'doc_date')::date)::integer, 28)), descr,
      filed->'before');
    perform private.prepaid_respread(cid, sid);
    perform private.prepaid_post_due(current_date, sid);
    perform private.prepaid_settle_status(cid, sid);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'prepaid_create', p_transaction_id, jsonb_build_object(
      'schedule_id', sid, 'before', before, 'after', private.prepaid_snapshot(cid, sid, '{}')));

    response := jsonb_build_object('ok', true, 'data', private.prepaid_json(cid, sid) || jsonb_build_object(
      'posted_count', (select count(*) from public.prepaid_rows r
                       where r.company_id = cid and r.schedule_id = sid and r.entry_id is not null),
      'undo_kind', 'prepaid_create'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when unique_violation then
      response := private.mcp_refused('the line is already in a prepaid schedule');
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

create function public.mcp_list_prepaid_schedules(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  if p_status is not null and p_status not in ('active', 'completed', 'ended') then
    return private.mcp_error('validation', 'validation');
  end if;
  cid := private.readable_company_id();
  if cid is null then
    return private.mcp_error('forbidden', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'books_closed_through', (select c.books_closed_through from public.companies c where c.id = cid),
    'schedules', coalesce((
      select jsonb_agg(private.prepaid_json(cid, s.id) - 'rows' - 'refunds' - 'prepaid_category_id'
        order by s.created_at desc, s.id)
      from public.prepaid_schedules s
      where s.company_id = cid and (p_status is null or s.status = p_status)
    ), '[]'::jsonb)
  ));
end;
$$;

create function public.mcp_get_prepaid_schedule(p_schedule_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  sched jsonb;
begin
  if p_schedule_id is null then
    return private.mcp_error('validation', 'validation');
  end if;
  cid := private.readable_company_id();
  if cid is null then
    return private.mcp_error('forbidden', 'forbidden');
  end if;
  sched := private.prepaid_json(cid, p_schedule_id);
  if sched is null then
    return private.mcp_error('not_found', 'not found');
  end if;
  return jsonb_build_object('ok', true, 'data', sched || jsonb_build_object(
    'books_closed_through', (select c.books_closed_through from public.companies c where c.id = cid)));
end;
$$;

create function public.mcp_attach_prepaid_refund(
  p_idempotency_key text,
  p_schedule_id uuid,
  p_transaction_id uuid,
  p_amount_minor bigint default null
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
  s public.prepaid_schedules%rowtype;
  before jsonb;
  filed jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_schedule_id is null
    or p_transaction_id is null
    or (p_amount_minor is not null and p_amount_minor <= 0)
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'prepaid_refund|' || p_schedule_id::text || '|' || p_transaction_id::text || '|' || coalesce(p_amount_minor::text, '');
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
    -- Held against a books-closed change until this write commits.
    perform 1 from public.companies c where c.id = cid for share;
    s := private.prepaid_lock(cid, p_schedule_id, true);
    before := private.prepaid_snapshot(cid, s.id, array[p_transaction_id]);
    filed := private.prepaid_file_line(cid, p_transaction_id, 'income',
      private.ledger_mirror_category(cid, s.prepaid_account_id, false), p_amount_minor, s.project_id, s.currency);
    if (filed->>'amount_minor')::bigint > private.prepaid_remaining(cid, s.id) then
      raise exception 'amount is above what remains';
    end if;
    insert into public.prepaid_refunds (company_id, schedule_id, transaction_id, amount_minor, prior)
    values (cid, s.id, p_transaction_id, (filed->>'amount_minor')::bigint, filed->'before');
    perform private.prepaid_respread(cid, s.id);
    perform private.prepaid_post_due(current_date, s.id);
    perform private.prepaid_settle_status(cid, s.id);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'prepaid_refund', p_transaction_id, jsonb_build_object(
      'schedule_id', s.id, 'before', before, 'after', private.prepaid_snapshot(cid, s.id, '{}')));

    response := jsonb_build_object('ok', true, 'data', private.prepaid_json(cid, s.id) || jsonb_build_object(
      'refund_minor', (filed->>'amount_minor')::bigint, 'undo_kind', 'prepaid_refund'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when unique_violation then
      response := private.mcp_refused('the line is already in a prepaid schedule');
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

create function public.mcp_update_prepaid_schedule(
  p_idempotency_key text,
  p_schedule_id uuid,
  p_months integer default null,
  p_expense_category_id uuid default null,
  p_project_id uuid default null
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
  s public.prepaid_schedules%rowtype;
  before jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_schedule_id is null
    or (p_months is null and p_expense_category_id is null and p_project_id is null)
    or (p_months is not null and p_months not between 1 and 120)
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'prepaid_update|' || p_schedule_id::text || '|' || coalesce(p_months::text, '') || '|'
    || coalesce(p_expense_category_id::text, '') || '|' || coalesce(p_project_id::text, '');
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
    -- Held against a books-closed change until this write commits.
    perform 1 from public.companies c where c.id = cid for share;
    s := private.prepaid_lock(cid, p_schedule_id, true);
    if p_expense_category_id is not null then
      perform private.prepaid_expense_category(cid, p_expense_category_id);
    end if;
    if p_project_id is not null
      and not exists (select 1 from public.projects p where p.company_id = cid and p.id = p_project_id)
    then
      raise exception 'project not found';
    end if;
    if coalesce(p_months, s.months) = s.months
      and coalesce(p_expense_category_id, s.expense_category_id) = s.expense_category_id
      and coalesce(p_project_id, s.project_id) is not distinct from s.project_id
    then
      raise exception 'nothing to change';
    end if;
    if p_months is not null and p_months <= (
      select coalesce(max(r.seq), 0) from public.prepaid_rows r
      where r.company_id = cid and r.schedule_id = s.id and r.entry_id is not null)
    then
      raise exception 'months must be above the months posted';
    end if;

    before := private.prepaid_snapshot(cid, s.id, '{}');
    update public.prepaid_schedules x
    set months = coalesce(p_months, x.months),
        expense_category_id = coalesce(p_expense_category_id, x.expense_category_id),
        project_id = coalesce(p_project_id, x.project_id)
    where x.company_id = cid and x.id = s.id;
    perform private.prepaid_respread(cid, s.id);
    perform private.prepaid_post_due(current_date, s.id);
    perform private.prepaid_settle_status(cid, s.id);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'prepaid_update', jsonb_build_object(
      'schedule_id', s.id, 'before', before, 'after', private.prepaid_snapshot(cid, s.id, '{}')));

    response := jsonb_build_object('ok', true, 'data', private.prepaid_json(cid, s.id) || jsonb_build_object(
      'undo_kind', 'prepaid_update'));
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

create function public.mcp_end_prepaid_schedule(
  p_idempotency_key text,
  p_schedule_id uuid,
  p_from_month text,
  p_remaining text
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
  s public.prepaid_schedules%rowtype;
  before jsonb;
  from_month date;
  rem bigint;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_schedule_id is null
    or p_from_month is null or p_from_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_remaining is null or p_remaining not in ('expense', 'keep')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'prepaid_end|' || p_schedule_id::text || '|' || p_from_month || '|' || p_remaining;
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
    -- Held against a books-closed change until this write commits.
    perform 1 from public.companies c where c.id = cid for share;
    s := private.prepaid_lock(cid, p_schedule_id, true);
    from_month := (p_from_month || '-01')::date;
    if from_month < (
      select max(date_trunc('month', r.due_date))::date from public.prepaid_rows r
      where r.company_id = cid and r.schedule_id = s.id and r.entry_id is not null)
    then
      raise exception 'from_month is before the last posted month';
    end if;

    before := private.prepaid_snapshot(cid, s.id, '{}');
    delete from public.prepaid_rows r
    where r.company_id = cid and r.schedule_id = s.id and r.entry_id is null and r.due_date >= from_month;
    if p_remaining = 'expense' then
      -- One last row in from_month takes what the planned rows left before it do not.
      rem := private.prepaid_remaining(cid, s.id) - coalesce((
        select sum(r.amount_minor) from public.prepaid_rows r
        where r.company_id = cid and r.schedule_id = s.id and r.entry_id is null), 0);
      if rem > 0 then
        insert into public.prepaid_rows (company_id, schedule_id, seq, due_date, amount_minor, kind)
        values (cid, s.id,
          (select coalesce(max(r.seq), 0) + 1 from public.prepaid_rows r where r.company_id = cid and r.schedule_id = s.id),
          from_month + (s.day_of_month - 1), rem, 'end_expense');
      end if;
    end if;
    update public.prepaid_schedules x set status = 'ended', ended_on = from_month, end_mode = p_remaining
    where x.company_id = cid and x.id = s.id;
    perform private.prepaid_post_due(current_date, s.id);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'prepaid_end', jsonb_build_object(
      'schedule_id', s.id, 'before', before, 'after', private.prepaid_snapshot(cid, s.id, '{}')));

    response := jsonb_build_object('ok', true, 'data', private.prepaid_json(cid, s.id) || jsonb_build_object(
      'undo_kind', 'prepaid_end'));
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

create function public.mcp_delete_prepaid_schedule(p_idempotency_key text, p_schedule_id uuid)
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
  s public.prepaid_schedules%rowtype;
  before jsonb;
  lines uuid[];
  removed integer;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_schedule_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'prepaid_delete|' || p_schedule_id::text;
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
    -- Held against a books-closed change until this write commits.
    perform 1 from public.companies c where c.id = cid for share;
    s := private.prepaid_lock(cid, p_schedule_id, false);
    before := private.prepaid_snapshot(cid, s.id, '{}');
    select array_agg((l->>'transaction_id')::uuid) into lines from jsonb_array_elements(before->'lines') l;
    -- The payment and refund lines get the coding they had before the schedule.
    removed := private.prepaid_apply(cid, s.id, jsonb_build_object(
      'schedule', null, 'rows', '[]'::jsonb, 'refunds', '[]'::jsonb,
      'lines', jsonb_build_array(s.prior) || coalesce((
        select jsonb_agg(f->'prior' order by f->>'transaction_id') from jsonb_array_elements(before->'refunds') f
      ), '[]'::jsonb)));

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'prepaid_delete', jsonb_build_object(
      'schedule_id', s.id, 'before', before, 'after', private.prepaid_snapshot(cid, s.id, lines)));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'schedule_id', s.id, 'entries_removed', removed, 'undo_kind', 'prepaid_delete'));
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

create function public.mcp_set_books_closed_through(p_idempotency_key text, p_date date)
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
  before date;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'books_closed|' || coalesce(p_date::text, '');
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
    select c.books_closed_through into before from public.companies c
    where c.id = cid and c.owner_id = auth.uid()
    for update;
    if not found then
      raise exception 'only the owner can close the books';
    end if;
    if p_date > current_date then
      raise exception 'the date is after today';
    end if;
    if p_date is not distinct from before then
      raise exception 'nothing to change';
    end if;
    if p_date is not null and exists (
      select 1 from public.prepaid_rows r
      where r.company_id = cid and r.entry_id is null and r.due_date <= p_date
    ) then
      raise exception 'post the due prepaid rows first';
    end if;
    update public.companies c set books_closed_through = p_date where c.id = cid;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior)
    values (token, auth.uid(), cid, 'books_closed', jsonb_build_object('before', before, 'after', p_date));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'books_closed_through', p_date, 'previous', before, 'undo_kind', 'books_closed'));
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

revoke all on function public.mcp_create_prepaid_schedule(text, uuid, uuid, text, integer, uuid, bigint, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.mcp_list_prepaid_schedules(text) from public, anon, authenticated;
revoke all on function public.mcp_get_prepaid_schedule(uuid) from public, anon, authenticated;
revoke all on function public.mcp_attach_prepaid_refund(text, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.mcp_update_prepaid_schedule(text, uuid, integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_end_prepaid_schedule(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mcp_delete_prepaid_schedule(text, uuid) from public, anon, authenticated;
revoke all on function public.mcp_set_books_closed_through(text, date) from public, anon, authenticated;
grant execute on function public.mcp_create_prepaid_schedule(text, uuid, uuid, text, integer, uuid, bigint, integer, uuid, text) to authenticated;
grant execute on function public.mcp_list_prepaid_schedules(text) to authenticated;
grant execute on function public.mcp_get_prepaid_schedule(uuid) to authenticated;
grant execute on function public.mcp_attach_prepaid_refund(text, uuid, uuid, bigint) to authenticated;
grant execute on function public.mcp_update_prepaid_schedule(text, uuid, integer, uuid, uuid) to authenticated;
grant execute on function public.mcp_end_prepaid_schedule(text, uuid, text, text) to authenticated;
grant execute on function public.mcp_delete_prepaid_schedule(text, uuid) to authenticated;
grant execute on function public.mcp_set_books_closed_through(text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The write kinds: the check constraints, mcp_refused, mcp_undo.
-- ---------------------------------------------------------------------------
do $kinds$
declare
  def text;
  kinds constant text := $k$'prepaid_create'::text, 'prepaid_refund'::text, 'prepaid_update'::text, 'prepaid_end'::text, 'prepaid_delete'::text$k$;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  if pg_temp.anchor_count(def, ']))') <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, ']))', ', ' || kinds || ', ''books_closed''::text]))');

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 1) <> ')' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 1)
    || ' OR ((kind = ANY (ARRAY[' || kinds || '])) AND (prior ? ''schedule_id''::text) AND (prior ? ''before''::text) AND (prior ? ''after''::text))'
    || ' OR ((kind = ''books_closed''::text) AND (company_id IS NOT NULL) AND (prior ? ''before''::text) AND (prior ? ''after''::text)))';
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
  def := replace(def, anchor, $n$      -- FLOW-155 and FLOW-156: prepaid schedules and the books-closed date. "schedule not found"
      -- stays out (no existence leak).
      when p_message in (
        'the line is a journal entry',
        'the line is not an expense',
        'the line is not income',
        'the line is not posted',
        'the line is already in a prepaid schedule',
        'the line is in another currency',
        'line is already split',
        'a line with VAT can''t be prepaid yet',
        'the line is switched into the P&L',
        'amount is above the line',
        'amount is above what remains',
        'the category must be an expense category counted in the P&L',
        'the prepaid account must be an asset account',
        'the schedule is not active',
        'months must be above the months posted',
        'from_month is before the last posted month',
        'only the owner can close the books',
        'the date is after today',
        'post the due prepaid rows first',
        'the line is in a prepaid schedule',
        'the entry belongs to a prepaid schedule'
      ) or p_message ~ '^the books are closed through [0-9]{4}-[0-9]{2}-[0-9]{2}$' then p_message
$n$ || anchor);
  execute def;
end
$refused$;

do $undo$
declare
  def text;
  a_kinds constant text := $a$p_kind not in ($a$;
  a_lookup constant text := $a$(p_kind = 'supplier_category' and w.kind = 'supplier_category' and w.transaction_id = p_id)$a$;
  a_branch constant text := $a$    elsif p_kind = 'supplier_category' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_kinds,
    $n$p_kind not in ('prepaid_create', 'prepaid_refund', 'prepaid_update', 'prepaid_end', 'prepaid_delete', 'books_closed', $n$);
  def := replace(def, a_lookup, a_lookup || $n$
        or (p_kind in ('prepaid_create', 'prepaid_refund', 'prepaid_update', 'prepaid_end', 'prepaid_delete')
          and w.kind = p_kind and w.prior->>'schedule_id' = p_id::text)
        or (p_kind = 'books_closed' and w.kind = 'books_closed' and w.company_id = p_id)$n$);
  def := replace(def, a_branch, $n$    elsif p_kind in ('prepaid_create', 'prepaid_refund', 'prepaid_update', 'prepaid_end', 'prepaid_delete', 'books_closed') then
      -- FLOW-155 and FLOW-156: the schedule (or the books-closed date) goes back while it reads as the
      -- write left it.
      response := private.undo_prepaid_write(cid, rec);
$n$ || a_branch);
  execute def;
end
$undo$;

-- ---------------------------------------------------------------------------
-- 7. The daily job. Missing pg_cron skips it with a notice, as the other jobs do.
-- ---------------------------------------------------------------------------
do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'flow-prepaid-post skipped: pg_cron is missing';
    return;
  end if;
  if exists (select 1 from cron.job j where j.jobname = 'flow-prepaid-post') then
    perform cron.unschedule('flow-prepaid-post');
  end if;
  perform cron.schedule(
    'flow-prepaid-post',
    '41 0 * * *',
    $job$ select private.prepaid_post_due(); $job$
  );
end
$cron$;

commit;
