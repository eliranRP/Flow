-- Read-only. Counts the rows 20260929250000 will change.
-- Run this before `supabase db push`. It does not update anything.
--
-- transactions_to_suggest: category_suggested false → true.
-- Those rows also get a new updated_at. No audit rows are written.
-- undo_priors_to_set: pending or undone undo rows whose prior flag is filled.
-- review_priors_to_set: suggested reviews, and reopened missing-project
-- approvals, whose prior flag is filled.
--
-- Audit meta is not a condition. Older audit rows stored '{}'.

select
  (
    select count(*)
    from public.transactions t
    where t.category_suggested = false
      and t.user_assigned = false
      and t.category_id is not null
      and t.removed_at is null
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
  ) as transactions_to_suggest,
  (
    select count(*)
    from public.reassign_undo u
    where u.prior_category_suggested is null
      and (
        exists (
          select 1
          from public.review_queue q
          where q.id = u.prior_review_id
            and q.company_id = u.company_id
            and q.reason = 'suggested'
        )
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
  ) as undo_priors_to_set,
  (
    select count(*)
    from public.review_queue q
    where q.prior_category_suggested is null
      and (
        (
          q.reason = 'suggested'
          and q.prior_category_id is not null
        )
        or (
          q.reason = 'missing_project'
          and q.status = 'open'
          and q.prior_category_id is not null
          and coalesce(q.prior_user_assigned, false) = false
        )
      )
  ) as review_priors_to_set;
