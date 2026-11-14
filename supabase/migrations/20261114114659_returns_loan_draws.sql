-- FLOW-1199 (decision 0269, amends 0250): a loan paid out at closing, with no amount from the
-- settlement statement (loans.closing_paid_minor null), adds its principal less the draws it paid
-- into the bank to the purchase price, not the whole principal.
--
-- A hard-money loan funds the purchase at the title company and holds the rest back for renovation
-- draws, which reach the bank as loan proceeds and pay renovation costs that rehab already counts.
-- Counting the whole principal in the price counted those draws twice.
--
-- A draw is a money-in line on the property's financing line, dated after the loan's start and up to
-- its payoff (closed_on, or today while open), before the first rent, in a category that posts to a
-- liability account and is not a renovation refund, and not another loan's proceeds (80% or more of
-- that loan, from 120 days before its start to 30 days after, as 0246 tells proceeds). The amount
-- counted is the principal less the draws, at least zero. A closing amount the owner sets still wins.
--
-- Some lenders hold the draws back inside the principal (interest on the whole loan from day one);
-- others lend them on top of it (the balance grows with each draw). When the loan's principal paid
-- back, from its start to 30 days after its payoff, is above its principal, the excess is draws lent
-- on top: those draws are not taken off. taken_over_loans gains draws_minor, the draws taken off.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

do $returns$
declare
  def text;
  a_taken constant text := $a$    select coalesce(sum(least(coalesce(lo.closing_paid_minor, lo.principal_minor), lo.principal_minor)), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('loan_id', lo.id, 'name', lo.name, 'principal_minor', lo.principal_minor,
        'closing_paid_minor', lo.closing_paid_minor,
        'counted_minor', least(coalesce(lo.closing_paid_minor, lo.principal_minor), lo.principal_minor))$a$;
  a_from constant text := $a$    from public.loans lo
    where lo.company_id = cid and lo.project_id = p_project_id and lo.currency = cur
      and lo.start_date between closing - 30 and closing + 75$a$;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_taken) <> 1 or pg_temp.anchor_count(def, a_from) <> 1 then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, a_taken, $n$    select coalesce(sum(least(coalesce(lo.closing_paid_minor, greatest(lo.principal_minor - dr.draws_minor, 0)), lo.principal_minor)), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('loan_id', lo.id, 'name', lo.name, 'principal_minor', lo.principal_minor,
        'closing_paid_minor', lo.closing_paid_minor,
        'draws_minor', dr.draws_minor,
        'counted_minor', least(coalesce(lo.closing_paid_minor, greatest(lo.principal_minor - dr.draws_minor, 0)), lo.principal_minor))$n$);
  def := replace(def, a_from, $n$    from public.loans lo
    -- FLOW-1199 (decision 0269): the draws the loan paid into the bank after closing are not the price.
    cross join lateral (
      select coalesce(sum(f.amount_minor), 0)::bigint as gross_minor
      from private.property_lines(cid, p_project_id, lo.start_date + 1,
        coalesce(lo.closed_on, (now() at time zone 'Asia/Jerusalem')::date)) f
      join public.categories fc on fc.id = f.category_id and fc.company_id = cid
      join public.accounts fa on fa.id = fc.ledger_account_id and fa.company_id = cid
      where f.currency = cur and f.line = 'financing' and f.amount_minor > 0
        and fa.type = 'liability' and fc.rehab is not true
        and (first_rent is null or f.line_date < first_rent)
        and not exists (
          select 1 from public.loans o
          where o.company_id = cid and o.project_id = p_project_id and o.id <> lo.id
            and f.line_date between o.start_date - 120 and o.start_date + 30
            and f.amount_minor >= o.principal_minor * 0.8
        )
    ) dg
    -- Draws lent on top of the principal show as principal paid back above it: not taken off. Loan
    -- payments carry no link to their loan, so this reads the property's principal paid back up to
    -- 30 days after the payoff (today + 30 while the loan is open).
    cross join lateral (
      select coalesce(-sum(f.amount_minor), 0)::bigint as repaid_minor
      from private.property_lines(cid, p_project_id, lo.start_date + 1,
        coalesce(lo.closed_on, (now() at time zone 'Asia/Jerusalem')::date) + 30) f
      left join public.categories pc on pc.id = f.category_id and pc.company_id = cid
      where f.currency = cur and f.amount_minor < 0 and coalesce(f.part, pc.loan_part::text) = 'principal'
    ) rp
    cross join lateral (
      select dg.gross_minor - least(dg.gross_minor, greatest(rp.repaid_minor - lo.principal_minor, 0)) as draws_minor
    ) dr
    where lo.company_id = cid and lo.project_id = p_project_id and lo.currency = cur
      and lo.start_date between closing - 30 and closing + 75$n$);
  execute def;
end
$returns$;

drop function pg_temp.anchor_count(text, text);

commit;
