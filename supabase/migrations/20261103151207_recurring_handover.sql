-- FLOW-1037 (decision 0255): a recurring charge that moves to another payee. A loan moved to a new
-- servicer: the old servicer's monthly charge stayed in the month forecast while the new servicer's
-- payment for the same project, at the same amount, was already in this month's cash, so the month
-- end counted it twice. FLOW-430's rename suggestion (decision 0179) missed it: the names share no
-- word, and the new servicer already paid other charges. The owner chose: hide and ask.
-- - private.recurring_handover: a charge due this month with no line yet (one party, direction,
--   currency and project, decision 0185) has a likely handover when a posted line this month, up to
--   today, from another party has the same direction and currency, the charge's project (a charge
--   with no project never has one), an amount within 2% of the usual one, and that party had no
--   posted line on the project before this month. The nearest amount wins, then the latest line. A
--   party the company already answered for this charge is not offered again.
-- - public.recurring_handovers keeps the answers, per charge and party, and, for a yes, the two
--   per-charge "recurring" overrides as they were before it.
-- - expected_months: each recurring[] item carries handover (null, or the line that came under the
--   other payee) while unanswered, and the open month's cells leave such a charge out; the forecast
--   builder leaves it out of the items and totals. missing_bills leaves it out: it is not late.
-- - answer_recurring_handover (owner or editor): yes writes the old charge "not recurring" and the new
--   party's charge on the project "recurring" (decision 0188's per-charge overrides); no keeps the old
--   charge and stops the pair's suggestion; null takes the answer back and puts both overrides back.
--   It returns what it replaced. mcp_answer_recurring_handover adds the idempotency key, the write gate
--   and the undo kind recurring_handover (id: the write).

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- 1. The answers. party_id is the recurring charge's supplier (expense) or customer (income) on
-- project_id; to_party_id is the party whose line came instead. same: the charge moved to it (yes) or
-- not (no). from_prior and to_prior keep, for a yes, the two charges' "recurring" overrides before it
-- (null: none), so taking the answer back puts them back.
create table public.recurring_handovers (
  company_id uuid not null references public.companies (id) on delete cascade,
  direction public.txn_direction not null,
  party_id uuid not null,
  currency text not null,
  project_id uuid not null,
  to_party_id uuid not null,
  same boolean not null,
  from_prior boolean,
  to_prior boolean,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (company_id, direction, party_id, currency, project_id, to_party_id),
  constraint recurring_handovers_two_parties check (party_id <> to_party_id),
  constraint recurring_handovers_project_fkey foreign key (company_id, project_id)
    references public.projects (company_id, id) on delete cascade
);

create index recurring_handovers_project_idx on public.recurring_handovers (company_id, project_id);
create index recurring_handovers_set_by_idx on public.recurring_handovers (set_by);

comment on table public.recurring_handovers is
  'FLOW-1037. The company''s answer to a likely handover of a recurring charge (party, direction, currency, project) to another party: moved (same) or not. A yes keeps the two charges'' recurring overrides from before it. Decision 0255.';

-- Only the functions below read and write it.
alter table public.recurring_handovers enable row level security;
revoke all on public.recurring_handovers from public, anon, authenticated;

-- 2. The likely handover of one charge, or null.
create function private.recurring_handover(p_company uuid, p_direction public.txn_direction, p_party uuid,
  p_currency text, p_project uuid, p_typical bigint, p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select date_trunc('month', p_today)::date as this_month),
  lines as (
    select t.id, t.doc_date, t.created_at, t.amount_net::bigint as amount_net,
      case when p_direction = 'expense' then t.supplier_id else t.customer_id end as party_id
    from public.transactions t, b
    where p_project is not null
      and p_typical <> 0
      and t.company_id = p_company
      and t.direction = p_direction
      and t.currency = p_currency
      and t.project_id = p_project
      and t.removed_at is null
      and t.line_status = 'posted'
      and (p_direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= b.this_month
      and t.doc_date <= p_today
      -- Within 2% of the usual amount, either way.
      and abs(abs(t.amount_net::bigint) - abs(p_typical)) * 50 <= abs(p_typical)
  )
  select jsonb_build_object(
      'party_id', l.party_id,
      'party_name', coalesce(s.name, cu.name),
      'transaction_id', l.id,
      'doc_date', l.doc_date,
      'amount_minor', l.amount_net
    )
  from lines l
  cross join b
  left join public.suppliers s on p_direction = 'expense' and s.company_id = p_company and s.id = l.party_id
  left join public.customers cu on p_direction = 'income' and cu.company_id = p_company and cu.id = l.party_id
  where l.party_id is not null
    and l.party_id <> p_party
    and coalesce(s.id, cu.id) is not null
    -- New on the project: no posted line of that party on it before this month.
    and not exists (
      select 1 from public.transactions o
      where o.company_id = p_company and o.removed_at is null and o.line_status = 'posted'
        and o.direction = p_direction and o.project_id = p_project
        and l.party_id = case when p_direction = 'expense' then o.supplier_id else o.customer_id end
        and o.doc_date < b.this_month
    )
    -- Answered for this charge already (yes or no): not offered again.
    and not exists (
      select 1 from public.recurring_handovers h
      where h.company_id = p_company and h.direction = p_direction and h.party_id = p_party
        and h.currency = p_currency and h.project_id = p_project and h.to_party_id = l.party_id
    )
  order by abs(abs(l.amount_net) - abs(p_typical)), l.doc_date desc, l.created_at desc, l.id
  limit 1;
$$;

revoke all on function private.recurring_handover(uuid, public.txn_direction, uuid, text, uuid, bigint, date)
  from public, anon, authenticated;

-- 3. expected_months: each charge's handover, and the open month's cells leave a handed-over charge
-- out. The body is 20261021120613's otherwise.
CREATE OR REPLACE FUNCTION public.expected_months(p_months integer DEFAULT 3, p_project_id uuid DEFAULT NULL::uuid, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception 'validation';
  end if;
  return (
    with r as (
      select rp.*,
        -- FLOW-1037: due this month with no line yet, and another party's line on its project came instead.
        case when not rp.seen_this_month and rp.project_id is not null
            and rp.next_due_month <= date_trunc('month', today)::date
          then private.recurring_handover(cid, rp.direction, rp.party_id, rp.currency, rp.project_id,
            rp.typical_amount_minor, today)
        end as handover
      from private.recurring_parties(cid, today) rp
      where p_project_id is null or rp.project_id = p_project_id
    ),
    months as (
      select n, (date_trunc('month', today) + make_interval(months => n))::date as month
      from generate_series(0, p_months - 1) n
    ),
    cells as (
      select m.month, r.currency, r.direction, r.typical_amount_minor as amount
      from months m
      join r on m.month >= greatest(r.next_due_month, date_trunc('month', today)::date)
        and private.month_diff(m.month, greatest(r.next_due_month, date_trunc('month', today)::date))
          % private.pace_months(r.pace) = 0
        -- A charge with a handover is not expected this month: its payment came under the other party.
        and not (m.month = date_trunc('month', today)::date and r.handover is not null)
    ),
    per_month as (
      select m.month,
        coalesce((
          select jsonb_agg(jsonb_build_object(
              'currency', c.currency,
              'income_minor', c.income,
              'expense_minor', c.expense
            ) order by c.currency <> 'ILS', c.currency)
          from (
            select cl.currency,
              coalesce(sum(cl.amount) filter (where cl.direction = 'income'), 0)::bigint as income,
              coalesce(sum(cl.amount) filter (where cl.direction = 'expense'), 0)::bigint as expense
            from cells cl where cl.month = m.month
            group by cl.currency
          ) c
        ), '[]'::jsonb) as by_currency
      from months m
    )
    select jsonb_build_object(
      'today', today,
      'project_id', p_project_id,
      'months', (select jsonb_agg(jsonb_build_object(
          'month', to_char(pm.month, 'YYYY-MM'),
          'open', pm.month = date_trunc('month', today)::date,
          'by_currency', pm.by_currency
        ) order by pm.month) from per_month pm),
      'recurring', coalesce((select jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'party_id', r.party_id,
          'name', coalesce(s.name, cu.name),
          'currency', r.currency,
          'typical_amount_minor', r.typical_amount_minor,
          'typical_day', r.typical_day,
          'months_seen', r.months_seen,
          'seen_this_month', r.seen_this_month,
          'project_id', r.project_id,
          'category_id', r.category_id,
          'source', r.source,
          'pace', r.pace,
          'next_due_month', to_char(r.next_due_month, 'YYYY-MM'),
          -- Any of the charge's stream lines is split into loan parts (recurring_parties says).
          'pays_loan', r.pays_loan,
          'handover', r.handover
        ) order by r.direction, coalesce(s.name, cu.name), r.party_id)
        from r
        left join public.suppliers s on r.direction = 'expense' and s.company_id = cid and s.id = r.party_id
        left join public.customers cu on r.direction = 'income' and cu.company_id = cid and cu.id = r.party_id
      ), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.expected_months(integer, uuid, date) from public, anon;
grant execute on function public.expected_months(integer, uuid, date) to authenticated, service_role;

-- 4. missing_bills leaves out a charge with an unanswered handover: it is not late, it came under
-- another party. The body is 20261018111500's otherwise.
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
        -- A party with one charge keeps the key it always had; a party split by project adds its project.
        r.direction || ':' || r.party_id || ':' || r.currency || ':' || to_char(r.next_due_month, 'YYYY-MM')
          || case when r.charges > 1 then ':' || coalesce(r.project_id::text, 'none') else '' end as alert_key
      from (
        select rp.*, count(*) over (partition by rp.direction, rp.party_id, rp.currency) as charges
        from private.recurring_parties(cid, today) rp
      ) r
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
      ) order by d.direction = 'income', d.typical_day, coalesce(s.name, cu.name), p.name, d.party_id), '[]'::jsonb)
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
      -- FLOW-1037: a charge whose payment came this month under another party is not late.
      and (d.seen_this_month or d.project_id is null
        or private.recurring_handover(cid, d.direction, d.party_id, d.currency, d.project_id,
          d.typical_amount_minor, today) is null)
  );
end;
$$;

-- 5. The answer, per charge and party: yes ends the old charge and makes the new party's charge on the
-- project recurring; no keeps the old charge and stops the suggestion; null takes the answer back. An
-- owner or an editor writes (decision 0167). Returns the answer, prior_same, and the two charges'
-- "recurring" overrides before this call (prior_from_recurring, prior_to_recurring) for ביטול.
create function public.answer_recurring_handover(
  p_direction text, p_party_id uuid, p_currency text, p_project_id uuid, p_to_party_id uuid, p_same boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  dir public.txn_direction;
  held public.recurring_handovers%rowtype;
  found_held boolean;
  cur_from boolean;
  cur_to boolean;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_direction is null or p_direction not in ('expense', 'income')
    or p_party_id is null or p_to_party_id is null or p_project_id is null
    or p_party_id = p_to_party_id
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
  then
    raise exception 'validation';
  end if;
  dir := p_direction::public.txn_direction;
  if (select count(*) from (
        select s.id from public.suppliers s
        where dir = 'expense' and s.company_id = cid and s.id in (p_party_id, p_to_party_id)
        union all
        select cu.id from public.customers cu
        where dir = 'income' and cu.company_id = cid and cu.id in (p_party_id, p_to_party_id)
      ) x) <> 2 then
    raise exception 'party not found';
  end if;
  if not exists (select 1 from public.projects p where p.company_id = cid and p.id = p_project_id) then
    raise exception 'project not found';
  end if;

  select * into held
  from public.recurring_handovers h
  where h.company_id = cid and h.direction = dir and h.party_id = p_party_id and h.currency = p_currency
    and h.project_id = p_project_id and h.to_party_id = p_to_party_id
  for update;
  found_held := found;

  select o.recurring into cur_from
  from public.recurring_overrides o
  where o.company_id = cid and o.direction = dir and o.party_id = p_party_id and o.currency = p_currency
    and o.project_id = p_project_id;
  select o.recurring into cur_to
  from public.recurring_overrides o
  where o.company_id = cid and o.direction = dir and o.party_id = p_to_party_id and o.currency = p_currency
    and o.project_id = p_project_id;

  -- A yes taken back (or turned into a no) puts both charges' overrides back as they were before it.
  if found_held and held.same and p_same is not true then
    perform private.write_recurring_override(cid, dir, p_party_id, p_currency, p_project_id,
      'recurring', to_jsonb(held.from_prior));
    perform private.write_recurring_override(cid, dir, p_to_party_id, p_currency, p_project_id,
      'recurring', to_jsonb(held.to_prior));
  end if;

  if p_same is null then
    delete from public.recurring_handovers h
    where h.company_id = cid and h.direction = dir and h.party_id = p_party_id and h.currency = p_currency
      and h.project_id = p_project_id and h.to_party_id = p_to_party_id;
  else
    if p_same then
      perform private.write_recurring_override(cid, dir, p_party_id, p_currency, p_project_id,
        'recurring', 'false'::jsonb);
      perform private.write_recurring_override(cid, dir, p_to_party_id, p_currency, p_project_id,
        'recurring', 'true'::jsonb);
    end if;
    insert into public.recurring_handovers as h
      (company_id, direction, party_id, currency, project_id, to_party_id, same, from_prior, to_prior, set_by, set_at)
    values (cid, dir, p_party_id, p_currency, p_project_id, p_to_party_id, p_same,
      case when p_same then cur_from end, case when p_same then cur_to end, auth.uid(), now())
    on conflict (company_id, direction, party_id, currency, project_id, to_party_id)
    do update set
      same = excluded.same,
      -- A repeated yes keeps the overrides from before the first one.
      from_prior = case when h.same and excluded.same then h.from_prior else excluded.from_prior end,
      to_prior = case when h.same and excluded.same then h.to_prior else excluded.to_prior end,
      set_by = excluded.set_by, set_at = excluded.set_at;
  end if;

  return jsonb_build_object(
    'direction', dir,
    'party_id', p_party_id,
    'currency', p_currency,
    'project_id', p_project_id,
    'to_party_id', p_to_party_id,
    'same', p_same,
    'prior_same', case when found_held then held.same end,
    'prior_from_recurring', cur_from,
    'prior_to_recurring', cur_to
  );
end;
$$;

revoke all on function public.answer_recurring_handover(text, uuid, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.answer_recurring_handover(text, uuid, text, uuid, uuid, boolean)
  to authenticated, service_role;

-- 6. The MCP's answer: answer_recurring_handover with the idempotency key, the write gate and an undo
-- (kind recurring_handover, id: the write).
create function public.mcp_answer_recurring_handover(
  p_idempotency_key text, p_direction text, p_party_id uuid, p_currency text, p_project_id uuid,
  p_to_party_id uuid, p_same boolean
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
    or p_party_id is null or p_to_party_id is null or p_project_id is null
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'recurring_handover|' || p_direction || '|' || p_party_id::text || '|' || p_currency
    || '|' || p_project_id::text || '|' || p_to_party_id::text || '|' || coalesce(p_same::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.answer_recurring_handover(p_direction, p_party_id, p_currency, p_project_id,
      p_to_party_id, p_same);
    insert into private.mcp_writes (token_id, user_id, kind, project_id, prior, created_at)
    values (
      token, auth.uid(), 'recurring_handover', p_project_id,
      jsonb_build_object('before', written->'prior_same', 'written', to_jsonb(p_same),
        'direction', p_direction, 'party_id', p_party_id, 'currency', p_currency,
        'project_id', p_project_id, 'to_party_id', p_to_party_id,
        'prior_from_recurring', written->'prior_from_recurring',
        'prior_to_recurring', written->'prior_to_recurring'),
      clock_timestamp()
    )
    returning id into write_id;
    response := jsonb_build_object(
      'ok', true,
      'data', (written - 'prior_same' - 'prior_from_recurring' - 'prior_to_recurring') || jsonb_build_object(
        'undo_kind', 'recurring_handover',
        'id', write_id,
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

revoke all on function public.mcp_answer_recurring_handover(text, text, uuid, text, uuid, uuid, boolean)
  from public, anon, service_role;
grant execute on function public.mcp_answer_recurring_handover(text, text, uuid, text, uuid, uuid, boolean)
  to authenticated;

-- 7. The undo kind recurring_handover on mcp_writes and mcp_undo: the answer from before goes back
-- (answer_recurring_handover, with the overrides), unless the pair's answer changed since.
do $undo$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'recurring_match'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'recurring_handover'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'recurring_handover'::text) AND (prior ? 'before'::text) AND (prior ? 'written'::text) AND (prior ? 'direction'::text) AND (prior ? 'party_id'::text) AND (prior ? 'currency'::text) AND (prior ? 'project_id'::text) AND (prior ? 'to_party_id'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'supplier_category', 'recurring_match', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$'recurring_handover', $n$);

  anchor := $a$        or (p_kind = 'recurring_match' and w.kind = 'recurring_match' and w.prior->>'match_party_id' = p_id::text)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'recurring_handover' and w.kind = 'recurring_handover' and w.id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'line_pace' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo branches are not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'recurring_handover' then
      -- FLOW-1037 (decision 0255). The pair's answer changed since the write is a conflict; else
      -- answer_recurring_handover puts back the answer from before (null: no answer) and, with it,
      -- both charges' recurring overrides.
      declare
        cur jsonb;
      begin
        select coalesce(
          (select to_jsonb(h.same) from public.recurring_handovers h
           where h.company_id = cid and h.direction = (rec.prior->>'direction')::public.txn_direction
             and h.party_id = (rec.prior->>'party_id')::uuid and h.currency = rec.prior->>'currency'
             and h.project_id = (rec.prior->>'project_id')::uuid
             and h.to_party_id = (rec.prior->>'to_party_id')::uuid
           for update),
          'null'::jsonb
        ) into cur;
        if cur is distinct from rec.prior->'written' then
          response := private.mcp_error('conflict', 'conflict');
        else
          perform public.answer_recurring_handover(rec.prior->>'direction', (rec.prior->>'party_id')::uuid,
            rec.prior->>'currency', (rec.prior->>'project_id')::uuid, (rec.prior->>'to_party_id')::uuid,
            (rec.prior->>'before')::boolean);
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
