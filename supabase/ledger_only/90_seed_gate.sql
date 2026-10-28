-- ===========================================================================
-- 90 seed and gate. The parts move from line_splits and loan_splits into the legs; every line of
-- every company is posted again; the books must come out exactly as they went in.
-- ===========================================================================

create temp table ledger_only_legs_before on commit drop as
  select company_id, transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id,
    part, gross_up, loan_split_fallback, project_explicit
  from public.legs;

create temp table ledger_only_pnl_before on commit drop as
  select company_id, transaction_id, project_id, pnl_role, direction, doc_kind, doc_date, cash_date, currency,
    category_id, part, amount_net, line_amount_net, in_pnl, loan_split_fallback, unassigned, kind, unpaid,
    gross_up
  from private.pnl_lines_legacy;

-- The lines with parts: their legs come back from the parts below.
delete from public.legs l
where exists (select 1 from public.line_splits s where s.transaction_id = l.transaction_id)
   or exists (select 1 from public.loan_splits s where s.transaction_id = l.transaction_id);

-- A part leg takes its old row's id, so a snapshot that names the row (a category move) still finds it.
insert into public.legs (id, company_id, transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind,
  category_id, gross_up, project_explicit, split_part, part_ordinal, draft, part_percent, part_rest)
select s.id, s.company_id, s.transaction_id, a.id, s.project_id, s.amount_minor, s.ordinal, 'item',
  s.category_id, s.gross_up, s.project_id is not null, true, s.ordinal, true, s.percent, s.is_rest
from public.line_splits s
join public.accounts a on a.company_id = s.company_id and a.category_id = s.category_id;

insert into public.legs (id, company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind,
  category_id, part, loan_id, scheduled_minor, needs_review, part_ordinal, draft)
select s.id, s.company_id, s.transaction_id, a.id, s.amount_minor, 1, 'item',
  s.category_id, s.part, s.loan_id, s.scheduled_minor, s.needs_review,
  case s.part::text when 'interest' then 1 when 'escrow' then 2 when 'principal' then 3 else 4 end, true
from public.loan_splits s
join public.accounts a on a.company_id = s.company_id and a.category_id = s.category_id;

do $seed$
declare
  r record;
  missing bigint;
begin
  select (select count(*) from public.line_splits) + (select count(*) from public.loan_splits)
    - (select count(*) from public.legs where split_part or loan_id is not null)
  into missing;
  if missing <> 0 then
    raise exception 'ledger-only gate: % parts did not move to the legs', missing;
  end if;
  for r in select t.company_id, array_agg(t.id) as txns from public.transactions t group by t.company_id loop
    perform private.post_lines(r.company_id, r.txns);
  end loop;
end
$seed$;

do $gate$
declare
  diff bigint;
begin
  select count(*) into diff from (
    (select * from ledger_only_legs_before
     except all
     select company_id, transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id,
       part, gross_up, loan_split_fallback, project_explicit
     from public.legs where not draft)
    union all
    (select company_id, transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id,
       part, gross_up, loan_split_fallback, project_explicit
     from public.legs where not draft
     except all
     select * from ledger_only_legs_before)
  ) d;
  if diff <> 0 then
    raise exception 'ledger-only gate: % legs differ after the parts moved to the legs', diff;
  end if;
  select count(*) into diff from (
    (select * from ledger_only_pnl_before
     except all
     select company_id, transaction_id, project_id, pnl_role, direction, doc_kind, doc_date, cash_date, currency,
       category_id, part, amount_net, line_amount_net, in_pnl, loan_split_fallback, unassigned, kind, unpaid,
       gross_up
     from private.pnl_lines)
    union all
    (select company_id, transaction_id, project_id, pnl_role, direction, doc_kind, doc_date, cash_date, currency,
       category_id, part, amount_net, line_amount_net, in_pnl, loan_split_fallback, unassigned, kind, unpaid,
       gross_up
     from private.pnl_lines
     except all
     select * from ledger_only_pnl_before)
  ) d;
  if diff <> 0 then
    raise exception 'ledger-only gate: % P&L rows differ from the posting rules', diff;
  end if;
end
$gate$;
