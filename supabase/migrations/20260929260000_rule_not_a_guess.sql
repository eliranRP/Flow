-- Decision 0071 point 6, amended by 0074's round. Append-only.
-- A remembered supplier rule is an assignment, stored with user_assigned false.
-- 20260929250000 treated every such row as a guess, so an undone or reopened
-- rule landed in ממתינה לאישור and wrote no audit row. This leaves a category
-- that matches the supplier's rule alone, puts those rows back when the
-- earlier backfill already flipped them, and writes an audit row for every flip.

create or replace function private.supplier_remembers(
  p_company uuid,
  p_transaction uuid,
  p_category uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_category is not null
    and exists (
      select 1
      from public.transactions t
      join public.suppliers s
        on s.id = t.supplier_id
       and s.company_id = t.company_id
      where t.company_id = p_company
        and t.id = p_transaction
        and s.remembered_category_id = p_category
    );
$$;

revoke all on function private.supplier_remembers(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.restore_undone_suggestions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A rule row 20260929250000 already marked as a guess goes back.
  with restored as (
    update public.transactions t
    set category_suggested = false
    where t.category_suggested = true
      and t.user_assigned = false
      and t.category_id is not null
      and t.removed_at is null
      and private.supplier_remembers(t.company_id, t.id, t.category_id)
    returning t.company_id, t.id, t.category_id
  )
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, meta)
  select r.company_id, c.owner_id, 'update', 'transactions', r.id,
    jsonb_build_object(
      'backfill', 'restore_rule',
      'category_suggested', true,
      'category_id', r.category_id
    )
  from restored r
  join public.companies c on c.id = r.company_id;

  update public.reassign_undo u
  set prior_category_suggested = null
  where u.prior_category_suggested is true
    and private.supplier_remembers(u.company_id, u.transaction_id, u.prior_category_id);

  update public.review_queue q
  set prior_category_suggested = null
  where q.prior_category_suggested is true
    and private.supplier_remembers(q.company_id, q.transaction_id, q.prior_category_id);

  update public.review_queue q
  set prior_category_suggested = true
  where q.reason = 'suggested'
    and q.prior_category_id is not null
    and q.prior_category_suggested is null
    and not private.supplier_remembers(q.company_id, q.transaction_id, q.prior_category_id);

  update public.reassign_undo u
  set prior_category_suggested = true
  from public.review_queue q
  where q.id = u.prior_review_id
    and q.company_id = u.company_id
    and q.reason = 'suggested'
    and u.prior_category_suggested is null
    and not private.supplier_remembers(u.company_id, u.transaction_id, u.prior_category_id);

  update public.reassign_undo u
  set prior_category_suggested = true
  where u.prior_category_suggested is null
    and u.prior_user_assigned = false
    and u.prior_category_id is not null
    and not private.supplier_remembers(u.company_id, u.transaction_id, u.prior_category_id)
    and (
      u.prior_review_id is null
      or not exists (
        select 1
        from public.review_queue q
        where q.id = u.prior_review_id
          and q.company_id = u.company_id
          and q.reason = 'suggested'
      )
    );

  update public.review_queue q
  set prior_category_suggested = true
  where q.reason = 'missing_project'
    and q.status = 'open'
    and q.prior_category_id is not null
    and coalesce(q.prior_user_assigned, false) = false
    and q.prior_category_suggested is null
    and not private.supplier_remembers(q.company_id, q.transaction_id, q.prior_category_id);

  with candidates as (
    select t.id, t.company_id, t.category_id, t.category_suggested
    from public.transactions t
    where t.user_assigned = false
      and t.category_id is not null
      and t.removed_at is null
      and not private.supplier_remembers(t.company_id, t.id, t.category_id)
      and (
        exists (
          select 1
          from public.review_queue q
          where q.company_id = t.company_id
            and q.transaction_id = t.id
            and q.reason = 'suggested'
            and q.status = 'open'
            and q.prior_category_id is not distinct from t.category_id
        )
        or exists (
          select 1
          from public.reassign_undo u
          where u.company_id = t.company_id
            and u.transaction_id = t.id
            and u.undone_at is not null
            and u.prior_category_id is not distinct from t.category_id
            and (
              u.prior_category_suggested is true
              or (
                u.prior_user_assigned = false
                and u.prior_category_id is not null
                and (
                  u.prior_review_id is null
                  or not exists (
                    select 1
                    from public.review_queue q
                    where q.id = u.prior_review_id
                      and q.company_id = u.company_id
                      and q.reason = 'suggested'
                  )
                )
              )
            )
        )
        or exists (
          select 1
          from public.review_queue q
          where q.company_id = t.company_id
            and q.transaction_id = t.id
            and q.reason = 'missing_project'
            and q.status = 'open'
            and q.prior_category_id is not null
            and q.prior_category_id is not distinct from t.category_id
            and coalesce(q.prior_user_assigned, false) = false
        )
      )
  ),
  flipped as (
    update public.transactions t
    set category_suggested = true
    from candidates c
    where t.id = c.id
      and t.category_suggested = false
    returning t.company_id, t.id, t.category_id
  ),
  wrote as (
    insert into public.audit_log (company_id, actor_id, action, entity, entity_id, meta)
    select f.company_id, c.owner_id, 'update', 'transactions', f.id,
      jsonb_build_object(
        'backfill', 'restore_suggested',
        'category_suggested', false,
        'category_id', f.category_id
      )
    from flipped f
    join public.companies c on c.id = f.company_id
    returning entity_id
  )
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, meta)
  select c.company_id, co.owner_id, 'update', 'transactions', c.id,
    jsonb_build_object(
      'backfill', 'restore_suggested',
      'category_suggested', false,
      'category_id', c.category_id
    )
  from candidates c
  join public.companies co on co.id = c.company_id
  where c.category_suggested = true
    and not exists (select 1 from wrote w where w.entity_id = c.id)
    and not exists (
      select 1
      from public.audit_log a
      where a.company_id = c.company_id
        and a.entity = 'transactions'
        and a.entity_id = c.id
        and a.meta->>'backfill' = 'restore_suggested'
    );
end;
$$;

revoke all on function private.restore_undone_suggestions() from public, anon, authenticated;

select private.restore_undone_suggestions();
