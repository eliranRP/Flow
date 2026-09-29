-- Read-only. Safe to run before 20260929240000: it never reads
-- prior_category_suggested unless that column already exists.
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
--
-- When the prior column is missing, every matching prior still counts: the
-- column is added null, so the backfill would fill it.

drop table if exists preflight_r23;

create temp table preflight_r23 (
  backfill_240000_transactions bigint,
  backfill_240000_undo_priors bigint,
  backfill_240000_review_priors bigint,
  backfill_250000_transactions bigint,
  backfill_250000_undo_priors bigint,
  backfill_250000_review_priors bigint,
  rule_transactions_at_risk bigint,
  rule_undo_rows_at_risk bigint
);

do $$
declare
  has_prior boolean;
  tx_240 bigint;
  undo_240 bigint;
  review_240 bigint;
  tx_250 bigint;
  undo_250 bigint;
  review_250 bigint;
  rule_tx bigint;
  rule_undo bigint;
  prior_undo text := 'true';
  prior_review text := 'true';
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reassign_undo'
      and column_name = 'prior_category_suggested'
  ) into has_prior;

  if has_prior then
    prior_undo := 'u.prior_category_suggested is null';
    prior_review := 'q.prior_category_suggested is null';
  end if;

  select count(*) into tx_240
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
    );

  execute format($q$
    select count(*)
    from public.reassign_undo u
    where %s
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
  $q$, prior_undo) into undo_240;

  execute format($q$
    select count(*)
    from public.review_queue q
    where %s
      and q.reason = 'suggested'
      and q.prior_category_id is not null
  $q$, prior_review) into review_240;

  select count(*) into tx_250
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
    );

  execute format($q$
    select count(*)
    from public.reassign_undo u
    where %s
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
  $q$, prior_undo) into undo_250;

  execute format($q$
    select count(*)
    from public.review_queue q
    where %s
      and q.reason = 'missing_project'
      and q.status = 'open'
      and q.prior_category_id is not null
      and coalesce(q.prior_user_assigned, false) = false
  $q$, prior_review) into review_250;

  select count(*) into rule_tx
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
    );

  select count(*) into rule_undo
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
    );

  insert into preflight_r23 values (
    tx_240, undo_240, review_240,
    tx_250, undo_250, review_250,
    rule_tx, rule_undo
  );
end
$$;

select * from preflight_r23;
