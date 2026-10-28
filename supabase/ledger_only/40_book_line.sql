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
