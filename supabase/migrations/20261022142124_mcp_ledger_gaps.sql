-- FLOW-950. The MCP can use the ledger end to end. Decision 0208 (amended, item 9).
--
-- FLOW-948 added the accounts/legs ledger and book_line, but an MCP client could not use it:
--   G1  no tool listed the account ids book_line needs           -> public.mcp_accounts (list_accounts)
--   G2  no tool read a line's legs back to verify a booking        -> public.mcp_line_legs (get_line_legs)
--   G3  book_line refused gross-up and contra legs                 -> legs map to split parts by sign
--   G4  book_line could only create a NEW manual line              -> optional p_transaction_id books an
--                                                                     existing posted line (a split_line write)
--   G5  bridge accounts kept the category's name/kind/excluded flag from insert time
--                                                                  -> a sync trigger on categories + resync
--   G7  the new refusal reasons join private.mcp_refused's allowlist (counted anchor).
--
-- Legs -> split parts (G3). A content leg whose sign is OPPOSITE to the bank leg counts toward the line:
-- a normal part (gross_up false). A content leg with the SAME sign as the bank leg nets against it: a
-- gross-up part (gross_up true; its effect, contra or normal, is derived from the category kind vs the
-- line direction exactly as decision 0207 says). amount_minor = abs(leg). Legs on one account and
-- project with the same sign are merged first, so the line_splits key (transaction, category, project,
-- gross_up) holds. The split is written by public.save_line_split, so every split rule (projects,
-- signed sum, one pair per kind, reversal project, loan split, open review) stays in one place. The
-- FLOW-948 self-check still compares the derived legs' projection with the requested legs, grouped
-- and summed per category and project, and refuses rather than mis-books.
--
-- P&L: no figure moves. pnl_lines and its consumers are unchanged. The categories trigger re-derives
-- the legs of the lines a category touches when its kind, excluded flag or loan part changes, so the
-- legs keep mirroring pnl_lines (whose in_pnl follows the live category).
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- G5. Bridge accounts follow their category.
-- ---------------------------------------------------------------------------
-- Copies a category's live name, kind, loan part and excluded flag onto its bridge account. When the
-- kind, the excluded flag or the loan part changed, the legs of every line that uses the category (whole,
-- by a split part or by a loan part) are re-derived, since pnl_lines routes them by the live category.
create or replace function private.legs_category_sync_tg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
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
  then
    for r in
      select t.id from public.transactions t
      where t.company_id = new.company_id and t.category_id = new.id
      union
      select s.transaction_id from public.line_splits s
      where s.company_id = new.company_id and s.category_id = new.id
      union
      select s.transaction_id from public.loan_splits s
      where s.company_id = new.company_id and s.category_id = new.id
    loop
      perform private.rebuild_legs(new.company_id, r.id);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function private.legs_category_sync_tg() from public, anon, authenticated;

create trigger legs_category_sync
  after update of name, kind, excluded_from_pnl, loan_part on public.categories
  for each row execute function private.legs_category_sync_tg();

-- One-time resync: the lines of a category whose bridge went stale on kind, excluded flag or loan part
-- get their legs re-derived, then every bridge takes its category's live values.
select private.rebuild_legs(x.company_id, x.txn)
from (
  select t.company_id, t.id as txn
  from public.transactions t
  join public.accounts a on a.company_id = t.company_id and a.category_id = t.category_id
  join public.categories c on c.id = a.category_id
  where (a.type, a.loan_part, a.excluded_from_pnl)
    is distinct from (c.kind::text, c.loan_part, coalesce(c.excluded_from_pnl, false))
  union
  select s.company_id, s.transaction_id
  from public.line_splits s
  join public.accounts a on a.company_id = s.company_id and a.category_id = s.category_id
  join public.categories c on c.id = a.category_id
  where (a.type, a.loan_part, a.excluded_from_pnl)
    is distinct from (c.kind::text, c.loan_part, coalesce(c.excluded_from_pnl, false))
  union
  select s.company_id, s.transaction_id
  from public.loan_splits s
  join public.accounts a on a.company_id = s.company_id and a.category_id = s.category_id
  join public.categories c on c.id = a.category_id
  where (a.type, a.loan_part, a.excluded_from_pnl)
    is distinct from (c.kind::text, c.loan_part, coalesce(c.excluded_from_pnl, false))
) x;

update public.accounts a
set name = c.name,
    type = c.kind::text,
    loan_part = c.loan_part,
    excluded_from_pnl = coalesce(c.excluded_from_pnl, false)
from public.categories c
where c.id = a.category_id and c.company_id = a.company_id
  and (a.name, a.type, a.loan_part, a.excluded_from_pnl)
    is distinct from (c.name, c.kind::text, c.loan_part, coalesce(c.excluded_from_pnl, false));

-- ---------------------------------------------------------------------------
-- G1. list_accounts: the company's chart of accounts (any member).
-- ---------------------------------------------------------------------------
-- A bridge account reads its category's LIVE name, kind and excluded flag. bookable is what book_line
-- takes today: the bank account, or an in-P&L category account.
create or replace function public.mcp_accounts()
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
    select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', coalesce(c.name, a.name),
        'type', coalesce(c.kind::text, a.type),
        'category_id', a.category_id,
        'system', a.category_id is null,
        'is_bank', a.is_bank,
        'excluded_from_pnl', case when c.id is null then a.excluded_from_pnl else coalesce(c.excluded_from_pnl, false) end,
        'loan_part', coalesce(c.loan_part, a.loan_part),
        'hidden', coalesce(c.hidden, false),
        'bookable', a.is_bank or (c.id is not null and not coalesce(c.excluded_from_pnl, false))
      ) order by a.category_id is not null, a.is_bank desc, coalesce(c.kind::text, a.type),
        lower(coalesce(c.name, a.name)), a.id)
    from public.accounts a
    left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
    where a.company_id = cid
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.mcp_accounts() from public, anon, authenticated, service_role;
grant execute on function public.mcp_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- G2. get_line_legs: one line's legs, to verify a booking (any member).
-- ---------------------------------------------------------------------------
-- Null for an unknown, removed or another company's line (the tool says not_found). balanced is the
-- legs' sum = 0 (a pending line has no legs: balanced, with legs []).
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
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'ordinal', l.ordinal,
          'account_id', l.account_id,
          'account_name', coalesce(c.name, a.name),
          'account_type', coalesce(c.kind::text, a.type),
          'category_id', a.category_id,
          'is_bank', a.is_bank,
          'project_id', l.project_id,
          'amount_minor', l.amount_minor
        ) order by l.ordinal)
      from public.legs l
      join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
      left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
      where l.company_id = cid and l.transaction_id = t.id
    ), '[]'::jsonb),
    'balanced', coalesce((
      select sum(l.amount_minor) = 0 from public.legs l
      where l.company_id = cid and l.transaction_id = t.id
    ), true)
  );
end;
$$;

revoke all on function public.mcp_line_legs(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_line_legs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- G3/G4/G6. book_line: gross-up and contra legs, and an existing line.
-- ---------------------------------------------------------------------------
-- The signature gains p_transaction_id, so the old one is dropped (its grants go with it).
drop function public.mcp_book_line(text, date, text, text, text, jsonb, uuid);

-- Without p_transaction_id: a NEW manual line, as in FLOW-948 (doc_date, currency and description
-- required). With it: the caller's EXISTING posted line, booked as split_line would (doc_date, currency
-- and description must then be null: the line keeps its own). Content legs may be in-P&L category
-- accounts of either kind; a leg's sign against the bank leg makes it a normal or a gross-up part.
create or replace function public.mcp_book_line(
  p_idempotency_key text,
  p_doc_date date,
  p_direction text,
  p_currency text,
  p_description text,
  p_legs jsonb,
  p_project_id uuid default null,
  p_transaction_id uuid default null
)
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
  line public.transactions%rowtype;
  bank_legs integer;
  bank_amt bigint;
  content integer;
  leg jsonb;
  acct public.accounts%rowtype;
  cat public.categories%rowtype;
  amt bigint;
  parts jsonb;
  part_count integer;
  one_part jsonb;
  default_project uuid;
  want jsonb;
  got jsonb;
  before_parts jsonb;
  written jsonb;
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
      if exists (select 1 from public.loan_splits s where s.transaction_id = line.id) then
        raise exception 'line has a loan split';
      end if;
      if exists (
        select 1 from public.review_queue q
        where q.transaction_id = line.id and q.company_id = cid and q.status = 'open'
          and q.reason is distinct from 'split_mismatch'
      ) then
        raise exception 'line has an open review';
      end if;
    end if;
    if p_project_id is not null
      and not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid)
    then
      raise exception 'project not found';
    end if;

    -- Validate every leg: shape, company ownership, project ownership, and the live category.
    bank_legs := 0;
    bank_amt := 0;
    content := 0;
    for leg in select value from jsonb_array_elements(p_legs)
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
      if acct.is_bank then
        bank_legs := bank_legs + 1;
        bank_amt := (leg->>'amount_minor')::bigint;
      else
        -- A content leg is an in-P&L category account of either kind, read from the live category
        -- (the bridge row's copy is never trusted). System, kept-out and VAT accounts are a later phase.
        cat := null;
        if acct.category_id is not null then
          select * into cat from public.categories c
          where c.id = acct.category_id and c.company_id = cid;
        end if;
        if cat.id is null or coalesce(cat.excluded_from_pnl, false) then
          raise exception 'book_line: unsupported account for a phase-1 booking';
        end if;
        if (leg->>'amount_minor')::bigint = 0 then
          raise exception 'validation';
        end if;
        content := content + 1;
      end if;
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

    -- The parts: one per (category, effective project, side). A leg opposite to the bank leg is a
    -- normal part; one with the bank leg's sign a gross-up part. Same account, project and sign merge.
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
      select a.category_id,
        coalesce(nullif(e.value->>'project_id', '')::uuid, p_project_id) as project_id,
        sign((e.value->>'amount_minor')::bigint) = sign(bank_amt) as gross_up,
        sum(abs((e.value->>'amount_minor')::bigint)) as amount_minor,
        min(e.ord) as first_at
      from jsonb_array_elements(p_legs) with ordinality as e(value, ord)
      join public.accounts a on a.id = (e.value->>'account_id')::uuid and a.company_id = cid
      where not a.is_bank
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
      -- The legacy rows: a posted line whose net is the bank movement (phase 1 is VAT-free).
      insert into public.transactions (
        company_id, direction, doc_kind, pnl_role, line_status, currency,
        amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date,
        source, idempotency_key, project_id, category_id, description, user_assigned
      )
      values (
        cid, p_direction::public.txn_direction, 'receipt', 'project', 'posted', p_currency,
        bank_amt, bank_amt, abs(bank_amt), 0, 'source', p_doc_date, p_doc_date,
        'manual', 'book:' || gen_random_uuid()::text,
        case when part_count = 1 then (one_part->>'project_id')::uuid else p_project_id end,
        case when part_count = 1 then (one_part->>'category_id')::uuid else null end,
        btrim(p_description), true
      )
      returning id into rid;
      -- More than one part: the split, through save_line_split and its rules.
      if part_count > 1 then
        perform public.save_line_split(rid, parts);
      end if;
    else
      if part_count = 1 then
        raise exception 'book_line: one category leg on an existing line — use assign_expense';
      end if;
      rid := line.id;
      -- Exactly as mcp_split_line: the parts before (with percent, rest and gross_up), then the save.
      before_parts := private.line_split_parts_full(rid);
      written := public.save_line_split(rid, parts);
    end if;

    -- Self-check: the derived legs must project to the requested content legs, grouped and summed per
    -- category and effective project the way private.legs_pnl_projection groups them. Otherwise refuse
    -- (the whole write rolls back) rather than mis-book.
    want := coalesce((
      select jsonb_agg(jsonb_build_object('c', g.c, 'p', g.p, 'n', g.n) order by g.c::text, coalesce(g.p::text, ''))
      from (
        select a.category_id as c,
          coalesce(nullif(e.value->>'project_id', '')::uuid, p_project_id, default_project) as p,
          sum(-(e.value->>'amount_minor')::bigint)::bigint as n
        from jsonb_array_elements(p_legs) e
        join public.accounts a on a.id = (e.value->>'account_id')::uuid and a.company_id = cid
        where not a.is_bank
        group by 1, 2
      ) g
    ), '[]'::jsonb);
    got := coalesce((
      select jsonb_agg(jsonb_build_object('c', g.c, 'p', g.p, 'n', g.n) order by g.c::text, coalesce(g.p::text, ''))
      from (
        select pr.category_id as c, pr.project_id as p, sum(pr.amount_net)::bigint as n
        from private.legs_pnl_projection(cid) pr
        where pr.transaction_id = rid
        group by 1, 2
      ) g
    ), '[]'::jsonb);
    if want is distinct from got then
      raise exception 'book_line: could not represent the legs in the ledger';
    end if;

    if p_transaction_id is null then
      insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
      values (token, auth.uid(), cid, 'book_line', rid, jsonb_build_object('after', jsonb_build_object(
        'amount_gross', bank_amt, 'doc_date', p_doc_date,
        'legs', (select md5(coalesce(string_agg(l.account_id::text || ':' || coalesce(l.project_id::text,'') || ':' || l.amount_minor::text, '|' order by l.ordinal), ''))
                 from public.legs l where l.transaction_id = rid and l.company_id = cid)
      )));
      response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'id', rid, 'direction', p_direction, 'undo_kind', 'book_line'));
    else
      -- The split_line write record, so undo kind line_split restores the parts before.
      insert into private.mcp_writes (token_id, user_id, company_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), cid, rid, 'line_split',
        jsonb_build_object(
          'before', before_parts,
          'written', written,
          'user_assigned', coalesce(line.user_assigned, false),
          'category_suggested', coalesce(line.category_suggested, false)
        ),
        clock_timestamp()
      )
      returning id into write_id;
      response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'id', rid, 'transaction_id', rid, 'direction', p_direction, 'parts', written,
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

revoke all on function public.mcp_book_line(text, date, text, text, text, jsonb, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_book_line(text, date, text, text, text, jsonb, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- G7. The new refusal reasons are safe to surface; 'account not found' and 'transaction not found'
-- stay as they are (no existence leak). Counted anchor on FLOW-948's last book_line hint.
-- ---------------------------------------------------------------------------
do $r$
declare
  def text;
  anchor constant text := $a$        'book_line: could not represent the legs in the ledger',$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if def is null or position('book_line: the line is not posted' in def) > 0
    or (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1
  then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $a$
        -- FLOW-950 (decision 0208, item 9): booking an existing line.
        'book_line: the line is not posted',
        'book_line: direction does not match the line',
        'book_line: the bank leg must equal the line amount',
        'book_line: a line with VAT is a later phase',
        'book_line: one category leg on an existing line — use assign_expense',$a$);
  execute def;
end
$r$;

commit;
