-- P6: line lists, review, recurring and Jev readers read parts through the split_parts / loan_parts views.

CREATE OR REPLACE FUNCTION public.search_transactions(p_query text DEFAULT NULL::text, p_scope text DEFAULT 'all'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_project text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_amount_min bigint DEFAULT NULL::bigint, p_amount_max bigint DEFAULT NULL::bigint, p_category_exact boolean DEFAULT false)
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
              select 1 from private.split_parts sp
              where sp.transaction_id = t.id and sp.company_id = cid
              having bool_and(sp.project_id is not null)
            )
          )
          or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.company_id = cid and a.project_id = want_project
          )
          or exists (
            select 1 from private.split_parts sp
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
              select 1 from private.split_parts sp
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
              select 1 from private.split_parts sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from private.loan_parts ls
              where ls.transaction_id = t.id and ls.company_id = cid
              having not bool_or(ls.needs_review)
            )
          )
          or exists (
            select 1 from private.split_parts sp
            where sp.transaction_id = t.id and sp.company_id = cid and sp.category_id = any(want_categories)
          )
          or exists (
            select 1 from private.loan_parts ls
            where ls.transaction_id = t.id and ls.company_id = cid and ls.category_id = any(want_categories)
          )
        )
        and (
          not no_category
          or (
            t.category_id is null
            and not exists (
              select 1 from private.split_parts sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from private.loan_parts ls
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
            select count(*)::int from private.split_parts sp
            where sp.transaction_id = page.id and sp.company_id = cid
          ),
          'loan_matched', exists (
            select 1 from private.loan_parts ls
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_review_queue(p_company_id uuid)
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
          union all select 1 from private.split_parts s where s.transaction_id = t.id
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
          union all select 1 from private.split_parts s where s.transaction_id = t.id
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
    -- FLOW-941: a line in a confirmed transfer pair is not queued.
    and not exists (
      select 1 from public.transfer_matches m
      where m.company_id = t.company_id and m.same
        and t.id in (m.out_transaction_id, m.in_transaction_id)
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
    -- FLOW-941: a line in a confirmed transfer pair is not queued.
    and not exists (
      select 1 from public.transfer_matches m
      where m.company_id = t.company_id and m.same
        and t.id in (m.out_transaction_id, m.in_transaction_id)
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_transaction(p_id uuid)
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
        select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ),
    'loan_split', public.get_loan_split(t.id),
    -- FLOW-149: a journal entry (it moves no money) and its reference; null for any other line.
    'journal_entry', (select jsonb_build_object('reference', j.reference)
                      from public.journal_entries j
                      where j.transaction_id = t.id and j.company_id = t.company_id),
    'pnl_state', private.line_pnl_state(t.id),
    'in_cash_override', t.in_cash_override,
    'cash_state', private.line_cash_state(t.id),
    'pnl_fixed', c.loan_part is not null
      or exists (select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id),
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
$function$
;

CREATE OR REPLACE FUNCTION private.follow_invoice(p_invoice uuid, p_owner boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv record;
  receipt_ids uuid[];
  waiting boolean;
  filed boolean;
  settled_id uuid;
  settled_status public.review_status;
  r record;
  own_row uuid;
  paired_row uuid;
  open_row uuid;
  prior_shares jsonb;
  want_shares jsonb;
  want_user boolean;
  want_suggested boolean;
  want_cat_assigned boolean;
  want_proj_assigned boolean;
  owner_filed boolean;
  receipt_filed boolean;
begin
  receipt_ids := array(select private.invoice_receipts(p_invoice));
  if cardinality(receipt_ids) = 0 then
    return;
  end if;

  select t.id, t.company_id, t.project_id, t.category_id, t.pnl_role, t.user_assigned,
         t.category_suggested, t.category_assigned, t.project_assigned,
         c.excluded_from_pnl, c.loan_part
  into inv
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.id = p_invoice;

  -- Rule 1: the invoice waits. A split_mismatch row is the receipt's own review and stays.
  waiting := private.invoice_waits(inv.id);
  if waiting then
    delete from public.review_queue q
    where q.company_id = inv.company_id
      and q.transaction_id = any(receipt_ids)
      and q.status = 'open'
      and q.reason is distinct from 'split_mismatch';
    return;
  end if;

  -- Rule 2 needs a filed invoice on one project or on none: a category, and a project unless
  -- the category keeps the line out of the P&L. A shared or overhead invoice, or one split by
  -- category, is left alone.
  filed := inv.category_id is not null
    and coalesce(inv.pnl_role, 'project') = 'project'
    and not exists (
      select 1 from private.split_parts sp
      where sp.transaction_id = inv.id and sp.company_id = inv.company_id
    )
    and (
      inv.project_id is not null
      or private.line_category_out(inv.excluded_from_pnl, inv.category_suggested, inv.loan_part)
    );
  if not filed then
    return;
  end if;

  select q.id, q.status into settled_id, settled_status
  from public.review_queue q
  where q.transaction_id = inv.id
    and q.company_id = inv.company_id
    and q.status in ('approved', 'changed')
  order by q.resolved_at desc nulls last, q.created_at desc, q.id desc
  limit 1;

  for r in
    select t.*
    from public.transactions t
    where t.id = any(receipt_ids) and t.company_id = inv.company_id
    order by t.doc_date, t.id
    -- A receipt another transaction holds (a sync writing it) is skipped rather than waited
    -- for, which could deadlock with a sync that holds the receipt and waits for the invoice.
    -- A skipped receipt that is still unfiled is queued by the next sync, and its row's insert
    -- pairs it then.
    for update skip locked
  loop
    select q.id into paired_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id
      and q.paired_with is not null and q.status in ('approved', 'changed')
    order by q.created_at desc, q.id desc
    limit 1;

    select q.id into open_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id and q.status = 'open'
    order by q.created_at desc, q.id desc
    limit 1;

    -- The owner filed this receipt on their own: it keeps that filing.
    select q.id into own_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id
      and q.paired_with is null and q.status in ('approved', 'changed')
    limit 1;
    -- So is a receipt split by category, whose split this would lose.
    owner_filed := (paired_row is null and open_row is null and (own_row is not null or r.user_assigned))
      or exists (
        select 1 from private.split_parts sp
        where sp.transaction_id = r.id and sp.company_id = r.company_id
      );
    if owner_filed then
      continue;
    end if;
    -- A receipt the owner refiled after the joint approval is theirs too: it stops following.
    if paired_row is not null and exists (
      select 1 from public.review_queue q
      where q.id = paired_row
        -- A null left by a deleted project or category is not the owner's choice.
        and ((r.project_id is not null and r.project_id is distinct from q.paired_project_id)
          or (r.category_id is not null and r.category_id is distinct from q.paired_category_id))
    ) then
      update public.review_queue set paired_with = null where id = paired_row;
      continue;
    end if;
    if not coalesce(p_owner, false) and paired_row is null and open_row is null then
      select r.category_id is not null and (
        r.project_id is not null
        or private.line_category_out(c.excluded_from_pnl, r.category_suggested, c.loan_part)
      )
      into receipt_filed
      from (select 1) one
      left join public.categories c on c.id = r.category_id and c.company_id = r.company_id;
      if receipt_filed then
        continue;
      end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', a.project_id,
      'share_bp', a.share_bp,
      'amount_net', a.amount_net
    )), '[]'::jsonb)
    into prior_shares
    from public.allocations a
    where a.transaction_id = r.id and a.company_id = r.company_id;

    want_user := case when settled_id is null then inv.user_assigned else true end;
    want_suggested := case when settled_id is null then inv.category_suggested else false end;
    want_cat_assigned := case when settled_id is null then inv.category_assigned else true end;
    want_proj_assigned := case when settled_id is null then inv.project_assigned else inv.project_id is not null end;
    want_shares := case
      when inv.pnl_role = 'project' and inv.project_id is not null then jsonb_build_array(jsonb_build_object(
        'project_id', inv.project_id,
        'share_bp', 10000,
        'amount_net', r.amount_net
      ))
      else '[]'::jsonb
    end;

    -- Only a real change writes, so a sync that touches the pair again adds no audit rows.
    if r.project_id is distinct from inv.project_id
      or r.category_id is distinct from inv.category_id
      or r.pnl_role is distinct from inv.pnl_role
      or r.user_assigned is distinct from want_user
      or r.category_suggested is distinct from want_suggested
      or r.category_assigned is distinct from want_cat_assigned
      or r.project_assigned is distinct from want_proj_assigned
    then
      update public.transactions
      set project_id = inv.project_id,
          category_id = inv.category_id,
          pnl_role = inv.pnl_role,
          user_assigned = want_user,
          category_suggested = want_suggested,
          category_assigned = want_cat_assigned,
          project_assigned = want_proj_assigned
      where id = r.id and company_id = r.company_id;
    end if;

    if prior_shares is distinct from want_shares then
      delete from public.allocations where transaction_id = r.id and company_id = r.company_id;
      if jsonb_array_length(want_shares) > 0 then
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (r.company_id, r.id, inv.project_id, 10000, r.amount_net);
      end if;
    end if;

    if paired_row is not null then
      -- Already settled with the invoice: the snapshot from then stays.
      update public.review_queue
      set paired_with = coalesce(settled_id, paired_with),
          status = coalesce(settled_status, status),
          paired_project_id = inv.project_id,
          paired_category_id = inv.category_id
      where id = paired_row
        and (paired_with is distinct from coalesce(settled_id, paired_with)
          or status is distinct from coalesce(settled_status, status)
          or paired_project_id is distinct from inv.project_id
          or paired_category_id is distinct from inv.category_id);
    elsif settled_id is not null then
      if open_row is not null then
        delete from public.review_queue q
        where q.transaction_id = r.id and q.company_id = r.company_id
          and q.status = 'open' and q.id <> open_row;
        update public.review_queue
        set status = settled_status,
            resolved_at = now(),
            paired_with = settled_id,
            paired_project_id = inv.project_id,
            paired_category_id = inv.category_id,
            prior_project_id = r.project_id,
            prior_category_id = r.category_id,
            prior_pnl_role = r.pnl_role,
            prior_user_assigned = r.user_assigned,
            prior_category_suggested = r.category_suggested,
            prior_category_assigned = r.category_assigned,
            prior_project_assigned = r.project_assigned,
            prior_allocations = prior_shares,
            doc_fingerprint = private.doc_fingerprint(
              r.direction::text, r.doc_kind::text, r.amount_gross, r.doc_date, r.description, r.external_id
            )
        where id = open_row;
      else
        insert into public.review_queue (
          company_id, transaction_id, status, reason, resolved_at, paired_with,
          paired_project_id, paired_category_id, prior_project_id, prior_category_id, prior_pnl_role, prior_user_assigned,
          prior_category_suggested, prior_category_assigned, prior_project_assigned,
          prior_allocations, doc_fingerprint
        ) values (
          r.company_id, r.id, settled_status, null, now(), settled_id,
          inv.project_id, inv.category_id, r.project_id, r.category_id, r.pnl_role, r.user_assigned,
          r.category_suggested, r.category_assigned, r.project_assigned,
          prior_shares,
          private.doc_fingerprint(
            r.direction::text, r.doc_kind::text, r.amount_gross, r.doc_date, r.description, r.external_id
          )
        );
      end if;
    else
      -- Filed without review: the receipt is filed the same way and waits for nothing.
      delete from public.review_queue q
      where q.transaction_id = r.id and q.company_id = r.company_id and q.status = 'open';
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.line_anomalies(p_company uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with target as (
    select t.id, t.direction, coalesce(t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.amount_net, t.amount_gross, t.doc_kind, t.external_id, t.linked_external_id
    from public.transactions t
    where t.company_id = p_company
      and t.id = any (p_ids)
      and t.removed_at is null
      and t.line_status <> 'void'
  ),
  -- The company's 90th percentile posted line, per direction and currency, over the year up to
  -- the newest target line. Materialized, so it is read once and not per line.
  p90 as materialized (
    select c.direction, c.currency,
      percentile_disc(0.9) within group (order by abs(c.amount_net)) as amount
    from public.transactions c
    where c.company_id = p_company
      and c.removed_at is null and c.line_status = 'posted'
      and (c.direction = 'expense' or c.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and c.doc_date >= (select max(doc_date) from target) - 365
      and c.doc_date <= (select max(doc_date) from target)
      and (c.direction, c.currency) in (select direction, currency from target)
    group by c.direction, c.currency
    having count(*) >= 20
  ),
  duplicate as (
    select tg.id, 'duplicate' as kind, jsonb_build_object(
        'other_transaction_id', d.id,
        'other_doc_date', d.doc_date
      ) as detail
    from target tg
    cross join lateral (
      select o.id, o.doc_date
      from public.transactions o
      where o.company_id = p_company
        and o.id <> tg.id
        and o.direction = tg.direction
        and coalesce(o.supplier_id, o.customer_id) = tg.party_id
        and o.currency = tg.currency
        and o.amount_gross = tg.amount_gross
        and o.doc_kind = tg.doc_kind
        and o.removed_at is null
        and o.line_status = 'posted'
        and o.doc_date between tg.doc_date - 7 and tg.doc_date + 7
        -- Not a document and the one it links to.
        and coalesce(o.linked_external_id <> tg.external_id, true)
        and coalesce(tg.linked_external_id <> o.external_id, true)
        -- Not an invoice that a credit note cancels (cancelled and issued again).
        and not exists (
          select 1 from public.transactions cr
          where cr.company_id = p_company and cr.doc_kind = 'credit' and cr.removed_at is null
            and cr.line_status <> 'void'
            and cr.linked_external_id is not null
            and cr.linked_external_id in (o.external_id, tg.external_id)
        )
        -- Not two loans' payments to the same lender.
        and not exists (
          select 1 from private.loan_parts a
          join private.loan_parts b on b.company_id = a.company_id and b.loan_id <> a.loan_id
          where a.company_id = p_company and a.transaction_id = tg.id and b.transaction_id = o.id
        )
      order by abs(o.doc_date - tg.doc_date), o.id
      limit 1
    ) d
    where tg.party_id is not null and tg.amount_gross <> 0
  ),
  history as (
    select tg.id, tg.amount_net,
      (select count(*) from public.transactions h
       where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
         and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
         and h.removed_at is null and h.line_status = 'posted'
         and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and h.doc_date < tg.doc_date) as earlier,
      (select percentile_disc(0.5) within group (order by abs(h.amount_net))
       from (
         select h.amount_net from public.transactions h
         where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
           and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
           and h.removed_at is null and h.line_status = 'posted'
           and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
           and h.doc_date < tg.doc_date and h.doc_date >= tg.doc_date - 365
         order by h.doc_date desc limit 12
       ) h) as typical,
      (select count(*) from public.transactions h
       where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
         and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
         and h.removed_at is null and h.line_status = 'posted'
         and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and h.doc_date < tg.doc_date and h.doc_date >= tg.doc_date - 365) as recent,
      (select p.amount from p90 p
       where p.direction = tg.direction and p.currency = tg.currency) as company_p90
    from target tg
    where tg.party_id is not null
      -- A receipt that pays several invoices is not compared with single invoices.
      and (tg.direction = 'expense' or tg.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
  ),
  spike as (
    select h.id, 'amount_spike' as kind, jsonb_build_object(
        'typical_amount_minor', h.typical,
        'ratio', round(abs(h.amount_net)::numeric / h.typical, 1)
      ) as detail
    from history h
    where h.recent >= 3
      and h.typical > 0
      and abs(h.amount_net) >= 3 * h.typical
      and abs(h.amount_net) - h.typical >= 10000
  ),
  new_party as (
    select h.id, 'new_party_large' as kind, jsonb_build_object(
        'company_p90_minor', h.company_p90
      ) as detail
    from history h
    where h.earlier = 0
      and h.company_p90 is not null
      and abs(h.amount_net) >= h.company_p90
      and abs(h.amount_net) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id', a.id, 'kind', a.kind) || a.detail
    order by a.id, a.kind), '[]'::jsonb)
  from (
    select * from duplicate
    union all select * from spike
    union all select * from new_party
  ) a;
$function$
;

CREATE OR REPLACE FUNCTION public.answer_transfer_match(p_out_transaction_id uuid, p_in_transaction_id uuid, p_same boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  o public.transactions%rowtype;
  i public.transactions%rowtype;
  cur public.transfer_matches%rowtype;
  prior_same boolean;
  lo record;
  li record;
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
      if exists (
        select 1 from public.transfer_matches m
        where m.company_id = cid and m.same
          and (m.out_transaction_id = o.id or m.in_transaction_id = i.id
            or m.out_transaction_id = i.id or m.in_transaction_id = o.id)
      ) then
        raise exception 'already matched';
      end if;
      if exists (select 1 from private.loan_parts x where x.company_id = cid and x.transaction_id in (o.id, i.id)) then
        raise exception 'loan line is fixed';
      end if;
      if exists (select 1 from private.split_parts x where x.company_id = cid and x.transaction_id in (o.id, i.id)) then
        raise exception 'line has a split by category';
      end if;
      -- The list's own rule (transfer_match_lines: posted, synced, still in the P&L, not a credit note,
      -- not an invoice's deposit, …) for both lines, then the pair's: two connections, the same amount
      -- and currency, 3 days apart at most.
      select l.* into lo from private.transfer_match_lines(cid, array[o.id]) l where l.direction = 'expense';
      select l.* into li from private.transfer_match_lines(cid, array[i.id]) l where l.direction = 'income';
      if lo.id is null or li.id is null
        or lo.currency <> li.currency or lo.amount <> li.amount
        or lo.slot = li.slot
        or abs(lo.doc_date - li.doc_date) > 3
      then
        raise exception 'not a transfer pair';
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
$function$
;

CREATE OR REPLACE FUNCTION private.transfer_match_lines(p_company uuid, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, direction txn_direction, doc_date date, currency text, amount bigint, slot smallint, org_label text, party text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select t.id, t.direction, t.doc_date, t.currency, t.amount_original, a.slot, a.org_label,
    case when t.direction = 'expense' then s.name else cu.name end
  from public.transactions t
  join private.mercury_synced_accounts(p_company) a on a.account_id = t.provider_meta->>'account_id'
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  left join public.suppliers s on s.id = t.supplier_id and s.company_id = t.company_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  where t.company_id = p_company
    and (p_ids is null or t.id = any (p_ids))
    and t.source = 'mercury'
    and t.removed_at is null
    and t.line_status = 'posted'
    and t.doc_kind <> 'credit'
    and t.amount_original > 0
    and private.line_in_pnl(
      t.in_pnl_override,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part)
    and not exists (select 1 from private.loan_parts x where x.company_id = p_company and x.transaction_id = t.id)
    and not exists (select 1 from private.split_parts x where x.company_id = p_company and x.transaction_id = t.id)
    and not exists (
      select 1 from public.invoice_payment_links x where x.company_id = p_company and x.bank_transaction_id = t.id
    )
    and not exists (
      select 1 from public.transfer_matches m
      where m.company_id = p_company and m.same and t.id in (m.out_transaction_id, m.in_transaction_id)
    );
$function$
;

CREATE OR REPLACE FUNCTION private.recurring_parties(p_company uuid, p_today date, p_overrides boolean DEFAULT true)
 RETURNS TABLE(direction txn_direction, party_id uuid, currency text, months_seen integer, typical_day integer, typical_amount_minor bigint, last_doc_date date, seen_this_month boolean, project_id uuid, category_id uuid, last_amount_minor bigint, source text, pace text, pace_source text, next_due_month date, typical_amount_source text, pays_loan boolean, this_month_minor bigint, this_month_transaction_id uuid, this_month_line_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6
  ),
  -- One recurring charge per party and project (recurring_stream_lines): a servicer paying two
  -- loans, or a utility billing two properties, is two charges, each with its own usual amount.
  -- A split line counts only its parts for the charge (decision 0189).
  lines as (
    select sl.direction, sl.party_id, sl.currency, sl.stream_project,
      sl.doc_date, sl.amount_net, sl.project_id, sl.category_id,
      date_trunc('month', sl.doc_date)::date as month, true as posted,
      sl.id, sl.created_at
    from private.recurring_stream_lines(p_company, p_today) sl
  ),
  -- The owner's words: a row with a project is that charge's; a row with none is the party's (decision 0188).
  overrides as (
    select o.direction, o.party_id, o.currency, o.project_id, o.recurring, o.pace, o.typical_amount_minor
    from public.recurring_overrides o
    where o.company_id = p_company and p_overrides
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month and l.posted
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  gapped as (
    select m.*,
      private.month_diff(m.month, lag(m.month) over w) as gap,
      row_number() over (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month desc) as back
    from monthly m
    window w as (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month)
  ),
  stats as (
    select g.direction, g.party_id, g.currency, g.stream_project,
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
    group by g.direction, g.party_id, g.currency, g.stream_project
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
  -- The party's main charge: the project it billed in the most of the last six complete months (then the
  -- latest). A party-wide "recurring" (a row with no project) makes only this charge recurring (decision 0185).
  main as (
    select distinct on (l.direction, l.party_id, l.currency) l.direction, l.party_id, l.currency, l.stream_project
    from lines l, bounds b
    group by l.direction, l.party_id, l.currency, l.stream_project
    order by l.direction, l.party_id, l.currency,
      count(distinct l.month) filter (where l.month >= b.window6 and l.month < b.this_month) desc, max(l.doc_date) desc,
      l.stream_project nulls last
  ),
  -- The owner's word on each charge (decision 0188). The charge's own row wins, field by field. Else the
  -- party-wide row: "not recurring" ends every charge, "recurring" makes the main charge recurring, and its
  -- pace is every charge's. The usual amount is only the charge's own (decision 0189): a charge with no
  -- project reads it from the row with no project.
  words as (
    select s.direction, s.party_id, s.currency, s.stream_project,
      coalesce(own.recurring, case
        when pw.recurring is false then false
        when pw.recurring and s.stream_project is not distinct from mn.stream_project then true
      end) as recurring,
      coalesce(own.pace, pw.pace) as pace,
      coalesce(own.typical_amount_minor, case when s.stream_project is null then pw.typical_amount_minor end) as amount
    from (select distinct l.direction, l.party_id, l.currency, l.stream_project from lines l) s
    left join main mn on mn.direction = s.direction and mn.party_id = s.party_id and mn.currency = s.currency
    left join overrides own on own.direction = s.direction and own.party_id = s.party_id and own.currency = s.currency
      and own.project_id = s.stream_project
    left join overrides pw on pw.direction = s.direction and pw.party_id = s.party_id and pw.currency = s.currency
      and pw.project_id is null
  ),
  parties as (
    select d.direction, d.party_id, d.currency, d.stream_project, d.auto_pace,
      coalesce(w.pace, d.auto_pace, 'month') as pace,
      w.recurring, w.pace as pace_override, w.amount as owner_amount,
      d.months6, d.day6, d.amount6, d.months24, d.day24, d.amount24, d.last_month, d.gap_last
    from detected d
    left join words w on w.direction = d.direction and w.party_id = d.party_id and w.currency = d.currency
      and w.stream_project is not distinct from d.stream_project
    where case
      when w.recurring is false then false
      when d.auto_pace is not null then true
      else coalesce(w.recurring, false)
    end
  ),
  -- A charge that comes every 2 months, quarter or year (decision 0199): its usual day and amount come only
  -- from the months on its cycle, counted back from its last complete month (last, last - pace, last - 2 x
  -- pace, ... within the 24 months the lines cover). The months before a switch to yearly billing (the old
  -- monthly bills) and an off-cycle extra no longer pull the median down. The same median rule: by size,
  -- the direction's sign added in chosen. A yearly charge steps by its last gap when that is 11 to 13 months,
  -- the drift the yearly rule allows (0175), so a bill a month early or late still finds last year's.
  cycle_months as (
    select p.direction, p.party_id, p.currency, p.stream_project, g.month, g.first_day, g.amount
    from parties p
    join gapped g on g.direction = p.direction and g.party_id = p.party_id and g.currency = p.currency
      and g.stream_project is not distinct from p.stream_project
    where p.pace <> 'month'
      and private.month_diff(p.last_month, g.month)
        % case when p.pace = 'year' and p.gap_last between 11 and 13 then p.gap_last else private.pace_months(p.pace) end = 0
  ),
  cycle as (
    select cm.direction, cm.party_id, cm.currency, cm.stream_project,
      percentile_disc(0.5) within group (order by cm.first_day) as day_cycle,
      percentile_disc(0.5) within group (order by abs(cm.amount)) as amount_cycle
    from cycle_months cm
    group by cm.direction, cm.party_id, cm.currency, cm.stream_project
  ),
  -- A charge the owner marked recurring with no complete posted month yet: its latest month, this one
  -- included, is its usual day and amount (the owner's amount, when set).
  forced_monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l
    join words w on w.direction = l.direction and w.party_id = l.party_id and w.currency = l.currency
      and w.stream_project is not distinct from l.stream_project
    where w.recurring
      and not exists (
        select 1 from stats s
        where s.direction = l.direction and s.party_id = l.party_id and s.currency = l.currency
          and s.stream_project is not distinct from l.stream_project
      )
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  forced as (
    select distinct on (fm.direction, fm.party_id, fm.currency, fm.stream_project)
      fm.direction, fm.party_id, fm.currency, fm.stream_project, coalesce(w.pace, 'month') as pace, w.pace as pace_override,
      0 as months_seen, fm.first_day as typical_day,
      coalesce((case when fm.direction = 'expense' then -1 else 1 end) * w.amount, fm.amount)::bigint as typical_amount_minor,
      case when w.amount is null then 'computed' else 'owner' end as amount_source
    from forced_monthly fm
    join words w on w.direction = fm.direction and w.party_id = fm.party_id and w.currency = fm.currency
      and w.stream_project is not distinct from fm.stream_project
    order by fm.direction, fm.party_id, fm.currency, fm.stream_project, fm.month desc
  ),
  chosen as (
    select p.direction, p.party_id, p.currency, p.stream_project, p.pace, p.pace_override,
      case when p.pace = 'month' and p.months6 > 0 then p.months6 else p.months24 end as months_seen,
      case
        when p.pace = 'month' and p.months6 > 0 then p.day6
        -- The last month is always on its own cycle, so every known pace has cycle months; the fallback
        -- to the 24 months is only for a pace pace_months does not know.
        when p.pace <> 'month' then coalesce(c.day_cycle, p.day24)
        else p.day24
      end::integer as typical_day,
      -- The owner's amount, else the median by size (of the last 6 months for a monthly charge, of the
      -- cycle's months for any other pace), with the direction's sign, so an even count does not lean one way.
      ((case when p.direction = 'expense' then -1 else 1 end)
        * coalesce(p.owner_amount, case
            when p.pace = 'month' and p.months6 > 0 then p.amount6
            when p.pace <> 'month' then coalesce(c.amount_cycle, p.amount24)
            else p.amount24
          end))::bigint
        as typical_amount_minor,
      case when p.recurring is null then 'auto' else 'user' end as source,
      case when p.owner_amount is null then 'computed' else 'owner' end as amount_source
    from parties p
    left join cycle c on c.direction = p.direction and c.party_id = p.party_id and c.currency = p.currency
      and c.stream_project is not distinct from p.stream_project
    union all
    select f.direction, f.party_id, f.currency, f.stream_project, f.pace, f.pace_override,
      f.months_seen, f.typical_day, f.typical_amount_minor, 'user', f.amount_source
    from forced f
  ),
  -- The charges in the order they come out of chosen, kept to the end: the joins below may reorder
  -- them, and readers that list charges with equal sort keys keep the order they had.
  ordered as (
    select c.*, row_number() over () as ord
    from chosen c
  ),
  -- Each charge's last posted bill: its date and every posted line of the charge on that date, read for
  -- every charge in one pass (FLOW-943; a subquery per charge before). Every stream line is posted, so the
  -- bill's month is also the last month the charge was seen.
  bills as (
    select distinct on (l.direction, l.party_id, l.currency, l.stream_project)
      l.direction, l.party_id, l.currency, l.stream_project, l.doc_date, sum(l.amount_net)::bigint as amount
    from lines l
    where l.posted
    group by l.direction, l.party_id, l.currency, l.stream_project, l.doc_date
    order by l.direction, l.party_id, l.currency, l.stream_project, l.doc_date desc
  ),
  -- This month's lines of each charge: their sum, the latest (by date, then entry, then id) and how many.
  this_month as (
    select l.direction, l.party_id, l.currency, l.stream_project, sum(l.amount_net)::bigint as amount,
      (array_agg(l.id order by l.doc_date desc, l.created_at desc, l.id desc))[1] as transaction_id,
      count(*)::integer as line_count
    from lines l, bounds b
    where l.doc_date >= b.this_month
    group by l.direction, l.party_id, l.currency, l.stream_project
  ),
  -- The charges that pay a loan: any of the charge's lines is split into loan parts.
  loan_charges as (
    select distinct l.direction, l.party_id, l.currency, l.stream_project
    from lines l
    where exists (
      select 1 from private.loan_parts ls
      where ls.company_id = p_company and ls.transaction_id = l.id
    )
  ),
  seen as (
    select c.*,
      date_trunc('month', bl.doc_date)::date as last_seen_month,
      bl.doc_date as last_doc_date,
      bl.amount as last_amount,
      lc.direction is not null as pays_loan,
      tm.amount as this_month_minor,
      tm.transaction_id as this_month_transaction_id,
      coalesce(tm.line_count, 0) as this_month_line_count
    from ordered c
    left join bills bl on bl.direction = c.direction and bl.party_id = c.party_id and bl.currency = c.currency
      and bl.stream_project is not distinct from c.stream_project
    left join loan_charges lc on lc.direction = c.direction and lc.party_id = c.party_id and lc.currency = c.currency
      and lc.stream_project is not distinct from c.stream_project
    left join this_month tm on tm.direction = c.direction and tm.party_id = c.party_id and tm.currency = c.currency
      and tm.stream_project is not distinct from c.stream_project
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    p.last_doc_date,
    p.last_seen_month = b.this_month,
    -- The charge's project is its stream's (null when none of the party's lines has one).
    p.stream_project,
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.stream_project is not distinct from p.stream_project
       and l.category_id is not null
       -- A monthly charge's category is from its last 6 months; any other pace's from its cycle's months
       -- and this month (decision 0199), so the old monthly bills before a switch don't name it. A charge
       -- with no cycle months (marked recurring before a complete month) reads all its lines.
       and case
         when p.pace = 'month' then l.doc_date >= b.window6
         else l.month >= b.this_month
           or exists (
             select 1 from cycle_months cm
             where cm.direction = p.direction and cm.party_id = p.party_id and cm.currency = p.currency
               and cm.stream_project is not distinct from p.stream_project and cm.month = l.month)
           or not exists (
             select 1 from cycle_months cm
             where cm.direction = p.direction and cm.party_id = p.party_id and cm.currency = p.currency
               and cm.stream_project is not distinct from p.stream_project)
       end
     group by l.category_id order by count(*) desc, max(l.doc_date) desc limit 1),
    p.last_amount,
    p.source,
    p.pace,
    case when p.pace_override is null then 'auto' else 'user' end,
    -- Monthly: this month until its bill comes, then next month. Otherwise one pace after the
    -- last month it was seen (earlier than this month when it is late).
    case
      when p.pace = 'month' then
        case when p.last_seen_month = b.this_month then (b.this_month + interval '1 month')::date else b.this_month end
      else (p.last_seen_month + make_interval(months => private.pace_months(p.pace)))::date
    end,
    p.amount_source,
    p.pays_loan,
    p.this_month_minor,
    p.this_month_transaction_id,
    p.this_month_line_count
  from seen p
  cross join bounds b
  order by p.ord;
$function$
;

CREATE OR REPLACE FUNCTION private.recurring_line_parts(p_company uuid, p_from date, p_to date)
 RETURNS TABLE(id uuid, direction txn_direction, party_id uuid, line_party_id uuid, currency text, doc_date date, created_at timestamp with time zone, amount_net bigint, project_id uuid, category_id uuid, split boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lines as (
    select t.id, t.direction, coalesce(mm.party_id, t.supplier_id, t.customer_id) as party_id,
      coalesce(t.supplier_id, t.customer_id) as line_party_id, t.currency,
      t.doc_date, t.created_at, t.amount_net::bigint as amount_net, t.project_id, t.category_id
    from public.transactions t
    -- FLOW-430: a party answered "the same" counts as the recurring one.
    left join public.recurring_matches mm
      on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
      and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status = 'posted'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= p_from
      and t.doc_date <= p_to
  ),
  -- A split the P&L counts (pnl_lines, decision 0104): two or more parts that sum to the line, no loan split.
  split as (
    select l.id
    from lines l
    join private.split_parts s on s.company_id = p_company and s.transaction_id = l.id
    where not exists (select 1 from private.loan_parts ls where ls.transaction_id = l.id)
    group by l.id, l.amount_net
    having count(*) >= 2 and sum(s.amount_minor) = abs(l.amount_net)
  ),
  -- The counted parts (a kept-out category never counts), each with the project it is for: its own, else
  -- the line's. Of a line's parts for one project the charge takes one: the line's own category, else the
  -- largest part.
  parts as (
    select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at,
      (sign(l.amount_net) * s.amount_minor)::bigint as amount_net,
      coalesce(s.project_id, l.project_id) as project_id, s.category_id,
      row_number() over (
        partition by l.id, coalesce(s.project_id, l.project_id)
        order by (s.category_id = l.category_id) desc, s.amount_minor desc, s.ordinal
      ) as pick
    from lines l
    join split sp on sp.id = l.id
    join private.split_parts s on s.company_id = p_company and s.transaction_id = l.id
    join public.categories c on c.company_id = p_company and c.id = s.category_id
    where not c.excluded_from_pnl
  )
  select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at, l.amount_net,
    l.project_id, l.category_id, false
  from lines l
  where not exists (select 1 from split sp where sp.id = l.id)
  union all
  select p.id, p.direction, p.party_id, p.line_party_id, p.currency, p.doc_date, p.created_at, p.amount_net,
    p.project_id, p.category_id, true
  from parts p
  where p.pick = 1;
$function$
;

CREATE OR REPLACE FUNCTION private.party_charges_json(p_company uuid, p_transaction_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with line as (
    select t.id, t.amount_net, t.doc_date, t.project_id, t.category_id,
      date_trunc('month', t.doc_date)::date as anchor
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
  -- The party's lines in the window, a split line as its counted parts (recurring_line_parts).
  pieces as (
    select lp.*
    from party p,
      private.recurring_line_parts(p_company, (p.anchor - interval '24 months')::date,
        -- A line dated after today still reads its own month.
        greatest(p_today, (p.anchor + interval '1 month' - interval '1 day')::date)) lp
    where lp.direction = p.direction and lp.line_party_id = p.party_id and lp.currency = p.currency
  ),
  -- The line's own context: its loan when it pays one, else the project and category of its own part (a
  -- split line's part for its own project, else its largest), so a supplier with two loans (or two
  -- projects) compares this one with its own earlier charges.
  scope as (
    select
      case when own.id is not null then own.project_id else l.project_id end as project_id,
      case when own.id is not null then own.category_id else l.category_id end as category_id,
      (select ls.loan_id from private.loan_parts ls where ls.transaction_id = l.id limit 1) as loan_id
    from line l
    left join lateral (
      select pc.id, pc.project_id, pc.category_id
      from pieces pc
      where pc.id = l.id
      order by (pc.project_id is not distinct from l.project_id) desc, abs(pc.amount_net) desc
      limit 1
    ) own on true
  ),
  party_lines as (
    select pc.id, pc.doc_date, pc.amount_net as amount, pc.created_at, pc.project_id,
      date_trunc('month', pc.doc_date)::date as month,
      case
        when s.loan_id is not null then exists (
          select 1 from private.loan_parts ls where ls.transaction_id = pc.id and ls.loan_id = s.loan_id
        )
        else pc.project_id is not distinct from s.project_id and pc.category_id is not distinct from s.category_id
          and not exists (select 1 from private.loan_parts ls where ls.transaction_id = pc.id)
      end as in_scope
    from pieces pc
    cross join scope s
  ),
  lines as (
    select pl.id, pl.doc_date, pl.amount, pl.created_at, pl.month from party_lines pl where pl.in_scope
  ),
  recurring as (
    select r.typical_amount_minor as usual
    from party p, private.recurring_parties(p_company, p.as_of) r
    where r.direction = p.direction and r.party_id = p.party_id and r.currency = p.currency
      and r.typical_amount_minor <> 0
      -- As in recurring_arrivals: a party marked recurring with no complete month yet has no usual,
      -- unless the owner set it.
      and (r.months_seen > 0 or r.typical_amount_source = 'owner')
      -- The charge's usual stands for this context only when every one of its project's lines is in it.
      and not exists (
        select 1 from party_lines pl, scope s
        where not pl.in_scope and pl.project_id is not distinct from s.project_id
      )
      -- A party has one charge per project (decision 0185): the line's own charge. A line the streams
      -- leave out (dated after today, or an income receipt) reads its own project's.
      and r.project_id is not distinct from coalesce(
        (select sl.stream_project from private.recurring_stream_lines(p_company, p.as_of) sl, line l
         where sl.id = p_transaction_id
         order by (sl.project_id is not distinct from l.project_id) desc, abs(sl.amount_net) desc
         limit 1),
        (select s.project_id from scope s)
      )
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
    select coalesce((select r.usual from recurring r limit 1), (select nullif(e.usual, 0) from earlier e)) as amount,
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
$function$
;

CREATE OR REPLACE FUNCTION private.reassign_charge_line(p_company uuid, p_id uuid, p_project uuid, p_category uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line record;
  undo_id uuid;
begin
  select t.project_id, t.category_id, t.pnl_role into line
  from public.transactions t
  where t.id = p_id and t.company_id = p_company and t.removed_at is null
  for update;
  if not found then
    return null;
  end if;
  if line.pnl_role = 'shared'
    or exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_id and q.company_id = p_company
        and q.status = 'open' and q.reason = 'unallocated_shared'
    )
    or exists (select 1 from private.split_parts s where s.transaction_id = p_id and s.company_id = p_company)
  then
    return null;
  end if;
  if p_project is not null then
    if line.project_id is not distinct from p_project
      and (p_category is null or line.category_id is not distinct from p_category)
    then
      return null;
    end if;
    if coalesce(p_category, line.category_id) is null then
      return null;
    end if;
    undo_id := public.reassign_transaction(p_id, p_project, coalesce(p_category, line.category_id));
  else
    if line.category_id is not distinct from p_category then
      return null;
    end if;
    undo_id := public.set_transaction_category(p_id, p_category, true);
  end if;
  update public.reassign_undo u
  set charge_pick = true, after_project_id = t.project_id, after_category_id = t.category_id, after_pnl_role = t.pnl_role
  from public.transactions t
  where u.id = undo_id and u.company_id = p_company and t.id = p_id and t.company_id = p_company;
  return undo_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.jev_outcome_sync(p_company uuid, p_transaction uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  review public.review_status;
  sugg public.tag_suggestions%rowtype;
  line public.transactions%rowtype;
  s_project uuid;
  s_category uuid;
  f_project uuid;
  project_comparable boolean;
  category_comparable boolean;
begin
  select q.status into review
  from public.review_queue q
  where q.company_id = p_company and q.transaction_id = p_transaction
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;

  select * into sugg
  from public.tag_suggestions s
  where s.company_id = p_company and s.transaction_id = p_transaction
  order by s.created_at desc
  limit 1;

  select * into line
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction;

  if review is null or review not in ('approved', 'changed') or sugg.id is null or line.id is null
     or line.removed_at is not null then
    delete from public.jev_outcomes o where o.transaction_id = p_transaction;
    return;
  end if;

  s_project := private.jev_uuid_or_null(sugg.answers -> 'project' ->> 'choice');
  s_category := private.jev_uuid_or_null(sugg.answers -> 'category' ->> 'choice');

  project_comparable := s_project is not null
    and coalesce(line.pnl_role::text, '') not in ('shared', 'overhead')
    and (select count(*) from public.allocations a
         where a.company_id = p_company and a.transaction_id = p_transaction) <= 1
    -- A split part with no project stays on the line's project.
    and (
      not exists (
        select 1 from private.split_parts ls
        where ls.company_id = p_company and ls.transaction_id = p_transaction
      )
      or (
        select bool_and(coalesce(ls.project_id, line.project_id) is not null)
          and count(distinct coalesce(ls.project_id, line.project_id)) = 1
        from private.split_parts ls
        where ls.company_id = p_company and ls.transaction_id = p_transaction
      )
    );
  f_project := case when project_comparable then coalesce((
    select coalesce(ls.project_id, line.project_id) from private.split_parts ls
    where ls.company_id = p_company and ls.transaction_id = p_transaction
    limit 1
  ), line.project_id, (
    select a.project_id from public.allocations a
    where a.company_id = p_company and a.transaction_id = p_transaction
    limit 1
  )) end;
  category_comparable := s_category is not null
    and not exists (
      select 1 from private.split_parts ls
      where ls.company_id = p_company and ls.transaction_id = p_transaction
    );

  insert into public.jev_outcomes (
    company_id, transaction_id, suggestion_id, model_version, confidence,
    suggested_project_id, suggested_category_id, final_project_id, final_category_id,
    project_match, category_match, review_status, resolved_at
  ) values (
    p_company, p_transaction, sugg.id, sugg.model_version, sugg.confidence,
    s_project, s_category, f_project, line.category_id,
    case when project_comparable then f_project is not distinct from s_project end,
    case when category_comparable then line.category_id is not distinct from s_category end,
    review, now()
  )
  on conflict (transaction_id) do update
    set suggestion_id = excluded.suggestion_id,
        model_version = excluded.model_version,
        confidence = excluded.confidence,
        suggested_project_id = excluded.suggested_project_id,
        suggested_category_id = excluded.suggested_category_id,
        final_project_id = excluded.final_project_id,
        final_category_id = excluded.final_category_id,
        project_match = excluded.project_match,
        category_match = excluded.category_match,
        review_status = excluded.review_status,
        resolved_at = case
          when public.jev_outcomes.review_status = excluded.review_status
           and public.jev_outcomes.suggestion_id = excluded.suggestion_id
          then public.jev_outcomes.resolved_at
          else excluded.resolved_at
        end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.jev_supplier_history(p_company uuid, p_suppliers uuid[], p_per integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_per is null or p_per < 1 or p_per > 20
     or coalesce(cardinality(p_suppliers), 0) > 500 then
    raise exception 'validation';
  end if;

  with latest as (
    -- The current (newest) review row of each line of these parties, read once.
    select distinct on (q.transaction_id) q.transaction_id, q.status
    from public.review_queue q
    join public.transactions t on t.company_id = q.company_id and t.id = q.transaction_id
    where q.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
    order by q.transaction_id, q.created_at desc, q.updated_at desc, q.id desc
  ),
  filed as (
    select coalesce(t.supplier_id, t.customer_id) as party_id, t.id, t.direction, t.doc_date,
      t.description, t.amount_net, t.project_id, t.category_id, t.pnl_role,
      exists (
        select 1 from private.split_parts ls
        where ls.company_id = t.company_id and ls.transaction_id = t.id
      ) as split,
      (select count(*) from public.allocations a
       where a.company_id = t.company_id and a.transaction_id = t.id) as allocation_count,
      row_number() over (
        partition by coalesce(t.supplier_id, t.customer_id), t.direction order by t.doc_date desc, t.id desc
      ) as n
    from public.transactions t
    join latest l on l.transaction_id = t.id and l.status in ('approved', 'changed')
    where t.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
      and t.removed_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', f.party_id,
      'direction', f.direction,
      'doc_date', f.doc_date,
      'description', left(coalesce(f.description, ''), 120),
      'amount_net', f.amount_net,
      'project_id', f.project_id,
      'category_id', f.category_id,
      'pnl_role', f.pnl_role,
      'split', f.split or f.allocation_count > 1,
      'jev_project_id', o.suggested_project_id,
      'jev_category_id', o.suggested_category_id,
      'jev_corrected', o.project_match is false or o.category_match is false
    ) order by f.party_id, f.direction, f.n), '[]'::jsonb)
  into result
  from filed f
  left join public.jev_outcomes o on o.company_id = p_company and o.transaction_id = f.id
  where f.n <= p_per;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.forecast_line_candidates(p_company uuid, p_ids uuid[])
 RETURNS TABLE(line_id uuid, line_date date, edit_id uuid, month text, project_id uuid, category_id uuid, expected_minor bigint, diff bigint, edit_created timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with l as (
    select t.id, t.direction::text as direction, t.amount_net, t.amount_gross, t.category_id, t.doc_date,
      to_char(t.doc_date, 'YYYY-MM') as line_month,
      -- A category the line did not guess: a supplier rule or a bank hint, never the default.
      (t.category_id is not null and not t.category_suggested and not exists (
        select 1 from public.categories dc where dc.id = t.category_id and dc.is_default
      )) as firm
    from public.transactions t
    where t.company_id = p_company
      and t.id = any (coalesce(p_ids, array[]::uuid[]))
      and t.removed_at is null
      and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = private.company_base_currency(p_company)
      and ((t.direction = 'expense' and t.amount_net < 0) or (t.direction = 'income' and t.amount_net > 0))
      -- A line the owner split is several lines, never one forecast line.
      and coalesce(t.pnl_role::text, 'project') = 'project'
      and (select count(*) from public.allocations a where a.transaction_id = t.id) <= 1
      and not exists (select 1 from private.split_parts ls where ls.transaction_id = t.id)
  )
  select l.id, l.doc_date, e.id, l.line_month, e.project_id, e.category_id, x.expected, x.diff, e.created_at
  from l
  join public.project_forecast_edits e
    on e.company_id = p_company and e.kind = 'add' and e.direction = l.direction
   and private.pfe_hits(e.start_month, e.pace, l.line_month)
  join public.projects p on p.id = e.project_id and p.company_id = p_company and p.status = 'active'
  cross join lateral (
    select coalesce((
      select ch.amount_minor from public.project_forecast_edits ch
      where ch.company_id = p_company and ch.project_id = e.project_id and ch.kind = 'change'
        and ch.row_key = 'add:' || e.id::text
        and private.pfe_hits(ch.start_month, ch.pace, l.line_month)
      order by ch.start_month desc, ch.created_at desc
      limit 1
    ), e.amount_minor) as expected
  ) a
  cross join lateral (
    select a.expected,
      least(abs(abs(l.amount_net) - a.expected), abs(abs(l.amount_gross) - a.expected)) as diff
  ) x
  where private.pfe_category_ok(p_company, e.category_id)
    and not exists (
      select 1 from public.project_forecast_edits r
      where r.company_id = p_company and r.project_id = e.project_id and r.kind = 'remove'
        and r.row_key = 'add:' || e.id::text
        and private.pfe_hits(r.start_month, r.pace, l.line_month)
    )
    and x.expected > 0
    and x.diff <= greatest(x.expected / 10, 100)
    and (not l.firm or l.category_id = e.category_id);
$function$
;
