-- FLOW-404, server part (the owner chose: rehab is every project cost but the loan parts,
-- with a switch per category). Decision 0143.
-- 1. projects.purchase_agorot, arv_agorot, value_agorot and value_date: the figures the owner
--    types in, in shekels. public.set_project_investment(project, patch) sets them; a key left
--    out keeps its figure and a null clears it.
-- 2. categories.rehab: null follows the default (in rehab unless the category is kept out of
--    the P&L or is a loan part), true adds the category to rehab, false takes it out.
--    public.set_category_rehab(category, rehab) sets it.
-- 3. get_project returns investment: the figures, rehab (the project's posted, paid costs in
--    rehab categories, direct and shared, all time; shekels, other currencies apart), the
--    balance of its open loans, and forced equity (ARV - purchase - rehab) and current equity
--    (value - loan balance), null while a figure is missing or in another currency.
-- 4. MCP set_project_investment (undo kind project_investment) and set_category_rehab (undo
--    kind category_rehab), with the usual idempotency key and write rate limit.
-- get_project, list_categories, mcp_undo and the mcp_writes checks are patched from their
-- current definitions, with counted anchors, so changes merged since stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- How many times an anchor appears in a text (each patch below needs an exact count).
create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

alter table public.projects
  add column purchase_agorot bigint constraint projects_purchase_agorot_check check (purchase_agorot >= 0),
  add column arv_agorot bigint constraint projects_arv_agorot_check check (arv_agorot >= 0),
  add column value_agorot bigint constraint projects_value_agorot_check check (value_agorot >= 0),
  add column value_date date;

comment on column public.projects.purchase_agorot is
  'What the property cost to buy, in agorot, as the owner typed it. Null until set. Decision 0143.';
comment on column public.projects.arv_agorot is
  'The after-repair value, in agorot, as the owner typed it. Null until set. Decision 0143.';
comment on column public.projects.value_agorot is
  'What the property is worth today, in agorot, as the owner typed it. Null until set. Decision 0143.';
comment on column public.projects.value_date is
  'When value_agorot was last estimated. Decision 0143.';

alter table public.categories add column rehab boolean;

comment on column public.categories.rehab is
  'Whether this category counts as rehab on a project: null follows the default (not kept out of the P&L and not a loan part), true adds it, false takes it out. Decision 0143.';

-- Whether a category counts as rehab. A line with no category counts.
create function private.category_in_rehab(p_rehab boolean, p_excluded boolean, p_loan_part public.loan_split_part)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_rehab, not coalesce(p_excluded, false) and p_loan_part is null);
$$;

revoke all on function private.category_in_rehab(boolean, boolean, public.loan_split_part) from public, anon, authenticated, service_role;
grant execute on function private.category_in_rehab(boolean, boolean, public.loan_split_part) to authenticated, service_role;

-- A project's investment figures and the equity they give. The caller has checked that the
-- project is in company p_company_id and that the user may read it.
-- Rehab is on the cash basis for all time: posted, paid expense lines filed to the project
-- (direct) or shared to it (its allocation), whose category counts as rehab. A loan payment's
-- part (fees too, whatever its category) is a loan part. The line's own P&L switch does not
-- decide it: rehab follows the category. Shekels make rehab_agorot; other currencies are
-- listed apart, and an equity that would need them is null rather than wrong.
create function private.project_investment(p_company_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  p record;
  rehab bigint;
  rehab_other jsonb;
  loan_balance bigint;
  loan_other jsonb;
begin
  select pr.purchase_agorot, pr.arv_agorot, pr.value_agorot, pr.value_date into p
  from public.projects pr
  where pr.id = p_project_id and pr.company_id = p_company_id;
  if not found then
    return null;
  end if;

  with costs as (
    select l.currency, l.amount_net
    from private.pnl_lines l
    left join public.categories c on c.id = l.category_id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.kind = 'expense'
      and l.pnl_role = 'project'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
    union all
    select l.currency, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from public.allocations a
    join private.pnl_lines l on l.transaction_id = a.transaction_id
    left join public.categories c on c.id = l.category_id
    where a.project_id = p_project_id
      and l.company_id = p_company_id
      and l.kind = 'expense'
      and l.pnl_role = 'shared'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
  ),
  by_currency as (
    select x.currency, (-sum(x.amount_net))::bigint as amount_minor
    from costs x
    group by x.currency
  )
  select
    coalesce((select b.amount_minor from by_currency b where b.currency = 'ILS'), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('currency', b.currency, 'amount_minor', b.amount_minor) order by b.currency)
      from by_currency b
      where b.currency <> 'ILS' and b.amount_minor <> 0
    ), '[]'::jsonb)
  into rehab, rehab_other;

  select coalesce(sum(b.balance_minor), 0)::bigint into loan_balance
  from public.loans l
  join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
  where l.company_id = p_company_id
    and l.project_id = p_project_id
    and l.status = 'open'::public.loan_status
    and l.currency = 'ILS';

  select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'balance_minor', x.balance_minor)
           order by x.currency), '[]'::jsonb)
  into loan_other
  from (
    select l.currency, sum(b.balance_minor)::bigint as balance_minor
    from public.loans l
    join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.status = 'open'::public.loan_status
      and l.currency <> 'ILS'
    group by l.currency
  ) x;

  return jsonb_build_object(
    'purchase_agorot', p.purchase_agorot,
    'arv_agorot', p.arv_agorot,
    'value_agorot', p.value_agorot,
    'value_date', p.value_date,
    'rehab_agorot', rehab,
    'rehab_other_currencies', rehab_other,
    'loan_balance_agorot', loan_balance,
    'loan_balance_other_currencies', loan_other,
    'forced_equity_agorot', case when rehab_other = '[]'::jsonb then p.arv_agorot - p.purchase_agorot - rehab end,
    'current_equity_agorot', case when loan_other = '[]'::jsonb then p.value_agorot - loan_balance end
  );
end;
$$;

revoke all on function private.project_investment(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.project_investment(uuid, uuid) to authenticated, service_role;

-- The figures as they stand, for undo and for the RPC's reply.
create function private.project_figures(p_company_id uuid, p_project_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'purchase_agorot', p.purchase_agorot,
    'arv_agorot', p.arv_agorot,
    'value_agorot', p.value_agorot,
    'value_date', p.value_date
  )
  from public.projects p
  where p.id = p_project_id and p.company_id = p_company_id;
$$;

revoke all on function private.project_figures(uuid, uuid) from public, anon, authenticated, service_role;

-- Sets the investment figures of one project (owner only). p_patch holds any of
-- purchase_agorot, arv_agorot, value_agorot (whole agorot, 0 or more) and value_date
-- (YYYY-MM-DD); a key left out keeps its figure, a null clears it. Anything else, or an empty
-- patch, is 'validation'. Returns the figures before and after.
create function public.set_project_investment(p_project_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  before jsonb;
  after jsonb;
  k text;
  v jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_project_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'validation';
  end if;
  for k, v in select e.key, e.value from jsonb_each(p_patch) e loop
    if k in ('purchase_agorot', 'arv_agorot', 'value_agorot') then
      if jsonb_typeof(v) <> 'null'
         and (jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,15}$')
      then
        raise exception 'validation';
      end if;
    elsif k = 'value_date' then
      if jsonb_typeof(v) <> 'null' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'validation';
        end if;
        begin
          perform (v #>> '{}')::date;
        exception
          when datetime_field_overflow or invalid_datetime_format then
            raise exception 'validation';
        end;
      end if;
    else
      raise exception 'validation';
    end if;
  end loop;

  perform 1 from public.projects p where p.id = p_project_id and p.company_id = cid for update;
  if not found then
    raise exception 'project not found';
  end if;
  before := private.project_figures(cid, p_project_id);

  update public.projects p
  set purchase_agorot = case when p_patch ? 'purchase_agorot' then (p_patch->>'purchase_agorot')::bigint else p.purchase_agorot end,
      arv_agorot = case when p_patch ? 'arv_agorot' then (p_patch->>'arv_agorot')::bigint else p.arv_agorot end,
      value_agorot = case when p_patch ? 'value_agorot' then (p_patch->>'value_agorot')::bigint else p.value_agorot end,
      value_date = case when p_patch ? 'value_date' then (p_patch->>'value_date')::date else p.value_date end
  where p.id = p_project_id and p.company_id = cid;

  after := private.project_figures(cid, p_project_id);
  return jsonb_build_object('before', before, 'after', after);
end;
$$;

revoke all on function public.set_project_investment(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_project_investment(uuid, jsonb) to authenticated;
comment on function public.set_project_investment(uuid, jsonb) is
  'Sets a project''s purchase, ARV and value (owner only); a key left out keeps its figure, a null clears it. Decision 0143.';

-- Adds a category to rehab (true), takes it out (false) or goes back to the default (null).
-- Owner only. Returns the setting before and after.
create function public.set_category_rehab(p_category_id uuid, p_rehab boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  before boolean;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_category_id is null then
    raise exception 'validation';
  end if;
  select c.rehab into before
  from public.categories c
  where c.id = p_category_id and c.company_id = cid
  for update;
  if not found then
    raise exception 'category not found';
  end if;
  update public.categories c
  set rehab = p_rehab
  where c.id = p_category_id and c.company_id = cid and c.rehab is distinct from p_rehab;
  return jsonb_build_object('before', before, 'after', p_rehab);
end;
$$;

revoke all on function public.set_category_rehab(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_category_rehab(uuid, boolean) to authenticated;
comment on function public.set_category_rehab(uuid, boolean) is
  'Sets whether a category counts as rehab (owner only): true, false, or null for the default. Decision 0143.';

create function public.mcp_set_project_investment(p_idempotency_key text, p_project_id uuid, p_patch jsonb)
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
    or p_project_id is null
    or p_patch is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  -- jsonb text is canonical (keys sorted), so the same patch hashes the same.
  hash := 'project_investment|' || p_project_id::text || '|' || p_patch::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.set_project_investment(p_project_id, p_patch);
    insert into private.mcp_writes (token_id, user_id, project_id, kind, prior, created_at)
    values (token, auth.uid(), p_project_id, 'project_investment', written, clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', (written->'after') || jsonb_build_object(
        'project_id', p_project_id,
        'undo_kind', 'project_investment',
        'id', p_project_id
      )
    );
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

revoke all on function public.mcp_set_project_investment(text, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_project_investment(text, uuid, jsonb) to authenticated;

create function public.mcp_set_category_rehab(p_idempotency_key text, p_category_id uuid, p_rehab boolean)
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
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_rehab|' || p_category_id::text || '|' || coalesce(p_rehab::text, 'default');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.set_category_rehab(p_category_id, p_rehab);
    insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, created_at)
    values (token, auth.uid(), p_category_id, 'category_rehab', written, clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'category_id', p_category_id,
        'rehab', p_rehab,
        'in_rehab', (
          select private.category_in_rehab(c.rehab, c.excluded_from_pnl, c.loan_part)
          from public.categories c where c.id = p_category_id
        ),
        'undo_kind', 'category_rehab',
        'id', p_category_id
      )
    );
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

revoke all on function public.mcp_set_category_rehab(text, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_category_rehab(text, uuid, boolean) to authenticated;

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the project_investment and category_rehab kinds.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'loan_order'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'project_investment'::text, 'category_rehab'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'loan_order'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'project_investment'::text) AND (project_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text)) OR ((kind = 'category_rehab'::text) AND (category_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  -- public.mcp_undo: both kinds put back what was there, only while the write still stands.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'loan_order'
    )$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'loan_order', 'project_investment', 'category_rehab'
    )$n$);

  anchor := $a$or (p_kind = 'loan_order' and w.kind = 'loan_order' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'project_investment' and w.kind = 'project_investment' and w.project_id = p_id)
        or (p_kind = 'category_rehab' and w.kind = 'category_rehab' and w.category_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'loan_delete' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo loan_delete branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'project_investment' then
      perform 1 from public.projects p where p.id = p_id and p.company_id = cid for update;
      if not found or private.project_figures(cid, p_id) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.projects p
        set purchase_agorot = (rec.prior->'before'->>'purchase_agorot')::bigint,
            arv_agorot = (rec.prior->'before'->>'arv_agorot')::bigint,
            value_agorot = (rec.prior->'before'->>'value_agorot')::bigint,
            value_date = (rec.prior->'before'->>'value_date')::date
        where p.id = p_id and p.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_rehab' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
        and coalesce(to_jsonb(c.rehab), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.categories c
        set rehab = (rec.prior->>'before')::boolean
        where c.id = p_id and c.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
$n$ || anchor);
  execute def;

  -- get_project: the investment figures and equity.
  def := pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure);
  anchor := $a$    -- FLOW-105: the loans filed under this project. Nothing above reads them.$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_project is not the expected definition';
  end if;
  execute replace(def, anchor, $n$    -- FLOW-404: purchase, ARV, value, rehab and equity. Nothing above reads them.
    'investment', private.project_investment(cid, p_id),
$n$ || anchor);

  -- list_categories: the rehab switch and what it comes to.
  def := pg_get_functiondef('public.list_categories()'::regprocedure);
  anchor := $a$'loan_part', c.loan_part$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
    'rehab', c.rehab,
    'in_rehab', private.category_in_rehab(c.rehab, c.excluded_from_pnl, c.loan_part)$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
