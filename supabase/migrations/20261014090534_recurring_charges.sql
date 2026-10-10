-- FLOW-415, server part (decision 0172): recurring charges, the owner's option A (2026-10-10).
-- - public.recurring_overrides: the owner's word on whether a supplier's (or customer's) charges
--   in one currency recur. It is set from one payment and holds for the party, and it wins over
--   the automatic rule (seen in at least 3 of the last 6 complete months and in one of the last
--   2): true makes the party recurring from its own lines, false takes it out.
-- - private.recurring_parties gains the switch (p_overrides), each party's source (auto or
--   user) and its last bill's amount. missing_bills and expected_months follow the switch.
-- - missing_bills also names each row's project and category, its last bill's amount and its
--   source.
-- - recurring_changes: this month's charges from recurring suppliers that differ from usual by
--   20% or more, for Home.
-- - payment_recurring and set_payment_recurring: the transaction screen's חיוב קבוע switch.
-- A single payment already leaves the cash view with set_transaction_cash (FLOW-413).
-- "Today" is Asia/Jerusalem. All reads are the caller's company.

begin;

set local lock_timeout = '5s';

create table public.recurring_overrides (
  company_id uuid not null references public.companies (id) on delete cascade,
  direction public.txn_direction not null,
  party_id uuid not null,
  currency text not null,
  recurring boolean not null,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (company_id, direction, party_id, currency)
);

create index recurring_overrides_set_by_idx on public.recurring_overrides (set_by);

comment on table public.recurring_overrides is
  'FLOW-415. The owner''s word on whether a supplier''s (expense) or customer''s (income) charges in one currency recur; wins over the automatic rule in private.recurring_parties. Decision 0172.';

-- Only the functions below read and write it.
alter table public.recurring_overrides enable row level security;
revoke all on public.recurring_overrides from public, anon, authenticated;

-- The new columns change the return type, so the function is dropped and made again. Its callers
-- are plpgsql, which resolves it on each call.
drop function private.recurring_parties(uuid, date);

-- One row per supplier (expense) or customer (income) and currency that recurs as of p_today.
-- p_overrides false gives the automatic rule alone.
create function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean default true)
returns table (
  direction public.txn_direction,
  party_id uuid,
  currency text,
  months_seen integer,
  typical_day integer,
  typical_amount_minor bigint,
  last_doc_date date,
  seen_this_month boolean,
  project_id uuid,
  category_id uuid,
  last_amount_minor bigint,
  source text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window_start
  ),
  lines as (
    select t.direction, coalesce(t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.amount_net, t.project_id, t.category_id,
      date_trunc('month', t.doc_date)::date as month, t.line_status = 'posted' as posted
    from public.transactions t, bounds b
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status <> 'void'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= b.window_start
      and t.doc_date <= p_today
  ),
  overrides as (
    select o.direction, o.party_id, o.currency, o.recurring
    from public.recurring_overrides o
    where o.company_id = p_company and p_overrides
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month and l.posted
    group by l.direction, l.party_id, l.currency, l.month
  ),
  parties as (
    select m.direction, m.party_id, m.currency,
      count(*)::integer as months_seen,
      bool_or(m.month >= (b.this_month - interval '2 months')::date) as recent,
      percentile_disc(0.5) within group (order by m.first_day)::integer as typical_day,
      -- The median by size, with the direction's sign, so an even count does not lean one way.
      ((case when m.direction = 'expense' then -1 else 1 end)
        * percentile_disc(0.5) within group (order by abs(m.amount)))::bigint as typical_amount_minor
    from monthly m, bounds b
    group by m.direction, m.party_id, m.currency
  ),
  -- A party the owner marked recurring with no complete posted month yet: its latest month,
  -- this one and pending lines included, is its usual day and amount.
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join overrides o on o.direction = l.direction and o.party_id = l.party_id and o.currency = l.currency
    where o.recurring
      and not exists (
        select 1 from parties p
        where p.direction = l.direction and p.party_id = l.party_id and p.currency = l.currency
      )
    group by l.direction, l.party_id, l.currency, l.month
  ),
  forced as (
    select distinct on (fm.direction, fm.party_id, fm.currency)
      fm.direction, fm.party_id, fm.currency,
      0 as months_seen, true as recent, fm.first_day as typical_day, fm.amount::bigint as typical_amount_minor
    from forced_monthly fm
    order by fm.direction, fm.party_id, fm.currency, fm.month desc
  ),
  candidates as (
    select * from parties
    union all
    select * from forced
  ),
  chosen as (
    select c.*, case when o.recurring is null then 'auto' else 'user' end as source
    from candidates c
    left join overrides o on o.direction = c.direction and o.party_id = c.party_id and o.currency = c.currency
    where coalesce(o.recurring, c.months_seen >= 3 and c.recent)
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    last_bill.doc_date,
    exists (
      select 1 from lines l, bounds b
      where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
        and l.month = b.this_month
    ),
    (select l.project_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.project_id is not null
     group by l.project_id order by count(*) desc, max(l.doc_date) desc limit 1),
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.category_id is not null
     group by l.category_id order by count(*) desc, max(l.doc_date) desc limit 1),
    last_bill.amount,
    p.source
  from chosen p
  -- The last posted bill: its date, and every posted line of the party on that date.
  left join lateral (
    select l.doc_date, sum(l.amount_net)::bigint as amount
    from lines l
    where l.posted and l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
    group by l.doc_date
    order by l.doc_date desc
    limit 1
  ) last_bill on true;
$$;

revoke all on function private.recurring_parties(uuid, date, boolean) from public, anon, authenticated;

-- Missing bills: recurring suppliers with no expense line this month, past their usual day
-- plus 5 days (or the month's last day).
create or replace function public.missing_bills(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  last_day integer := extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::integer;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'supplier_id', r.party_id,
        'supplier_name', s.name,
        'currency', r.currency,
        'typical_amount_minor', r.typical_amount_minor,
        'typical_day', r.typical_day,
        'expected_by', make_date(extract(year from today)::integer, extract(month from today)::integer,
          least(r.typical_day + 5, last_day)),
        'months_seen', r.months_seen,
        'last_doc_date', r.last_doc_date,
        'last_amount_minor', r.last_amount_minor,
        'project_id', r.project_id,
        'project_name', p.name,
        'category_id', r.category_id,
        'category_name', c.name,
        'source', r.source
      ) order by r.typical_day, s.name, r.party_id), '[]'::jsonb)
    from private.recurring_parties(cid, today) r
    join public.suppliers s on s.company_id = cid and s.id = r.party_id
    left join public.projects p on p.company_id = cid and p.id = r.project_id
    left join public.categories c on c.company_id = cid and c.id = r.category_id
    where r.direction = 'expense'
      and not r.seen_this_month
      -- A deadline past the month's end falls on its last day.
      and (extract(day from today)::integer > r.typical_day + 5
        or (r.typical_day + 5 >= last_day and extract(day from today)::integer = last_day))
  );
end;
$$;

-- This month's charges from recurring suppliers that differ from their usual monthly amount by
-- 20% or more, up or down. A month's charge is every live line of the supplier this month,
-- pending ones included (a pending line is this month's bill too); usual is the median of the
-- complete months. Largest change first.
create or replace function public.recurring_changes(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    with r as (
      select * from private.recurring_parties(cid, today) rp
      where rp.direction = 'expense' and rp.seen_this_month and rp.typical_amount_minor <> 0
        -- A party with no complete month yet has its usual amount from this month itself.
        and rp.months_seen > 0
    ),
    this_month as (
      select r.party_id, r.currency, sum(t.amount_net)::bigint as amount,
        (array_agg(t.id order by t.doc_date desc, t.created_at desc))[1] as transaction_id
      from r
      join public.transactions t
        on t.company_id = cid and t.supplier_id = r.party_id and t.currency = r.currency
      where t.direction = 'expense'
        and t.removed_at is null
        and t.line_status <> 'void'
        and t.doc_date >= date_trunc('month', today)::date
        and t.doc_date <= today
      group by r.party_id, r.currency
    ),
    changes as (
      select r.*, m.amount, m.transaction_id,
        round((abs(m.amount) - abs(r.typical_amount_minor)) * 100.0 / abs(r.typical_amount_minor))::integer as change_percent
      from r
      join this_month m on m.party_id = r.party_id and m.currency = r.currency
      where abs(abs(m.amount) - abs(r.typical_amount_minor)) * 5 >= abs(r.typical_amount_minor)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'supplier_id', ch.party_id,
        'supplier_name', s.name,
        'currency', ch.currency,
        'amount_minor', ch.amount,
        'typical_amount_minor', ch.typical_amount_minor,
        'change_percent', ch.change_percent,
        'typical_day', ch.typical_day,
        'transaction_id', ch.transaction_id,
        'project_id', ch.project_id,
        'project_name', p.name,
        'category_id', ch.category_id,
        'category_name', c.name,
        'source', ch.source
      ) order by abs(ch.change_percent) desc, s.name, ch.party_id), '[]'::jsonb)
    from changes ch
    join public.suppliers s on s.company_id = cid and s.id = ch.party_id
    left join public.projects p on p.company_id = cid and p.id = ch.project_id
    left join public.categories c on c.company_id = cid and c.id = ch.category_id
  );
end;
$$;

-- The party a payment's switch applies to: its supplier (expense) or customer (income), and its
-- currency. Null when the line has neither or is not the caller's.
create or replace function private.payment_party(p_company uuid, p_transaction_id uuid)
returns table (direction public.txn_direction, party_id uuid, currency text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.direction, coalesce(t.supplier_id, t.customer_id), t.currency, coalesce(s.name, cu.name)
  from public.transactions t
  left join public.suppliers s on t.direction = 'expense' and s.id = t.supplier_id
  left join public.customers cu on t.direction = 'income' and cu.id = t.customer_id
  where t.id = p_transaction_id
    and t.company_id = p_company
    and t.removed_at is null
    and ((t.direction = 'expense' and t.supplier_id is not null)
      or (t.direction = 'income' and t.customer_id is not null));
$$;

revoke all on function private.payment_party(uuid, uuid) from public, anon, authenticated;

-- The חיוב קבוע state of one payment, for the transaction screen and the MCP.
create or replace function private.payment_recurring_state(p_company uuid, p_transaction_id uuid, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  party record;
  override boolean;
  detected boolean;
  usual_day integer;
  usual_amount bigint;
begin
  if not exists (
    select 1 from public.transactions t
    where t.id = p_transaction_id and t.company_id = p_company and t.removed_at is null
  ) then
    return null;
  end if;
  select * into party from private.payment_party(p_company, p_transaction_id);
  if not found then
    return jsonb_build_object(
      'transaction_id', p_transaction_id,
      'party', null,
      'recurring', false,
      'override', null,
      'detected', false,
      'typical_day', null,
      'typical_amount_minor', null
    );
  end if;
  select o.recurring into override
  from public.recurring_overrides o
  where o.company_id = p_company and o.direction = party.direction
    and o.party_id = party.party_id and o.currency = party.currency;
  detected := exists (
    select 1 from private.recurring_parties(p_company, p_today, false) r
    where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency
  );
  select r.typical_day, r.typical_amount_minor into usual_day, usual_amount
  from private.recurring_parties(p_company, p_today) r
  where r.direction = party.direction and r.party_id = party.party_id and r.currency = party.currency;
  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'party', jsonb_build_object(
      'direction', party.direction,
      'id', party.party_id,
      'name', party.name,
      'currency', party.currency
    ),
    'recurring', coalesce(override, detected),
    'override', override,
    'detected', detected,
    'typical_day', usual_day,
    'typical_amount_minor', usual_amount
  );
end;
$$;

revoke all on function private.payment_recurring_state(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.payment_recurring(p_id uuid, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  state jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  state := private.payment_recurring_state(cid, p_id, coalesce(p_today, private.flow_today()));
  if state is null then
    raise exception 'transaction not found';
  end if;
  return state;
end;
$$;

-- The owner's switch: true or false holds for the payment's supplier (or customer) in its
-- currency, null goes back to the automatic rule. Returns the new state and the prior override,
-- so the app's ביטול puts it back.
create or replace function public.set_payment_recurring(p_id uuid, p_recurring boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  party record;
  prior boolean;
begin
  -- An owner or an editor writes (decision 0167); a viewer member or the demo viewer is refused.
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if not exists (
    select 1 from public.transactions t
    where t.id = p_id and t.company_id = cid and t.removed_at is null
  ) then
    raise exception 'transaction not found';
  end if;
  select * into party from private.payment_party(cid, p_id);
  if not found then
    raise exception 'no supplier or customer';
  end if;
  select o.recurring into prior
  from public.recurring_overrides o
  where o.company_id = cid and o.direction = party.direction
    and o.party_id = party.party_id and o.currency = party.currency
  for update;
  if p_recurring is null then
    delete from public.recurring_overrides o
    where o.company_id = cid and o.direction = party.direction
      and o.party_id = party.party_id and o.currency = party.currency;
  else
    insert into public.recurring_overrides (company_id, direction, party_id, currency, recurring, set_by, set_at)
    values (cid, party.direction, party.party_id, party.currency, p_recurring, auth.uid(), now())
    on conflict (company_id, direction, party_id, currency)
    do update set recurring = excluded.recurring, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
  return private.payment_recurring_state(cid, p_id, private.flow_today())
    || jsonb_build_object('prior_override', prior);
end;
$$;

revoke all on function public.missing_bills(date) from public, anon;
revoke all on function public.recurring_changes(date) from public, anon;
revoke all on function public.payment_recurring(uuid, date) from public, anon;
revoke all on function public.set_payment_recurring(uuid, boolean) from public, anon;
grant execute on function public.missing_bills(date) to authenticated, service_role;
grant execute on function public.recurring_changes(date) to authenticated, service_role;
grant execute on function public.payment_recurring(uuid, date) to authenticated, service_role;
grant execute on function public.set_payment_recurring(uuid, boolean) to authenticated, service_role;

-- The MCP's switch: set_payment_recurring with the idempotency key, the write gate and an undo
-- (kind line_recurring, id: the transaction).
create or replace function public.mcp_set_line_recurring(p_idempotency_key text, p_transaction_id uuid, p_recurring boolean)
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
  written jsonb;
  response jsonb;
  write_id uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_recurring|' || p_transaction_id::text || '|' || coalesce(p_recurring::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    if not exists (
      select 1 from public.transactions t
      where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
    ) then
      if exists (
        select 1 from public.review_queue q
        where q.id = p_transaction_id and q.company_id = cid
      ) then
        response := private.mcp_error(
          'validation',
          'id is not a transaction; list_review.id is the review id'
        );
      else
        response := private.mcp_refused('transaction not found');
      end if;
    else
      written := public.set_payment_recurring(p_transaction_id, p_recurring);
      -- clock_timestamp, so two writes to one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_recurring',
        jsonb_build_object('before', written->'prior_override', 'written', to_jsonb(p_recurring)),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object(
        'ok', true,
        'data', (written - 'prior_override') || jsonb_build_object(
          'undo_kind', 'line_recurring',
          'id', p_transaction_id,
          'write_id', write_id
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
$$;

-- The MCP's reads go through the same functions as the app's: missing_bills, recurring_changes
-- and payment_recurring.
revoke all on function public.mcp_set_line_recurring(text, uuid, boolean) from public, anon;
grant execute on function public.mcp_set_line_recurring(text, uuid, boolean) to authenticated, service_role;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The undo kind line_recurring on mcp_writes and mcp_undo.
do $undo$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'cash_basis'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'line_recurring'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'cash_basis'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'line_recurring'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$p_kind not in ('category_cash', 'line_cash', 'cash_basis', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('line_recurring', 'category_cash', 'line_cash', 'cash_basis', $n$);

  anchor := $a$(p_kind = 'category_cash' and w.kind = 'category_cash' and w.category_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo match is not the expected definition';
  end if;
  def := replace(def, anchor, $n$(p_kind = 'line_recurring' and w.kind = 'line_recurring' and w.transaction_id = p_id)
        or $n$ || anchor);

  anchor := $a$    elsif p_kind in ('category_cash', 'line_cash', 'cash_basis') then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo branches are not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'line_recurring' then
      -- FLOW-415. The party's switch changed since the write is a conflict; else
      -- set_payment_recurring puts back the switch from before (null: automatic).
      declare
        party record;
        cur jsonb;
      begin
        select * into party from private.payment_party(cid, p_id);
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select coalesce(
            (select to_jsonb(o.recurring) from public.recurring_overrides o
             where o.company_id = cid and o.direction = party.direction
               and o.party_id = party.party_id and o.currency = party.currency
             for update),
            'null'::jsonb
          ) into cur;
          if cur is distinct from rec.prior->'written' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform public.set_payment_recurring(p_id, (rec.prior->>'before')::boolean);
            update private.mcp_writes
            set undone_at = clock_timestamp()
            where id = rec.id and user_id = auth.uid() and undone_at is null;
            response := jsonb_build_object(
              'ok', true,
              'data', jsonb_build_object('kind', p_kind, 'id', p_id)
            );
          end if;
        end if;
      end;
$n$ || anchor);
  execute def;
end
$undo$;

-- expected_months names each recurring party's source: the rule ('auto') or the owner ('user').
do $expected$
declare
  def text := pg_get_functiondef('public.expected_months(integer,uuid,date)'::regprocedure);
  anchor text := $a$'category_id', r.category_id$a$;
begin
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'expected_months is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
          'source', r.source$n$);
end
$expected$;

drop function pg_temp.anchor_count(text, text);

commit;
