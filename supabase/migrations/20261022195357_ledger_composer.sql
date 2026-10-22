-- FLOW-955. The journal entry composer and the review of Jev's bookings (UI PR B). Decision 0208.
--
-- The owner approved the composer and the review card on 2026-10-22 (the board's LedgerComposer,
-- LedgerComposerTemplates and LedgerReviewCard frames). No P&L figure moves: private.pnl_lines, the
-- posting rules and every consumer are untouched; a booking still writes the legacy rows through
-- save_line_split exactly as MCP book_line does.
--
--   1. private.book_line_core: the body of public.mcp_book_line (validation of the legs, the parts,
--      save_line_split, the self-check), moved out so the app can book through the same rules.
--      mcp_book_line keeps its signature, its idempotency, its write record and every response and
--      refusal: it now calls the core.
--   2. public.save_line_journal(p_transaction_id, p_legs): the app's booking of an EXISTING line under
--      the user's own auth (owner or editor), through the core. It returns the split before and after,
--      so the app's ביטול saves the parts before back (as the split editor does).
--   3. private.line_journal: the body of get_line_journal, shared with the new reads (same output).
--   4. private.journal_entry_legs / private.scale_entry: a booked line's non-bank legs on the accounts
--      book_line takes (a category leg on its category's own account), and those legs scaled to
--      another bank amount: each rounded to the cent, the remainder on the largest leg, so the entry
--      balances exactly.
--   5. public.get_line_journal_suggestion(p_transaction_id): "✦ הצעה של Jev" — the most common entry
--      shape among the same party's recent booked lines with a split, scaled to this line, with how
--      many lines it rests on (basis_count) and the party's name; null when there is none.
--      public.get_line_journal_copies(p_transaction_id): "כמו תנועה קודמת" — the party's last 10 such
--      lines, each with its legs as booked and scaled to this line.
--   6. Jev's bookings to review (לאישור): an MCP book_line or line_split write that still stands (the
--      line is as the write left it), not undone and not reviewed. private.mcp_writes gains
--      reviewed_at / reviewed_by; the writes made before this migration count as reviewed, so the
--      queue starts empty. public.list_jev_bookings lists them with their entry;
--      public.approve_jev_booking marks one reviewed; public.undo_jev_booking takes it back through
--      the same undo as MCP undo (the line_split and book_line branches of mcp_undo move to
--      private.undo_line_split_write / private.undo_book_line_write, patched with counted anchors).
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. book_line's core, shared by MCP book_line and the app.
-- ---------------------------------------------------------------------------
-- Everything mcp_book_line did between its idempotency check and its write record, unchanged. It
-- raises the same messages; the caller maps them. It returns the line it booked, the bank amount,
-- and, for an existing line, the parts before and after and the line's flags before the save.
create or replace function private.book_line_core(
  p_company uuid,
  p_direction text,
  p_doc_date date,
  p_currency text,
  p_description text,
  p_legs jsonb,
  p_project_id uuid,
  p_transaction_id uuid
)
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
  mirror uuid;
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
  -- posts to and the category it is mirrored to (null for the bank leg).
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
    if acct.category_id is not null then
      -- A category account, read from the live category (the bridge row's copy is never trusted):
      -- in the P&L it posts to itself; kept out, to the category's balance-sheet account.
      select * into cat from public.categories c
      where c.id = acct.category_id and c.company_id = cid;
      if not found then
        raise exception 'account not found';
      end if;
      mirror := cat.id;
      post_to := case when coalesce(cat.excluded_from_pnl, false)
                   then private.kept_out_account(cid, cat.id, cat.loan_part) else acct.id end;
    elsif acct.name = 'VAT control' then
      raise exception 'book_line: a VAT leg is a later phase';
    elsif acct.type in ('asset', 'liability') and acct.name <> 'Suspense' then
      -- A balance-sheet system account: mirrored to the kept-out category of the leg's side there.
      mirror := private.ledger_mirror_category(cid, acct.id, amt > 0);
      post_to := acct.id;
    else
      raise exception 'book_line: unsupported account — use a category account or a balance-sheet account';
    end if;
    content := content + 1;
    resolved := resolved || jsonb_build_object(
      'ord', ord, 'acct', post_to, 'cat', mirror,
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
    -- The legacy rows: a posted line whose net is the bank movement (VAT-free).
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

  -- Self-check: the item legs the posting rules derived must equal the request, per account (the one
  -- each leg posts to), effective project and sign. Otherwise refuse (the whole write rolls back)
  -- rather than mis-book.
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
      where l.company_id = cid and l.transaction_id = rid and l.leg_kind = 'item'
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

revoke all on function private.book_line_core(uuid, text, date, text, text, jsonb, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Same signature, grants kept. Validation, the gate, idempotency, the write record and the responses
-- are as before; the booking itself is the core.
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
      values (token, auth.uid(), cid, 'book_line', rid, jsonb_build_object('after', jsonb_build_object(
        'amount_gross', (core->>'bank_amt')::bigint, 'doc_date', p_doc_date,
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
-- 2. The app's booking of an existing line.
-- ---------------------------------------------------------------------------
-- An owner or editor books their own posted line from legs, through the same core and refusals as
-- MCP book_line (the raised messages reach the app as they are). The line is found first, so another
-- company's id is refused as not found before anything else is read. The result names the parts
-- before, so the app's ביטול can save them back through save_line_split.
create or replace function public.save_line_journal(p_transaction_id uuid, p_legs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  dir text;
  core jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select t.direction::text into dir from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null;
  if not found then
    raise exception 'transaction not found';
  end if;
  if p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 2
    or jsonb_array_length(p_legs) > 50 then
    raise exception 'validation';
  end if;
  core := private.book_line_core(cid, dir, null, null, null, p_legs, null, p_transaction_id);
  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'before', core->'before',
    'parts', core->'written'
  );
end;
$$;

revoke all on function public.save_line_journal(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_line_journal(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. One line's journal, shared by get_line_journal and the new reads.
-- ---------------------------------------------------------------------------
-- p_company is trusted: only definers below call it, each with the caller's own company.
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
      where l.company_id = p_company and l.transaction_id = t.id
    ), '[]'::jsonb),
    'balanced', coalesce((
      select sum(l.amount_minor) = 0 from public.legs l
      where l.company_id = p_company and l.transaction_id = t.id
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

revoke all on function private.line_journal(uuid, uuid) from public, anon, authenticated, service_role;

-- Same output as FLOW-954's: null with no company, or for an unknown, removed or another company's line.
create or replace function public.get_line_journal(p_transaction_id uuid)
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
    return null;
  end if;
  return private.line_journal(cid, p_transaction_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A booked line's entry on the accounts book_line takes, and the entry scaled.
-- ---------------------------------------------------------------------------
-- The non-bank legs of one line, in ledger order: a leg with a category is booked on that category's
-- own account (a kept-out category's account posts to its balance-sheet account, as the leg did);
-- a hidden ledger category's leg and any other leg on its own account (the picker never lists a hidden
-- category). Signed: a debit is positive.
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
  where l.company_id = p_company and l.transaction_id = p_transaction_id and not a.is_bank;
$$;

revoke all on function private.journal_entry_legs(uuid, uuid) from public, anon, authenticated, service_role;

-- p_legs (non-bank, signed) balanced a bank movement of p_from; the same entry for p_to. Each leg is
-- scaled and rounded to the cent (half away from zero); what rounding leaves over goes on the largest
-- leg (the first of equals), so bank + legs is exactly zero. Null when a leg would reach zero or change
-- side, or the amounts are of opposite signs.
create or replace function private.scale_entry(p_legs jsonb, p_from bigint, p_to bigint)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with s as (
    select e.ord, e.leg, (e.leg->>'amount_minor')::bigint as amount,
      case when p_from = 0 then 0
           else round((e.leg->>'amount_minor')::numeric * p_to / p_from)::bigint end as scaled
    from jsonb_array_elements(p_legs) with ordinality as e(leg, ord)
  ),
  leftover as (
    select -(p_to + sum(s.scaled))::bigint as minor from s
  ),
  big as (
    select s.ord from s order by abs(s.scaled) desc, s.ord limit 1
  ),
  res as (
    select s.ord, s.leg, s.amount,
      s.scaled + case when s.ord = (select big.ord from big) then (select leftover.minor from leftover) else 0 end as minor
    from s
  )
  select case
    when p_from = 0 or p_to = 0 or sign(p_from) <> sign(p_to) or jsonb_array_length(p_legs) = 0 then null
    when exists (select 1 from res where res.minor = 0 or sign(res.minor) <> sign(res.amount)) then null
    else (select jsonb_agg(res.leg || jsonb_build_object('amount_minor', res.minor) order by res.ord) from res)
  end;
$$;

revoke all on function private.scale_entry(jsonb, bigint, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. ✦ הצעה של Jev and כמו תנועה קודמת.
-- ---------------------------------------------------------------------------
-- The lines a composer may start from: the same party's (the supplier, else the customer) other
-- posted lines, same direction and currency, VAT-free, with at least two non-bank legs (a split: one
-- category on an existing line is an assignment, not a booking), newest first. Each with its entry on
-- book_line's accounts, scaled to p_line's bank amount. The projects stay as booked, except that an
-- entry on one project takes the line's own project when the line has one.
create or replace function private.journal_history(p_company uuid, p_line uuid, p_limit integer)
returns table (transaction_id uuid, doc_date date, amount_gross bigint, shape text, scaled jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select x.* from public.transactions x
    where x.id = p_line and x.company_id = p_company and x.removed_at is null
      and (x.supplier_id is not null or x.customer_id is not null) and x.amount_gross <> 0
  ),
  -- The party's newest 200 lines (on its (company_id, supplier_id) index) before any legs are read.
  cand as (
    select x.id, x.doc_date, x.amount_gross
    from public.transactions x, t
    where x.company_id = p_company and x.id <> t.id and x.removed_at is null
      and x.line_status = 'posted' and x.direction = t.direction
      and coalesce(x.currency, 'ILS') = coalesce(t.currency, 'ILS')
      and coalesce(x.vat_amount, 0) = 0 and x.amount_gross <> 0
      and case when t.supplier_id is not null then x.supplier_id = t.supplier_id
               else x.supplier_id is null and x.customer_id = t.customer_id end
    order by x.doc_date desc, x.id
    limit 200
  ),
  h as (
    select c.id, c.doc_date, c.amount_gross, private.journal_entry_legs(p_company, c.id) as legs
    from cand c
  ),
  booked as (
    select h.*,
      (select string_agg(z.k, ',' order by z.k)
       from (select e->>'account_id' || case when (e->>'amount_minor')::bigint > 0 then '+' else '-' end as k
             from jsonb_array_elements(h.legs) e) z) as shape,
      (select count(distinct e->>'project_id') from jsonb_array_elements(h.legs) e where e->>'project_id' is not null) as projects
    from h
    where jsonb_array_length(h.legs) >= 2
      and (select sum((e->>'amount_minor')::bigint) from jsonb_array_elements(h.legs) e) = -h.amount_gross
    order by h.doc_date desc, h.id
    limit p_limit
  )
  select b.id, b.doc_date, b.amount_gross, b.shape,
    private.scale_entry(
      case when b.projects = 1 and t.project_id is not null then (
        select jsonb_agg(case when e->>'project_id' is null then e
                              else e || jsonb_build_object('project_id', t.project_id) end order by o)
        from jsonb_array_elements(b.legs) with ordinality as x(e, o))
      else b.legs end,
      b.amount_gross, t.amount_gross)
  from booked b, t
  order by b.doc_date desc, b.id;
$$;

revoke all on function private.journal_history(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- The party's name for the composer's note.
create or replace function private.line_party_name(p_company uuid, p_line uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.name, c.name)
  from public.transactions t
  left join public.suppliers s on s.id = t.supplier_id and s.company_id = t.company_id
  left join public.customers c on c.id = t.customer_id and c.company_id = t.company_id
  where t.id = p_line and t.company_id = p_company;
$$;

revoke all on function private.line_party_name(uuid, uuid) from public, anon, authenticated, service_role;

-- Scaled legs with their project's name, for the screen.
create or replace function private.named_entry(p_company uuid, p_legs jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(e || jsonb_build_object('project_name', p.name) order by o), '[]'::jsonb)
  from jsonb_array_elements(p_legs) with ordinality as x(e, o)
  left join public.projects p on p.company_id = p_company and p.id = (e->>'project_id')::uuid;
$$;

revoke all on function private.named_entry(uuid, jsonb) from public, anon, authenticated, service_role;

-- The most common entry shape (accounts and sides) among the party's last 20 booked lines with a split,
-- its amounts and projects from the newest line of that shape, scaled to this line. Ties go to the
-- shape booked most recently. Null when there is none (or no company, or not the caller's line).
create or replace function public.get_line_journal_suggestion(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  pick record;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  select h.transaction_id, h.scaled, count(*) over (partition by h.shape) as basis
  into pick
  from private.journal_history(cid, p_transaction_id, 20) h
  where h.scaled is not null
  order by count(*) over (partition by h.shape) desc, h.doc_date desc, h.transaction_id
  limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'party_name', private.line_party_name(cid, p_transaction_id),
    'basis_count', pick.basis,
    'source_transaction_id', pick.transaction_id,
    'legs', private.named_entry(cid, pick.scaled)
  );
end;
$$;

revoke all on function public.get_line_journal_suggestion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_line_journal_suggestion(uuid) to authenticated;

-- The party's last 10 booked lines with a split: each with its date, amount, legs as booked (for the
-- sheet's חובה / זכות lines) and its entry scaled to this line (the copy). Null with no company or
-- for a line not the caller's; lines [] when the party has none.
create or replace function public.get_line_journal_copies(p_transaction_id uuid)
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
    return null;
  end if;
  if not exists (
    select 1 from public.transactions t
    where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  ) then
    return null;
  end if;
  return jsonb_build_object(
    'party_name', private.line_party_name(cid, p_transaction_id),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'transaction_id', h.transaction_id,
          'doc_date', h.doc_date,
          'amount_gross', h.amount_gross,
          'legs', private.line_journal(cid, h.transaction_id)->'legs',
          'scaled', private.named_entry(cid, h.scaled)
        ) order by h.doc_date desc, h.transaction_id)
      from private.journal_history(cid, p_transaction_id, 10) h
      where h.scaled is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_line_journal_copies(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_line_journal_copies(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Jev's bookings to review.
-- ---------------------------------------------------------------------------
alter table private.mcp_writes
  add column reviewed_at timestamptz,
  add column reviewed_by uuid;

-- The bookings waiting for review, per company and line, newest first (list_jev_bookings,
-- private.jev_booking_waiting).
create index mcp_writes_jev_waiting_idx on private.mcp_writes (company_id, transaction_id, created_at desc)
  where kind in ('book_line', 'line_split') and undone_at is null and reviewed_at is null;

comment on column private.mcp_writes.reviewed_at is
  'FLOW-955: an owner or editor approved (or undid) this book_line / line_split write in לאישור.';

-- The bookings made before the review existed were never shown for review: they count as reviewed.
update private.mcp_writes
set reviewed_at = created_at
where kind in ('book_line', 'line_split') and reviewed_at is null;

-- The undo of a line_split write (MCP split_line, and book_line on an existing line), moved out of
-- mcp_undo unchanged: the parts before come back while the split is still the one the write left.
create or replace function private.undo_line_split_write(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    delete from public.line_splits where transaction_id = p_id and company_id = cid;
    -- A write stored before FLOW-133 has no percent or rest in before: they stay empty.
    insert into public.line_splits (
      company_id, transaction_id, ordinal, category_id, project_id, amount_minor, percent, is_rest, gross_up
    )
    select cid, p_id, b.ord::smallint, (b.part->>'category_id')::uuid, (b.part->>'project_id')::uuid,
      (b.part->>'amount_minor')::bigint, (b.part->>'percent')::numeric,
      coalesce((b.part->>'is_rest')::boolean, false), coalesce((b.part->>'gross_up')::boolean, false)
    from jsonb_array_elements(rec.prior->'before') with ordinality as b(part, ord);
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
$$;

revoke all on function private.undo_line_split_write(uuid, private.mcp_writes) from public, anon, authenticated, service_role;

-- The undo of a book_line write on a new line (FLOW-948), moved out of mcp_undo unchanged: the line
-- goes while it is still the one booked.
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
  elsif (
    select jsonb_build_object(
      'amount_gross', t.amount_gross, 'doc_date', t.doc_date,
      'legs', (select md5(coalesce(string_agg(
                 l.account_id::text || ':' || coalesce(l.project_id::text, '') || ':' || l.amount_minor::text,
                 '|' order by l.ordinal), ''))
               from public.legs l where l.transaction_id = rec.transaction_id and l.company_id = cid)
    )
    from public.transactions t where t.id = rec.transaction_id and t.company_id = cid
  ) is distinct from rec.prior->'after' then
    response := private.mcp_error('conflict', 'conflict');
  else
    begin
      delete from public.line_splits where transaction_id = rec.transaction_id and company_id = cid;
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

revoke all on function private.undo_book_line_write(uuid, private.mcp_writes) from public, anon, authenticated, service_role;

-- mcp_undo's two branches call the functions above. Each branch is cut between its own head and the
-- next branch's head (each counted once), and must still be the text this migration moved.
do $undo$
declare
  def text;
  split_head constant text := E'    elsif p_kind = ''line_split'' then\n';
  split_next constant text := E'    elsif p_kind = ''loan'' then\n';
  book_head constant text := E'    elsif p_kind = ''book_line'' then\n';
  book_next constant text := E'    elsif p_kind = ''document_attach'' then\n';
  cut text;
  i integer;
  j integer;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if (length(def) - length(replace(def, split_head, ''))) / length(split_head) <> 1
    or (length(def) - length(replace(def, split_next, ''))) / length(split_next) <> 1
    or (length(def) - length(replace(def, book_head, ''))) / length(book_head) <> 1
    or (length(def) - length(replace(def, book_next, ''))) / length(book_next) <> 1
  then
    raise exception 'mcp_undo is not the expected definition';
  end if;

  i := position(split_head in def) + length(split_head);
  j := position(split_next in def);
  cut := substr(def, i, j - i);
  if j < i or position('private.line_has_loose_reversal(p_id, rec.prior->''before'')' in cut) = 0
    or position('where id = rec.id and user_id = auth.uid() and undone_at is null;' in cut) = 0
    or length(cut) > 2200
  then
    raise exception 'mcp_undo line_split branch is not the expected definition';
  end if;
  def := substr(def, 1, i - 1) || E'      response := private.undo_line_split_write(cid, rec);\n' || substr(def, j);

  i := position(book_head in def) + length(book_head);
  j := position(book_next in def);
  cut := substr(def, i, j - i);
  if j < i or position('t.source = ''manual''' in cut) = 0
    or position('when sqlstate ''23503'' then' in cut) = 0
    or length(cut) > 2200
  then
    raise exception 'mcp_undo book_line branch is not the expected definition';
  end if;
  def := substr(def, 1, i - 1) || E'      response := private.undo_book_line_write(cid, rec);\n\n' || substr(def, j);
  execute def;
end
$undo$;

-- A booking still stands while its line is as the write left it: the split it wrote (line_split), or
-- the line it made, by amount, date and legs (book_line).
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
    when 'book_line' then (
      select jsonb_build_object(
        'amount_gross', t.amount_gross, 'doc_date', t.doc_date,
        'legs', (select md5(coalesce(string_agg(
                   l.account_id::text || ':' || coalesce(l.project_id::text, '') || ':' || l.amount_minor::text,
                   '|' order by l.ordinal), ''))
                 from public.legs l where l.transaction_id = p_write.transaction_id and l.company_id = p_company)
      )
      from public.transactions t where t.id = p_write.transaction_id and t.company_id = p_company
    ) is not distinct from p_write.prior->'after'
    else false
  end;
$$;

revoke all on function private.jev_booking_standing(uuid, private.mcp_writes) from public, anon, authenticated, service_role;

-- Jev's bookings waiting in לאישור, oldest first: on each line, the newest book_line / line_split write
-- not undone and not reviewed, while it still stands. Any member reads them (a viewer sees the queue too).
create or replace function public.list_jev_bookings()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'write_id', w.id,
        'transaction_id', t.id,
        'kind', w.kind,
        'booked_at', w.created_at,
        'party', coalesce(s.name, c.name, t.description),
        'doc_date', t.doc_date,
        'direction', t.direction,
        'amount_gross', t.amount_gross,
        'currency', coalesce(t.currency, 'ILS'),
        'source', t.source,
        'journal', private.line_journal(cid, t.id)
      ) order by w.created_at, w.id)
    from (
      select distinct on (x.transaction_id) x.*
      from private.mcp_writes x
      where x.company_id = cid and x.kind in ('book_line', 'line_split') and x.transaction_id is not null
        and x.undone_at is null and x.reviewed_at is null
      order by x.transaction_id, x.created_at desc, x.id
    ) w
    join public.transactions t on t.id = w.transaction_id and t.company_id = cid and t.removed_at is null
    left join public.suppliers s on s.id = t.supplier_id and s.company_id = cid
    left join public.customers c on c.id = t.customer_id and c.company_id = cid
    where private.jev_booking_standing(cid, w)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_jev_bookings() from public, anon, authenticated, service_role;
grant execute on function public.list_jev_bookings() to authenticated;

-- The booking of a line that waits in לאישור, as list_jev_bookings picks it: the newest book_line /
-- line_split write on the line, not undone and not reviewed. Locked for the caller's answer.
create or replace function private.jev_booking_waiting(p_company uuid, p_transaction_id uuid)
returns private.mcp_writes
language sql
security definer
set search_path = ''
as $$
  select w.* from private.mcp_writes w
  where w.company_id = p_company and w.transaction_id = p_transaction_id
    and w.kind in ('book_line', 'line_split') and w.undone_at is null and w.reviewed_at is null
  order by w.created_at desc, w.id
  limit 1
  for update;
$$;

revoke all on function private.jev_booking_waiting(uuid, uuid) from public, anon, authenticated, service_role;

-- אישור: the owner or an editor keeps Jev's booking of the line as it is.
create or replace function public.approve_jev_booking(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  rec private.mcp_writes%rowtype;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  rec := private.jev_booking_waiting(cid, p_transaction_id);
  if rec.id is null then
    raise exception 'booking not found';
  end if;
  update private.mcp_writes
  set reviewed_at = clock_timestamp(), reviewed_by = auth.uid()
  where id = rec.id;
  return jsonb_build_object('transaction_id', p_transaction_id, 'reviewed', true);
end;
$$;

revoke all on function public.approve_jev_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_jev_booking(uuid) to authenticated;

-- ביטול: the owner or an editor takes Jev's booking of the line back, through MCP undo's own branch
-- (any member's token wrote it). A line changed since keeps it ('line changed since').
create or replace function public.undo_jev_booking(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  rec private.mcp_writes%rowtype;
  result jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  rec := private.jev_booking_waiting(cid, p_transaction_id);
  if rec.id is null then
    raise exception 'booking not found';
  end if;
  result := case rec.kind
    when 'line_split' then private.undo_line_split_write(cid, rec)
    else private.undo_book_line_write(cid, rec)
  end;
  if result->>'ok' is distinct from 'true' then
    if result->'error'->>'code' = 'conflict' then
      raise exception 'line changed since';
    end if;
    raise exception 'booking not found';
  end if;
  update private.mcp_writes
  set reviewed_at = clock_timestamp(), reviewed_by = auth.uid()
  where id = rec.id;
  return jsonb_build_object('transaction_id', rec.transaction_id, 'undone', true);
end;
$$;

revoke all on function public.undo_jev_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.undo_jev_booking(uuid) to authenticated;

commit;
