-- Decision 0184 (supersedes 0086's pending rule): a bank line still pending at Mercury shows
-- nowhere in the app until it posts. The sync stores it as before (line_status 'pending'); no
-- transaction row is written here. Every read that returns lines to the app leaves it out:
-- לאישור and its counts, search, the project page, the transaction page (not found), a loan's
-- payments, a party's charges, the recurring reads, category counts, receipt matching and the
-- pushes. Totals already counted posted lines only (private.pnl_lines).
-- sync_review_queue no longer queues a pending line (the pending_income insert is gone) and
-- removes an open row of a line still pending, so the line is queued once, as any line, when it
-- posts (upsert_connector_lines calls it after each batch). Settled rows (approved, changed,
-- skipped) stay, so an owner's answer is kept when the line posts.
-- Each function keeps its signature, security, search_path and grants (create or replace).

begin;

set local lock_timeout = '5s';

-- A pending bank line is not queued; an open row of a line still pending is removed. It is queued like any line once it posts.
create or replace function public.sync_review_queue(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inserted integer;
  income_inserted integer := 0;
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
    and t.line_status = 'posted'
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
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.category_id is null then 'missing_category'
      -- FLOW-309: a guessed category with no project still waits for its category.
      when t.project_id is null and not t.user_assigned and not t.category_assigned then 'missing_category'
      when t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'income'
    and t.line_status = 'posted'
    -- FLOW-309: a receipt waits with its invoice (decision 0165).
    and not (t.doc_kind = 'receipt' and t.linked_external_id is not null and private.receipt_waits(t.id))
    and (
      -- FLOW-121: a guessed kept-out category counts, so the line waits for review like any
      -- other unfiled income until the guess is confirmed.
      (t.project_id is null
        and (t.category_id is null
          or not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part)))
      -- FLOW-126: income that already has a project but only a guess of a kept-out category
      -- counts until the guess is confirmed, so it waits for review too. A guessed loan
      -- category is already out (line_category_out), so it is not queued (FLOW-127).
      -- user_assigned / category_assigned stay next to category_suggested: not every owner
      -- write clears category_suggested (assign_expense sets user_assigned only), and the
      -- closing update below keys on the same pair.
      or (t.project_id is not null
        and t.category_suggested
        and not t.user_assigned
        and not t.category_assigned
        and coalesce(c.excluded_from_pnl, false)
        and not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part))
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
    )
    and not exists (
      -- A row the owner approved or changed is settled; it is not queued again (FLOW-309).
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status in ('approved', 'changed')
    );
  get diagnostics income_inserted = row_count;



  -- 0184: no row is queued as pending_income any more; the rows below were queued before it.
  -- FLOW-309: an open pending_income row whose line has posted takes the reason the income
  -- insert above would give it, or is removed when the posted line needs no review. A settled
  -- row only drops the pending label, as before. An open income row with a null reason (a
  -- settled row reopened after its line posted) takes the same reason; it is never removed.
  update public.review_queue q
  set reason = case
      when t.category_id is null then 'missing_category'
      when t.project_id is null and not t.user_assigned and not t.category_assigned then 'missing_category'
      when t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and (q.reason = 'pending_income' or q.reason is null)
    and private.is_connector_source(t.source)
    and t.direction = 'income'
    and t.line_status = 'posted'
    and t.removed_at is null
    -- Same as the income insert: a line with a settled row is not queued, so an open row
    -- the old code queued after a changed row is removed below, not relabelled.
    and not exists (
      select 1 from public.review_queue s
      where s.transaction_id = t.id and s.status in ('approved', 'changed')
    )
    and (
      (t.project_id is null
        and (t.category_id is null
          or not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part)))
      or (t.project_id is not null
        and t.category_suggested
        and not t.user_assigned
        and not t.category_assigned
        and coalesce(c.excluded_from_pnl, false)
        and not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part))
    );

  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  update public.review_queue q
  set reason = null
  from public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status <> 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    -- 0184: a line still pending at the bank waits in no review until it posts.
    and (t.line_status in ('void', 'pending') or t.removed_at is not null);

  update public.transactions t
  set category_suggested = true
  from public.review_queue q
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and t.company_id = p_company_id
    and t.direction = 'income'
    and not t.user_assigned
    and not t.category_assigned;

  -- FLOW-309: an open income missing_category row whose category the owner has since set.
  perform private.relabel_income_category_pick(p_company_id, q.transaction_id)
  from public.review_queue q
  where q.company_id = p_company_id
    and q.status = 'open'
    and q.reason = 'missing_category';

  return inserted + income_inserted;
end;
$function$;

-- A split whose pending line no longer adds up is queued once the line posts, not while it is pending.
create or replace function private.line_split_review_sync(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line record;
  parts integer;
  parts_minor bigint;
  mismatch boolean;
begin
  select t.company_id, t.amount_net, t.removed_at, t.line_status
  into line
  from public.transactions t
  where t.id = p_transaction_id;
  if not found then
    return;
  end if;

  select count(*)::integer, coalesce(sum(s.amount_minor), 0)
  into parts, parts_minor
  from public.line_splits s
  where s.transaction_id = p_transaction_id;

  mismatch := parts > 0
    and parts_minor <> abs(line.amount_net)
    and line.removed_at is null
    and line.line_status = 'posted'::public.line_status;

  if mismatch then
    insert into public.review_queue (company_id, transaction_id, status, reason)
    select line.company_id, p_transaction_id, 'open', 'split_mismatch'
    where not exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_transaction_id and q.status = 'open'
    );
  else
    delete from public.review_queue q
    where q.transaction_id = p_transaction_id
      and q.company_id = line.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;
end;
$function$;

-- לאישור lists no pending bank line.
create or replace function public.list_review()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'company_id', q.company_id,
    'transaction_id', t.id,
    'description', t.description,
    'doc_date', t.doc_date,
    'doc_kind', t.doc_kind,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'currency', t.currency,
    'vat_agorot', t.vat_amount,
    'direction', t.direction,
    'line_status', t.line_status,
    'source', t.source,
    'kept_out', kept.state = 'out',
    'reason', q.reason,
    'pnl_role', t.pnl_role,
    'share_count', (
      select count(*)::int
      from public.allocations a
      where a.transaction_id = t.id
    ),
    'project_id', t.project_id,
    'category_id', t.category_id,
    'project_name', p.name,
    'category_name', c.name,
    'category_suggested', t.category_suggested,
    'project_suggested', (
      t.project_id is not null
      and not t.user_assigned
      and not t.project_assigned
      and coalesce(t.pnl_role, 'project') is distinct from 'shared'
      and (
        select count(*)
        from public.allocations a
        where a.transaction_id = t.id
          and a.company_id = t.company_id
      ) <= 1
      and not exists (
        select 1
        from public.suppliers sp
        where sp.id = t.supplier_id
          and sp.company_id = t.company_id
          and sp.remembered_project_id = t.project_id
      )
    ),
    'confidence', null,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'auto_approved_today', filed.n,
    'assistant_filed_today', filed.assistant,
    'receipts', coalesce(pair.receipts, '[]'::jsonb),
    'paid', coalesce(
      pair.receipts is not null
        and t.amount_gross + pair.credit_gross - pair.receipt_gross <= 0,
      false
    ),
    'paid_on', pair.paid_on
  ) order by t.doc_date, q.created_at), '[]'::jsonb)
  from public.review_queue q
  -- The lines filed today, read once for the whole list (it was read twice).
  cross join (
    select count(*)::int as n, coalesce(bool_or(f.assistant), false) as assistant
    from private.filed_today_rows() f
  ) filed
  left join (
    select st.transaction_id, st.state
    from private.line_pnl_states(array(
      select open_row.transaction_id
      from public.review_queue open_row
      where open_row.company_id = (select private.readable_company_id())
        and open_row.status = 'open'
    )) st
  ) kept on kept.transaction_id = q.transaction_id
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  -- FLOW-309: the invoice's receipts (the matching rule in private.invoice_receipts).
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'transaction_id', r.id,
        'doc_date', r.doc_date,
        'amount_gross', r.amount_gross,
        'currency', r.currency
      ) order by r.doc_date, r.id) as receipts,
      sum(r.amount_gross)::bigint as receipt_gross,
      max(r.doc_date) as paid_on,
      coalesce((
        select sum(cred.amount_gross)::bigint
        from public.transactions cred
        where cred.company_id = t.company_id
          and cred.removed_at is null
          and cred.doc_kind = 'credit'
          and cred.linked_external_id = t.external_id
      ), 0) as credit_gross
    from public.transactions r
    where t.direction = 'income'
      and t.doc_kind = 'invoice'
      and t.external_id is not null
      and private.is_connector_source(t.source)
      and r.company_id = t.company_id
      and r.source = t.source
      and r.linked_external_id = t.external_id
      and r.direction = 'income'
      and r.doc_kind = 'receipt'
      and r.removed_at is null
      and r.line_status <> 'void'
    having count(*) > 0
  ) pair on true
  where q.company_id = (select private.readable_company_id())
    and q.status = 'open'
    and t.removed_at is null
    and t.line_status <> 'pending';
$function$;

-- A project's waiting lines (and pending_count / pending_agorot on get_project) leave out pending bank lines.
create or replace function public.project_waiting(p_project uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(item order by item->>'doc_date', item->>'description'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'review_id', q.id,
      'transaction_id', t.id,
      'description', t.description,
      'doc_date', t.doc_date,
      'amount_net', t.amount_net,
      'direction', t.direction,
      'reason', q.reason,
      'project_id', t.project_id,
      'category_id', t.category_id,
      'category_name', c.name,
      'supplier_name', s.name,
    'currency', t.currency,
    'source', t.source,
    'kept_out', private.line_pnl_state(t.id, p_project) = 'out'
    ) as item
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    left join public.categories c on c.id = t.category_id
    left join public.suppliers s on s.id = t.supplier_id
    where q.company_id = (select private.readable_company_id())
      and q.status = 'open'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.project_id = p_project
      and t.direction = 'expense'
      and t.pnl_role = 'project'
    union all
    select jsonb_build_object(
      'review_id', null,
      'transaction_id', t.id,
      'description', t.description,
      'doc_date', t.doc_date,
      'amount_net', t.amount_net,
      'direction', t.direction,
      'reason', 'suggested',
      'project_id', t.project_id,
      'category_id', t.category_id,
      'category_name', c.name,
      'supplier_name', s.name,
    'currency', t.currency,
    'source', t.source,
    'kept_out', private.line_pnl_state(t.id, p_project) = 'out'
    )
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    left join public.suppliers s on s.id = t.supplier_id
    where t.company_id = (select private.readable_company_id())
      and t.project_id = p_project
      and t.direction = 'expense'
      and t.pnl_role = 'project'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
  ) held;
$function$;

-- The לאישור count on Home leaves out pending bank lines.
create or replace function public.company_pnl(p_company_id uuid, p_from date, p_to date, p_basis text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare
  basis text;
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
    and not exists (
      select 1 from public.companies
      where id = p_company_id and id = (select private.readable_company_id())
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
      l.project_id,
      l.amount_net,
      l.in_pnl,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.currency = 'ILS'
      and l.kind = 'income'
      and (
        l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense as (
    select
      l.transaction_id as id,
      l.project_id,
      l.pnl_role,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.unassigned,
      l.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.currency = 'ILS'
      and l.kind = 'expense'
  ),
  shared_alloc as (
    select
      a.project_id,
      coalesce(private.div_half_even(a.amount_net::numeric * e.amount_net, e.line_amount_net), 0) as amount_net,
      e.in_period,
      e.in_prev
    from public.allocations a
    join expense e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
      and e.in_pnl
  ),
  income_all as (
    select
      l.project_id,
      l.currency,
      l.amount_net,
      l.in_pnl,
      l.unassigned,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.kind = 'income'
      and (
        l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense_all as (
    select
      l.transaction_id as id,
      l.project_id,
      l.pnl_role,
      l.currency,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.loan_split_fallback,
      l.unassigned,
      l.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.kind = 'expense'
  ),
  shared_alloc_all as (
    select
      a.project_id,
      e.currency,
      coalesce(private.div_half_even(a.amount_net::numeric * e.amount_net, e.line_amount_net), 0) as amount_net,
      e.in_period,
      e.in_prev
    from public.allocations a
    join expense_all e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
      and e.in_pnl
  ),
  unassigned_by_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as unassigned_income_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as unassigned_expense_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as expense_net
      from income_all i
      where i.in_period and i.in_pnl and i.unassigned
      union all
      select e.currency, 0::bigint, e.amount_net
      from expense_all e
      where e.in_period and e.in_pnl and e.unassigned
    ) parts
    group by parts.currency
  ),
  fallback_by_currency as (
    select e.currency, count(distinct e.id)::integer as fallback_count
    from expense_all e
    where e.in_period and e.loan_split_fallback
    group by e.currency
  ),
  excluded_by_currency as (
    select
      parts.currency,
      coalesce(sum(parts.excluded_income), 0)::bigint as excluded_income_minor,
      coalesce(sum(parts.excluded_expense), 0)::bigint as excluded_expense_minor,
      coalesce(sum(parts.excluded_count), 0)::integer as excluded_count
    from (
      select i.currency, i.amount_net as excluded_income, 0::bigint as excluded_expense, 1 as excluded_count
      from income_all i
      where i.in_period and not i.in_pnl
      union all
      select e.currency, 0::bigint, (-e.amount_net)::bigint, 1
      from expense_all e
      where e.in_period and not e.in_pnl
    ) parts
    group by parts.currency
  ),
  prev_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as expense_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as expense_net
      from income_all i
      where i.in_prev and i.in_pnl
      union all
      select e.currency, 0::bigint, e.amount_net
      from expense_all e
      where e.in_prev and e.in_pnl
    ) parts
    group by parts.currency
  ),
  company_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_minor,
      -coalesce(sum(parts.direct_net), 0)::bigint as direct_minor,
      -coalesce(sum(parts.shared_net), 0)::bigint as shared_minor,
      -coalesce(sum(parts.overhead_net), 0)::bigint as overhead_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as expense_minor,
      (coalesce(sum(parts.income_net), 0) + coalesce(sum(parts.expense_net), 0))::bigint as net_profit_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net, 0::bigint as overhead_net, 0::bigint as expense_net
      from income_all i
      where i.in_period and i.in_pnl
      union all
      select
        e.currency,
        0::bigint,
        case when e.pnl_role = 'project' and not e.unassigned then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'shared' and not e.unassigned then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'overhead' then e.amount_net else 0::bigint end,
        e.amount_net
      from expense_all e
      where e.in_period and e.in_pnl
    ) parts
    group by parts.currency
  ),
  currency_line_counts as (
    select
      l.currency,
      count(distinct l.transaction_id)::integer as line_count
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
    where l.company_id = p_company_id
      and l.in_pnl
      and (
        (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
          and (
            (select dfrom from bounds) is null
            or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
            or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
          )
        )
        or (
          l.kind = 'expense'
          and (
            (select dfrom from bounds) is null
            or l.doc_date between (select dfrom from bounds) and (select dto from bounds)
          )
        )
      )
    group by l.currency
  ),
  project_currency as (
    select
      parts.project_id,
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_net,
      coalesce(sum(parts.direct_net), 0)::bigint as direct_net,
      coalesce(sum(parts.shared_net), 0)::bigint as shared_net
    from (
      select i.project_id, i.currency, i.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
      from income_all i
      where i.in_period and i.in_pnl
      union all
      select e.project_id, e.currency, 0::bigint, e.amount_net, 0::bigint
      from expense_all e
      where e.in_period and e.in_pnl and e.pnl_role = 'project' and e.project_id is not null
      union all
      select s.project_id, s.currency, 0::bigint, 0::bigint, s.amount_net
      from shared_alloc_all s
      where s.in_period
    ) parts
    where parts.project_id is not null
    group by parts.project_id, parts.currency
    having coalesce(sum(parts.income_net), 0) <> 0
      or coalesce(sum(parts.direct_net), 0) <> 0
      or coalesce(sum(parts.shared_net), 0) <> 0
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.status,
      p.state_label,
      p.budget_agorot,
      p.sumit_budget_section_id,
      p.group_id,
      coalesce((select sum(i.amount_net) from income i where i.project_id = p.id and i.in_period and i.in_pnl), 0) as income_net,
      coalesce((select sum(e.amount_net) from expense e where e.project_id = p.id and e.pnl_role = 'project' and e.in_period and e.in_pnl), 0) as direct_net,
      coalesce((select sum(s.amount_net) from shared_alloc s where s.project_id = p.id and s.in_period), 0) as shared_net
    from public.projects p
    where p.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', c.id,
    'name', c.name,
    'vat_registered', c.vat_registered,
    'basis', basis,
    'base_currency', c.base_currency,
    'from', p_from,
    'to', p_to,
    'income_agorot', coalesce((select sum(amount_net) from income where in_period and in_pnl), 0),
    'direct_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'project' and not unassigned and in_period and in_pnl), 0),
    'shared_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'shared' and not unassigned and in_period and in_pnl), 0),
    'overhead_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'overhead' and in_period and in_pnl), 0),
    'expense_agorot', -coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
    'net_profit_agorot',
      coalesce((select sum(amount_net) from income where in_period and in_pnl), 0)
      + coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
    'unassigned_income_agorot', coalesce((select u.unassigned_income_minor from unassigned_by_currency u where u.currency = 'ILS'), 0),
    'unassigned_expense_agorot', coalesce((select u.unassigned_expense_minor from unassigned_by_currency u where u.currency = 'ILS'), 0),
    'overhead_project_id', c.overhead_project_id,
    'excluded_income_agorot', coalesce((select sum(amount_net) from income where in_period and not in_pnl), 0),
    'excluded_expense_agorot', coalesce((select -sum(amount_net) from expense where in_period and not in_pnl), 0),
    'prev_income_agorot', case when p_from is null then null else coalesce((select sum(amount_net) from income where in_prev and in_pnl), 0) end,
    'prev_expense_agorot', case when p_from is null then null else -coalesce((select sum(amount_net) from expense where in_prev and in_pnl), 0) end,
    'prev_net_agorot', case when p_from is null then null else
      coalesce((select sum(amount_net) from income where in_prev and in_pnl), 0)
      + coalesce((select sum(amount_net) from expense where in_prev and in_pnl), 0)
    end,
    'active_projects', (select count(*) from public.projects p where p.company_id = c.id and p.status = 'active'),
    'review_count', (
      select count(*)
      from public.review_queue q
      left join public.transactions rt on rt.id = q.transaction_id
      where q.company_id = c.id
        and q.status = 'open'
        and (rt.id is null or (rt.removed_at is null and rt.line_status <> 'pending'))
    ),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          l.currency,
          coalesce(sum(l.amount_net) filter (where l.kind = 'income'), 0)::bigint as income_minor,
          coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
          count(distinct l.transaction_id)::integer as line_count
        from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
        where l.company_id = p_company_id
          and l.in_pnl
          and l.currency <> 'ILS'
          and (
            (
              l.kind = 'income'
              and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              )
              and (
                (select dfrom from bounds) is null
                or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
                or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
              )
            )
            or (
              l.kind = 'expense'
              and (
                (select dfrom from bounds) is null
                or l.doc_date between (select dfrom from bounds) and (select dto from bounds)
              )
            )
          )
        group by l.currency
      ) bucket
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', k.currency,
        'income_minor', coalesce(cc.income_minor, 0),
        'direct_minor', coalesce(cc.direct_minor, 0),
        'shared_minor', coalesce(cc.shared_minor, 0),
        'overhead_minor', coalesce(cc.overhead_minor, 0),
        'expense_minor', coalesce(cc.expense_minor, 0),
        'net_profit_minor', coalesce(cc.net_profit_minor, 0),
        'excluded_income_minor', coalesce(ex.excluded_income_minor, 0),
        'excluded_expense_minor', coalesce(ex.excluded_expense_minor, 0),
        'excluded_count', coalesce(ex.excluded_count, 0),
        'count', coalesce(lc.line_count, 0),
        'loan_split_fallback_count', coalesce(fb.fallback_count, 0),
        'unassigned_income_minor', coalesce(un.unassigned_income_minor, 0),
        'unassigned_expense_minor', coalesce(un.unassigned_expense_minor, 0),
        'prev_income_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) end,
        'prev_expense_minor', case when p_from is null then null else coalesce(pv.expense_minor, 0) end,
        'prev_net_profit_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) - coalesce(pv.expense_minor, 0) end
      ) order by k.currency is distinct from c.base_currency, k.currency)
      from (
        select currency from company_currency
        union
        select currency from excluded_by_currency
        union
        select currency from prev_currency where p_from is not null
      ) k
      left join company_currency cc on cc.currency = k.currency
      left join currency_line_counts lc on lc.currency = k.currency
      left join excluded_by_currency ex on ex.currency = k.currency
      left join fallback_by_currency fb on fb.currency = k.currency
      left join unassigned_by_currency un on un.currency = k.currency
      left join prev_currency pv on pv.currency = k.currency
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
          'group_id', r.group_id,
          'is_overhead', r.id is not distinct from c.overhead_project_id,
          'income_agorot', r.income_net,
          'direct_agorot', -r.direct_net,
          'shared_agorot', -r.shared_net,
          'profit_before_shared_agorot', r.income_net + r.direct_net,
          'profit_agorot', r.income_net + r.direct_net + r.shared_net,
          'by_currency', coalesce((
            select jsonb_agg(jsonb_build_object(
              'currency', pc.currency,
              'income_minor', pc.income_net,
              'direct_minor', -pc.direct_net,
              'shared_minor', -pc.shared_net,
              'profit_minor', pc.income_net + pc.direct_net + pc.shared_net
            ) order by pc.currency is distinct from c.base_currency, pc.currency)
            from project_currency pc
            where pc.project_id = r.id
          ), '[]'::jsonb)
        )
        order by coalesce((
          select abs(pc.income_net) + abs(pc.direct_net)
          from project_currency pc
          where pc.project_id = r.id and pc.currency = c.base_currency
        ), 0) desc, r.name
      )
      from project_rows r
    ), '[]'::jsonb)
  )
  into result
  from public.companies c
  where c.id = p_company_id;

  if result is not null then
    result := result || jsonb_build_object(
      'groups', private.company_pnl_groups(result->'projects', p_company_id, result->>'base_currency')
    );
  end if;
  return result;
end;

$function$;

-- The waiting count in a push leaves out pending bank lines.
create or replace function private.push_waiting_by_owner()
 RETURNS TABLE(user_id uuid, waiting integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.owner_id, count(*)::integer
  from public.review_queue q
  join public.companies c on c.id = q.company_id
  left join public.transactions rt on rt.id = q.transaction_id
  where q.status = 'open'
    and (rt.id is null or (rt.removed_at is null and rt.line_status <> 'pending'))
  group by c.owner_id;
$function$;

-- A new-lines push counts posted lines only.
create or replace function private.push_fresh_lines(p_user uuid, p_since timestamp with time zone)
 RETURNS TABLE(fresh integer, upto timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer, max(t.created_at)
  from public.transactions t
  join public.companies c on c.id = t.company_id
  where c.owner_id = p_user
    and private.is_connector_source(t.source)
    and t.line_status = 'posted'
    and t.removed_at is null
    and t.created_at > p_since;
$function$;

-- Search, its month totals and its counts leave out pending bank lines.
create or replace function public.search_transactions(p_query text DEFAULT NULL::text, p_scope text DEFAULT 'all'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_project text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_amount_min bigint DEFAULT NULL::bigint, p_amount_max bigint DEFAULT NULL::bigint, p_category_exact boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  lim integer;
  off integer;
  needle text;
  scope text;
  want_project uuid;
  no_project boolean := false;
  want_category uuid;
  want_categories uuid[];
  no_category boolean := false;
begin
  if p_scope is not null and p_scope not in ('pending', 'filed', 'all') then
    raise exception 'validation';
  end if;
  if p_direction is not null and p_direction not in ('income', 'expense') then
    raise exception 'validation';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'validation';
  end if;
  -- An amount is the line's bank amount (gross) without its sign, in minor units of the line's
  -- own currency; both ends are included, so min = max finds one figure (FLOW-211).
  if p_amount_min < 0 or p_amount_max < 0
     or (p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max) then
    raise exception 'validation';
  end if;
  -- A project or category is an id, or 'none' for lines with none.
  if p_project = 'none' then
    no_project := true;
  elsif p_project is not null then
    if p_project !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'validation';
    end if;
    want_project := p_project::uuid;
  end if;
  if p_category = 'none' then
    no_category := true;
  elsif p_category is not null then
    if p_category !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'validation';
    end if;
    want_category := p_category::uuid;
  end if;

  cid := private.readable_company_id();
  if cid is null then
    return jsonb_build_object('total', 0, 'expenses', '[]'::jsonb);
  end if;
  -- FLOW-406: a parent category also matches its sub-categories' lines, unless exact.
  if want_category is not null then
    if coalesce(p_category_exact, false) then
      want_categories := array[want_category];
    else
      select array_agg(c.id) into want_categories
      from public.categories c
      where c.company_id = cid and (c.id = want_category or c.parent_id = want_category);
      want_categories := coalesce(want_categories, array[want_category]);
    end if;
  end if;
  scope := coalesce(p_scope, 'all');
  lim := least(greatest(coalesce(p_limit, 50), 0), 100);
  off := greatest(coalesce(p_offset, 0), 0);
  -- The text is matched literally: % and _ in it are not wildcards.
  needle := nullif(btrim(coalesce(p_query, '')), '');
  needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');

  return (
    with matched as (
      select
        t.id,
        t.description,
        t.doc_date,
        t.doc_kind,
        t.amount_net,
        t.amount_gross,
        t.vat_amount,
        t.direction,
        t.currency,
        t.amount_original,
        t.line_status,
        t.project_id,
        t.category_id,
        p.name as project_name,
        c.name as category_name,
        s.name as supplier_name,
        cu.name as customer_name,
        waiting.open as waiting_review
      from public.transactions t
      left join public.projects p on p.id = t.project_id
      left join public.categories c on c.id = t.category_id
      left join public.suppliers s on s.id = t.supplier_id
      left join public.customers cu on cu.id = t.customer_id
      cross join lateral (
        select exists (
          select 1
          from public.review_queue q
          where q.transaction_id = t.id
            and q.company_id = cid
            and q.status = 'open'
        ) as open
      ) waiting
      where t.company_id = cid
        and t.removed_at is null
        and t.line_status <> 'pending'
        and (
          scope = 'all'
          or (scope = 'pending' and waiting.open)
          or (scope = 'filed' and not waiting.open)
        )
        and (p_from is null or t.doc_date >= p_from)
        and (p_to is null or t.doc_date <= p_to)
        and (p_direction is null or t.direction::text = p_direction)
        and (p_amount_min is null or abs(t.amount_gross) >= p_amount_min)
        and (p_amount_max is null or abs(t.amount_gross) <= p_amount_max)
        and (
          needle is null
          or t.description ilike '%' || needle || '%'
          or coalesce(s.name, '') ilike '%' || needle || '%'
          or coalesce(cu.name, '') ilike '%' || needle || '%'
        )
        -- A project: the line's own, a share of a shared cost, or a split part on it. A split
        -- part with no project is on the line's project (0138); a line split whose parts all
        -- name a project holds none of it on the line's own.
        and (
          want_project is null
          or (
            t.project_id = want_project
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid
              having bool_and(sp.project_id is not null)
            )
          )
          or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.company_id = cid and a.project_id = want_project
          )
          or exists (
            select 1 from public.line_splits sp
            where sp.transaction_id = t.id and sp.company_id = cid and sp.project_id = want_project
          )
        )
        and (
          not no_project
          or (
            t.project_id is null
            and not exists (
              select 1 from public.allocations a
              where a.transaction_id = t.id and a.company_id = cid
            )
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid and sp.project_id is not null
            )
          )
        )
        -- A category: the line's own, or a part of its line split or its loan split. A split
        -- line counts by its parts, so its own category matches only through a part. A loan
        -- payment with a part waiting for review counts whole under its own category (0136).
        and (
          want_category is null
          or (
            t.category_id = any(want_categories)
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from public.loan_splits ls
              where ls.transaction_id = t.id and ls.company_id = cid
              having not bool_or(ls.needs_review)
            )
          )
          or exists (
            select 1 from public.line_splits sp
            where sp.transaction_id = t.id and sp.company_id = cid and sp.category_id = any(want_categories)
          )
          or exists (
            select 1 from public.loan_splits ls
            where ls.transaction_id = t.id and ls.company_id = cid and ls.category_id = any(want_categories)
          )
        )
        and (
          not no_category
          or (
            t.category_id is null
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from public.loan_splits ls
              where ls.transaction_id = t.id and ls.company_id = cid
            )
          )
        )
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      -- Every matching line's month totals, on the first page only.
      'months', case when off = 0 then coalesce((
        select jsonb_agg(jsonb_build_object(
          'month', m.month,
          'currency', m.currency,
          'income_minor', m.income_minor,
          'expense_minor', m.expense_minor
        ) order by m.month desc, m.currency)
        from (
          select
            to_char(mt.doc_date, 'YYYY-MM') as month,
            mt.currency,
            coalesce(sum(abs(mt.amount_net)) filter (
              where mt.direction = 'income' and mt.amount_net >= 0
            ), 0)::bigint as income_minor,
            coalesce(sum(abs(mt.amount_net)) filter (
              where not (mt.direction = 'income' and mt.amount_net >= 0)
            ), 0)::bigint as expense_minor
          from matched mt
          -- The states as one id-keyed map, read once: a join of the lines to the states could
          -- nested-loop 4,000 x 4,000 when the planner had no statistics.
          where (
            (select coalesce(jsonb_object_agg(st.transaction_id, st.state), '{}'::jsonb)
             from private.line_pnl_states(array(select id from matched)) st)
            ->> mt.id::text
          ) is distinct from 'out'
          group by 1, 2
        ) m
      ), '[]'::jsonb) end,
      'expenses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', page.id,
          'description', page.description,
          'doc_date', page.doc_date,
          'doc_kind', page.doc_kind,
          'amount_net', page.amount_net,
          'amount_gross', page.amount_gross,
          'vat_agorot', page.vat_amount,
          'direction', page.direction,
          'currency', page.currency,
          'amount_original', page.amount_original,
          'line_status', page.line_status,
          'project_id', page.project_id,
          'category_id', page.category_id,
          'project_name', page.project_name,
          'category_name', page.category_name,
          'supplier_name', page.supplier_name,
          'customer_name', page.customer_name,
          'waiting_review', page.waiting_review,
          'kept_out', private.line_pnl_state(page.id) = 'out',
          'split_parts', (
            select count(*)::int from public.line_splits sp
            where sp.transaction_id = page.id and sp.company_id = cid
          ),
          'loan_matched', exists (
            select 1 from public.loan_splits ls
            where ls.transaction_id = page.id and ls.company_id = cid
          )
        ) order by page.doc_date desc, page.description, page.id)
        from (
          select *
          from matched
          order by doc_date desc, description, id
          limit lim
          offset off
        ) page
      ), '[]'::jsonb)
    )
  );
end;
$function$;

-- The project's transactions list leaves out pending bank lines.
create or replace function public.get_project(p_id uuid, p_basis text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
  ids uuid[];
  pl_rows private.pnl_lines[];
  cats_ils jsonb;
  cats_in jsonb;
  cats_out jsonb;
  base text;
begin
  select c.id into cid
    from public.companies c
    where c.id = (select private.readable_company_id());
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  basis := private.pnl_basis(cid, p_basis);

  waiting := public.project_waiting(p_id);
  -- Every line this project can count: filed to it, shared to it, or split to it. The totals
  -- below read only these lines, so the page costs the project's lines, not the company's.
  ids := array(
    select t.id from public.transactions t where t.company_id = cid and t.project_id = p_id
    union
    select a.transaction_id from public.allocations a where a.company_id = cid and a.project_id = p_id
    union
    select s.transaction_id from public.line_splits s where s.company_id = cid and s.project_id = p_id
  );
  -- The project's lines, read once. Every total below reads this array instead of reading
  -- private.pnl_lines again with the same filter (eight times before).
  pl_rows := array(
    select u from private.pnl_lines u
    where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
      and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)
  );
  -- One pass over the project's category entries feeds the three category lists (three before).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'amount_agorot', s.amount,
      'has_shared_share', s.shared
    ) order by s.amount desc, c.name) filter (where s.in_pnl and s.currency = 'ILS'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)
  into cats_ils, cats_in, cats_out
  from (
    select e.currency,
      e.category_id,
      private.line_in_pnl(
        case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      ) as in_pnl,
      (-sum(e.amount_net))::bigint as amount,
      bool_or(e.shared) as shared
    from private.project_category_entries_by_currency(p_id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
      and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
    group by 1, 2, 3
  ) s
  left join public.categories c on c.id = s.category_id;

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'is_overhead', p.id is not distinct from (select c.overhead_project_id from public.companies c where c.id = cid),
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'income'
        and l.in_pnl
        and l.currency = 'ILS'
        and (
          l.direction = 'expense'
          or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
    ), 0),
    'direct_agorot', -coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from unnest(pl_rows) l
      -- Lines first, then each line's share by index, so the allocations never drive the join.
      cross join lateral (
        select a.amount_net from public.allocations a
        where a.transaction_id = l.transaction_id and a.project_id = p.id
        offset 0 -- keeps this a per-line lookup
      ) a
      where l.kind = 'expense' and l.pnl_role = 'shared' and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', b.currency,
        'income_minor', b.income_minor,
        'direct_minor', b.direct_minor,
        'shared_minor', b.shared_minor,
        'profit_minor', b.income_minor - b.direct_minor - b.shared_minor
      ) order by b.currency)
      from (
        select
          parts.currency,
          coalesce(sum(parts.income_minor), 0)::bigint as income_minor,
          coalesce(sum(parts.direct_minor), 0)::bigint as direct_minor,
          coalesce(sum(parts.shared_minor), 0)::bigint as shared_minor
        from (
          select l.currency as currency,
            case when l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ) then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' and l.pnl_role = 'project' then -l.amount_net else 0 end as direct_minor,
            0::bigint as shared_minor
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', cats_ils,
    'categories_by_currency', cats_in,
    'excluded_categories_by_currency', cats_out,
    -- FLOW-121: income filed to this project that is out of the P&L, by category, on the
    -- same basis as income_agorot. Positive minor units.
    'excluded_income_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'count', s.line_count
      ) order by s.currency, s.amount desc, c.name)
      from (
        select l.currency,
          l.category_id,
          sum(l.amount_net)::bigint as amount,
          count(distinct l.transaction_id)::integer as line_count
        from unnest(pl_rows) l
        where l.project_id = p.id
          and l.company_id = cid
          and l.kind = 'income'
          and not l.in_pnl
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        group by l.currency, l.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          parts.currency,
          sum(parts.income_minor)::bigint as income_minor,
          sum(parts.expense_minor)::bigint as expense_minor,
          count(distinct parts.transaction_id)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            l.transaction_id
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
            and l.currency <> 'ILS'
            and (
              (l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ))
              or (l.kind = 'expense' and l.pnl_role = 'project')
            )
          union all
          select l.currency, 0, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0), l.transaction_id
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum(t.amount_net))::bigint
      from jsonb_array_elements(waiting) row
      join public.transactions t on t.id = (row->>'transaction_id')::uuid
      where coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'pending_other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as expense_minor,
          count(*)::integer as line_count
        from jsonb_array_elements(waiting) row
        join public.transactions t on t.id = (row->>'transaction_id')::uuid
        where coalesce(t.currency, 'ILS') <> 'ILS'
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'currency', coalesce(t.currency, 'ILS'),
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'line_status', t.line_status,
        'category', c.name,
        'kept_out', case
          when t.line_status = 'posted' then not coalesce((
            select bool_or(pl.in_pnl)
            from private.pnl_lines pl
            where pl.transaction_id = t.id
              and (pl.project_id = p.id or exists (
                select 1 from public.allocations a
                where a.transaction_id = t.id and a.project_id = p.id
              ))
          ), false)
          else not private.line_in_pnl(
            case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
              then t.in_pnl_override end,
            private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
            c.loan_part
          )
        end,
        'parts_minor', case when exists (
          select 1 from public.line_splits s0
          where s0.transaction_id = t.id and s0.company_id = cid
        ) then coalesce((
          select sum(case
              when pc.kind::text is not distinct from coalesce(
                (select lc.kind::text from public.categories lc
                 where lc.id = t.category_id and lc.company_id = t.company_id),
                t.direction::text) then s.amount_minor
              else -s.amount_minor
            end)
          from public.line_splits s
          left join public.categories pc on pc.id = s.category_id and pc.company_id = s.company_id
          where s.transaction_id = t.id
            and s.company_id = cid
            and coalesce(s.project_id, t.project_id) = p.id
        ), 0)::bigint end
      ) order by t.doc_date desc, t.created_at desc, t.id desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and t.line_status <> 'pending'
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ) or exists (
            select 1 from public.line_splits s
            where s.transaction_id = t.id and s.company_id = cid and s.project_id = p.id
          ))
          and private.pnl_in_range(t.direction::text, basis, t.doc_date, t.cash_date, p_from, p_to)
        order by t.doc_date desc, t.created_at desc, t.id desc
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
  from private.overhead_share_for(cid, p_id, basis, p_from, p_to) s;
  base := private.company_base_currency(cid);
  -- FLOW-406: parent_id on each category row and the parent roll-ups beside them.
  result := result || jsonb_build_object(
    'categories', private.category_rows_with_parent(result->'categories', cid),
    'categories_by_currency', private.category_rows_with_parent(result->'categories_by_currency', cid),
    'excluded_categories_by_currency', private.category_rows_with_parent(result->'excluded_categories_by_currency', cid),
    'category_rollups', private.category_rollup_rows(result->'categories', 'amount_agorot', cid),
    'category_rollups_by_currency', private.category_rollup_rows(result->'categories_by_currency', 'amount_minor', cid),
    'excluded_category_rollups_by_currency', private.category_rollup_rows(result->'excluded_categories_by_currency', 'amount_minor', cid)
  );
  return result || jsonb_build_object(
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'base_currency', base,
    -- A company kept in shekels has the same share as above: no second pass over its lines.
    'overhead_share_minor', case
      when base = 'ILS' then case when coalesce(available, false) then coalesce(share, 0) else null end
      else (
        select case when s.available then coalesce(s.share_agorot, 0) else null end
        from private.overhead_share_for(cid, p_id, basis, p_from, p_to, base) s
      )
    end,
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
    -- FLOW-404: purchase, ARV, value, rehab and equity. Nothing above reads them.
    'investment', private.project_investment(cid, p_id),
    -- FLOW-105: the loans filed under this project. Nothing above reads them.
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'currency', l.currency,
        'balance_minor', b.balance_minor,
        'status', l.status,
        'closed_on', l.closed_on,
        'kind', l.kind,
        'principal_minor', l.principal_minor,
        'annual_rate_ppm', l.annual_rate_ppm,
        'term_months', l.term_months,
        'start_date', l.start_date,
        'payment_minor', l.payment_minor,
        'escrow_minor', l.escrow_minor,
        'interest_only_months', l.interest_only_months,
        'amortization_months', l.amortization_months,
        'rates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'effective_date', r.effective_date,
            'annual_rate_ppm', r.annual_rate_ppm
          ) order by r.effective_date)
          from public.loan_rates r
          where r.company_id = l.company_id
            and r.loan_id = l.id
        ), '[]'::jsonb)
      ) order by l.name, l.id)
      from public.loans l
      join public.loan_balances b
        on b.company_id = l.company_id
       and b.loan_id = l.id
      where l.company_id = cid
        and l.project_id = p_id
    ), '[]'::jsonb)
  );
end;
$function$;

-- A pending bank line opened by id reads as not found.
create or replace function public.get_transaction(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', t.id,
    'description', t.description,
    'direction', t.direction,
    'doc_kind', t.doc_kind,
    'doc_date', t.doc_date,
    'amount_gross', t.amount_gross,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'vat_amount', t.vat_amount,
    'vat_status', t.vat_status,
    'currency', t.currency,
    'source', t.source,
    'pnl_role', t.pnl_role,
    'project_id', t.project_id,
    'project_name', p.name,
    'category_id', t.category_id,
    'category_name', c.name,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'in_pnl_override', t.in_pnl_override,
    'category_excluded_from_pnl', coalesce(c.excluded_from_pnl, false),
    -- FLOW-121: a guessed category. A guessed kept-out category still counts.
    'category_suggested', t.category_suggested,
    'in_pnl', private.line_in_pnl(
      case when not exists (
        select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ),
    'loan_split', public.get_loan_split(t.id),
    'pnl_state', private.line_pnl_state(t.id),
    'in_cash_override', t.in_cash_override,
    'cash_state', private.line_cash_state(t.id),
    'pnl_fixed', c.loan_part is not null
      or exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.company_id = t.company_id),
    'review_status', (
      select q.status
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id
      order by case when q.status = 'open' then 0 else 1 end, q.created_at desc
      limit 1
    ),
    'review_id', (
      select q.id
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
    'review_reason', (
      select q.reason
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
    'paid', t.cash_date is not null,
    'open_gross_agorot', case
      when t.doc_kind = 'invoice' and t.external_id is not null then
        t.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = t.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = t.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = t.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = t.external_id
        ), 0)
      else null
    end,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id,
        'project_name', ap.name,
        'share_bp', a.share_bp,
        'amount_net', a.amount_net
      ) order by ap.name)
      from public.allocations a
      join public.projects ap on ap.id = a.project_id
      where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = p_id
    and t.removed_at is null
    and t.line_status <> 'pending'
    and t.company_id = (select private.readable_company_id());
$function$;

-- A loan's payments list leaves out pending bank lines.
create or replace function public.mcp_loan_payments(p_loan_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id', p.transaction_id,
    'doc_date', p.doc_date,
    'line_status', p.line_status,
    'needs_review', p.needs_review,
    'interest_minor', p.interest_minor,
    'escrow_minor', p.escrow_minor,
    'principal_minor', p.principal_minor,
    'fees_minor', p.fees_minor
  ) order by p.doc_date, p.transaction_id), '[]'::jsonb)
  from (
    select
      s.transaction_id,
      t.doc_date,
      t.line_status,
      bool_or(s.needs_review) as needs_review,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'interest'), 0)::bigint as interest_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'escrow'), 0)::bigint as escrow_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'principal'), 0)::bigint as principal_minor,
      coalesce(sum(s.amount_minor) filter (where s.part::text = 'fees'), 0)::bigint as fees_minor
    from public.loan_splits s
    join public.transactions t
      on t.company_id = s.company_id
     and t.id = s.transaction_id
    where s.loan_id = p_loan_id
      and s.company_id = (select private.readable_company_id())
      and t.removed_at is null
      and t.line_status <> 'pending'
    group by s.transaction_id, t.doc_date, t.line_status
  ) p;
$function$;

-- A receipt is matched to a posted line only.
create or replace function public.receipt_match(p_amount_minor bigint, p_doc_date date, p_payee text)
 RETURNS TABLE(id uuid, description text, doc_date date, amount_minor bigint, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.id, t.description, t.doc_date, -t.amount_gross, t.source::text
  from public.transactions t
  where t.company_id = private.readable_company_id()
    and t.removed_at is null
    and t.line_status = 'posted'
    and t.direction = 'expense'
    and t.source <> 'manual'
    and -t.amount_gross = p_amount_minor
    and t.doc_date between p_doc_date - 3 and p_doc_date + 3
    and char_length(btrim(coalesce(p_payee, ''))) >= 2
    and char_length(t.description) >= 2
    and (
      position(lower(btrim(p_payee)) in lower(t.description)) > 0
      or position(lower(t.description) in lower(btrim(p_payee))) > 0
    )
  order by abs(t.doc_date - p_doc_date), t.id
  limit 1;
$function$;

-- A category's line count leaves out pending bank lines.
create or replace function public.list_categories()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with co as (
    select private.readable_company_id() as id
  ),
  tagged as (
    select t.category_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = (select id from co)
      and t.category_id is not null
      and t.removed_at is null
      and t.line_status = 'posted'::public.line_status
    union
    select s.category_id, s.transaction_id
    from public.line_splits s
    join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
    where s.company_id = (select id from co)
      and t.removed_at is null
      and t.line_status = 'posted'::public.line_status
  ),
  counted as (
    select
      g.category_id,
      count(*)::integer as lines,
      count(*) filter (where exists (
        select 1 from public.line_splits s
        where s.transaction_id = g.transaction_id and s.category_id = g.category_id
      ))::integer as split_lines
    from tagged g
    group by g.category_id
  ),
  loan_used as (
    select v.category_id
    from public.loans l
    cross join lateral (values
      (l.interest_category_id), (l.escrow_category_id), (l.principal_category_id), (l.fees_category_id)
    ) v(category_id)
    where l.company_id = (select id from co) and v.category_id is not null
    union
    select s.category_id
    from public.loan_splits s
    where s.company_id = (select id from co) and s.category_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'kind', c.kind,
    'hidden', c.hidden,
    'is_default', c.is_default,
    'excluded_from_pnl', c.excluded_from_pnl,
    'in_cash', c.in_cash,
    'loan_part', c.loan_part,
    'group_name', c.group_name,
    'parent_id', c.parent_id,
    'children_count', (select count(*)::integer from public.categories k where k.parent_id = c.id),
    'rollup_lines', coalesce(n.lines, 0) + coalesce((
      select sum(m.lines)::integer from counted m
      join public.categories k on k.id = m.category_id
      where k.parent_id = c.id
    ), 0),
    'rehab', c.rehab,
    'in_rehab', private.category_in_rehab(c.rehab, c.excluded_from_pnl, c.loan_part),
    'lines', coalesce(n.lines, 0),
    'split_lines', coalesce(n.split_lines, 0),
    'loan_used', lu.category_id is not null
  ) order by c.kind, c.sort_order, c.name), '[]'::jsonb)
  from public.categories c
  left join counted n on n.category_id = c.id
  left join loan_used lu on lu.category_id = c.id
  where c.company_id = (select id from co);
$function$;

-- A party's charge history holds posted lines only, so no charge is marked pending.
create or replace function private.party_charges_json(p_company uuid, p_transaction_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with line as (
    select t.id, t.amount_net, t.doc_date, date_trunc('month', t.doc_date)::date as anchor
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = p_company and t.removed_at is null
      and t.line_status = 'posted'
  ),
  party as (
    select pp.direction, pp.party_id, pp.currency, pp.name, l.anchor,
      -- The usual amount as of the line's own month: this month's line reads today's usual.
      least(p_today, (l.anchor + interval '1 month' - interval '1 day')::date) as as_of
    from line l, private.payment_party(p_company, p_transaction_id) pp
  ),
  -- The line's own context: its loan when it pays one, else its project and category, so a supplier
  -- with two loans (or two projects) compares this one with its own earlier charges.
  scope as (
    select t.project_id, t.category_id,
      (select ls.loan_id from public.loan_splits ls where ls.transaction_id = t.id limit 1) as loan_id
    from line l
    join public.transactions t on t.id = l.id
  ),
  party_lines as (
    select t.id, t.doc_date, t.amount_net as amount, t.created_at,
      date_trunc('month', t.doc_date)::date as month,
      case
        when s.loan_id is not null then exists (
          select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.loan_id = s.loan_id
        )
        else t.project_id is not distinct from s.project_id and t.category_id is not distinct from s.category_id
          and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
      end as in_scope
    from party p
    cross join scope s
    join public.transactions t
      on t.company_id = p_company and t.direction = p.direction and t.currency = p.currency
      and p.party_id = case when p.direction = 'expense' then t.supplier_id else t.customer_id end
    where t.removed_at is null
      and t.line_status = 'posted'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= (p.anchor - interval '24 months')::date
      -- A line dated after today still reads its own month.
      and t.doc_date <= greatest(p_today, p.anchor + interval '1 month' - interval '1 day')
  ),
  lines as (
    select pl.id, pl.doc_date, pl.amount, pl.created_at, pl.month from party_lines pl where pl.in_scope
  ),
  recurring as (
    select r.typical_amount_minor as usual
    from party p, private.recurring_parties(p_company, p.as_of) r
    where r.direction = p.direction and r.party_id = p.party_id and r.currency = p.currency
      and r.typical_amount_minor <> 0
      -- As in recurring_arrivals: a party marked recurring with no complete month yet has no usual.
      and r.months_seen > 0
      -- The rule's usual is the whole party's; it stands for this context only when every one of the
      -- party's charges is in it.
      and not exists (select 1 from party_lines pl where not pl.in_scope)
  ),
  -- Otherwise: the median of the context's earlier complete months, at least 2 of the last 6.
  earlier as (
    select ((case when p.direction = 'expense' then -1 else 1 end)
        * percentile_disc(0.5) within group (order by abs(m.amount)))::bigint as usual
    from party p, (
      select l.month, sum(l.amount) as amount
      from lines l, party p
      where l.month >= (p.anchor - interval '6 months')::date and l.month < p.anchor
      group by l.month
    ) m
    group by p.direction
    having count(*) >= 2
  ),
  usual as (
    select coalesce((select r.usual from recurring r), (select nullif(e.usual, 0) from earlier e)) as amount,
      case
        when exists (select 1 from recurring) then 'recurring'
        when exists (select 1 from earlier e where e.usual <> 0) then 'earlier_months'
      end as source
  ),
  month_total as (
    select (select sum(l.amount)::bigint from lines l, party p where l.month = p.anchor) as amount,
      -- An income receipt is not one of the counted lines (its invoice is), so it gets no comparison.
      exists (select 1 from lines l where l.id = p_transaction_id) as counted
  ),
  -- The percent only when the month and the usual amount go the same way (a refund month gets none)
  -- and it fits a readable figure.
  change as (
    select case
      when u.amount is null or not mt.counted or mt.amount is null or sign(mt.amount) <> sign(u.amount) then null
      else round((abs(mt.amount) - abs(u.amount)) * 100.0 / abs(u.amount))
    end as percent
    from usual u, month_total mt
  )
  select case
    when not exists (select 1 from line) then null
    when not exists (select 1 from party) then jsonb_build_object(
      'transaction_id', p_transaction_id, 'party', null, 'month', null, 'month_amount_minor', null,
      'typical_amount_minor', null, 'typical_source', null, 'change_percent', null,
      'others', 0, 'months', '[]'::jsonb, 'charges', '[]'::jsonb
    )
    else (
      select jsonb_build_object(
        'transaction_id', p_transaction_id,
        'party', jsonb_build_object('direction', p.direction, 'id', p.party_id, 'name', p.name, 'currency', p.currency),
        'month', to_char(p.anchor, 'YYYY-MM'),
        'month_amount_minor', mt.amount,
        'typical_amount_minor', u.amount,
        'typical_source', u.source,
        'change_percent', case when abs(c.percent) < 100000 then c.percent::integer end,
        'others', (select count(*) from lines l where l.id <> p_transaction_id),
        'months', (
          select jsonb_agg(jsonb_build_object(
              'month', to_char(g.month, 'YYYY-MM'),
              'amount_minor', coalesce((select sum(l.amount)::bigint from lines l where l.month = g.month::date), 0)
            ) order by g.month)
          from generate_series(p.anchor - interval '5 months', p.anchor, interval '1 month') g(month)
        ),
        'charges', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', c.id, 'doc_date', c.doc_date, 'amount_minor', c.amount
            ) order by c.doc_date desc, c.created_at desc)
          -- The 12 newest up to the line's month, so an older line sits among its own neighbours.
          from (
            select * from lines l where l.month <= p.anchor order by l.doc_date desc, l.created_at desc limit 12
          ) c
        ), '[]'::jsonb)
      )
      from party p, usual u, month_total mt, change c
    )
  end;
$function$;

-- A recurring party is seen, dated and summed from posted lines only.
create or replace function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, months_seen integer, typical_day integer, typical_amount_minor bigint, last_doc_date date, seen_this_month boolean, project_id uuid, category_id uuid, last_amount_minor bigint, source text, pace text, pace_source text, next_due_month date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6,
      (date_trunc('month', p_today) - interval '24 months')::date as window24
  ),
  lines as (
    select t.direction, coalesce(mm.party_id, t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.amount_net, t.project_id, t.category_id,
      date_trunc('month', t.doc_date)::date as month, t.line_status = 'posted' as posted
    from public.transactions t
    -- FLOW-430: a party answered "the same" counts as the recurring one.
    left join public.recurring_matches mm
      on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
      and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
    cross join bounds b
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status = 'posted'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= b.window24
      and t.doc_date <= p_today
  ),
  overrides as (
    select o.direction, o.party_id, o.currency, o.recurring, o.pace
    from public.recurring_overrides o
    where o.company_id = p_company and p_overrides
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month and l.posted
    group by l.direction, l.party_id, l.currency, l.month
  ),
  gapped as (
    select m.*,
      private.month_diff(m.month, lag(m.month) over w) as gap,
      row_number() over (partition by m.direction, m.party_id, m.currency order by m.month desc) as back
    from monthly m
    window w as (partition by m.direction, m.party_id, m.currency order by m.month)
  ),
  stats as (
    select g.direction, g.party_id, g.currency,
      (count(*) filter (where g.month >= b.window6))::integer as months6,
      coalesce(bool_or(g.month >= (b.this_month - interval '2 months')::date), false) as recent,
      percentile_disc(0.5) within group (order by g.first_day) filter (where g.month >= b.window6) as day6,
      percentile_disc(0.5) within group (order by abs(g.amount)) filter (where g.month >= b.window6) as amount6,
      count(*)::integer as months24,
      percentile_disc(0.5) within group (order by g.first_day) as day24,
      percentile_disc(0.5) within group (order by abs(g.amount)) as amount24,
      max(g.month) as last_month,
      max(g.gap) filter (where g.back = 1) as gap_last,
      max(g.gap) filter (where g.back = 2) as gap_prev
    from gapped g, bounds b
    group by g.direction, g.party_id, g.currency
  ),
  detected as (
    select s.*,
      case
        when s.months24 >= 3 and s.gap_last = 2 and s.gap_prev = 2
          and private.month_diff(b.this_month, s.last_month) <= 4 then '2months'
        when s.months24 >= 3 and s.gap_last = 3 and s.gap_prev = 3
          and private.month_diff(b.this_month, s.last_month) <= 6 then 'quarter'
        when s.months6 >= 3 and s.recent then 'month'
        when s.months24 >= 2 and s.gap_last between 11 and 13
          and private.month_diff(b.this_month, s.last_month) <= 13 then 'year'
      end as auto_pace
    from stats s, bounds b
  ),
  parties as (
    select d.direction, d.party_id, d.currency, d.auto_pace,
      coalesce(o.pace, d.auto_pace, 'month') as pace,
      o.recurring, o.pace as pace_override,
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24
    from detected d
    left join overrides o on o.direction = d.direction and o.party_id = d.party_id and o.currency = d.currency
    where coalesce(o.recurring, d.auto_pace is not null)
  ),
  -- A party the owner marked recurring with no complete posted month yet: its latest month,
  -- this one included, is its usual day and amount.
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join overrides o on o.direction = l.direction and o.party_id = l.party_id and o.currency = l.currency
    where o.recurring
      and not exists (
        select 1 from stats s
        where s.direction = l.direction and s.party_id = l.party_id and s.currency = l.currency
      )
    group by l.direction, l.party_id, l.currency, l.month
  ),
  forced as (
    select distinct on (fm.direction, fm.party_id, fm.currency)
      fm.direction, fm.party_id, fm.currency, coalesce(o.pace, 'month') as pace, o.pace as pace_override,
      0 as months_seen, fm.first_day as typical_day, fm.amount::bigint as typical_amount_minor
    from forced_monthly fm
    join overrides o on o.direction = fm.direction and o.party_id = fm.party_id and o.currency = fm.currency
    order by fm.direction, fm.party_id, fm.currency, fm.month desc
  ),
  chosen as (
    select p.direction, p.party_id, p.currency, p.pace, p.pace_override,
      case when p.pace = 'month' and p.months6 > 0 then p.months6 else p.months24 end as months_seen,
      case when p.pace = 'month' and p.months6 > 0 then p.day6 else p.day24 end::integer as typical_day,
      -- The median by size, with the direction's sign, so an even count does not lean one way.
      ((case when p.direction = 'expense' then -1 else 1 end)
        * case when p.pace = 'month' and p.months6 > 0 then p.amount6 else p.amount24 end)::bigint
        as typical_amount_minor,
      case when p.recurring is null then 'auto' else 'user' end as source
    from parties p
    union all
    select f.direction, f.party_id, f.currency, f.pace, f.pace_override,
      f.months_seen, f.typical_day, f.typical_amount_minor, 'user'
    from forced f
  ),
  seen as (
    select c.*,
      (select max(l.month) from lines l
       where l.direction = c.direction and l.party_id = c.party_id and l.currency = c.currency) as last_seen_month
    from chosen c
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    last_bill.doc_date,
    p.last_seen_month = b.this_month,
    (select l.project_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.project_id is not null
       and (p.pace <> 'month' or l.doc_date >= b.window6)
     group by l.project_id order by count(*) desc, max(l.doc_date) desc limit 1),
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.category_id is not null
       and (p.pace <> 'month' or l.doc_date >= b.window6)
     group by l.category_id order by count(*) desc, max(l.doc_date) desc limit 1),
    last_bill.amount,
    p.source,
    p.pace,
    case when p.pace_override is null then 'auto' else 'user' end,
    -- Monthly: this month until its bill comes, then next month. Otherwise one pace after the
    -- last month it was seen (earlier than this month when it is late).
    case
      when p.pace = 'month' then
        case when p.last_seen_month = b.this_month then (b.this_month + interval '1 month')::date else b.this_month end
      else (p.last_seen_month + make_interval(months => private.pace_months(p.pace)))::date
    end
  from seen p
  cross join bounds b
  -- The last posted bill: its date, and every posted line of the party on that date.
  left join lateral (
    select l.doc_date, sum(l.amount_net)::bigint as amount
    from lines l
    where l.posted and l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
    group by l.doc_date
    order by l.doc_date desc
    limit 1
  ) last_bill on true;
$function$;

-- This month's arrival of a recurring party counts posted lines only.
create or replace function private.recurring_arrivals(p_company uuid, p_today date)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, amount_minor bigint, typical_amount_minor bigint, change_percent integer, typical_day integer, transaction_id uuid, project_id uuid, category_id uuid, source text, pace text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with r as (
    select * from private.recurring_parties(p_company, p_today) rp
    -- A party with no complete month yet has its usual amount from this month itself.
    where rp.seen_this_month and rp.typical_amount_minor <> 0 and rp.months_seen > 0
  ),
  this_month as (
    select r.direction, r.party_id, r.currency, sum(t.amount_net)::bigint as amount,
      (array_agg(t.id order by t.doc_date desc, t.created_at desc))[1] as transaction_id
    from r
    join public.transactions t
      on t.company_id = p_company and t.direction = r.direction and t.currency = r.currency
      and r.party_id = private.recurring_party_of(p_company, t.direction,
        case when r.direction = 'expense' then t.supplier_id else t.customer_id end)
    where t.removed_at is null
      and t.line_status = 'posted'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= date_trunc('month', p_today)::date
      and t.doc_date <= p_today
    group by r.direction, r.party_id, r.currency
  )
  select r.direction, r.party_id, r.currency, m.amount, r.typical_amount_minor,
    round((abs(m.amount) - abs(r.typical_amount_minor)) * 100.0 / abs(r.typical_amount_minor))::integer,
    r.typical_day, m.transaction_id, r.project_id, r.category_id, r.source, r.pace
  from r
  join this_month m on m.direction = r.direction and m.party_id = r.party_id and m.currency = r.currency;
$function$;

-- Same line count as recurring_arrivals: posted lines only.
create or replace function private.recurring_arrivals_json(p_company uuid, p_today date, p_changes boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', a.direction,
      'party_id', a.party_id,
      'party_name', coalesce(s.name, cu.name),
      'supplier_id', s.id,
      'supplier_name', s.name,
      'currency', a.currency,
      'amount_minor', a.amount_minor,
      'typical_amount_minor', a.typical_amount_minor,
      'change_percent', a.change_percent,
      'changed', a.changed,
      'typical_day', a.typical_day,
      'transaction_id', a.transaction_id,
      'project_id', a.project_id,
      'project_name', p.name,
      'category_id', a.category_id,
      'category_name', c.name,
      'source', a.source,
      'pace', a.pace,
      'alert_key', a.transaction_id::text,
      'line_count', n.line_count
    ) order by
      case when p_changes then abs(a.change_percent) end desc,
      a.direction = 'income', coalesce(s.name, cu.name), a.party_id), '[]'::jsonb)
  from (
    select ar.*,
      abs(abs(ar.amount_minor) - abs(ar.typical_amount_minor)) * 5 >= abs(ar.typical_amount_minor) as changed
    from private.recurring_arrivals(p_company, p_today) ar
  ) a
  left join public.suppliers s on a.direction = 'expense' and s.company_id = p_company and s.id = a.party_id
  left join public.customers cu on a.direction = 'income' and cu.company_id = p_company and cu.id = a.party_id
  left join public.projects p on p.company_id = p_company and p.id = a.project_id
  left join public.categories c on c.company_id = p_company and c.id = a.category_id
  -- FLOW-913: how many of this month's lines make up the amount, with recurring_arrivals' filters.
  cross join lateral (
    select count(*)::integer as line_count
    from public.transactions t
    where t.company_id = p_company and t.direction = a.direction and t.currency = a.currency
      -- FLOW-430: a party answered "the same" counts as the recurring one.
      and a.party_id = private.recurring_party_of(p_company, t.direction,
        case when a.direction = 'expense' then t.supplier_id else t.customer_id end)
      and t.removed_at is null
      and t.line_status = 'posted'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= date_trunc('month', p_today)::date
      and t.doc_date <= p_today
  ) n
  where coalesce(s.id, cu.id) is not null
    and (not p_changes or (a.changed and not exists (
      select 1 from public.recurring_dismissals x
      where x.user_id = auth.uid() and x.company_id = p_company and x.kind = 'change'
        and x.alert_key = a.transaction_id::text
    )));
$function$;

-- A project's recurring arrivals read posted lines only.
create or replace function private.project_recurring_arrivals(p_company uuid, p_project uuid, p_today date)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, amount_minor bigint, typical_amount_minor bigint, change_percent integer, typical_day integer, transaction_id uuid, line_count integer, category_id uuid, source text, pace text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6,
      (date_trunc('month', p_today) - interval '24 months')::date as window24
  ),
  r as (
    select rp.* from private.recurring_parties(p_company, p_today) rp
    where rp.seen_this_month and rp.months_seen > 0
  ),
  shares as (
    select r.direction, r.party_id, r.currency, r.pace, t.id, t.doc_date, t.created_at,
      date_trunc('month', t.doc_date)::date as month, t.line_status = 'posted' as posted,
      case
        when exists (select 1 from public.line_splits s where s.company_id = p_company and s.transaction_id = t.id)
          then sign(t.amount_net)::bigint * (
            select coalesce(sum(s.amount_minor), 0) from public.line_splits s
            where s.company_id = p_company and s.transaction_id = t.id
              and coalesce(s.project_id, t.project_id) = p_project)
        when t.project_id = p_project then t.amount_net::bigint
        else 0
      end as share
    from r
    cross join bounds b
    join public.transactions t
      on t.company_id = p_company and t.direction = r.direction and t.currency = r.currency
      -- FLOW-430: a party answered "the same" counts as the recurring one.
      and r.party_id = private.recurring_party_of(p_company, t.direction,
        case when r.direction = 'expense' then t.supplier_id else t.customer_id end)
    where t.removed_at is null
      and t.line_status = 'posted'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= b.window24
      and t.doc_date <= p_today
  ),
  usual as (
    -- As recurring_parties: complete posted months, the last 6 for a monthly party, else 24.
    select m.direction, m.party_id, m.currency,
      percentile_disc(0.5) within group (order by abs(m.amount)) as amount
    from (
      select s.direction, s.party_id, s.currency, s.month, sum(s.share) as amount
      from shares s, bounds b
      where s.posted and s.month < b.this_month
        and s.month >= case when s.pace = 'month' then b.window6 else b.window24 end
      group by s.direction, s.party_id, s.currency, s.month
      having sum(s.share) <> 0
    ) m
    group by m.direction, m.party_id, m.currency
  ),
  this_month as (
    select s.direction, s.party_id, s.currency, sum(s.share)::bigint as amount, count(*)::integer as line_count,
      (array_agg(s.id order by s.doc_date desc, s.created_at desc))[1] as transaction_id
    from shares s, bounds b
    where s.share <> 0 and s.doc_date >= b.this_month
    group by s.direction, s.party_id, s.currency
  )
  select r.direction, r.party_id, r.currency, m.amount,
    ((case when r.direction = 'expense' then -1 else 1 end) * u.amount)::bigint,
    round((abs(m.amount) - u.amount) * 100.0 / u.amount)::integer,
    r.typical_day, m.transaction_id, m.line_count, r.category_id, r.source, r.pace
  from r
  join this_month m on m.direction = r.direction and m.party_id = r.party_id and m.currency = r.currency
  join usual u on u.direction = r.direction and u.party_id = r.party_id and u.currency = r.currency
  where m.amount <> 0 and u.amount <> 0;
$function$;

-- The schedule's this-month amount sums posted lines only.
create or replace function private.recurring_schedule_json(p_company uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with this_month as (
    select date_trunc('month', p_today)::date as month_start
  ),
  due as (
    select r.*,
      make_date(extract(year from r.next_due_month)::integer, extract(month from r.next_due_month)::integer,
        least(r.typical_day + 5, extract(day from private.month_end(r.next_due_month))::integer)) as expected_by
    from private.recurring_parties(p_company, p_today) r
  ),
  rows as (
    select d.*,
      case
        when d.seen_this_month then 'arrived'
        when d.next_due_month > (select month_start from this_month) then 'later'
        when p_today > d.expected_by
          or (p_today = d.expected_by and d.expected_by = private.month_end(d.next_due_month)) then 'late'
        else 'soon'
      end as state
    from due d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', x.direction,
      'party_id', x.party_id,
      'party_name', coalesce(s.name, cu.name),
      'currency', x.currency,
      'state', x.state,
      'typical_amount_minor', x.typical_amount_minor,
      'amount_minor', case when x.seen_this_month then ma.amount end,
      'typical_day', x.typical_day,
      'pace', x.pace,
      'next_due_month', to_char(x.next_due_month, 'YYYY-MM'),
      'expected_by', x.expected_by,
      'project_id', x.project_id,
      'project_name', p.name,
      'category_id', x.category_id,
      'category_name', c.name
    ) order by
      case x.state when 'arrived' then 0 when 'late' then 1 when 'soon' then 2 else 3 end,
      x.direction = 'income', x.typical_day, coalesce(s.name, cu.name), x.party_id), '[]'::jsonb)
  from rows x
  -- This month's live lines of the party, the same sum recurring_arrivals takes.
  left join lateral (
    select sum(t.amount_net)::bigint as amount
    from public.transactions t
    where t.company_id = p_company and t.direction = x.direction and t.currency = x.currency
      and x.party_id = case when x.direction = 'expense' then t.supplier_id else t.customer_id end
      and t.removed_at is null
      and t.line_status = 'posted'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= date_trunc('month', p_today)::date
      and t.doc_date <= p_today
  ) ma on x.seen_this_month
  left join public.suppliers s on x.direction = 'expense' and s.company_id = p_company and s.id = x.party_id
  left join public.customers cu on x.direction = 'income' and cu.company_id = p_company and cu.id = x.party_id
  left join public.projects p on p.company_id = p_company and p.id = x.project_id
  left join public.categories c on c.company_id = p_company and c.id = x.category_id
  where coalesce(s.id, cu.id) is not null;
$function$;

-- A new party is suggested from posted lines only.
create or replace function private.recurring_match_suggestion(p_company uuid, p_direction txn_direction, p_party uuid, p_currency text, p_due_month date, p_typical bigint, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select coalesce(s.name, cu.name) as name
    from (select 1) one
    left join public.suppliers s on p_direction = 'expense' and s.company_id = p_company and s.id = p_party
    left join public.customers cu on p_direction = 'income' and cu.company_id = p_company and cu.id = p_party
  ),
  candidates as (
    select n.id, n.name
    from (
      select s.id, s.name from public.suppliers s where p_direction = 'expense' and s.company_id = p_company
      union all
      select cu.id, cu.name from public.customers cu where p_direction = 'income' and cu.company_id = p_company
    ) n, me
    where n.id <> p_party
      and private.party_names_alike(me.name, n.name)
      and not exists (
        select 1 from public.recurring_matches m
        where m.company_id = p_company and m.direction = p_direction
          and ((m.party_id = p_party and m.match_party_id = n.id) or (m.match_party_id = n.id and m.same)
            or m.party_id = n.id)
      )
  ),
  latest as (
    select distinct on (c.id) c.id, c.name, t.id as transaction_id, t.doc_date, t.amount_net
    from candidates c
    join public.transactions t
      on t.company_id = p_company and t.direction = p_direction and t.currency = p_currency
      and c.id = case when p_direction = 'expense' then t.supplier_id else t.customer_id end
    where t.removed_at is null
      and t.line_status = 'posted'
      and (p_direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= (p_due_month - interval '1 month')::date
      and t.doc_date <= p_today
      -- First seen lately: no line before the month ahead of the due month.
      and not exists (
        select 1 from public.transactions o
        where o.company_id = p_company and o.removed_at is null and o.line_status = 'posted'
          and c.id = case when p_direction = 'expense' then o.supplier_id else o.customer_id end
          and o.doc_date < (p_due_month - interval '1 month')::date
      )
    order by c.id, t.doc_date desc, t.created_at desc
  )
  select jsonb_build_object(
      'party_id', l.id,
      'party_name', l.name,
      'transaction_id', l.transaction_id,
      'doc_date', l.doc_date,
      'amount_minor', l.amount_net
    )
  from latest l
  where p_typical <> 0
    and abs(l.amount_net) * 2 >= abs(p_typical)
    and abs(l.amount_net) * 2 <= abs(p_typical) * 3
  order by abs(abs(l.amount_net) - abs(p_typical)), l.doc_date desc, l.id
  limit 1;
$function$;

-- A recurring party's latest line is a posted one.
create or replace function public.recurring_party_line(p_direction text, p_party_id uuid, p_currency text, p_today date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  line_id uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('income', 'expense') then
    raise exception 'validation';
  end if;
  select t.id into line_id
  from public.transactions t
  where t.company_id = cid
    and t.direction = p_direction::public.txn_direction
    and t.currency = p_currency
    and p_party_id = case when t.direction = 'expense' then t.supplier_id else t.customer_id end
    and t.removed_at is null
    and t.line_status = 'posted'
    and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
    and t.doc_date <= coalesce(p_today, private.flow_today())
  order by t.doc_date desc, t.created_at desc
  limit 1;
  return line_id;
end;
$function$;

-- A lender's first date is its first posted line.
create or replace function public.get_setup_suggestions(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  cur text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.base_currency into cur from public.companies c where c.id = cid;

  return jsonb_build_object(
    'projects', '[]'::jsonb,
    'lenders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', s.name,
          'monthly_agorot', -r.typical_amount_minor,
          'since', f.first_doc_date
        )
        order by s.name, s.id
      )
      from private.recurring_parties(cid, today) r
      join public.suppliers s on s.company_id = cid and s.id = r.party_id
      join lateral (
        select min(t.doc_date) as first_doc_date
        from public.transactions t
        where t.company_id = cid
          and t.supplier_id = r.party_id
          and t.removed_at is null
          and t.line_status = 'posted'
      ) f on true
      where r.direction = 'expense'
        and r.currency = cur
        and r.months_seen >= 3
        and not exists (
          select 1 from public.loans l
          where l.company_id = cid
            and lower(btrim(l.name)) = lower(btrim(s.name))
        )
        and not exists (
          select 1
          from public.loan_splits ls
          join public.transactions lt on lt.company_id = cid and lt.id = ls.transaction_id
          where ls.company_id = cid
            and lt.supplier_id = r.party_id
        )
    ), '[]'::jsonb)
  );
end;
$function$;
-- Open review rows of lines still pending leave the queue now; the transactions stay.
delete from public.review_queue q
using public.transactions t
where t.id = q.transaction_id
  and q.status = 'open'
  and t.line_status = 'pending';

commit;
