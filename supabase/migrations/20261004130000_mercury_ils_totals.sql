-- Shekel totals count only ILS lines. Non-ILS amounts come back per currency.
-- Pending connector income is queued for review and stays out of those totals.
-- A Mercury cron claims only Mercury rows. The drain posts mercury-sync for them.
-- provider_meta keeps kind, providerCategory, and checked_at.

begin;

set local lock_timeout = '5s';

create or replace function public.company_pnl(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_basis text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  basis text;
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
    and not exists (
      select 1 from public.companies
      where id = p_company_id and owner_id = (select auth.uid())
    )
  then
    raise exception 'forbidden';
  end if;
  if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id) then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  with bounds as (
    select
      p_from as dfrom,
      p_to as dto,
      case
        when p_from is null or p_to is null then null
        else (p_from - ((p_to - p_from) + 1))
      end as pfrom,
      case when p_from is null or p_to is null then null else (p_from - 1) end as pto
  ),
  income as (
    select
      t.project_id,
      t.amount_net,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.removed_at is null
      and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
      and t.direction = 'income'
      and (
        (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense as (
    select
      t.id,
      t.project_id,
      t.pnl_role,
      t.amount_net,
      t.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.removed_at is null
      and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
      and t.direction = 'expense'
  ),
  shared_alloc as (
    select a.project_id, a.amount_net, e.in_period, e.in_prev
    from public.allocations a
    join expense e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.status,
      p.state_label,
      p.budget_agorot,
      p.sumit_budget_section_id,
      coalesce((select sum(i.amount_net) from income i where i.project_id = p.id and i.in_period), 0) as income_net,
      coalesce((select sum(e.amount_net) from expense e where e.project_id = p.id and e.pnl_role = 'project' and e.in_period), 0) as direct_net,
      coalesce((select sum(s.amount_net) from shared_alloc s where s.project_id = p.id and s.in_period), 0) as shared_net
    from public.projects p
    where p.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', c.id,
    'name', c.name,
    'vat_registered', c.vat_registered,
    'basis', basis,
    'from', p_from,
    'to', p_to,
    'income_agorot', coalesce((select sum(amount_net) from income where in_period), 0),
    'direct_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'project' and in_period), 0),
    'shared_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'shared' and in_period), 0),
    'overhead_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'overhead' and in_period), 0),
    'expense_agorot', -coalesce((select sum(amount_net) from expense where in_period), 0),
    'net_profit_agorot',
      coalesce((select sum(amount_net) from income where in_period), 0)
      + coalesce((select sum(amount_net) from expense where in_period), 0),
    'prev_income_agorot', case when p_from is null then null else coalesce((select sum(amount_net) from income where in_prev), 0) end,
    'prev_expense_agorot', case when p_from is null then null else -coalesce((select sum(amount_net) from expense where in_prev), 0) end,
    'prev_net_agorot', case when p_from is null then null else
      coalesce((select sum(amount_net) from income where in_prev), 0)
      + coalesce((select sum(amount_net) from expense where in_prev), 0)
    end,
    'active_projects', (select count(*) from public.projects p where p.company_id = c.id and p.status = 'active'),
    'review_count', (
      select count(*)
      from public.review_queue q
      left join public.transactions rt on rt.id = q.transaction_id
      where q.company_id = c.id
        and q.status = 'open'
        and (rt.id is null or rt.removed_at is null)
    ),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'minor', bucket.minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as minor,
          count(*)::integer as line_count
        from public.transactions t
        where t.company_id = p_company_id
          and t.removed_at is null
          and t.line_status = 'posted'
          and coalesce(t.currency, 'ILS') <> 'ILS'
          and (
            (
              t.direction = 'income'
              and (
                (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              )
              and (
                (select dfrom from bounds) is null
                or (basis = 'cash' and coalesce(t.cash_date, t.doc_date) between (select dfrom from bounds) and (select dto from bounds))
                or (basis = 'invoiced' and t.doc_date between (select dfrom from bounds) and (select dto from bounds))
              )
            )
            or (
              t.direction = 'expense'
              and (
                (select dfrom from bounds) is null
                or t.doc_date between (select dfrom from bounds) and (select dto from bounds)
              )
            )
          )
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'status', r.status,
          'state_label', r.state_label,
          'budget_agorot', r.budget_agorot,
          'sumit_budget_section_id', r.sumit_budget_section_id,
          'income_agorot', r.income_net,
          'direct_agorot', -r.direct_net,
          'shared_agorot', -r.shared_net,
          'profit_before_shared_agorot', r.income_net + r.direct_net,
          'profit_agorot', r.income_net + r.direct_net + r.shared_net
        )
        order by (abs(r.income_net) + abs(r.direct_net)) desc, r.name
      )
      from project_rows r
    ), '[]'::jsonb)
  )
  into result
  from public.companies c
  where c.id = p_company_id;

  return result;
end;
$$;

create or replace function public.get_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', coalesce((
          select sum(
            case
              when t.direction = 'income' and t.doc_kind in ('receipt', 'invoice_receipt') then t.amount_net
              when t.direction = 'expense' then t.amount_net
              else 0
            end
          )::bigint
          from public.transactions t
          where t.company_id = c.id
            and t.removed_at is null
            and t.line_status = 'posted'
            and coalesce(t.currency, 'ILS') = 'ILS'
        ), 0),
        'other_currencies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'currency', bucket.currency,
            'minor', bucket.minor,
            'count', bucket.line_count
          ) order by bucket.currency)
          from (
            select
              t.currency,
              sum(
                case
                  when t.direction = 'income' and t.doc_kind in ('receipt', 'invoice_receipt') then t.amount_net
                  when t.direction = 'expense' then t.amount_net
                  else 0
                end
              )::bigint as minor,
              count(*) filter (
                where (t.direction = 'income' and t.doc_kind in ('receipt', 'invoice_receipt'))
                  or t.direction = 'expense'
              )::integer as line_count
            from public.transactions t
            where t.company_id = c.id
              and t.removed_at is null
              and t.line_status = 'posted'
              and coalesce(t.currency, 'ILS') <> 'ILS'
            group by t.currency
          ) bucket
          where bucket.line_count > 0
        ), '[]'::jsonb),
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.id = (select private.readable_company_id())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'other_currencies', '[]'::jsonb,
      'is_demo', false
    )
  );
$$;

create or replace function private.overhead_share(p_project uuid)
returns table (available boolean, share_agorot bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select private.current_company_id() as id
  ),
  totals as (
    select
      coalesce((
        select sum(t.amount_net)::bigint
        from public.transactions t
        where t.company_id = (select id from cid)
          and t.removed_at is null
          and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
          and t.direction = 'income'
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
          and t.project_id is not null
      ), 0) as total_income,
      coalesce((
        select -sum(t.amount_net)::bigint
        from public.transactions t
        where t.company_id = (select id from cid)
          and t.removed_at is null
          and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
          and t.pnl_role = 'overhead'
      ), 0) as overhead_cost
  ),
  rounded as (
    select
      p.id as project_id,
      p.name as project_name,
      s.income,
      (select overhead_cost from totals)::numeric * s.income / (select total_income from totals) as exact,
      private.round_agorot_shekel_hundreds(
        (select overhead_cost from totals)::numeric * s.income / (select total_income from totals)
      ) as rounded
    from public.projects p
    join (
      select t.project_id, sum(t.amount_net)::bigint as income
      from public.transactions t
      where t.company_id = (select id from cid)
        and t.removed_at is null
        and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
        and t.direction = 'income'
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
        and t.project_id is not null
      group by t.project_id
      having sum(t.amount_net) > 0
    ) s on s.project_id = p.id
    where p.company_id = (select id from cid)
      and (select id from cid) is not null
      and (select total_income from totals) <> 0
  ),
  chosen as (
    select r.project_id
    from rounded r
    order by
      case when (select max(x.exact - x.rounded) from rounded x) > 0 then (r.exact - r.rounded) end desc nulls last,
      case when (select max(x.exact - x.rounded) from rounded x) <= 0 then r.income end desc nulls last,
      r.project_name asc
    limit 1
  ),
  adjusted as (
    select
      r.project_id,
      r.rounded + case
        when r.project_id = (select c.project_id from chosen c)
          then (select overhead_cost from totals) - (select coalesce(sum(x.rounded), 0) from rounded x)
        else 0
      end as share
    from rounded r
  )
  select
    (select id from cid) is not null and (select total_income from totals) <> 0,
    case
      when (select id from cid) is null or (select total_income from totals) = 0 then null::bigint
      else coalesce((select a.share from adjusted a where a.project_id = p_project), 0)
    end;
$$;

revoke all on function private.overhead_share(uuid) from public, anon;
grant execute on function private.overhead_share(uuid) to authenticated, service_role;

revoke all on function private.overhead_share(uuid) from public, anon;
grant execute on function private.overhead_share(uuid) to authenticated, service_role;

create or replace function private.project_category_entries(p_project uuid)
returns table (
  category_id uuid,
  transaction_id uuid,
  description text,
  doc_date date,
  amount_net bigint,
  created_at timestamptz,
  shared boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.category_id, t.id, t.description, t.doc_date, t.amount_net, t.created_at, false
  from public.transactions t
  where t.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'project'
    and t.removed_at is null
    and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
    and not t.category_suggested
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = t.id
        and q.company_id = t.company_id
        and q.status = 'open'
    )
  union all
  select t.category_id, t.id, t.description, t.doc_date, a.amount_net, t.created_at, true
  from public.allocations a
  join public.transactions t on t.id = a.transaction_id
  where a.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'shared'
    and t.removed_at is null
    and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
    and not t.category_suggested
    and t.category_id is not null;
$$;

revoke all on function private.project_category_entries(uuid) from public, anon;
grant execute on function private.project_category_entries(uuid) to authenticated, service_role;

revoke all on function private.project_category_entries(uuid) from public, anon;
grant execute on function private.project_category_entries(uuid) to authenticated, service_role;

create or replace function public.get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
begin
  select c.id into cid
    from public.companies c
    where c.owner_id = (select auth.uid());
  if cid is null then
    return null;
  end if;

  waiting := public.project_waiting(p_id);

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'income'
        and t.removed_at is null
        and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
    ), 0),
    'direct_agorot', -coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
        and t.removed_at is null
        and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(a.amount_net) from public.allocations a
      join public.transactions t on t.id = a.transaction_id
      where a.project_id = p.id and t.pnl_role = 'shared' and t.removed_at is null
        and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount,
        'has_shared_share', s.shared
      ) order by s.amount desc, c.name)
      from (
        select e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries(p.id) e
        group by e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'minor', bucket.minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select parts.currency, sum(parts.minor)::bigint as minor, sum(parts.line_count)::integer as line_count
        from (
          select t.currency, t.amount_net as minor, 1 as line_count
          from public.transactions t
          where t.project_id = p.id
            and t.removed_at is null
            and t.line_status = 'posted'
            and coalesce(t.currency, 'ILS') <> 'ILS'
            and (
              (t.direction = 'income' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              or (t.direction = 'expense' and t.pnl_role = 'project')
            )
          union all
          select t.currency, a.amount_net, 1
          from public.allocations a
          join public.transactions t on t.id = a.transaction_id
          where a.project_id = p.id
            and t.pnl_role = 'shared'
            and t.removed_at is null
            and t.line_status = 'posted'
            and coalesce(t.currency, 'ILS') <> 'ILS'
            and t.project_id is distinct from p.id
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum((row->>'amount_net')::bigint))::bigint
      from jsonb_array_elements(waiting) row
    ), 0),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'category', c.name
      ) order by t.doc_date desc, t.created_at desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ))
        order by t.doc_date desc, t.created_at desc
        limit 40
      ) t
      left join public.categories c on c.id = t.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.projects p
  where p.id = p_id and p.company_id = cid;
  if result is null then
    return null;
  end if;
  profit :=
    (result->>'income_agorot')::bigint
    - (result->>'direct_agorot')::bigint
    - (result->>'shared_agorot')::bigint;
  select s.available, s.share_agorot into available, share
  from private.overhead_share(p_id) s;
  return result || jsonb_build_object(
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end
  );
end;
$$;

create or replace function public.sync_review_queue(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
  pending_inserted integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
        then 'unallocated_shared'
      when t.category_id is null then 'missing_category'
      when coalesce(t.pnl_role, 'project') = 'project' and t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'expense'
    and (
      (
        t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
      )
      or t.category_id is null
      or (
        coalesce(t.pnl_role, 'project') = 'project'
        and t.project_id is null
      )
      or (t.category_suggested and not t.user_assigned)
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    );
  get diagnostics inserted = row_count;

  insert into public.review_queue (company_id, transaction_id, status, reason)
  select t.company_id, t.id, 'open', 'pending_income'
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'income'
    and t.line_status = 'pending'
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    );
  get diagnostics pending_inserted = row_count;
  return inserted + pending_inserted;
end;
$$;

revoke all on function public.sync_review_queue(uuid) from public, anon, authenticated;
grant execute on function public.sync_review_queue(uuid) to service_role;

create or replace function public.upsert_connector_lines(
  p_company uuid,
  p_provider public.connector_provider,
  p_lines jsonb,
  p_next_cursor text,
  p_expected_prev_cursor text
)
returns public.connector_upsert_result
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  result public.connector_upsert_result;
  line jsonb;
  has_connection boolean := false;
  prev_cursor text;
  import_from date;
  source_value public.txn_source;
  income_category uuid;
  seen_ids text[] := array[]::text[];
  removed_ids text[] := array[]::text[];
  ext text;
  key text;
  direction public.txn_direction;
  kind public.doc_kind;
  role public.pnl_role;
  line_status public.line_status;
  gross bigint;
  net bigint;
  vat bigint;
  original bigint;
  negated boolean;
  section_name text;
  section_id bigint;
  project uuid;
  named uuid;
  mapped_section bigint;
  party_name text;
  party_kind text;
  party_external bigint;
  party_external_text text;
  supplier uuid;
  customer uuid;
  remembered uuid;
  hint_category uuid;
  txn uuid;
  assigned boolean;
  allocated bigint;
  existing_id uuid;
  existing_void boolean;
  existing_removed timestamptz;
  existing_user boolean;
  existing_project_assigned boolean;
  existing_category_assigned boolean;
  existing_count integer;
  remove_count integer;
  removed_now integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'no company';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'object' then
    raise exception 'lines must be an object';
  end if;
  if jsonb_typeof(p_lines->'lines') <> 'array' then
    raise exception 'lines must be an array';
  end if;
  if p_provider::text = 'sumit' then
    source_value := 'sumit';
  elsif p_provider::text = 'mercury' then
    source_value := 'mercury';
  else
    raise exception 'provider is not a ledger source yet';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company::text || ':' || p_provider::text, 0)
  );
  perform 1 from public.companies where id = p_company for update;

  select c.sync_cursor, c.import_from, true
  into prev_cursor, import_from, has_connection
  from public.connector_connections c
  where c.company_id = p_company
    and c.provider = p_provider
  for update;
  if has_connection and prev_cursor is distinct from p_expected_prev_cursor then
    raise exception 'sync_cursor_conflict';
  end if;

  select c.id into income_category
  from public.categories c
  where c.company_id = p_company
    and c.kind = 'income'
    and c.is_default = true
    and c.hidden = false
  order by c.sort_order
  limit 1;

  result.inserted := 0;
  result.updated := 0;
  result.removed := 0;
  result.skipped := 0;

  for line in select value from jsonb_array_elements(p_lines->'lines')
  loop
    if coalesce(line->>'source', '') is distinct from p_provider::text then
      result.skipped := result.skipped + 1;
      continue;
    end if;
    ext := nullif(line->>'external_id', '');
    if ext is null then
      raise exception 'line is missing an external id';
    end if;
    key := coalesce(nullif(line->>'idempotency_key', ''), p_provider::text || ':' || ext);
    direction := (line->>'direction')::public.txn_direction;
    kind := (line->>'doc_kind')::public.doc_kind;
    role := nullif(line->>'pnl_role', '')::public.pnl_role;
    line_status := coalesce(nullif(line->>'line_status', '')::public.line_status, 'posted');
    negated := coalesce((line->>'amount_negated')::boolean, false);
    original := (line->>'amount_original')::bigint;
    vat := (line #>> '{vat,amount}')::bigint;
    if original is null or original < 0 or vat is null or vat < 0 then
      raise exception 'line amounts are not valid';
    end if;
    gross := case when negated then -original else original end;
    vat := case when negated then -vat else vat end;
    net := gross - vat;

    section_name := nullif(btrim(coalesce(line #>> '{project_hint,name}', '')), '');
    section_id := nullif(line #>> '{project_hint,external_id}', '')::bigint;
    project := null;
    if section_id is not null then
      select p.id into project
      from public.projects p
      where p.company_id = p_company and p.sumit_budget_section_id = section_id
      limit 1;
    end if;
    if project is null and section_name is not null then
      select p.id, p.sumit_budget_section_id into named, mapped_section
      from public.projects p
      where p.company_id = p_company and p.name = section_name;
      if named is null then
        insert into public.projects (company_id, name, sumit_budget_section_id)
        values (p_company, section_name, section_id)
        on conflict (company_id, name) do update
          set sumit_budget_section_id = coalesce(public.projects.sumit_budget_section_id, excluded.sumit_budget_section_id)
        returning id into project;
        select p.sumit_budget_section_id into mapped_section
        from public.projects p where p.id = project;
        if section_id is not null and mapped_section is distinct from section_id then
          project := null;
        end if;
      elsif mapped_section is null then
        update public.projects
        set sumit_budget_section_id = section_id
        where id = named and sumit_budget_section_id is null;
        project := named;
      elsif section_id is null or mapped_section = section_id then
        project := named;
      end if;
    end if;

    party_name := nullif(btrim(coalesce(line #>> '{counterparty,name}', '')), '');
    party_kind := line #>> '{counterparty,kind}';
    party_external_text := nullif(line #>> '{counterparty,external_id}', '');
    -- Mercury ids are text. Only a SUMIT id is a bigint on the party row.
    party_external := case
      when p_provider = 'sumit' then party_external_text::bigint
      else null
    end;
    supplier := null;
    customer := null;
    remembered := null;
    if party_name is not null and party_kind = 'supplier' then
      insert into public.suppliers (company_id, name, sumit_external_id)
      values (p_company, party_name, case when p_provider = 'sumit' then party_external else null end)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.suppliers.sumit_external_id)
      returning id, remembered_category_id into supplier, remembered;
      if party_external_text is not null then
        insert into public.party_external_refs (company_id, provider, kind, external_id, supplier_id)
        values (p_company, p_provider, 'supplier', party_external_text, supplier)
        on conflict on constraint party_external_refs_pkey do update
          set supplier_id = excluded.supplier_id;
      end if;
    elsif party_name is not null and party_kind = 'customer' then
      insert into public.customers (company_id, name, sumit_external_id)
      values (p_company, party_name, case when p_provider = 'sumit' then party_external else null end)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.customers.sumit_external_id)
      returning id into customer;
      if party_external_text is not null then
        insert into public.party_external_refs (company_id, provider, kind, external_id, customer_id)
        values (p_company, p_provider, 'customer', party_external_text, customer)
        on conflict on constraint party_external_refs_pkey do update
          set customer_id = excluded.customer_id;
      end if;
    end if;

    if direction = 'income' or role is distinct from 'project' then
      project := null;
    end if;
    if direction = 'income' then
      role := null;
    end if;

    hint_category := null;
    if nullif(line->>'category_hint', '') is not null then
      select c.id into hint_category
      from public.categories c
      where c.company_id = p_company
        and c.name = line->>'category_hint'
        and c.kind::text = direction::text
      limit 1;
    end if;

    existing_id := null;
    select t.id, t.line_status = 'void', t.removed_at,
           t.user_assigned, t.project_assigned, t.category_assigned
    into existing_id, existing_void, existing_removed,
         existing_user, existing_project_assigned, existing_category_assigned
    from public.transactions t
    where t.company_id = p_company
      and t.source = source_value
      and t.external_id = ext
    for update;
    if existing_id is null then
      select t.id, t.line_status = 'void', t.removed_at,
             t.user_assigned, t.project_assigned, t.category_assigned
      into existing_id, existing_void, existing_removed,
           existing_user, existing_project_assigned, existing_category_assigned
      from public.transactions t
      where t.company_id = p_company
        and t.idempotency_key = key
      for update;
    end if;

    if existing_id is null then
      insert into public.transactions (
        company_id, direction, doc_kind, pnl_role, line_status,
        amount_gross, amount_net, vat_amount, vat_status,
        currency, amount_original, provider_meta,
        doc_date, cash_date, source, external_id, idempotency_key,
        project_id, customer_id, supplier_id, category_id,
        description, linked_external_id, user_assigned, removed_at
      ) values (
        p_company,
        direction,
        kind,
        role,
        line_status,
        gross,
        net,
        vat,
        (line #>> '{vat,status}')::public.vat_status,
        coalesce(nullif(line->>'currency', ''), 'ILS'),
        original,
        case
          when nullif(line #>> '{provider_meta,kind}', '') is null
           and nullif(line #>> '{provider_meta,providerCategory}', '') is null
           and nullif(line #>> '{provider_meta,checked_at}', '') is null then '{}'::jsonb
          else jsonb_strip_nulls(jsonb_build_object(
            'kind', nullif(line #>> '{provider_meta,kind}', ''),
            'providerCategory', nullif(line #>> '{provider_meta,providerCategory}', ''),
            'checked_at', nullif(line #>> '{provider_meta,checked_at}', '')
          ))
        end,
        (line->>'doc_date')::date,
        nullif(line->>'cash_date', '')::date,
        source_value,
        ext,
        key,
        project,
        customer,
        supplier,
        case
          when hint_category is not null then hint_category
          when direction = 'income' then income_category
          when direction = 'expense' then remembered
          else null
        end,
        coalesce(line->>'description', ''),
        nullif(line->>'linked_external_id', ''),
        false,
        case when line_status = 'void' then pg_catalog.now() else null end
      )
      returning id, false, project_id, pnl_role, amount_net
      into txn, assigned, project, role, net;
      result.inserted := result.inserted + 1;
    else
      update public.transactions t
      set direction = direction,
          doc_kind = kind,
          amount_gross = gross,
          amount_net = net,
          vat_amount = vat,
          vat_status = (line #>> '{vat,status}')::public.vat_status,
          currency = coalesce(nullif(line->>'currency', ''), t.currency),
          amount_original = original,
          provider_meta = case
            when nullif(line #>> '{provider_meta,kind}', '') is null
             and nullif(line #>> '{provider_meta,providerCategory}', '') is null
             and nullif(line #>> '{provider_meta,checked_at}', '') is null
             and nullif(t.provider_meta->>'checked_at', '') is null then '{}'::jsonb
            else jsonb_strip_nulls(jsonb_build_object(
              'kind', nullif(line #>> '{provider_meta,kind}', ''),
              'providerCategory', nullif(line #>> '{provider_meta,providerCategory}', ''),
              'checked_at', coalesce(
                nullif(line #>> '{provider_meta,checked_at}', ''),
                nullif(t.provider_meta->>'checked_at', '')
              )
            ))
          end,
          doc_date = (line->>'doc_date')::date,
          cash_date = nullif(line->>'cash_date', '')::date,
          external_id = ext,
          description = coalesce(line->>'description', ''),
          linked_external_id = nullif(line->>'linked_external_id', ''),
          customer_id = customer,
          supplier_id = supplier,
          line_status = case when existing_void then 'void'::public.line_status else line_status end,
          removed_at = case
            when existing_void then existing_removed
            when line_status = 'void' then coalesce(existing_removed, pg_catalog.now())
            else null
          end,
          project_id = case
            when existing_user or existing_project_assigned then t.project_id
            else project
          end,
          category_id = case
            when existing_user or existing_category_assigned then t.category_id
            when hint_category is not null then hint_category
            when direction = 'income' then income_category
            when direction = 'expense' then remembered
            else null
          end,
          pnl_role = case
            when existing_user or existing_project_assigned then t.pnl_role
            else role
          end
      where t.id = existing_id
      returning t.id, (t.user_assigned or t.project_assigned), t.project_id, t.pnl_role, t.amount_net
      into txn, assigned, project, role, net;
      result.updated := result.updated + 1;
    end if;

    seen_ids := array_append(seen_ids, ext);

    if assigned then
      update public.allocations
      set amount_net = (net * share_bp) / 10000
      where transaction_id = txn;
      select coalesce(sum(a.amount_net), 0) into allocated
      from public.allocations a
      where a.transaction_id = txn;
      if allocated <> 0 and allocated <> net then
        update public.allocations
        set amount_net = amount_net + (net - allocated)
        where id = (
          select a.id from public.allocations a
          where a.transaction_id = txn
          order by a.project_id
          limit 1
        );
      end if;
    else
      delete from public.allocations where transaction_id = txn;
      delete from public.overhead where transaction_id = txn;
      if direction <> 'income' and role = 'project' and project is not null then
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (p_company, txn, project, 10000, net);
      elsif direction <> 'income' and role = 'overhead' then
        insert into public.overhead (company_id, transaction_id)
        values (p_company, txn);
      end if;
    end if;
  end loop;

  if jsonb_typeof(p_lines->'removed_ids') = 'array' then
    select coalesce(array_agg(value), array[]::text[])
    into removed_ids
    from jsonb_array_elements_text(p_lines->'removed_ids') as value;
    update public.transactions t
    set line_status = 'void',
        removed_at = coalesce(t.removed_at, pg_catalog.now())
    where t.company_id = p_company
      and t.source = source_value
      and t.external_id = any (removed_ids)
      and t.line_status is distinct from 'void';
    get diagnostics removed_now = row_count;
    result.removed := result.removed + removed_now;
  end if;

  if coalesce((p_lines->>'complete')::boolean, false) and p_provider = 'sumit' then
    select count(*) into existing_count
    from public.transactions t
    where t.company_id = p_company
      and t.source = source_value
      and t.removed_at is null
      and (import_from is null or t.doc_date >= import_from);

    select count(*) into remove_count
    from public.transactions t
    where t.company_id = p_company
      and t.source = source_value
      and t.removed_at is null
      and (import_from is null or t.doc_date >= import_from)
      and not (t.external_id = any (seen_ids));

    if coalesce(array_length(seen_ids, 1), 0) = 0 then
      update public.connector_connections
      set last_error = 'sync_sweep_empty'
      where company_id = p_company
        and provider = p_provider;
    elsif existing_count > 0 and remove_count * 2 > existing_count then
      update public.connector_connections
      set last_error = 'sync_sweep_suspicious'
      where company_id = p_company
        and provider = p_provider;
    else
      update public.transactions t
      set removed_at = pg_catalog.now()
      where t.company_id = p_company
        and t.source = source_value
        and t.removed_at is null
        and (import_from is null or t.doc_date >= import_from)
        and not (t.external_id = any (seen_ids));
      get diagnostics removed_now = row_count;
      result.removed := result.removed + removed_now;
    end if;
  end if;

  if has_connection then
    update public.connector_connections
    set sync_cursor = p_next_cursor,
        sync_claimed_at = null
    where company_id = p_company
      and provider = p_provider
      and sync_cursor is not distinct from p_expected_prev_cursor;
  end if;

  perform public.sync_review_queue(p_company);
  return result;
end;
$$;

revoke all on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text) to service_role;

create or replace function public.claim_connector_refreshes(p_limit integer, p_provider public.connector_provider)
returns table (id bigint, company_id uuid, provider public.connector_provider)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  with due as (
    select r.id
    from public.connector_refresh_requests r
    join public.connector_connections c
      on c.company_id = r.company_id
     and c.provider = r.provider
    where r.claimed_at is null
      and r.provider = p_provider
      and (c.next_attempt_at is null or c.next_attempt_at <= pg_catalog.now())
      and c.last_error is distinct from 'auth'
      and (c.sync_claimed_at is null or c.sync_claimed_at < pg_catalog.now() - interval '15 minutes')
    order by r.requested_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of r, c skip locked
  ),
  marked as (
    update public.connector_refresh_requests r
    set claimed_at = pg_catalog.now()
    from due
    where r.id = due.id
    returning r.id, r.company_id, r.provider
  ),
  stamped as (
    update public.connector_connections c
    set sync_claimed_at = pg_catalog.now()
    from marked m
    where c.company_id = m.company_id
      and c.provider = m.provider
  )
  select m.id, m.company_id, m.provider
  from marked m;
end;
$$;

revoke all on function public.claim_connector_refreshes(integer, public.connector_provider) from public, anon, authenticated;
grant execute on function public.claim_connector_refreshes(integer, public.connector_provider) to service_role;

create or replace function private.schedule_connector_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  sync_url text;
  existing_name text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'flow-connector-daily requires pg_cron';
  end if;

  foreach existing_name in array ARRAY['flow-sumit-daily', 'flow-sumit-drain', 'flow-connector-daily', 'flow-connector-drain']
  loop
    if exists (select 1 from cron.job j where j.jobname = existing_name) then
      perform cron.unschedule(existing_name);
    end if;
  end loop;

  perform cron.schedule(
    'flow-connector-daily',
    '0 3 * * *',
    $cron$
        insert into public.connector_refresh_requests (company_id, provider)
        select c.company_id, c.provider
        from public.connector_connections c
        where not exists (
          select 1 from public.connector_refresh_requests r
          where r.company_id = c.company_id
            and r.provider = c.provider
            and r.claimed_at is null
        );
      $cron$
  );

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'flow-connector-drain skipped: pg_net is missing';
    return;
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
    $sql$ into secret;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
  end;

  if secret is null or btrim(secret) = '' then
    raise notice 'flow-connector-drain skipped: cron_secret is missing';
    return;
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'flow_sync_url' limit 1
    $sql$ into sync_url;
  exception
    when undefined_table or invalid_schema_name then
      sync_url := null;
  end;

  if sync_url is null or btrim(sync_url) = '' then
    raise notice 'flow-connector-drain skipped: flow_sync_url is missing';
    return;
  end if;

  perform cron.schedule(
    'flow-connector-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := (
          select case p.provider
            when 'mercury' then replace(decrypted_secret, '/sumit-sync', '/mercury-sync')
            else decrypted_secret
          end
          from vault.decrypted_secrets
          where name = 'flow_sync_url'
          limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-flow-cron', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb
      )
      from (
        select distinct r.provider
        from public.connector_refresh_requests r
        left join public.connector_connections c
          on c.company_id = r.company_id
         and c.provider = r.provider
        where r.claimed_at is null
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and c.last_error is distinct from 'auth'
          and r.provider in ('sumit', 'mercury')
      ) p;
    $cron$
  );
end;
$$;

revoke all on function private.schedule_connector_jobs() from public, anon, authenticated;
grant execute on function private.schedule_connector_jobs() to service_role;

do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_connector_jobs();
end
$schedule$;

commit;
