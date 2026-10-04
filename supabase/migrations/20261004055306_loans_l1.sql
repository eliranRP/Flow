-- Loans. Decision 0088.
-- A loan keeps its original currency. The schedule is built in the app.
-- One bank line stays one transaction. loan_splits is the three parts of that line.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create type public.loan_split_part as enum ('interest', 'escrow', 'principal');

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  principal_minor bigint not null,
  annual_rate_ppm integer not null,
  term_months integer not null,
  start_date date not null,
  payment_minor bigint not null,
  escrow_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  constraint loans_name_chk check (char_length(btrim(name)) between 1 and 80),
  constraint loans_principal_chk check (principal_minor > 0),
  constraint loans_rate_chk check (annual_rate_ppm >= 0 and annual_rate_ppm <= 1000000),
  constraint loans_term_chk check (term_months between 1 and 600),
  constraint loans_payment_chk check (payment_minor > 0),
  constraint loans_escrow_chk check (escrow_minor >= 0 and escrow_minor < payment_minor),
  constraint loans_currency_chk check (currency ~ '^[A-Z]{3}$')
);

comment on table public.loans is
  'One loan for one company. Amounts are minor units of currency. Decision 0088.';

comment on column public.loans.annual_rate_ppm is
  'Nominal annual rate in parts per million. 60000 is 6 percent. Monthly interest divides by 12.';

comment on column public.loans.start_date is
  'Due date of the first scheduled payment. Later payments are calendar months after this.';

comment on column public.loans.currency is
  'The loan''s own currency. Display conversion does not rewrite it.';

create index loans_company_idx on public.loans (company_id);

create trigger loans_touch
  before update on public.loans
  for each row execute function private.touch_updated_at();

-- A currency change after a split would leave the parts in the old currency.
create or replace function private.loans_lock_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency
     and exists (
       select 1
       from public.loan_splits s
       where s.company_id = old.company_id
         and s.loan_id = old.id
     )
  then
    raise exception 'loan_currency_locked' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loans_lock_currency() from public, anon, authenticated;

create trigger loans_lock_currency
  before update on public.loans
  for each row execute function private.loans_lock_currency();

create table public.loan_splits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  loan_id uuid not null,
  transaction_id uuid not null,
  part public.loan_split_part not null,
  amount_minor bigint not null,
  scheduled_minor bigint not null,
  category_id uuid not null,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, part),
  unique (company_id, id),
  foreign key (company_id, loan_id)
    references public.loans (company_id, id)
    on delete cascade,
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade,
  foreign key (company_id, category_id)
    references public.categories (company_id, id),
  constraint loan_splits_amount_chk check (amount_minor >= 0),
  constraint loan_splits_scheduled_chk check (scheduled_minor >= 0)
);

comment on table public.loan_splits is
  'Three rows for one bank line: interest, escrow, and principal. Decision 0088.';

comment on column public.loan_splits.amount_minor is
  'The part actually applied. A correction replaces the scheduled amount and the three parts still sum to the line.';

comment on column public.loan_splits.scheduled_minor is
  'The schedule''s amount for this part, kept so a correction can be compared with one tap.';

comment on column public.loan_splits.needs_review is
  'Set when a connector re-sync changes the line amount or currency. L-3 clears it with the one-tap correction. While every part of the line is set, the sum and the currency are not enforced.';

create index loan_splits_company_loan_idx on public.loan_splits (company_id, loan_id);
create index loan_splits_company_txn_idx on public.loan_splits (company_id, transaction_id);
create index loan_splits_category_idx on public.loan_splits (category_id);

create trigger loan_splits_touch
  before update on public.loan_splits
  for each row execute function private.touch_updated_at();

-- Deferred so the three parts can be written in one transaction.
create or replace function private.loan_splits_check(txn uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  parts integer;
  loan_count integer;
  actual bigint;
  expected bigint;
  stale boolean;
begin
  select count(*)::integer,
         count(distinct s.loan_id)::integer,
         coalesce(sum(s.amount_minor), 0),
         bool_and(s.needs_review)
  into parts, loan_count, actual, stale
  from public.loan_splits s
  where s.transaction_id = txn;

  if parts = 0 then
    return;
  end if;

  if parts <> 3 or loan_count <> 1 then
    raise exception 'loan_split_incomplete' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.transactions t
    where t.id = txn
      and t.direction = 'income'::public.txn_direction
  ) then
    raise exception 'loan_split_income' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.loan_splits s
    join public.categories c
      on c.company_id = s.company_id
     and c.id = s.category_id
    where s.transaction_id = txn
      and (
        c.kind is distinct from 'expense'::public.category_kind
        or (
          s.part = 'interest'::public.loan_split_part
          and (c.name is distinct from 'ריבית משכנתא' or c.excluded_from_pnl)
        )
        or (
          s.part = 'escrow'::public.loan_split_part
          and (c.name is distinct from 'מסים וביטוח' or c.excluded_from_pnl)
        )
        or (
          s.part = 'principal'::public.loan_split_part
          and (c.name is distinct from 'תשלומי הלוואה' or c.excluded_from_pnl is distinct from true)
        )
      )
  ) then
    raise exception 'loan_split_category' using errcode = '23514';
  end if;

  -- A re-sync sets the flag on every part. The sum and the currency wait.
  if coalesce(stale, false) then
    return;
  end if;

  if exists (
    select 1
    from public.loan_splits s
    join public.loans l
      on l.company_id = s.company_id
     and l.id = s.loan_id
    join public.transactions t
      on t.company_id = s.company_id
     and t.id = s.transaction_id
    where s.transaction_id = txn
      and t.currency is distinct from l.currency
  ) then
    raise exception 'loan_split_currency' using errcode = '23514';
  end if;

  select t.amount_original
  into expected
  from public.transactions t
  where t.id = txn;

  if actual is distinct from expected then
    raise exception 'loan_split_sum' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.loan_splits_check(uuid) from public, anon, authenticated;

create or replace function private.loan_splits_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.transaction_id is distinct from new.transaction_id then
    perform private.loan_splits_check(old.transaction_id);
    perform private.loan_splits_check(new.transaction_id);
  else
    perform private.loan_splits_check(coalesce(new.transaction_id, old.transaction_id));
  end if;
  return null;
end;
$$;

revoke all on function private.loan_splits_match() from public, anon, authenticated;

create constraint trigger loan_splits_match
  after insert or update or delete on public.loan_splits
  deferrable initially deferred
  for each row
  execute function private.loan_splits_match();

-- The connector upsert rewrites amount_original and currency in place.
-- Mark the parts stale instead of failing that write.
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
    update public.loan_splits
       set needs_review = true
     where company_id = new.company_id
       and transaction_id = new.id
       and needs_review is distinct from true;
  end if;
  return null;
end;
$$;

revoke all on function private.loan_splits_mark_stale() from public, anon, authenticated;

create trigger transactions_loan_splits_stale
  after update of amount_original, currency on public.transactions
  for each row
  execute function private.loan_splits_mark_stale();

create view public.loan_balances
with (security_invoker = true) as
select
  l.company_id,
  l.id as loan_id,
  l.currency,
  (
    l.principal_minor - coalesce(
      sum(s.amount_minor) filter (
        where s.part = 'principal'::public.loan_split_part
          and t.line_status = 'posted'::public.line_status
          and t.removed_at is null
      ),
      0
    )
  )::bigint as balance_minor
from public.loans l
left join public.loan_splits s
  on s.company_id = l.company_id
 and s.loan_id = l.id
left join public.transactions t
  on t.company_id = s.company_id
 and t.id = s.transaction_id
group by l.company_id, l.id, l.currency, l.principal_minor;

comment on view public.loan_balances is
  'Principal left on the loan, in the loan currency. Only principal on a posted line that is still on the books reduces it. Decision 0088.';

alter table public.loans enable row level security;
alter table public.loan_splits enable row level security;

create policy loans_select on public.loans
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

create policy loans_insert on public.loans
  for insert to authenticated
  with check (company_id = (select private.current_company_id()));

create policy loans_update on public.loans
  for update to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy loans_delete on public.loans
  for delete to authenticated
  using (company_id = (select private.current_company_id()));

create policy loan_splits_select on public.loan_splits
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

create policy loan_splits_insert on public.loan_splits
  for insert to authenticated
  with check (company_id = (select private.current_company_id()));

create policy loan_splits_update on public.loan_splits
  for update to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));

create policy loan_splits_delete on public.loan_splits
  for delete to authenticated
  using (company_id = (select private.current_company_id()));

revoke all on public.loans from public, anon, authenticated;
revoke all on public.loan_splits from public, anon, authenticated;
revoke all on public.loan_balances from public, anon, authenticated;

grant select, insert, update, delete on public.loans to authenticated, service_role;
grant select, insert, delete on public.loan_splits to authenticated;
grant update (amount_minor, scheduled_minor, category_id, needs_review)
  on public.loan_splits to authenticated;
grant select, insert, update, delete on public.loan_splits to service_role;
grant select on public.loan_balances to authenticated, service_role;

create or replace function private.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (company_id, name, kind, sort_order, is_default) values
    (new.id, 'חומרים', 'expense', 1, true),
    (new.id, 'קבלני משנה', 'expense', 2, true),
    (new.id, 'עבודה', 'expense', 3, true),
    (new.id, 'ציוד והשכרה', 'expense', 4, true),
    (new.id, 'הובלה', 'expense', 5, true),
    (new.id, 'ביטוח', 'expense', 6, true),
    (new.id, 'אחר', 'expense', 7, true),
    (new.id, 'תקבול מלקוח', 'income', 1, true),
    (new.id, 'הכנסה אחרת', 'income', 2, true);
  insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl) values
    (new.id, 'תשלומי הלוואה', 'expense', 8, true, true),
    (new.id, 'העברות', 'expense', 9, true, true),
    (new.id, 'העברות', 'income', 3, true, true),
    (new.id, 'ריבית משכנתא', 'expense', 10, true, false),
    (new.id, 'מסים וביטוח', 'expense', 11, true, false);
  return new;
end;
$$;

revoke all on function private.seed_default_categories() from public, anon;
grant execute on function private.seed_default_categories() to authenticated, service_role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select c.id, v.name, 'expense'::public.category_kind, v.sort_order, true, false
from public.companies c
cross join (
  values
    ('ריבית משכנתא', 10),
    ('מסים וביטוח', 11)
) as v(name, sort_order)
on conflict on constraint categories_company_id_kind_name_key do nothing;

commit;
