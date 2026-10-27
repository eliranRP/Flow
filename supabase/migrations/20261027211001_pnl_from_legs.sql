-- FLOW-952 (decision 0209 item 9): the P&L reads the legs.
-- 1. The gate of FLOW-951 again: if any company's posting rules (private.pnl_lines_legacy) and the
--    P&L over the legs differ on any of the 19 columns, kept-out rows included, nothing applies.
--    Read-only on production on 2026-10-27: 4 companies, 0 rows.
-- 2. private.pnl_lines takes the body of private.pnl_lines_ledger: the same 19 columns in the same
--    order, read from the item legs, so every P&L reader (company_pnl, get_project, the breakdowns,
--    the cash reads, get_loan_split, the line states, ...) reads the legs. It stays security_invoker,
--    and create or replace keeps its grants (authenticated, service_role). One change from the shadow:
--    company_id and transaction_id are the line's (t), equal to the leg's through the join, so a
--    reader's filter on them reaches the transactions indexes as it did on the legacy body. With the
--    leg's columns, line_pnl_states' transaction_id = any(4,000 ids) nested-looped every leg against
--    the company's lines when the planner had no statistics (search_month_totals_speed). For the same
--    reason the lines come first and each line's legs are read by the legs index (a lateral, fenced
--    with OFFSET 0), as the legacy body read the lines first: with or without statistics, the plan is
--    the lines, then an index probe per line.
-- 3. private.ledger_pnl_diff compares the posting rules with the live view, and the shadow view is
--    dropped. private.pnl_lines_legacy, the posting triggers and the legacy tables stay: the writes
--    are unchanged, and the legs are posted from them as before.
-- Rollback: one migration that sets private.pnl_lines back to the legacy body (the 19 columns of
-- private.pnl_lines_legacy, with authenticated granted on it as 0209 notes) and points the diff at a
-- copy of this body. No data moves either way.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- 1. The gate.
do $gate$
declare
  bad integer;
begin
  select count(*) into bad
  from public.companies c
  where exists (select 1 from private.ledger_pnl_diff(c.id));
  if bad > 0 then
    raise exception 'FLOW-952 gate: the legs and the posting rules differ for % compan(y/ies)', bad;
  end if;
end
$gate$;

-- 2. The flip.
create or replace view private.pnl_lines
with (security_invoker = true)
as
 SELECT t.company_id,
    t.id AS transaction_id,
        CASE
            WHEN l.project_explicit THEN l.project_id
            ELSE t.project_id
        END AS project_id,
        CASE
            WHEN ((COALESCE((c.kind)::text, (t.direction)::text) = 'expense'::text) AND l.project_explicit AND (l.project_id = co.overhead_project_id)) THEN 'overhead'::pnl_role
            WHEN ((COALESCE((c.kind)::text, (t.direction)::text) = 'expense'::text) AND l.project_explicit) THEN 'project'::pnl_role
            WHEN ((COALESCE((c.kind)::text, (t.direction)::text) = 'expense'::text) AND (t.pnl_role = 'project'::pnl_role) AND (t.project_id IS NOT NULL) AND (t.project_id = co.overhead_project_id)) THEN 'overhead'::pnl_role
            ELSE t.pnl_role
        END AS pnl_role,
    t.direction,
    t.doc_kind,
    t.doc_date,
    t.cash_date,
    COALESCE(t.currency, 'ILS'::text) AS currency,
    l.category_id,
    l.part,
    (- l.amount_minor) AS amount_net,
    t.amount_net AS line_amount_net,
    (a.type = ANY (ARRAY['income'::text, 'expense'::text])) AS in_pnl,
    l.loan_split_fallback,
        CASE
            WHEN (COALESCE((c.kind)::text, (t.direction)::text) = 'income'::text) THEN (
            CASE
                WHEN l.project_explicit THEN l.project_id
                ELSE t.project_id
            END IS NULL)
            WHEN l.project_explicit THEN false
            ELSE ((t.pnl_role IS NULL) OR ((t.pnl_role = 'project'::pnl_role) AND (t.project_id IS NULL)) OR ((t.pnl_role = 'shared'::pnl_role) AND (NOT (EXISTS ( SELECT 1
               FROM allocations x
              WHERE (x.transaction_id = t.id))))))
        END AS unassigned,
    COALESCE((c.kind)::text, (t.direction)::text) AS kind,
    private.line_unpaid(t.direction, t.doc_kind, t.cash_date) AS unpaid,
    l.gross_up
   FROM transactions t
     -- Each line's item legs by the legs index, the line first: OFFSET 0 keeps the planner from
     -- turning it into a join it may run legs-first with no statistics.
     CROSS JOIN LATERAL ( SELECT x.account_id, x.project_id, x.project_explicit, x.category_id, x.part,
            x.amount_minor, x.loan_split_fallback, x.gross_up
           FROM legs x
          WHERE ((x.company_id = t.company_id) AND (x.transaction_id = t.id) AND (x.leg_kind = 'item'::text))
         OFFSET 0) l
     JOIN accounts a ON (((a.company_id = t.company_id) AND (a.id = l.account_id)))
     LEFT JOIN categories c ON ((c.id = l.category_id))
     LEFT JOIN companies co ON ((co.id = t.company_id))
  WHERE ((t.removed_at IS NULL) AND (t.line_status = 'posted'::line_status));

comment on view private.pnl_lines is
  'FLOW-952: the P&L lines, read from the item legs (decision 0209 item 9). One row per item leg of a posted, not removed line; private.pnl_lines_legacy is the posting rules the legs are written from.';

-- 3. The diff compares the posting rules with the live view; the shadow view goes.
create or replace function private.ledger_pnl_diff(p_company uuid)
returns table (side text, company_id uuid, transaction_id uuid, project_id uuid, pnl_role public.pnl_role,
  direction public.txn_direction, doc_kind public.doc_kind, doc_date date, cash_date date, currency text,
  category_id uuid, part public.loan_split_part, amount_net bigint, line_amount_net bigint, in_pnl boolean,
  loan_split_fallback boolean, unassigned boolean, kind text, unpaid boolean, gross_up boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select g.company_id, g.transaction_id, g.project_id, g.pnl_role, g.direction, g.doc_kind, g.doc_date,
      g.cash_date, g.currency, g.category_id, g.part, g.amount_net, g.line_amount_net, g.in_pnl,
      g.loan_split_fallback, g.unassigned, g.kind, g.unpaid, g.gross_up
    from private.pnl_lines_legacy g
    where g.company_id = p_company
  ),
  ledger as (
    select * from private.pnl_lines d where d.company_id = p_company
  )
  select 'legacy_only', x.* from (select * from legacy except all select * from ledger) x
  union all
  select 'ledger_only', y.* from (select * from ledger except all select * from legacy) y;
$$;

drop view private.pnl_lines_ledger;

commit;
