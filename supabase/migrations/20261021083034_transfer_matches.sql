-- FLOW-941 (decision 0205): a transfer between two Mercury connections is suggested, and the user
-- decides. Between two accounts of the same organisation Mercury names the other account, and the sync
-- skips the transfer (decision 0203). Between two organisations (two connections) it may name a
-- recipient instead, so the money comes in as two lines: out on one connection, in on the other. The
-- owner's rule (2026-10-21): match them, but as a suggestion the user confirms or rejects.
--
-- 1. public.transfer_matches keeps the company's answer for a pair (the money-out line and the
--    money-in line): a transfer (same true) or a coincidence (same false). RLS on, no client grant;
--    read and written only through the functions below. A line is in one confirmed pair at most.
-- 2. The suggestion is worked out on read (private.transfer_match_pairs), so the sync does nothing new
--    and the answer is the same however often it runs. Only a company with two or more chosen Mercury
--    connections is read. A pair is a posted Mercury money-out line (not a refund) and a posted
--    Mercury money-in line, each on a synced account of a different connection, the same amount and
--    currency, dated within 3 days, both still counted in the P&L (not already a transfer, a loan
--    part or kept out), neither split, a loan payment, an invoice's linked deposit or in a confirmed
--    pair, and the pair not rejected. Each line is in one suggestion at most: the closest dates
--    first, then a name hint (one side's payee names the other organisation), then the newest.
-- 3. public.list_transfer_matches(): the suggestions, with both lines (date, amount, payee, account,
--    organisation). Any member reads them.
-- 4. public.answer_transfer_match(out, in, same), owner or editor. True: both lines become a transfer,
--    as a transfer to an own account the sync does not skip is filed: the category העברות of the
--    line's kind (when the company has one), kept out of the P&L (in_pnl_override false) and out of
--    the cash view (in_cash_override false); an open review of either line is set aside (skipped, so
--    the sync does not queue it again). False: the pair is not suggested again; nothing else changes.
--    Null takes the answer back: a confirmed pair's lines get back what they had, field by field where
--    nothing changed them since, and their reviews reopen. Returns prior_same for ביטול.
-- 5. public.mcp_answer_transfer_match: the MCP's confirm_transfer_match and dismiss_transfer_match, with
--    the idempotency key, the write gate and undo kind transfer_match (id: the money-out line).
--    mcp_writes and mcp_undo are patched from their current definitions with counted anchors.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- 1. The answers.
create table public.transfer_matches (
  company_id uuid not null references public.companies (id) on delete cascade,
  out_transaction_id uuid not null,
  in_transaction_id uuid not null,
  same boolean not null,
  -- A confirmed pair: each line's fields before the write and what it wrote ({"out": …, "in": …}).
  prior jsonb not null default '{}'::jsonb,
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (company_id, out_transaction_id, in_transaction_id),
  constraint transfer_matches_two_lines check (out_transaction_id <> in_transaction_id),
  constraint transfer_matches_prior check (jsonb_typeof(prior) = 'object'),
  foreign key (company_id, out_transaction_id)
    references public.transactions (company_id, id)
    on delete cascade,
  foreign key (company_id, in_transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

create unique index transfer_matches_out_same_idx
  on public.transfer_matches (company_id, out_transaction_id) where same;
create unique index transfer_matches_in_same_idx
  on public.transfer_matches (company_id, in_transaction_id) where same;
create index transfer_matches_in_idx on public.transfer_matches (company_id, in_transaction_id);
create index transfer_matches_set_by_idx on public.transfer_matches (set_by);

comment on table public.transfer_matches is
  'FLOW-941. The company''s answer to a suggested transfer between two Mercury connections: the money-out and money-in lines are one transfer (same true: both filed as a transfer, out of the P&L and the cash view) or a coincidence (false: not suggested again). Decision 0205.';

-- Only the functions below read and write it.
alter table public.transfer_matches enable row level security;
revoke all on public.transfer_matches from public, anon, authenticated;
grant select, insert, update, delete on public.transfer_matches to service_role;

-- 2. The synced accounts of a company's chosen Mercury connections, with the connection and the names.
create function private.mercury_synced_accounts(p_company uuid)
returns table (account_id text, slot smallint, org_label text, account_name text, last4 text)
language sql
stable
set search_path = ''
as $$
  select distinct on (l.id) l.id, c.slot, c.org_label,
    coalesce(nullif(btrim(l.v->>'label'), ''), 'Mercury'),
    case when l.v->>'last4' ~ '^[0-9]{4}$' then l.v->>'last4' end
  from public.connector_connections c
  cross join lateral (
    select e.value->>'id' as id, e.value as v
    from jsonb_array_elements(
      case when jsonb_typeof(c.account_labels) = 'array' then c.account_labels else '[]'::jsonb end
    ) e
    where jsonb_typeof(e.value) = 'object' and length(coalesce(e.value->>'id', '')) between 1 and 128
  ) l
  where c.company_id = p_company
    and c.provider = 'mercury'
    and c.accounts_chosen_at is not null
    and (c.sync_account_ids is null or l.id = any (c.sync_account_ids))
  order by l.id, c.slot;
$$;

-- One side's payee names the other organisation: a word of 3 letters or more of the organisation's
-- name (not a company suffix) is one of the payee's words.
create function private.transfer_name_hint(p_party text, p_org text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_party, '') <> '' and exists (
    select 1
    from regexp_split_to_table(private.party_name_words(p_org), ' ') w
    where length(w) >= 3
      and w not in ('llc', 'inc', 'ltd', 'corp', 'the', 'and', 'company')
      and (' ' || private.party_name_words(p_party) || ' ') like ('% ' || w || ' %')
  );
$$;

-- The lines that may be one side of a transfer: posted Mercury lines on a synced account that still
-- count in the P&L, not split, not a loan payment, not an invoice's deposit, not in a confirmed pair.
create function private.transfer_match_lines(p_company uuid)
returns table (
  id uuid, direction public.txn_direction, doc_date date, currency text, amount bigint,
  slot smallint, org_label text, party text
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.direction, t.doc_date, t.currency, t.amount_original, a.slot, a.org_label,
    case when t.direction = 'expense' then s.name else cu.name end
  from public.transactions t
  join private.mercury_synced_accounts(p_company) a on a.account_id = t.provider_meta->>'account_id'
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  left join public.suppliers s on s.id = t.supplier_id and s.company_id = t.company_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  where t.company_id = p_company
    and t.source = 'mercury'
    and t.removed_at is null
    and t.line_status = 'posted'
    and t.doc_kind <> 'credit'
    and t.amount_original > 0
    and private.line_in_pnl(
      t.in_pnl_override,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part)
    and not exists (select 1 from public.loan_splits x where x.company_id = p_company and x.transaction_id = t.id)
    and not exists (select 1 from public.line_splits x where x.company_id = p_company and x.transaction_id = t.id)
    and not exists (
      select 1 from public.invoice_payment_links x where x.company_id = p_company and x.bank_transaction_id = t.id
    )
    and not exists (
      select 1 from public.transfer_matches m
      where m.company_id = p_company and m.same and t.id in (m.out_transaction_id, m.in_transaction_id)
    );
$$;

-- The suggestions: each line in one pair at most, the closest dates first, then a name hint, then the
-- newest. Nothing for a company with fewer than two chosen Mercury connections.
create function private.transfer_match_pairs(p_company uuid)
returns table (out_id uuid, in_id uuid, day_diff integer, name_hint boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  used uuid[] := '{}';
  r record;
  n integer := 0;
begin
  if (
    select count(*) from public.connector_connections c
    where c.company_id = p_company and c.provider = 'mercury' and c.accounts_chosen_at is not null
  ) < 2 then
    return;
  end if;
  for r in
    with lines as materialized (select * from private.transfer_match_lines(p_company))
    select o.id as o_id, i.id as i_id, abs(o.doc_date - i.doc_date) as dd,
      (private.transfer_name_hint(o.party, i.org_label) or private.transfer_name_hint(i.party, o.org_label)) as hint,
      greatest(o.doc_date, i.doc_date) as newest
    from lines o
    join lines i
      on o.direction = 'expense'
      and i.direction = 'income'
      and i.currency = o.currency
      and i.amount = o.amount
      and i.slot <> o.slot
      and abs(o.doc_date - i.doc_date) <= 3
    where not exists (
      select 1 from public.transfer_matches m
      where m.company_id = p_company and m.out_transaction_id = o.id and m.in_transaction_id = i.id
    )
    order by dd, hint desc, newest desc, o.id, i.id
  loop
    continue when r.o_id = any (used) or r.i_id = any (used);
    used := used || r.o_id || r.i_id;
    out_id := r.o_id;
    in_id := r.i_id;
    day_diff := r.dd;
    name_hint := r.hint;
    return next;
    n := n + 1;
    exit when n >= 100;
  end loop;
end;
$$;

-- One side of a suggestion as the list gives it.
create function private.transfer_match_line_json(p_company uuid, p_id uuid)
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
    'party', case when t.direction = 'expense' then s.name else cu.name end,
    'slot', a.slot,
    'org_label', a.org_label,
    'account_name', a.account_name,
    'account_last4', a.last4
  )
  from public.transactions t
  left join private.mercury_synced_accounts(p_company) a on a.account_id = t.provider_meta->>'account_id'
  left join public.suppliers s on s.id = t.supplier_id and s.company_id = t.company_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  where t.id = p_id and t.company_id = p_company;
$$;

revoke all on function private.mercury_synced_accounts(uuid) from public, anon, authenticated;
revoke all on function private.transfer_name_hint(text, text) from public, anon, authenticated;
revoke all on function private.transfer_match_lines(uuid) from public, anon, authenticated;
revoke all on function private.transfer_match_pairs(uuid) from public, anon, authenticated;
revoke all on function private.transfer_match_line_json(uuid, uuid) from public, anon, authenticated;

-- 3. The list (any member).
create function public.list_transfer_matches()
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
  return jsonb_build_object('matches', coalesce((
    select jsonb_agg(jsonb_build_object(
        'out', private.transfer_match_line_json(cid, p.out_id),
        'in', private.transfer_match_line_json(cid, p.in_id),
        'day_diff', p.day_diff,
        'name_hint', p.name_hint
      ) order by p.ord)
    from (
      select x.*, row_number() over () as ord from private.transfer_match_pairs(cid) x
    ) p
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.list_transfer_matches() from public, anon;
grant execute on function public.list_transfer_matches() to authenticated, service_role;
comment on function public.list_transfer_matches() is
  'FLOW-941 (decision 0205): the suggested transfers between two Mercury connections, both lines of each.';

-- 4. Confirming: one line filed as a transfer. Returns what it had and what was written.
create function private.transfer_mark_line(p_company uuid, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  line public.transactions%rowtype;
  cat uuid;
  reviews uuid[];
begin
  select * into line from public.transactions t where t.id = p_id and t.company_id = p_company;
  select c.id into cat
  from public.categories c
  where c.company_id = p_company
    and c.kind::text = line.direction::text
    and c.name = 'העברות'
    and c.loan_part is null
  order by c.hidden, c.sort_order, c.id
  limit 1;
  select coalesce(array_agg(q.id order by q.created_at), '{}') into reviews
  from public.review_queue q
  where q.company_id = p_company and q.transaction_id = p_id and q.status = 'open';
  -- Set aside, as a skip is: the fingerprint keeps the sync from queueing the line again.
  update public.review_queue q
  set status = 'skipped',
      resolved_at = now(),
      doc_fingerprint = private.doc_fingerprint(
        line.direction::text, line.doc_kind::text, line.amount_gross, line.doc_date, line.description, line.external_id)
  where q.id = any (reviews) and q.company_id = p_company;
  update public.transactions t
  set category_id = coalesce(cat, t.category_id),
      category_suggested = case when cat is null then t.category_suggested else false end,
      category_assigned = case when cat is null then t.category_assigned else true end,
      user_assigned = case when cat is null then t.user_assigned else true end,
      in_pnl_override = false,
      in_cash_override = false
  where t.id = p_id and t.company_id = p_company;
  return jsonb_build_object(
    'id', p_id,
    'set_category', cat is not null,
    'category_id', line.category_id,
    'category_suggested', line.category_suggested,
    'category_assigned', line.category_assigned,
    'user_assigned', line.user_assigned,
    'in_pnl_override', line.in_pnl_override,
    'in_cash_override', line.in_cash_override,
    'written_category_id', coalesce(cat, line.category_id),
    'reviews', to_jsonb(reviews)
  );
end;
$$;

-- Taking a confirmed pair back: each field the write changed goes back while it still holds what the
-- write put there; the reviews it set aside reopen while the line has no other open review.
create function private.transfer_restore_line(p_company uuid, p jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  txn uuid := (p->>'id')::uuid;
  cat_back boolean;
begin
  select coalesce((p->>'set_category')::boolean, false)
    and t.category_id is not distinct from (p->>'written_category_id')::uuid
    and (p->>'category_id' is null or exists (
      select 1 from public.categories c where c.id = (p->>'category_id')::uuid and c.company_id = p_company))
  into cat_back
  from public.transactions t
  where t.id = txn and t.company_id = p_company
  for update;
  if not found then
    return;
  end if;
  update public.transactions t
  set category_id = case when cat_back then (p->>'category_id')::uuid else t.category_id end,
      category_suggested = case when cat_back then coalesce((p->>'category_suggested')::boolean, false) else t.category_suggested end,
      category_assigned = case when cat_back then coalesce((p->>'category_assigned')::boolean, false) else t.category_assigned end,
      user_assigned = case when cat_back then coalesce((p->>'user_assigned')::boolean, false) else t.user_assigned end,
      in_pnl_override = case when t.in_pnl_override is false then (p->>'in_pnl_override')::boolean else t.in_pnl_override end,
      in_cash_override = case when t.in_cash_override is false then (p->>'in_cash_override')::boolean else t.in_cash_override end
  where t.id = txn and t.company_id = p_company;
  update public.review_queue q
  set status = 'open',
      resolved_at = null
  where q.company_id = p_company
    and q.transaction_id = txn
    and q.status = 'skipped'
    and q.id in (
      select e::uuid from jsonb_array_elements_text(
        case when jsonb_typeof(p->'reviews') = 'array' then p->'reviews' else '[]'::jsonb end) e
    )
    and not exists (
      select 1 from public.review_queue o
      where o.company_id = p_company and o.transaction_id = txn and o.status = 'open'
    );
end;
$$;

revoke all on function private.transfer_mark_line(uuid, uuid) from public, anon, authenticated;
revoke all on function private.transfer_restore_line(uuid, jsonb) from public, anon, authenticated;

-- The answer: true confirms, false rejects, null takes the answer back. An owner or an editor writes
-- (decision 0167). Returns the pair, the answer and prior_same for ביטול.
create function public.answer_transfer_match(p_out_transaction_id uuid, p_in_transaction_id uuid, p_same boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  o public.transactions%rowtype;
  i public.transactions%rowtype;
  cur public.transfer_matches%rowtype;
  prior_same boolean;
  out_slot smallint;
  in_slot smallint;
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
      select a.slot into out_slot from private.mercury_synced_accounts(cid) a where a.account_id = o.provider_meta->>'account_id';
      select a.slot into in_slot from private.mercury_synced_accounts(cid) a where a.account_id = i.provider_meta->>'account_id';
      if o.removed_at is not null or i.removed_at is not null
        or o.line_status <> 'posted' or i.line_status <> 'posted'
        or o.currency <> i.currency or o.amount_original <> i.amount_original
        or abs(o.doc_date - i.doc_date) > 3
        or out_slot is null or in_slot is null or out_slot = in_slot
      then
        raise exception 'not a transfer pair';
      end if;
      if exists (
        select 1 from public.transfer_matches m
        where m.company_id = cid and m.same
          and (m.out_transaction_id = o.id or m.in_transaction_id = i.id
            or m.out_transaction_id = i.id or m.in_transaction_id = o.id)
      ) then
        raise exception 'already matched';
      end if;
      if exists (select 1 from public.loan_splits x where x.company_id = cid and x.transaction_id in (o.id, i.id)) then
        raise exception 'loan line is fixed';
      end if;
      if exists (select 1 from public.line_splits x where x.company_id = cid and x.transaction_id in (o.id, i.id)) then
        raise exception 'line has a split by category';
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
$$;

revoke all on function public.answer_transfer_match(uuid, uuid, boolean) from public, anon;
grant execute on function public.answer_transfer_match(uuid, uuid, boolean) to authenticated, service_role;
comment on function public.answer_transfer_match(uuid, uuid, boolean) is
  'FLOW-941 (decision 0205): confirm (true) or reject (false) a suggested transfer between two Mercury connections; null takes the answer back. Owner or editor.';

-- 5. The MCP's answer, with the idempotency key, the write gate and undo kind transfer_match.
create function public.mcp_answer_transfer_match(
  p_idempotency_key text, p_out_transaction_id uuid, p_in_transaction_id uuid, p_same boolean
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
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_out_transaction_id is null
    or p_in_transaction_id is null
    or p_out_transaction_id = p_in_transaction_id
    or p_same is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'transfer_match|' || p_out_transaction_id::text || '|' || p_in_transaction_id::text || '|' || p_same::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.answer_transfer_match(p_out_transaction_id, p_in_transaction_id, p_same);
    insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
    values (
      token, auth.uid(), p_out_transaction_id, 'transfer_match',
      jsonb_build_object('before', written->'prior_same', 'written', to_jsonb(p_same),
        'out_transaction_id', p_out_transaction_id, 'in_transaction_id', p_in_transaction_id),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', (written - 'prior_same') || jsonb_build_object(
        'undo_kind', 'transfer_match',
        'id', p_out_transaction_id
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := case
        when sqlerrm in ('not a transfer pair', 'already matched', 'transaction not found') then private.mcp_error('refused', sqlerrm)
        else private.mcp_refused(sqlerrm)
      end;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_answer_transfer_match(text, uuid, uuid, boolean) from public, anon;
grant execute on function public.mcp_answer_transfer_match(text, uuid, uuid, boolean) to authenticated, service_role;
comment on function public.mcp_answer_transfer_match(text, uuid, uuid, boolean) is
  'FLOW-941 (decision 0205): MCP confirm_transfer_match (true) and dismiss_transfer_match (false), with undo kind transfer_match.';

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The undo log takes the kind transfer_match (transaction_id: the money-out line).
do $writes$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'bank_accounts'::text]$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'bank_accounts'::text, 'transfer_match'::text]$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or pg_temp.anchor_count(def, $a$(kind = 'bank_accounts'::text)$a$) <> 1 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'transfer_match'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'in_transaction_id'::text) AND (prior ? 'written'::text) AND (prior ? 'before'::text))))$n$;
end
$writes$;

-- mcp_undo takes transfer_match (id: the money-out line): the pair's answer changed since the write is
-- a conflict; else answer_transfer_match puts back the answer from before (null: none).
do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$p_kind not in ('recurring_match', 'bank_accounts', $a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kind list is not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('recurring_match', 'bank_accounts', 'transfer_match', $n$);

  anchor := $a$        or (p_kind = 'bank_accounts' and w.kind = 'bank_accounts' and w.prior->>'connection_id' = p_id::text)
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo bank_accounts lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor
    || $n$        or (p_kind = 'transfer_match' and w.kind = 'transfer_match' and w.transaction_id = p_id)
$n$);

  anchor := $a$    elsif p_kind = 'bank_accounts' then
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo bank_accounts branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'transfer_match' then
      -- FLOW-941. The pair's answer changed since the write is a conflict.
      declare
        cur jsonb;
      begin
        select coalesce(
          (select to_jsonb(m.same) from public.transfer_matches m
           where m.company_id = cid and m.out_transaction_id = p_id
             and m.in_transaction_id = (rec.prior->>'in_transaction_id')::uuid
           for update),
          'null'::jsonb
        ) into cur;
        if cur is distinct from rec.prior->'written' then
          response := private.mcp_error('conflict', 'conflict');
        else
          perform public.answer_transfer_match(p_id, (rec.prior->>'in_transaction_id')::uuid,
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
end;
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
