-- FLOW-430 (decision 0179): a late recurring bill suggests a renamed supplier, and the user
-- decides. When a supplier's bill comes in under a different name it becomes a new supplier, and
-- the recurring one stays late. Nothing merges by itself (the owner's rule, 2026-10-10):
-- - public.recurring_matches keeps the company's answer for a pair: the recurring party and the
--   suggested one are the same, or not.
-- - "Same" counts the other party's lines as the recurring party's in private.recurring_parties,
--   private.recurring_arrivals and private.payment_party, so its bill arrives.
-- - missing_bills gives a late row one suggestion: a party first seen in the due month or the
--   month before, same direction and currency, a name sharing its first word (or one name
--   inside the other), an amount within 50% of the usual, and no answer yet for the pair.
-- - answer_recurring_match saves the answer (null takes it back), for the app; the MCP's
--   answer_recurring_match adds the idempotency key, the write gate and an undo.

begin;

set local lock_timeout = '5s';

-- 1. The answers. party_id is the recurring supplier (expense) or customer (income);
-- match_party_id is the one suggested for it. A party is "the same" as one recurring party at most.
create table public.recurring_matches (
  company_id uuid not null references public.companies (id) on delete cascade,
  direction public.txn_direction not null,
  party_id uuid not null,
  match_party_id uuid not null,
  same boolean not null,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (company_id, direction, party_id, match_party_id),
  constraint recurring_matches_two_parties check (party_id <> match_party_id)
);

create unique index recurring_matches_one_same_idx
  on public.recurring_matches (company_id, direction, match_party_id) where same;
create index recurring_matches_set_by_idx on public.recurring_matches (set_by);

comment on table public.recurring_matches is
  'FLOW-430. The company''s answer to a suggested match for a recurring supplier (or customer): the same party under another name, or not. Same counts the other party''s lines as the recurring one''s. Decision 0179.';

-- Only the functions below read and write it.
alter table public.recurring_matches enable row level security;
revoke all on public.recurring_matches from public, anon, authenticated;

-- The party a line counts for: the recurring party it was answered "the same" as, else its own.
create function private.recurring_party_of(p_company uuid, p_direction public.txn_direction, p_party uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.party_id from public.recurring_matches m
     where m.company_id = p_company and m.direction = p_direction and m.match_party_id = p_party and m.same),
    p_party);
$$;

revoke all on function private.recurring_party_of(uuid, public.txn_direction, uuid) from public, anon, authenticated;

-- A name's words: lower case, letters and digits only.
create function private.party_name_words(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$ select btrim(regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g')); $$;

revoke all on function private.party_name_words(text) from public, anon, authenticated;

-- Two names that may be one party: the same first word (3 letters or more), or one name's words
-- inside the other's.
create function private.party_names_alike(p_a text, p_b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with w as (select private.party_name_words(p_a) as a, private.party_name_words(p_b) as b)
  select w.a <> '' and w.b <> '' and (
    (char_length(split_part(w.a, ' ', 1)) >= 3 and split_part(w.a, ' ', 1) = split_part(w.b, ' ', 1))
    or position(w.a in w.b) > 0 or position(w.b in w.a) > 0)
  from w;
$$;

revoke all on function private.party_names_alike(text, text) from public, anon, authenticated;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 2. The rule counts a matched party's lines as the recurring party's.
do $parties$
declare
  def text := pg_get_functiondef('private.recurring_parties(uuid,date,boolean)'::regprocedure);
  anchor text;
begin
  anchor := $a$coalesce(t.supplier_id, t.customer_id) as party_id$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'recurring_parties lines are not the expected definition';
  end if;
  def := replace(def, anchor, $n$coalesce(mm.party_id, t.supplier_id, t.customer_id) as party_id$n$);
  anchor := $a$from public.transactions t, bounds b$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'recurring_parties source is not the expected definition';
  end if;
  def := replace(def, anchor, $n$from public.transactions t
    -- FLOW-430: a party answered "the same" counts as the recurring one.
    left join public.recurring_matches mm
      on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
      and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
    cross join bounds b$n$);
  execute def;

  def := pg_get_functiondef('private.recurring_arrivals(uuid,date)'::regprocedure);
  anchor := $a$and r.party_id = case when r.direction = 'expense' then t.supplier_id else t.customer_id end$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'recurring_arrivals is not the expected definition';
  end if;
  execute replace(def, anchor, $n$and r.party_id = private.recurring_party_of(p_company, t.direction,
        case when r.direction = 'expense' then t.supplier_id else t.customer_id end)$n$);
end
$parties$;

-- A payment's party is the recurring one it was matched to, so its switches act on that party.
create or replace function private.payment_party(p_company uuid, p_transaction_id uuid)
returns table (direction public.txn_direction, party_id uuid, currency text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.direction, x.party_id, x.currency, coalesce(s.name, cu.name)
  from (
    select t.direction, private.recurring_party_of(p_company, t.direction, coalesce(t.supplier_id, t.customer_id)) as party_id,
      t.currency
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = p_company
      and t.removed_at is null
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null))
  ) x
  left join public.suppliers s on x.direction = 'expense' and s.company_id = p_company and s.id = x.party_id
  left join public.customers cu on x.direction = 'income' and cu.company_id = p_company and cu.id = x.party_id;
$$;

-- 3. One suggestion for a late row: the newest line of a party first seen from the month before
-- the due month, alike in name, within 50% of the usual amount, nearest to it first.
create function private.recurring_match_suggestion(
  p_company uuid, p_direction public.txn_direction, p_party uuid, p_currency text,
  p_due_month date, p_typical bigint, p_today date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select coalesce(s.name, cu.name) as name
    from (select 1) one
    left join public.suppliers s on p_direction = 'expense' and s.company_id = p_company and s.id = p_party
    left join public.customers cu on p_direction = 'income' and cu.company_id = p_company and cu.id = p_party
  ),
  candidates as (
    select n.id, n.name
    from (
      select s.id, s.name from public.suppliers s where p_direction = 'expense' and s.company_id = p_company
      union all
      select cu.id, cu.name from public.customers cu where p_direction = 'income' and cu.company_id = p_company
    ) n, me
    where n.id <> p_party
      and private.party_names_alike(me.name, n.name)
      and not exists (
        select 1 from public.recurring_matches m
        where m.company_id = p_company and m.direction = p_direction
          and ((m.party_id = p_party and m.match_party_id = n.id) or (m.match_party_id = n.id and m.same)
            or m.party_id = n.id)
      )
  ),
  latest as (
    select distinct on (c.id) c.id, c.name, t.id as transaction_id, t.doc_date, t.amount_net
    from candidates c
    join public.transactions t
      on t.company_id = p_company and t.direction = p_direction and t.currency = p_currency
      and c.id = case when p_direction = 'expense' then t.supplier_id else t.customer_id end
    where t.removed_at is null
      and t.line_status <> 'void'
      and (p_direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= (p_due_month - interval '1 month')::date
      and t.doc_date <= p_today
      -- First seen lately: no line before the month ahead of the due month.
      and not exists (
        select 1 from public.transactions o
        where o.company_id = p_company and o.removed_at is null and o.line_status <> 'void'
          and c.id = case when p_direction = 'expense' then o.supplier_id else o.customer_id end
          and o.doc_date < (p_due_month - interval '1 month')::date
      )
    order by c.id, t.doc_date desc, t.created_at desc
  )
  select jsonb_build_object(
      'party_id', l.id,
      'party_name', l.name,
      'transaction_id', l.transaction_id,
      'doc_date', l.doc_date,
      'amount_minor', l.amount_net
    )
  from latest l
  where p_typical <> 0
    and abs(l.amount_net) * 2 >= abs(p_typical)
    and abs(l.amount_net) * 2 <= abs(p_typical) * 3
  order by abs(abs(l.amount_net) - abs(p_typical)), l.doc_date desc, l.id
  limit 1;
$$;

revoke all on function private.recurring_match_suggestion(uuid, public.txn_direction, uuid, text, date, bigint, date)
  from public, anon, authenticated;

-- 4. Late bills, each with its suggestion (null when none).
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
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    with due as (
      select r.*,
        make_date(extract(year from r.next_due_month)::integer, extract(month from r.next_due_month)::integer,
          least(r.typical_day + 5, extract(day from private.month_end(r.next_due_month))::integer)) as expected_by,
        r.direction || ':' || r.party_id || ':' || r.currency || ':' || to_char(r.next_due_month, 'YYYY-MM') as alert_key
      from private.recurring_parties(cid, today) r
      where r.next_due_month <= date_trunc('month', today)::date
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'direction', d.direction,
        'party_id', d.party_id,
        'party_name', coalesce(s.name, cu.name),
        'supplier_id', s.id,
        'supplier_name', s.name,
        'currency', d.currency,
        'typical_amount_minor', d.typical_amount_minor,
        'typical_day', d.typical_day,
        'due_month', to_char(d.next_due_month, 'YYYY-MM'),
        'expected_by', d.expected_by,
        'months_seen', d.months_seen,
        'last_doc_date', d.last_doc_date,
        'last_amount_minor', d.last_amount_minor,
        'project_id', d.project_id,
        'project_name', p.name,
        'category_id', d.category_id,
        'category_name', c.name,
        'source', d.source,
        'pace', d.pace,
        'pace_source', d.pace_source,
        'alert_key', d.alert_key,
        'suggestion', private.recurring_match_suggestion(cid, d.direction, d.party_id, d.currency,
          d.next_due_month, d.typical_amount_minor, today)
      ) order by d.direction = 'income', d.typical_day, coalesce(s.name, cu.name), d.party_id), '[]'::jsonb)
    from due d
    left join public.suppliers s on d.direction = 'expense' and s.company_id = cid and s.id = d.party_id
    left join public.customers cu on d.direction = 'income' and cu.company_id = cid and cu.id = d.party_id
    left join public.projects p on p.company_id = cid and p.id = d.project_id
    left join public.categories c on c.company_id = cid and c.id = d.category_id
    where coalesce(s.id, cu.id) is not null
      -- A deadline past the month's end falls on its last day.
      and (today > d.expected_by or (today = d.expected_by and d.expected_by = private.month_end(d.next_due_month)))
      and not exists (
        select 1 from public.recurring_dismissals x
        where x.user_id = auth.uid() and x.company_id = cid and x.kind = 'missing' and x.alert_key = d.alert_key
      )
  );
end;
$$;

-- 5. The answer: same true or false for the pair; null takes the answer back. An owner or an
-- editor writes (decision 0167). Returns the pair, the answer and prior_same for ביטול.
create function public.answer_recurring_match(
  p_direction public.txn_direction, p_party_id uuid, p_match_party_id uuid, p_same boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior boolean;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_direction is null or p_party_id is null or p_match_party_id is null or p_party_id = p_match_party_id then
    raise exception 'validation';
  end if;
  if (select count(*) from (
        select s.id from public.suppliers s
        where p_direction = 'expense' and s.company_id = cid and s.id in (p_party_id, p_match_party_id)
        union all
        select cu.id from public.customers cu
        where p_direction = 'income' and cu.company_id = cid and cu.id in (p_party_id, p_match_party_id)
      ) x) <> 2 then
    raise exception 'party not found';
  end if;
  select m.same into prior
  from public.recurring_matches m
  where m.company_id = cid and m.direction = p_direction
    and m.party_id = p_party_id and m.match_party_id = p_match_party_id
  for update;
  if p_same then
    -- One step only: the recurring party is nobody's match, and the other one has no matches of
    -- its own and is not already the same as another party.
    if exists (
      select 1 from public.recurring_matches m
      where m.company_id = cid and m.direction = p_direction and m.same
        and (m.match_party_id = p_party_id
          or (m.match_party_id = p_match_party_id and m.party_id <> p_party_id))
    ) or exists (
      select 1 from public.recurring_matches m
      where m.company_id = cid and m.direction = p_direction and m.party_id = p_match_party_id and m.same
    ) then
      raise exception 'already matched';
    end if;
  end if;
  if p_same is null then
    delete from public.recurring_matches m
    where m.company_id = cid and m.direction = p_direction
      and m.party_id = p_party_id and m.match_party_id = p_match_party_id;
  else
    insert into public.recurring_matches as m (company_id, direction, party_id, match_party_id, same, set_by, set_at)
    values (cid, p_direction, p_party_id, p_match_party_id, p_same, auth.uid(), now())
    on conflict (company_id, direction, party_id, match_party_id)
    do update set same = excluded.same, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
  return jsonb_build_object(
    'direction', p_direction,
    'party_id', p_party_id,
    'match_party_id', p_match_party_id,
    'same', p_same,
    'prior_same', prior
  );
end;
$$;

revoke all on function public.answer_recurring_match(public.txn_direction, uuid, uuid, boolean) from public, anon;
grant execute on function public.answer_recurring_match(public.txn_direction, uuid, uuid, boolean)
  to authenticated, service_role;

-- 6. The MCP's answer: answer_recurring_match with the idempotency key, the write gate and an
-- undo (kind recurring_match, id: the suggested party).
create function public.mcp_answer_recurring_match(
  p_idempotency_key text, p_direction text, p_party_id uuid, p_match_party_id uuid, p_same boolean
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
  written jsonb;
  response jsonb;
  write_id uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_direction is null or p_direction not in ('expense', 'income')
    or p_party_id is null or p_match_party_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'recurring_match|' || p_direction || '|' || p_party_id::text || '|' || p_match_party_id::text
    || '|' || coalesce(p_same::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.answer_recurring_match(p_direction::public.txn_direction, p_party_id, p_match_party_id, p_same);
    insert into private.mcp_writes (token_id, user_id, kind, prior, created_at)
    values (
      token, auth.uid(), 'recurring_match',
      jsonb_build_object('before', written->'prior_same', 'written', to_jsonb(p_same),
        'direction', p_direction, 'party_id', p_party_id, 'match_party_id', p_match_party_id),
      clock_timestamp()
    )
    returning id into write_id;
    response := jsonb_build_object(
      'ok', true,
      'data', (written - 'prior_same') || jsonb_build_object(
        'undo_kind', 'recurring_match',
        'id', p_match_party_id,
        'write_id', write_id
      )
    );
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

revoke all on function public.mcp_answer_recurring_match(text, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.mcp_answer_recurring_match(text, text, uuid, uuid, boolean)
  to authenticated, service_role;

-- 7. The undo kind recurring_match on mcp_writes and mcp_undo.
do $undo$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'line_pace'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'recurring_match'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'line_pace'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'recurring_match'::text) AND (prior ? 'before'::text) AND (prior ? 'written'::text) AND (prior ? 'party_id'::text) AND (prior ? 'match_party_id'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$p_kind not in ('line_pace', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('recurring_match', 'line_pace', $n$);

  anchor := $a$(p_kind = 'line_pace' and w.kind = 'line_pace' and w.transaction_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo match is not the expected definition';
  end if;
  def := replace(def, anchor, $n$(p_kind = 'recurring_match' and w.kind = 'recurring_match' and w.prior->>'match_party_id' = p_id::text)
        or $n$ || anchor);

  anchor := $a$    elsif p_kind = 'line_pace' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo branches are not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'recurring_match' then
      -- FLOW-430. The pair's answer changed since the write is a conflict; else
      -- answer_recurring_match puts back the answer from before (null: no answer).
      declare
        cur jsonb;
      begin
        select coalesce(
          (select to_jsonb(m.same) from public.recurring_matches m
           where m.company_id = cid and m.direction = (rec.prior->>'direction')::public.txn_direction
             and m.party_id = (rec.prior->>'party_id')::uuid and m.match_party_id = p_id
           for update),
          'null'::jsonb
        ) into cur;
        if cur is distinct from rec.prior->'written' then
          response := private.mcp_error('conflict', 'conflict');
        else
          perform public.answer_recurring_match((rec.prior->>'direction')::public.txn_direction,
            (rec.prior->>'party_id')::uuid, p_id, (rec.prior->>'before')::boolean);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
$n$ || anchor);
  execute def;
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
