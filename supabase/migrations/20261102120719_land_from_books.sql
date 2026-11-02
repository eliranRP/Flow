-- FLOW-461 (decision 0248): a property's land value from the books.
--
-- The owner's books already split each purchase into land and building: the land sits on a
-- balance-sheet account (a land asset account), posted per property. The company
-- names that account once (companies.land_account_id, set_land_account, MCP set_land_account with
-- undo kind land_account); every property then reads its land from its own postings to it. A
-- value the owner typed on the property still wins. Until an account is named,
-- get_property_returns suggests one: an asset account whose name says land and not improvements,
-- with a balance on the property.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

alter table public.companies add column land_account_id uuid;
alter table public.companies
  add constraint companies_land_account_fkey foreign key (id, land_account_id)
  references public.accounts (company_id, id) on delete set null (land_account_id);
create index companies_id_land_account_id_fk_idx on public.companies (id, land_account_id);
comment on column public.companies.land_account_id is
  'FLOW-461: the balance-sheet account that holds the land of each property; a property''s land value is its postings to it. Decision 0248.';

-- A property's postings to one account, in a currency: posted lines, not removed, by the leg's
-- own project when it names one, else the line's.
create function private.project_account_balance(p_company_id uuid, p_project_id uuid, p_account_id uuid, p_currency text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(x.amount_minor), 0)::bigint
  from public.legs x
  join public.transactions t on t.id = x.transaction_id and t.company_id = x.company_id
  where x.company_id = p_company_id
    and x.account_id = p_account_id
    and not x.draft
    and t.removed_at is null
    and t.line_status = 'posted'::public.line_status
    and coalesce(t.currency, 'ILS') = p_currency
    and case when x.project_explicit then x.project_id else t.project_id end = p_project_id;
$$;
revoke all on function private.project_account_balance(uuid, uuid, uuid, text) from public, anon;
grant execute on function private.project_account_balance(uuid, uuid, uuid, text) to authenticated, service_role;

-- The land account (owner only): an asset account of the company, or null to unlink.
create function public.set_land_account(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.company_id = cid and a.type = 'asset' and a.archived_at is null
  ) then
    raise exception 'account not found';
  end if;
  select c.land_account_id into prior from public.companies c where c.id = cid for update;
  update public.companies c set land_account_id = p_account_id where c.id = cid;
  return jsonb_build_object('id', cid, 'land_account_id', p_account_id, 'prior', prior);
end;
$$;
revoke all on function public.set_land_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_land_account(uuid) to authenticated;
comment on function public.set_land_account(uuid) is
  'Names the balance-sheet account that holds each property''s land (owner only; null unlinks). Decision 0248.';

create function public.mcp_set_land_account(p_idempotency_key text, p_account_id uuid)
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
  changed jsonb;
  response jsonb;
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
  hash := 'land_account|' || coalesce(p_account_id::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    changed := public.set_land_account(p_account_id);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
    values (
      token, auth.uid(), 'land_account', (changed->>'id')::uuid,
      jsonb_build_object('before', changed->'prior', 'after', changed->'land_account_id'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', changed->>'id',
        'land_account_id', changed->'land_account_id',
        'prior', changed->'prior',
        'undo_kind', 'land_account'
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
revoke all on function public.mcp_set_land_account(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_land_account(text, uuid) to authenticated;

-- private.mcp_writes and mcp_undo: the land_account kind, put back unless changed since.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'tax_bracket'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'land_account'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'land_account'::text) AND (company_id IS NOT NULL) AND (prior ? 'before'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, $a$, 'tax_bracket'$a$) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, $a$, 'tax_bracket'$a$, $n$, 'tax_bracket', 'land_account'$n$);

  anchor := $a$        or (p_kind = 'tax_bracket' and w.kind = 'tax_bracket' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'land_account' and w.kind = 'land_account' and w.company_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'tax_bracket' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo tax_bracket branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'land_account' then
      -- FLOW-461 (decision 0248).
      declare
        held uuid;
      begin
        select c.land_account_id into held
        from public.companies c
        where c.id = p_id and c.id = cid
        for update;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif held is distinct from (rec.prior->>'after')::uuid then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.companies c
          set land_account_id = (rec.prior->>'before')::uuid
          where c.id = p_id and c.id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        end if;
      end;
$n$ || anchor);
  execute def;
end
$kinds$;

-- get_property_returns: the land is the typed figure, else the property's postings to the land
-- account; with no account named, a suggestion.
do $returns$
declare
  def text;
  procedure_anchor text;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, $a$  units integer;
$a$) <> 1
    or pg_temp.anchor_count(def, $a$  if p.land_minor is null then
$a$) <> 1
    or pg_temp.anchor_count(def, $a$  if purchase is not null and rehab is not null and p.land_minor is not null then
    building := greatest(purchase + rehab - p.land_minor, 0);$a$) <> 1
    or pg_temp.anchor_count(def, $a$      'land_minor', p.land_minor,
$a$) <> 1
  then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, $a$  units integer;
$a$, $n$  units integer;
  land bigint;
  land_source text;
  land_acc uuid;
  land_acc_name text;
  land_suggest jsonb;
$n$);
  def := replace(def, $a$  if p.land_minor is null then
$a$, $n$  -- FLOW-461: the typed land, else the property's postings to the company's land account.
  select c.land_account_id, a.name into land_acc, land_acc_name
  from public.companies c
  left join public.accounts a on a.id = c.land_account_id and a.company_id = c.id
  where c.id = cid;
  if p.land_minor is not null then
    land := p.land_minor;
    land_source := 'typed';
  elsif land_acc is not null then
    -- Only a positive balance is a land (as for the suggestion); none, or a credit, leaves it missing.
    land := private.project_account_balance(cid, p_project_id, land_acc, cur);
    if land > 0 then
      land_source := 'books';
    else
      land := null;
    end if;
  else
    select jsonb_build_object('account_id', s.id, 'name', s.name, 'amount_minor', s.balance)
    into land_suggest
    from (
      select a.id, a.name, private.project_account_balance(cid, p_project_id, a.id, cur) as balance
      from public.accounts a
      where a.company_id = cid and a.type = 'asset' and a.archived_at is null
        and a.name ~* '(קרקע|land)' and a.name !~* '(שיפור|improve)'
    ) s
    where s.balance > 0
    order by s.balance desc
    limit 1;
  end if;
  if land is null then
$n$);
  def := replace(def, $a$  if purchase is not null and rehab is not null and p.land_minor is not null then
    building := greatest(purchase + rehab - p.land_minor, 0);$a$, $n$  if purchase is not null and rehab is not null and land is not null then
    building := greatest(purchase + rehab - land, 0);$n$);
  def := replace(def, $a$      'land_minor', p.land_minor,
$a$, $n$      'land_minor', land,
      'land_source', land_source,
      'land_typed_minor', p.land_minor,
      'land_account', case when land_acc is not null then jsonb_build_object('account_id', land_acc, 'name', land_acc_name) end,
      'land_suggestion', land_suggest,
$n$);
  execute def;
end
$returns$;

drop function pg_temp.anchor_count(text, text);

commit;
