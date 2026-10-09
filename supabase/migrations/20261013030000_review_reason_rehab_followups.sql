-- Server follow-ups from FLOW-404 and the #300 review (FLOW-309).
-- 1. FLOW-404: get_project().investment gains rehab_by_category, the project-currency rehab
--    total by category from the same lines as rehab_minor, so the app's list always adds up
--    (a loan fees part in an ordinary category, suggested and in-review lines, shared lines
--    with no category, hidden categories). private.project_investment is otherwise as in
--    20261011060000_project_investment_currency.sql.
-- 2. FLOW-309: reopen_review takes back the missing_project row a category pick queued, as
--    undo_reassign does (20261013010000). A category the owner sets without resolving the card
--    (resolve_review or set_transaction_category with p_resolve false) relabels an open income
--    missing_category row to missing_project when the line still needs a project; sync does the
--    same for rows left from before, and this file relabels the existing ones once. Undoing
--    such a pick puts the missing_category label back.
-- Other functions are patched in place (pg_get_functiondef), each anchor checked to match once.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

create or replace function private.project_investment(p_company_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  p record;
  cur text;
  rehab bigint;
  rehab_other jsonb;
  rehab_rows jsonb;
  loan_balance bigint;
  loan_other jsonb;
begin
  select pr.investment_currency, pr.purchase_minor, pr.arv_minor, pr.value_minor, pr.value_date into p
  from public.projects pr
  where pr.id = p_project_id and pr.company_id = p_company_id;
  if not found then
    return null;
  end if;
  cur := p.investment_currency;

  with costs as (
    select l.currency, l.category_id, l.amount_net
    from private.pnl_lines l
    left join public.categories c on c.id = l.category_id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.kind = 'expense'
      and l.pnl_role = 'project'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
    union all
    select l.currency, l.category_id, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
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
  ),
  -- FLOW-404: the project-currency total by category, from the same lines, so the list adds
  -- up to rehab_minor. A line with no category is one row with a null id.
  by_category as (
    select x.category_id, (-sum(x.amount_net))::bigint as amount_minor
    from costs x
    where x.currency = cur
    group by x.category_id
  )
  select
    coalesce((select b.amount_minor from by_currency b where b.currency = cur), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('currency', b.currency, 'amount_minor', b.amount_minor) order by b.currency)
      from by_currency b
      where b.currency <> cur and b.amount_minor <> 0
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', g.category_id,
        'name', c.name,
        'hidden', coalesce(c.hidden, false),
        'amount_minor', g.amount_minor
      ) order by g.amount_minor desc, c.name nulls last, g.category_id)
      from by_category g
      left join public.categories c on c.id = g.category_id and c.company_id = p_company_id
      where g.amount_minor <> 0
    ), '[]'::jsonb)
  into rehab, rehab_other, rehab_rows;

  select coalesce(sum(b.balance_minor), 0)::bigint into loan_balance
  from public.loans l
  join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
  where l.company_id = p_company_id
    and l.project_id = p_project_id
    and l.status = 'open'::public.loan_status
    and l.currency = cur;

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
      and l.currency <> cur
    group by l.currency
    having sum(b.balance_minor) <> 0
  ) x;

  return jsonb_build_object(
    'currency', cur,
    'purchase_minor', p.purchase_minor,
    'arv_minor', p.arv_minor,
    'value_minor', p.value_minor,
    'value_date', p.value_date,
    'rehab_minor', rehab,
    'rehab_by_category', rehab_rows,
    'rehab_other_currencies', rehab_other,
    'loan_balance_minor', loan_balance,
    'loan_balance_other_currencies', loan_other,
    'forced_equity_minor', case when rehab_other = '[]'::jsonb then p.arv_minor - p.purchase_minor - rehab end,
    'current_equity_minor', case when loan_other = '[]'::jsonb then p.value_minor - loan_balance end
  );
end;
$$;

-- An open income missing_category row whose category the owner has now set waits for the
-- project instead, unless the category keeps the line out of the P&L (FLOW-309).
create or replace function private.relabel_income_category_pick(p_company_id uuid, p_transaction_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.review_queue q
  set reason = 'missing_project'
  from public.transactions t
  join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where q.company_id = p_company_id
    and q.transaction_id = p_transaction_id
    and q.status = 'open'
    and q.reason = 'missing_category'
    and t.id = q.transaction_id
    and t.company_id = p_company_id
    and t.direction = 'income'::public.txn_direction
    and t.project_id is null
    and (t.user_assigned or t.category_assigned)
    and not private.line_category_out(c.excluded_from_pnl, false, c.loan_part);
$$;
revoke all on function private.relabel_income_category_pick(uuid, uuid) from public, anon, authenticated;
grant execute on function private.relabel_income_category_pick(uuid, uuid) to service_role;

do $patch$
declare
  def text;
  anchor text;
begin
  -- reopen_review: the missing_project row a category pick queued goes with the pick.
  def := pg_get_functiondef('public.reopen_review(uuid)'::regprocedure);
  anchor := $a$  update public.review_queue
  set status = 'open',
      resolved_at = null
  where id = p_id and company_id = cid;
end;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'reopen_review is not the expected definition';
  end if;
  execute replace(def, anchor, $n$  update public.review_queue
  set status = 'open',
      resolved_at = null
  where id = p_id and company_id = cid;

  -- FLOW-309: as in undo_reassign, the missing_project row set_transaction_category queued
  -- for income goes with the category it followed.
  if exists (
    select 1
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id and t.company_id = q.company_id
    where q.id = p_id and q.company_id = cid and q.status = 'open'
      and q.reason = 'missing_category'
      and t.direction = 'income'::public.txn_direction
  ) then
    delete from public.review_queue q
    where q.id = (
      select q2.id
      from public.review_queue q2
      where q2.company_id = cid
        and q2.transaction_id = txn
        and q2.id <> p_id
        and q2.status = 'open'
        and q2.reason = 'missing_project'
      order by q2.created_at desc
      limit 1
    );
  end if;
end;$n$);

  -- resolve_review without resolving: a category pick relabels the open income row.
  def := pg_get_functiondef('public.resolve_review(uuid,text,uuid,uuid,boolean,boolean)'::regprocedure);
  anchor := $a$        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (cid, txn, p_project_id, 10000, net);
      end if;
    end if;
    return;
  end if;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'resolve_review is not the expected definition';
  end if;
  execute replace(def, anchor, $n$        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (cid, txn, p_project_id, 10000, net);
      end if;
    end if;
    perform private.relabel_income_category_pick(cid, txn);
    return;
  end if;$n$);

  -- undo_reassign of a pick made without resolving: the row the pick relabelled takes the
  -- category reason back once the line's guess is restored (sync's own rule).
  def := pg_get_functiondef('public.undo_reassign(uuid)'::regprocedure);
  anchor := $a$  update public.reassign_undo
  set undone_at = now()
  where id = p_id and company_id = cid;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'undo_reassign is not the expected definition';
  end if;
  execute replace(def, anchor, $n$  if review_id is null then
    update public.review_queue q
    set reason = 'missing_category'
    from public.transactions t
    where q.company_id = cid
      and q.transaction_id = txn
      and q.status = 'open'
      and q.reason = 'missing_project'
      and t.id = txn
      and t.company_id = cid
      and t.direction = 'income'::public.txn_direction
      and t.project_id is null
      and (t.category_id is null or (not t.user_assigned and not t.category_assigned));
  end if;

  update public.reassign_undo
  set undone_at = now()
  where id = p_id and company_id = cid;$n$);

  -- set_transaction_category without resolving: the same.
  def := pg_get_functiondef('public.set_transaction_category(uuid,uuid,boolean)'::regprocedure);
  anchor := $a$  insert into public.reassign_undo ($a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'set_transaction_category is not the expected definition';
  end if;
  execute replace(def, anchor, $n$  if not p_resolve then
    perform private.relabel_income_category_pick(cid, p_id);
  end if;

  insert into public.reassign_undo ($n$);

  -- sync_review_queue: rows labelled before a category was set take the project reason.
  def := pg_get_functiondef('public.sync_review_queue(uuid)'::regprocedure);
  anchor := $a$  return inserted + income_inserted + pending_inserted;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'sync_review_queue is not the expected definition';
  end if;
  execute replace(def, anchor, $n$  -- FLOW-309: an open income missing_category row whose category the owner has since set.
  perform private.relabel_income_category_pick(p_company_id, q.transaction_id)
  from public.review_queue q
  where q.company_id = p_company_id
    and q.status = 'open'
    and q.reason = 'missing_category';

  return inserted + income_inserted + pending_inserted;$n$);
end
$patch$;

-- Once: open rows already in that state.
select private.relabel_income_category_pick(q.company_id, q.transaction_id)
from public.review_queue q
where q.status = 'open'
  and q.reason = 'missing_category';

drop function pg_temp.anchor_count(text, text);

commit;
