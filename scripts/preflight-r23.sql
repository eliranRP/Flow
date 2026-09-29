-- Read-only. Plain SELECTs only: no DDL and no DML, so it can run
-- inside a read-only transaction. It does not create or touch a table.
-- Safe before 20260929240000: a missing prior_category_suggested column
-- is read through to_jsonb, which omits the key, and that reads as null.
-- Run this before `supabase db push`. It does not update anything.
--
-- backfill_240000_transactions: rows 240000 still has to mark suggested
--   (open suggested review, an undone undo of that review, or audit meta).
-- backfill_250000_transactions: extra rows only 250000 would mark
--   (an undone guess with no suggested review, or a reopened missing-project
--   approval). Reported separately from 240000.
-- The same split for undo priors and review priors.
-- rule_transactions_at_risk: rows in either backfill whose category matches
--   the supplier's remembered rule. 250000 would have flipped those to a guess.
-- rule_undo_rows_at_risk: undone or pending undo rows whose prior category
--   matches that rule. 250000 would have stored them as suggestions.
-- backfill_260000_rule_restores: rows 260000 puts back to an assignment
--   (already suggested, and the category matches the supplier's rule).
-- backfill_260000_undo_priors: undo priors 260000 clears because they match a rule.
-- backfill_260000_review_priors: review priors 260000 clears for the same reason.
--
-- When the prior column is missing, every matching prior still counts: the
-- column is added null, so the backfill would fill it. A true prior cannot
-- exist yet, so the 260000 clear-counts stay zero.

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
          join public.review_queue q
            on q.id = u.prior_review_id
           and q.company_id = u.company_id
          where u.company_id = t.company_id
            and u.transaction_id = t.id
            and u.undone_at is not null
            and q.reason = 'suggested'
            and u.prior_category_id is not distinct from t.category_id
        )
        or exists (
          select 1
          from public.audit_log a
          where a.company_id = t.company_id
            and a.entity = 'transactions'
            and a.entity_id = t.id
            and a.action = 'update'
            and a.meta->>'category_suggested' = 'true'
            and a.meta->>'category_id' is not distinct from t.category_id::text
        )
      )
  ) as backfill_240000_transactions,
  (
    select count(*)
    from public.reassign_undo u
    where (to_jsonb(u) -> 'prior_category_suggested') is null
      and (
        exists (
          select 1
          from public.review_queue q
          where q.id = u.prior_review_id
            and q.company_id = u.company_id
            and q.reason = 'suggested'
        )
        or exists (
          select 1
          from public.audit_log a
          where a.company_id = u.company_id
            and a.entity = 'transactions'
            and a.entity_id = u.transaction_id
            and a.action = 'update'
            and a.meta->>'category_suggested' = 'true'
            and a.meta->>'category_id' is not distinct from u.prior_category_id::text
            and a.created_at <= u.created_at
        )
      )
  ) as backfill_240000_undo_priors,
  (
    select count(*)
    from public.review_queue q
    where (to_jsonb(q) -> 'prior_category_suggested') is null
      and q.reason = 'suggested'
      and q.prior_category_id is not null
  ) as backfill_240000_review_priors,
  (
    select count(*)
    from public.transactions t
    where t.category_suggested = false
      and t.user_assigned = false
      and t.category_id is not null
      and t.removed_at is null
      and not (
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
          join public.review_queue q
            on q.id = u.prior_review_id
           and q.company_id = u.company_id
          where u.company_id = t.company_id
            and u.transaction_id = t.id
            and u.undone_at is not null
            and q.reason = 'suggested'
            and u.prior_category_id is not distinct from t.category_id
        )
        or exists (
          select 1
          from public.audit_log a
          where a.company_id = t.company_id
            and a.entity = 'transactions'
            and a.entity_id = t.id
            and a.action = 'update'
            and a.meta->>'category_suggested' = 'true'
            and a.meta->>'category_id' is not distinct from t.category_id::text
        )
      )
      and (
        exists (
          select 1
          from public.reassign_undo u
          where u.company_id = t.company_id
            and u.transaction_id = t.id
            and u.undone_at is not null
            and u.prior_category_id is not distinct from t.category_id
            and u.prior_user_assigned = false
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
  ) as backfill_250000_transactions,
  (
    select count(*)
    from public.reassign_undo u
    where (to_jsonb(u) -> 'prior_category_suggested') is null
      and u.prior_user_assigned = false
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
      and not exists (
        select 1
        from public.audit_log a
        where a.company_id = u.company_id
          and a.entity = 'transactions'
          and a.entity_id = u.transaction_id
          and a.action = 'update'
          and a.meta->>'category_suggested' = 'true'
          and a.meta->>'category_id' is not distinct from u.prior_category_id::text
          and a.created_at <= u.created_at
      )
  ) as backfill_250000_undo_priors,
  (
    select count(*)
    from public.review_queue q
    where (to_jsonb(q) -> 'prior_category_suggested') is null
      and q.reason = 'missing_project'
      and q.status = 'open'
      and q.prior_category_id is not null
      and coalesce(q.prior_user_assigned, false) = false
  ) as backfill_250000_review_priors,
  (
    select count(*)
    from public.transactions t
    join public.suppliers s
      on s.id = t.supplier_id
     and s.company_id = t.company_id
     and s.remembered_category_id = t.category_id
    where t.user_assigned = false
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
              u.prior_user_assigned = false
              or exists (
                select 1
                from public.review_queue q
                where q.id = u.prior_review_id
                  and q.company_id = u.company_id
                  and q.reason = 'suggested'
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
            and q.prior_category_id is not distinct from t.category_id
            and coalesce(q.prior_user_assigned, false) = false
        )
        or exists (
          select 1
          from public.audit_log a
          where a.company_id = t.company_id
            and a.entity = 'transactions'
            and a.entity_id = t.id
            and a.action = 'update'
            and a.meta->>'category_suggested' = 'true'
            and a.meta->>'category_id' is not distinct from t.category_id::text
        )
      )
  ) as rule_transactions_at_risk,
  (
    select count(*)
    from public.reassign_undo u
    join public.transactions t
      on t.id = u.transaction_id
     and t.company_id = u.company_id
    join public.suppliers s
      on s.id = t.supplier_id
     and s.company_id = t.company_id
     and s.remembered_category_id = u.prior_category_id
    where u.prior_category_id is not null
      and (
        u.prior_user_assigned = false
        or exists (
          select 1
          from public.review_queue q
          where q.id = u.prior_review_id
            and q.company_id = u.company_id
            and q.reason = 'suggested'
        )
      )
  ) as rule_undo_rows_at_risk,
  (
    select count(*)
    from public.transactions t
    join public.suppliers s
      on s.id = t.supplier_id
     and s.company_id = t.company_id
     and s.remembered_category_id = t.category_id
    where t.category_suggested = true
      and t.user_assigned = false
      and t.category_id is not null
      and t.removed_at is null
  ) as backfill_260000_rule_restores,
  (
    select count(*)
    from public.reassign_undo u
    join public.transactions t
      on t.id = u.transaction_id
     and t.company_id = u.company_id
    join public.suppliers s
      on s.id = t.supplier_id
     and s.company_id = t.company_id
     and s.remembered_category_id = u.prior_category_id
    where (to_jsonb(u) -> 'prior_category_suggested') = 'true'::jsonb
  ) as backfill_260000_undo_priors,
  (
    select count(*)
    from public.review_queue q
    join public.transactions t
      on t.id = q.transaction_id
     and t.company_id = q.company_id
    join public.suppliers s
      on s.id = t.supplier_id
     and s.company_id = t.company_id
     and s.remembered_category_id = q.prior_category_id
    where (to_jsonb(q) -> 'prior_category_suggested') = 'true'::jsonb
  ) as backfill_260000_review_priors;
