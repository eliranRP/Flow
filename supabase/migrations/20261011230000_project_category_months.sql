-- FLOW-401, server part (the owner chose "With groups"). Decision 0149.
-- 1. public.project_category_months(project, months, today): per expense category and currency
--    of a project, this month's cost so far and each of the last N complete months, the
--    expected cost (the median of the complete months with a cost, when there are at least 3)
--    and a flag: high, new or missing. The same parts as get_project's categories: approved
--    lines, split parts and the project's share of shared lines, in the P&L only. Months follow
--    the document date (the invoiced basis, like missing bills). Plain SQL; Jev only words it.
-- 2. categories.group_name: an optional group the owner sets (for example חשבונות), so a
--    screen can fold categories into one row. Totals stay per category. public.set_category_group
--    (owner only) and MCP set_category_group (undo kind category_group). list_categories and
--    project_category_months return it.
-- Patched functions are read from their current definitions, with counted anchors, so changes
-- merged since stay. CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

alter table public.categories
  add column group_name text
  constraint categories_group_name_check check (
    group_name is null or (group_name = btrim(group_name) and char_length(group_name) between 1 and 40)
  );

comment on column public.categories.group_name is
  'An optional group the owner folds categories into on screen (for example חשבונות). Totals stay per category. Decision 0149.';

-- The flag thresholds, in minor units of the row's currency: ILS, else the dollar figures.
create function private.category_flag(
  p_currency text,
  p_this_month bigint,
  p_expected bigint,
  p_months_seen integer,
  p_typical_day integer,
  p_today date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_expected is not null
      and p_this_month > p_expected * 1.5
      and p_this_month - p_expected >= case when p_currency = 'ILS' then 20000 else 5000 end
      then 'high'
    when p_months_seen = 0
      and p_this_month >= case when p_currency = 'ILS' then 50000 else 15000 end
      then 'new'
    when p_expected is not null
      and p_this_month = 0
      and extract(day from p_today)::integer > coalesce(p_typical_day, 31)
      then 'missing'
  end;
$$;

revoke all on function private.category_flag(text, bigint, bigint, integer, integer, date) from public, anon;
grant execute on function private.category_flag(text, bigint, bigint, integer, integer, date) to authenticated, service_role;

create function public.project_category_months(
  p_project_id uuid,
  p_months integer default 6,
  p_today date default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cid uuid;
  -- private.flow_today(), inline: the caller runs this function and cannot call that one.
  today date := coalesce(p_today, (now() at time zone 'Asia/Jerusalem')::date);
  this_month date;
  first_month date;
  months jsonb;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project_id is null or p_months is null or p_months < 3 or p_months > 12 then
    raise exception 'validation';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid) then
    return null;
  end if;

  this_month := date_trunc('month', today)::date;
  first_month := (this_month - make_interval(months => p_months))::date;
  select jsonb_agg(to_char(m, 'YYYY-MM-DD') order by m) into months
  from generate_series(first_month, this_month - interval '1 month', interval '1 month') m;

  with entries as (
    select e.category_id, e.currency, date_trunc('month', e.doc_date)::date as month,
      extract(day from e.doc_date)::integer as day, -e.amount_net as amount
    from private.project_category_entries_by_currency(p_project_id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where e.doc_date >= first_month
      and e.doc_date < (this_month + interval '1 month')::date
      and private.line_in_pnl(
        case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select category_id, currency, month, sum(amount)::bigint as amount
    from entries
    group by category_id, currency, month
  ),
  keys as (
    select category_id, currency,
      coalesce(sum(amount) filter (where month = this_month), 0)::bigint as this_month_minor
    from sums
    group by category_id, currency
  ),
  per_month as (
    select k.category_id, k.currency, m::date as month, coalesce(s.amount, 0)::bigint as amount
    from keys k
    cross join generate_series(first_month, this_month - interval '1 month', interval '1 month') m
    left join sums s on s.category_id is not distinct from k.category_id
      and s.currency = k.currency and s.month = m::date
  ),
  -- A month counts as seen only with a positive cost, so a refund-only month is not a cost.
  past as (
    select category_id, currency,
      jsonb_agg(amount order by month) as months_minor,
      (count(*) filter (where amount > 0))::integer as months_seen,
      round(percentile_cont(0.5) within group (order by amount) filter (where amount > 0))::bigint as median_minor
    from per_month
    group by category_id, currency
  ),
  days as (
    select category_id, currency,
      round(percentile_cont(0.5) within group (order by day))::integer as typical_day
    from entries
    where month < this_month
    group by category_id, currency
  ),
  rows as (
    select k.category_id, k.currency, k.this_month_minor, p.months_minor, p.months_seen,
      p.median_minor, d.typical_day
    from keys k
    join past p on p.category_id is not distinct from k.category_id and p.currency = k.currency
    left join days d on d.category_id is not distinct from k.category_id and d.currency = k.currency
  )
  select jsonb_build_object(
    'project_id', p_project_id,
    'today', today,
    'this_month', to_char(this_month, 'YYYY-MM-DD'),
    'months', coalesce(months, '[]'::jsonb),
    'categories', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.category_id,
      'name', c.name,
      'group_name', c.group_name,
      'currency', r.currency,
      'this_month_minor', r.this_month_minor,
      'months_minor', r.months_minor,
      'months_seen', r.months_seen,
      'expected_minor', case when r.months_seen >= 3 then r.median_minor end,
      'typical_day', r.typical_day,
      'flag', private.category_flag(
        r.currency, r.this_month_minor,
        case when r.months_seen >= 3 then r.median_minor end,
        r.months_seen, r.typical_day, today
      )
    ) order by r.currency is distinct from private.company_base_currency(cid), r.currency,
      r.this_month_minor desc, c.name), '[]'::jsonb)
  ) into result
  from rows r
  left join public.categories c on c.id = r.category_id;

  return result;
end;
$$;

revoke all on function public.project_category_months(uuid, integer, date) from public, anon;
grant execute on function public.project_category_months(uuid, integer, date) to authenticated, service_role;
comment on function public.project_category_months(uuid, integer, date) is
  'Per expense category and currency of a project: this month, the last N complete months, the expected cost and a high/new/missing flag. Decision 0149.';

-- Sets a category's group (owner only); null or blank clears it. Returns the group before and after.
create function public.set_category_group(p_category_id uuid, p_group_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  before text;
  after text := nullif(btrim(private.plain_spaces(p_group_name)), '');
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_category_id is null or char_length(after) > 40 then
    raise exception 'validation';
  end if;
  if private.name_has_hidden_char(after) then
    raise exception 'name has an invisible or control character' using errcode = '23514';
  end if;
  select c.group_name into before
  from public.categories c
  where c.id = p_category_id and c.company_id = cid
  for update;
  if not found then
    raise exception 'category not found';
  end if;
  update public.categories c
  set group_name = after
  where c.id = p_category_id and c.company_id = cid and c.group_name is distinct from after;
  return jsonb_build_object('before', before, 'after', after);
end;
$$;

revoke all on function public.set_category_group(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_category_group(uuid, text) to authenticated;
comment on function public.set_category_group(uuid, text) is
  'Sets the group a category folds into on screen (owner only); null or blank clears it. Decision 0149.';

create function public.mcp_set_category_group(p_idempotency_key text, p_category_id uuid, p_group_name text)
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
    or char_length(btrim(private.plain_spaces(p_group_name))) > 40
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_group|' || p_category_id::text || '|' || coalesce(nullif(btrim(private.plain_spaces(p_group_name)), ''), '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.set_category_group(p_category_id, p_group_name);
    insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, created_at)
    values (token, auth.uid(), p_category_id, 'category_group', written, clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'category_id', p_category_id,
        'group_name', written->'after',
        'prior', written->'before',
        'undo_kind', 'category_group',
        'id', p_category_id
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      elsif sqlerrm = 'name has an invisible or control character' then
        response := private.mcp_error('validation', sqlerrm);
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_category_group(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_category_group(text, uuid, text) to authenticated;

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the category_group kind.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'company_currency'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'category_group'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'company_currency'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'category_group'::text) AND (category_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  -- public.mcp_undo: put the group back, only while the write still stands.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'category_move', 'company_currency'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$, 'category_group'$n$);

  anchor := $a$        or (p_kind = 'company_currency' and w.kind = 'company_currency' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'category_group' and w.kind = 'category_group' and w.category_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'company_currency' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo company_currency branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'category_group' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
        and coalesce(to_jsonb(c.group_name), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.categories c
        set group_name = rec.prior->>'before'
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

  -- list_categories: the group.
  def := pg_get_functiondef('public.list_categories()'::regprocedure);
  anchor := $a$    'loan_part', c.loan_part,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$
    'group_name', c.group_name,$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
