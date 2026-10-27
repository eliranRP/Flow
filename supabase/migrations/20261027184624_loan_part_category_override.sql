-- FLOW-148 (MCP/data agent request, decision 0227): a category for each part of one loan payment,
-- and a dated category switch on the loan.
-- 1. public.loan_category_switches: from effective_date on, a part (interest, escrow, principal or
--    fees) of the loan's payments goes to category_id. One row per loan, part and date. Read with
--    the loan; written only through the functions below. A category that does not fit the part is
--    refused, as on the loan itself (decisions 0128, 0130, 0166).
-- 2. private.loan_part_category_on: the category a part of a payment dated p_on takes when the
--    write names none: the latest switch on or before that date, else the loan's own category for
--    the part, else the keyed default (none for fees).
-- 3. mcp_attach_loan_payment takes category_id on every part, not only fees, each checked like
--    fees; a part that names none takes loan_part_category_on for the line's date. save_loan_split
--    takes the same default, so a payment matched in the app follows the switches too.
-- 4. MCP set_loan_part_category: one part's category on one or more attached payments; the lines
--    stay attached. Undo kind loan_part_category (the write id), all or nothing.
-- 5. MCP set_loan_category_from: add, change or remove a switch; with apply_to_existing, also
--    re-file the part on the payments already attached from that date until the next switch.
--    Undo kind loan_category_from (the write id), all or nothing.
-- 6. get_loan_split shows each part's category; mcp_list_loans shows the switches.
-- 7. The places that follow a loan's categories follow the switches too: a category flip into or
--    out of the P&L (categories_loan_pnl_check), delete_category, the category move and its undo,
--    list_categories' loan_used, delete_loan's snapshot and loan_restore.
-- 8. mcp_refused names the new refusals, and turns the loan split check's internal names
--    (loan_split_category, loan_split_sum, ...) into words instead of "The write was refused.".
-- Functions written before this one are patched in place with counted anchors, as in
-- 20261026155947_loan_refinanced_into.sql.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 1. The switches.
create table public.loan_category_switches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  loan_id uuid not null,
  part public.loan_split_part not null,
  effective_date date not null,
  category_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_category_switches_loan_fkey foreign key (company_id, loan_id)
    references public.loans (company_id, id) on delete cascade,
  constraint loan_category_switches_category_fkey foreign key (company_id, category_id)
    references public.categories (company_id, id),
  constraint loan_category_switches_one_per_date unique (loan_id, part, effective_date)
);

comment on table public.loan_category_switches is
  'FLOW-148: from effective_date on, this part of the loan''s payments goes to category_id (payments attached later; set_loan_category_from can re-file attached ones). Decision 0227.';

create index loan_category_switches_company_loan_idx
  on public.loan_category_switches (company_id, loan_id, part, effective_date);
create index loan_category_switches_category_idx
  on public.loan_category_switches (company_id, category_id);

alter table public.loan_category_switches enable row level security;

create policy loan_category_switches_select on public.loan_category_switches
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

revoke all on table public.loan_category_switches from anon, authenticated;
grant select on table public.loan_category_switches to authenticated;

create trigger loan_category_switches_touch
  before update on public.loan_category_switches
  for each row execute function private.touch_updated_at();

-- A switch's category fits its part, as a loan's own category must (0128, 0130, 0166).
create function private.loan_category_switches_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.loan_part_category_ok(new.company_id, new.part, new.category_id) then
    raise exception 'category does not fit the loan part' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.loan_category_switches_check() from public, anon, authenticated;

create trigger loan_category_switches_check
  before insert or update of part, category_id on public.loan_category_switches
  for each row execute function private.loan_category_switches_check();

-- 2. The category a part takes when a write names none.
create function private.loan_part_category_on(
  p_company_id uuid,
  p_loan_id uuid,
  p_part public.loan_split_part,
  p_on date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select w.category_id
      from public.loan_category_switches w
      where w.company_id = p_company_id
        and w.loan_id = p_loan_id
        and w.part = p_part
        and w.effective_date <= p_on
      order by w.effective_date desc
      limit 1
    ),
    (
      select case p_part::text
        when 'interest' then l.interest_category_id
        when 'escrow' then l.escrow_category_id
        when 'principal' then l.principal_category_id
        else l.fees_category_id
      end
      from public.loans l
      where l.company_id = p_company_id and l.id = p_loan_id
    ),
    -- Fees have no default (0130).
    (
      select c.id from public.categories c
      where c.company_id = p_company_id
        and c.loan_part = p_part
        and p_part::text <> 'fees'
    )
  );
$$;
revoke all on function private.loan_part_category_on(uuid, uuid, public.loan_split_part, date)
  from public, anon, authenticated;
comment on function private.loan_part_category_on(uuid, uuid, public.loan_split_part, date) is
  'FLOW-148: the latest switch on or before p_on, else the loan''s category for the part, else the keyed default (none for fees). Decision 0227.';

-- 3. mcp_attach_loan_payment: a category on any part; the default follows the switches.
do $attach$
declare
  def text;
  a_declare constant text := $a$  call_fees_cat uuid;$a$;
  a_shape constant text := $a$                   e.value->>'part' = 'fees'
                   and jsonb_typeof(e.value->'category_id') = 'string'$a$;
  a_collect constant text := $a$              if part->>'part' = 'fees' then
                has_fees := true;
                call_fees_cat := (part->>'category_id')::uuid;
              end if;$a$;
  a_check constant text := $a$          elsif has_fees and call_fees_cat is not null and not exists ($a$;
  a_required constant text := $a$          elsif has_fees and coalesce(call_fees_cat, loan.fees_category_id) is null then$a$;
  a_defaults constant text := $a$            cat_interest := loan.interest_category_id;
            cat_escrow := loan.escrow_category_id;
            cat_principal := loan.principal_category_id;$a$;
  a_fees constant text := $a$            cat_fees := coalesce(call_fees_cat, loan.fees_category_id);$a$;
begin
  def := pg_get_functiondef('public.mcp_attach_loan_payment(text,uuid,uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_declare) <> 1 or pg_temp.anchor_count(def, a_shape) <> 1
    or pg_temp.anchor_count(def, a_collect) <> 1 or pg_temp.anchor_count(def, a_check) <> 1
    or pg_temp.anchor_count(def, a_required) <> 1 or pg_temp.anchor_count(def, a_defaults) <> 1
    or pg_temp.anchor_count(def, a_fees) <> 1 then
    raise exception 'mcp_attach_loan_payment is not the expected definition';
  end if;
  def := replace(def, a_declare, a_declare || $n$
  call_interest_cat uuid;
  call_escrow_cat uuid;
  call_principal_cat uuid;$n$);
  -- Any part may name its category (FLOW-148), not only fees.
  def := replace(def, a_shape, $n$                   jsonb_typeof(e.value->'category_id') = 'string'$n$);
  def := replace(def, a_collect, a_collect || $n$
              if part->>'part' = 'interest' then
                call_interest_cat := (part->>'category_id')::uuid;
              elsif part->>'part' = 'escrow' then
                call_escrow_cat := (part->>'category_id')::uuid;
              elsif part->>'part' = 'principal' then
                call_principal_cat := (part->>'category_id')::uuid;
              end if;$n$);
  def := replace(def, a_check, $n$          elsif exists (
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
$n$ || a_check);
  def := replace(def, a_required, $n$          elsif has_fees and coalesce(
            call_fees_cat, private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date)
          ) is null then$n$);
  -- The call's category for a part, else the switch in force on the line's date, else the
  -- loan's, else the keyed default (0128, 0227).
  def := replace(def, a_defaults, $n$            cat_interest := coalesce(call_interest_cat,
              private.loan_part_category_on(cid, p_loan_id, 'interest', txn.doc_date));
            cat_escrow := coalesce(call_escrow_cat,
              private.loan_part_category_on(cid, p_loan_id, 'escrow', txn.doc_date));
            cat_principal := coalesce(call_principal_cat,
              private.loan_part_category_on(cid, p_loan_id, 'principal', txn.doc_date));$n$);
  def := replace(def, a_fees, $n$            cat_fees := coalesce(call_fees_cat,
              private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date));$n$);
  execute def;
end
$attach$;

-- save_loan_split: a part that names no category takes the one in force on the line's date.
do $save$
declare
  def text;
  a_fees constant text := $a$  cat_fees := coalesce(call_fees_cat, loan.fees_category_id);$a$;
  a_interest constant text := $a$  cat_interest := coalesce(call_interest_cat, loan.interest_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'interest'::public.loan_split_part));$a$;
  a_escrow constant text := $a$  cat_escrow := coalesce(call_escrow_cat, loan.escrow_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'escrow'::public.loan_split_part));$a$;
  a_principal constant text := $a$  cat_principal := coalesce(call_principal_cat, loan.principal_category_id, (
    select c.id from public.categories c
    where c.company_id = cid and c.loan_part = 'principal'::public.loan_split_part));$a$;
begin
  def := pg_get_functiondef('public.save_loan_split(uuid,uuid,jsonb,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, a_fees) <> 1 or pg_temp.anchor_count(def, a_interest) <> 1
    or pg_temp.anchor_count(def, a_escrow) <> 1 or pg_temp.anchor_count(def, a_principal) <> 1 then
    raise exception 'save_loan_split is not the expected definition';
  end if;
  def := replace(def, a_fees, $n$  cat_fees := coalesce(call_fees_cat,
    private.loan_part_category_on(cid, p_loan_id, 'fees', txn.doc_date));$n$);
  def := replace(def, a_interest, $n$  cat_interest := coalesce(call_interest_cat,
    private.loan_part_category_on(cid, p_loan_id, 'interest', txn.doc_date));$n$);
  def := replace(def, a_escrow, $n$  cat_escrow := coalesce(call_escrow_cat,
    private.loan_part_category_on(cid, p_loan_id, 'escrow', txn.doc_date));$n$);
  def := replace(def, a_principal, $n$  cat_principal := coalesce(call_principal_cat,
    private.loan_part_category_on(cid, p_loan_id, 'principal', txn.doc_date));$n$);
  execute def;
end
$save$;

-- 4. set_loan_part_category.
create function public.mcp_set_loan_part_category(
  p_idempotency_key text,
  p_transaction_ids uuid[],
  p_part text,
  p_category_id uuid
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
        select s.loan_id from public.loan_splits s
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
        select 1 from public.loan_splits s where s.company_id = cid and s.transaction_id = x
      )
    ) then
      refusal := 'line has no loan split';
    elsif exists (
      select 1 from unnest(ids) x
      where not exists (
        select 1 from public.loan_splits s
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
        select s.id as split_id, s.transaction_id, s.loan_id, s.category_id, t.doc_date
        from public.loan_splits s
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
          update public.loan_splits s set category_id = target where s.id = item.split_id;
        end if;
        written_rows := written_rows || jsonb_build_object(
          'split_id', item.split_id, 'transaction_id', item.transaction_id, 'loan_id', item.loan_id,
          'before', item.category_id, 'written', target);
        shown := shown || jsonb_build_object(
          'transaction_id', item.transaction_id, 'loan_id', item.loan_id,
          'previous_category_id', item.category_id, 'category_id', target);
      end loop;

      for item in select x from unnest(ids) x loop
        perform private.loan_splits_check(item.x);
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
$$;
revoke all on function public.mcp_set_loan_part_category(text, uuid[], text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_loan_part_category(text, uuid[], text, uuid) to authenticated;
comment on function public.mcp_set_loan_part_category(text, uuid[], text, uuid) is
  'MCP set_loan_part_category: one part''s category on attached loan payments, which stay attached (undo kind loan_part_category, all or nothing). Decision 0227.';

-- 5. set_loan_category_from.
create function public.mcp_set_loan_category_from(
  p_idempotency_key text,
  p_loan_id uuid,
  p_part text,
  p_effective_date date,
  p_category_id uuid,
  p_apply_to_existing boolean default false
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
  part_key public.loan_split_part;
  loan record;
  cur record;
  switch_id uuid;
  next_date date;
  item record;
  target uuid;
  moved jsonb := '[]'::jsonb;
  shown jsonb := '[]'::jsonb;
  touched uuid[] := '{}';
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
          and t.id in (select s.transaction_id from public.loan_splits s
                       where s.company_id = cid and s.loan_id = p_loan_id and s.part = part_key)
        order by t.id
        for update;
        for item in
          select s.id as split_id, s.transaction_id, s.category_id, t.doc_date
          from public.loan_splits s
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
            update public.loan_splits s set category_id = target where s.id = item.split_id;
            touched := touched || item.transaction_id;
            moved := moved || jsonb_build_object(
              'split_id', item.split_id, 'transaction_id', item.transaction_id,
              'before', item.category_id, 'written', target);
            shown := shown || jsonb_build_object(
              'transaction_id', item.transaction_id, 'doc_date', item.doc_date,
              'previous_category_id', item.category_id, 'category_id', target);
          end if;
        end loop;
        for item in select x from unnest(touched) x loop
          perform private.loan_splits_check(item.x);
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
$$;
revoke all on function public.mcp_set_loan_category_from(text, uuid, text, date, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_loan_category_from(text, uuid, text, date, uuid, boolean) to authenticated;
comment on function public.mcp_set_loan_category_from(text, uuid, text, date, uuid, boolean) is
  'MCP set_loan_category_from: from a date on, a part of the loan''s payments goes to a category; apply_to_existing re-files attached ones until the next switch (undo kind loan_category_from, all or nothing). Decision 0227.';

-- private.mcp_writes: the two kinds, and what their undo reads.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'loan_refinance'::text])$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'loan_refinance'::text, 'loan_part_category'::text, 'loan_category_from'::text])$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or position($a$(kind = 'loan_refinance'::text)$a$ in def) = 0 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'loan_part_category'::text) AND (company_id IS NOT NULL) AND (prior ? 'part'::text) AND (prior ? 'rows'::text))$n$
    || $n$ OR ((kind = 'loan_category_from'::text) AND (loan_id IS NOT NULL) AND (prior ? 'effective_date'::text) AND (prior ? 'moved'::text))))$n$;
end
$kinds$;

-- mcp_undo: both kinds take the write id. All or nothing: every part and the switch must still
-- read as the write left them, else conflict.
do $undo$
declare
  def text;
  a_kinds constant text := $a$'file_remove', 'loan_refinance'
    )$a$;
  a_lookup constant text := $a$        or (p_kind = 'loan_refinance' and w.kind = 'loan_refinance' and w.loan_id = p_id)
      )$a$;
  a_branch constant text := $a$    elsif p_kind = 'book_line' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;

  def := replace(def, a_kinds, $n$'file_remove', 'loan_refinance', 'loan_part_category', 'loan_category_from'
    )$n$);
  def := replace(def, a_lookup, $n$        or (p_kind = 'loan_refinance' and w.kind = 'loan_refinance' and w.loan_id = p_id)
        or (p_kind in ('loan_part_category', 'loan_category_from') and w.kind = p_kind and w.id = p_id)
      )$n$);
  def := replace(def, a_branch, $n$    elsif p_kind in ('loan_part_category', 'loan_category_from') then
      -- FLOW-148 (decision 0227).
      declare
        rows_key text := case when p_kind = 'loan_part_category' then 'rows' else 'moved' end;
        row_item record;
        changed boolean := false;
        held uuid;
        sw record;
        part_key public.loan_split_part := (rec.prior->>'part')::public.loan_split_part;
      begin
        perform 1 from public.loans l
        where l.company_id = cid
          and (l.id = rec.loan_id or l.id in (
            select s.loan_id from public.loan_splits s
            where s.company_id = cid
              and s.id in (select (x->>'split_id')::uuid from jsonb_array_elements(rec.prior->rows_key) x)
          ))
        order by l.id
        for no key update;
        perform 1 from public.transactions t
        where t.company_id = cid
          and t.id in (select (x->>'transaction_id')::uuid from jsonb_array_elements(rec.prior->rows_key) x)
        order by t.id
        for update;

        for row_item in select x.value as item from jsonb_array_elements(rec.prior->rows_key) x loop
          select s.category_id into held
          from public.loan_splits s
          where s.company_id = cid and s.id = (row_item.item->>'split_id')::uuid
          for update;
          if not found or held is distinct from (row_item.item->>'written')::uuid then
            changed := true;
          elsif not private.loan_part_category_ok(cid, part_key, (row_item.item->>'before')::uuid) then
            -- The category it had was deleted or no longer fits the part.
            changed := true;
          end if;
        end loop;

        if p_kind = 'loan_category_from' then
          select w.id, w.category_id into sw
          from public.loan_category_switches w
          where w.company_id = cid and w.loan_id = rec.loan_id and w.part = part_key
            and w.effective_date = (rec.prior->>'effective_date')::date
          for update;
          if sw.category_id is distinct from (rec.prior->>'after')::uuid then
            changed := true;
          elsif rec.prior->>'before' is not null
            and not private.loan_part_category_ok(cid, part_key, (rec.prior->>'before')::uuid) then
            changed := true;
          end if;
        end if;

        if changed then
          response := private.mcp_error('conflict', 'conflict');
        else
          if p_kind = 'loan_category_from' then
            if rec.prior->>'before' is null then
              delete from public.loan_category_switches w where w.id = sw.id;
            elsif sw.id is null then
              insert into public.loan_category_switches (id, company_id, loan_id, part, effective_date, category_id)
              values ((rec.prior->>'switch_id')::uuid, cid, rec.loan_id, part_key,
                (rec.prior->>'effective_date')::date, (rec.prior->>'before')::uuid);
            else
              update public.loan_category_switches w
              set category_id = (rec.prior->>'before')::uuid
              where w.id = sw.id;
            end if;
          end if;
          update public.loan_splits s
          set category_id = (x->>'before')::uuid
          from jsonb_array_elements(rec.prior->rows_key) x
          where s.company_id = cid and s.id = (x->>'split_id')::uuid
            and s.category_id is distinct from (x->>'before')::uuid;
          for row_item in
            select distinct (x->>'transaction_id')::uuid as txn_id
            from jsonb_array_elements(rec.prior->rows_key) x
          loop
            perform private.loan_splits_check(row_item.txn_id);
          end loop;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        end if;
      end;
$n$ || a_branch);
  execute def;
end
$undo$;

-- 6. get_loan_split: each part's category.
create or replace function public.get_loan_split(p_transaction_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with parts as (
    select s.part, s.amount_minor, s.needs_review, s.loan_id, s.category_id
    from public.loan_splits s
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
$$;
comment on function public.get_loan_split(uuid) is
  'FLOW-107. Null when the line has no loan split. by_parts is true when the P&L counts the line by its parts; then each part''s in_pnl says whether it counts. Otherwise in_pnl is null and the whole line counts under its own category. Parts are interest, escrow, principal, then fees when the payment has one (0130), each with its category (0227).';

-- mcp_list_loans: the switches.
do $list$
declare
  def text;
  anchor text := $a$'refinanced_into_id', l.refinanced_into_id,$a$;
begin
  def := pg_get_functiondef('public.mcp_list_loans()'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_list_loans is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
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
    ), '[]'::jsonb),$n$);
  execute def;
end
$list$;

-- 7. Where a loan's categories are followed, the switches are followed too.
do $follow$
declare
  def text;
  a1 text;
  a2 text;
  a3 text;
begin
  -- A category a switch files a part under keeps its P&L side, as a loan's own does.
  def := pg_get_functiondef('private.categories_loan_pnl_check()'::regprocedure);
  a1 := $a$       or exists (
         select 1 from public.loans l$a$;
  if pg_temp.anchor_count(def, a1) <> 1 then
    raise exception 'categories_loan_pnl_check is not the expected definition';
  end if;
  def := replace(def, a1, $n$       or exists (
         select 1 from public.loan_category_switches w
         where w.company_id = new.company_id
           and w.category_id = new.id
           and (
             new.loan_part is not null
             or (w.part = 'principal'::public.loan_split_part and not new.excluded_from_pnl)
           )
       )
$n$ || a1);
  execute def;

  -- delete_category: a switch uses the category as a loan does.
  def := pg_get_functiondef('public.delete_category(uuid)'::regprocedure);
  a1 := $a$    select 1 from public.loan_splits s where s.company_id = cid and s.category_id = p_category_id
  ) then
    raise exception 'a loan uses this category';$a$;
  if pg_temp.anchor_count(def, a1) <> 1 then
    raise exception 'delete_category is not the expected definition';
  end if;
  def := replace(def, a1, $n$    select 1 from public.loan_splits s where s.company_id = cid and s.category_id = p_category_id
  ) or exists (
    select 1 from public.loan_category_switches w where w.company_id = cid and w.category_id = p_category_id
  ) then
    raise exception 'a loan uses this category';$n$);
  execute def;

  -- list_categories: loan_used counts a switch.
  def := pg_get_functiondef('public.list_categories()'::regprocedure);
  a1 := $a$    select s.category_id
    from public.loan_splits s
    where s.company_id = (select id from co) and s.category_id is not null
  )$a$;
  if pg_temp.anchor_count(def, a1) <> 1 then
    raise exception 'list_categories is not the expected definition';
  end if;
  def := replace(def, a1, $n$    select s.category_id
    from public.loan_splits s
    where s.company_id = (select id from co) and s.category_id is not null
    union
    select w.category_id
    from public.loan_category_switches w
    where w.company_id = (select id from co)
  )$n$);
  execute def;

  -- category_move: switches move with the loans, after the same fit check, and undo moves them back.
  def := pg_get_functiondef('private.category_move(uuid,uuid,uuid)'::regprocedure);
  a1 := $a$  loan_cols jsonb;$a$;
  a2 := $a$  ) or exists (
    select 1
    from public.loan_splits s
    where s.company_id = p_company_id
      and s.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, s.part, p_into)
  ) then$a$;
  a3 := $a$  with moved as (
    update public.suppliers s$a$;
  if pg_temp.anchor_count(def, a1) <> 1 or pg_temp.anchor_count(def, a2) <> 1
    or pg_temp.anchor_count(def, a3) <> 1
    or pg_temp.anchor_count(def, $a$    'loans', loan_cols,$a$) <> 1 then
    raise exception 'category_move is not the expected definition';
  end if;
  def := replace(def, a1, a1 || $n$
  loan_switches jsonb;$n$);
  def := replace(def, a2, $n$  ) or exists (
    select 1
    from public.loan_splits s
    where s.company_id = p_company_id
      and s.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, s.part, p_into)
  ) or exists (
    select 1
    from public.loan_category_switches w
    where w.company_id = p_company_id
      and w.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, w.part, p_into)
  ) then$n$);
  def := replace(def, a3, $n$  with moved as (
    update public.loan_category_switches w
    set category_id = p_into
    where w.company_id = p_company_id and w.category_id = p_from
    returning w.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into loan_switches from moved m;

$n$ || a3);
  def := replace(def, $a$    'loans', loan_cols,$a$, $n$    'loans', loan_cols,
    'loan_switches', loan_switches,$n$);
  execute def;

  def := pg_get_functiondef('private.category_move_undo(uuid,uuid)'::regprocedure);
  a1 := $a$  -- A remembered category the owner changed since stays as it is now.$a$;
  if pg_temp.anchor_count(def, a1) <> 1 then
    raise exception 'category_move_undo is not the expected definition';
  end if;
  def := replace(def, a1, $n$  -- FLOW-148: the loans' category switches (a move from before them has none).
  update public.loan_category_switches w
  set category_id = mv.from_id
  where w.company_id = p_company_id
    and w.category_id = mv.into_id
    and w.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(mv.moved->'loan_switches', '[]'::jsonb)) x);
  get diagnostics n = row_count;
  if n <> jsonb_array_length(coalesce(mv.moved->'loan_switches', '[]'::jsonb)) then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

$n$ || a1);
  execute def;

  -- delete_loan keeps the switches in its snapshot, and loan_restore puts them back (a switch
  -- whose category was deleted since stays out).
  def := pg_get_functiondef('public.delete_loan(uuid)'::regprocedure);
  a1 := $a$  rates jsonb;$a$;
  a2 := $a$  -- The parts and rates go with the loan (on delete cascade).$a$;
  a3 := $a$jsonb_build_object('loan', to_jsonb(loan_row), 'rates', rates, 'parts', parts, 'referrers', referrers))$a$;
  if pg_temp.anchor_count(def, a1) <> 1 or pg_temp.anchor_count(def, a2) <> 1
    or pg_temp.anchor_count(def, a3) <> 1 then
    raise exception 'delete_loan is not the expected definition';
  end if;
  def := replace(def, a1, a1 || $n$
  switches jsonb;$n$);
  def := replace(def, a2, $n$  select coalesce(jsonb_agg(to_jsonb(w) order by w.part, w.effective_date), '[]'::jsonb)
  into switches
  from public.loan_category_switches w
  where w.loan_id = p_loan_id and w.company_id = cid;

$n$ || a2);
  def := replace(def, a3, $n$jsonb_build_object('loan', to_jsonb(loan_row), 'rates', rates, 'parts', parts, 'referrers', referrers,
      'switches', switches))$n$);
  execute def;

  def := pg_get_functiondef('private.loan_restore(uuid,jsonb)'::regprocedure);
  a1 := $a$  from jsonb_populate_recordset(null::public.loan_rates, coalesce(p_snapshot->'rates', '[]'::jsonb)) r;$a$;
  if pg_temp.anchor_count(def, a1) <> 1 then
    raise exception 'loan_restore is not the expected definition';
  end if;
  def := replace(def, a1, a1 || $n$
  insert into public.loan_category_switches (id, company_id, loan_id, part, effective_date, category_id, created_at, updated_at)
  select w.id, w.company_id, w.loan_id, w.part, w.effective_date, w.category_id, w.created_at, w.updated_at
  from jsonb_populate_recordset(null::public.loan_category_switches, coalesce(p_snapshot->'switches', '[]'::jsonb)) w
  where private.loan_part_category_ok(w.company_id, w.part, w.category_id);$n$);
  execute def;
end
$follow$;

-- 8. mcp_refused: the new refusals, and the loan split check's internal names in words.
do $refused$
declare
  def text;
  a_list constant text := $a$        'too many documents'
      ) then p_message$a$;
  a_closed constant text := $a$      when p_message = 'loan_closed' then 'loan closed'$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, a_list) <> 1 or pg_temp.anchor_count(def, a_closed) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, a_list, $n$        'too many documents',
        -- FLOW-148 (decision 0227).
        'payment has no such part',
        'switch before the loan start',
        'switch not found',
        'a loan payment is an expense line'
      ) then p_message$n$);
  def := replace(def, a_closed, a_closed || $n$
      -- private.loan_splits_check's names, in the words the tools use.
      when p_message = 'loan_split_category' then 'category does not fit the loan part'
      when p_message in ('loan_split_sum', 'loan_split_incomplete') then 'invalid loan parts'
      when p_message = 'loan_split_currency' then 'loan currency mismatch'
      when p_message = 'loan_split_balance' then 'loan balance exceeded'
      when p_message = 'loan_split_income' then 'a loan payment is an expense line'$n$);
  execute def;
end
$refused$;

drop function pg_temp.anchor_count(text, text);

commit;
