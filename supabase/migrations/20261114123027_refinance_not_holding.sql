-- FLOW-1200 (decision 0270): a refinance closing's rental costs are not the deal's holding.
--
-- Real Estate by the Numbers, Ch 47 (BRRRR) and Ch 45 (the rental statement): what a refinance
-- closing pays to set up the rental belongs to the rental, not to the renovation's holding costs:
-- the new loan's costs (Ch 47: loan proceeds = new loan − closing costs), property taxes and
-- insurance for the rental year, and the new loan's escrow reserves. The old loan's payoff
-- interest and finance charges, filed as interest, stay holding.
--
-- A refinance transaction is one that holds a property's loan proceeds of 80% or more of a loan
-- that starts more than 75 days after the purchase closing (so not the purchase loan, decision
-- 0246), dated after that closing and from 120 days before the loan's start to 30 days after it.
-- In it, every holding line other than interest leaves deal.holding_minor, and
-- get_property_return_lines' deal_holding line, which add up to it.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- The property's refinance transactions (decision 0270).
create function private.refinance_transactions(p_company_id uuid, p_project_id uuid, p_currency text)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with l as (
    select * from private.property_lines(p_company_id, p_project_id, null, null) x where x.currency = p_currency
  ),
  closing as (
    select a.line_date as d from l a where a.line = 'acquisition' order by a.amount_minor, a.line_date limit 1
  )
  select distinct f.transaction_id
  from l f
  cross join closing c
  where f.line = 'financing' and f.amount_minor > 0 and f.line_date > c.d
    and exists (
      select 1 from public.loans lo
      where lo.company_id = p_company_id and lo.project_id = p_project_id and lo.currency = p_currency
        and lo.start_date > c.d + 75
        and f.line_date between lo.start_date - 120 and lo.start_date + 30
        and f.amount_minor >= lo.principal_minor * 0.8
    );
$$;
revoke all on function private.refinance_transactions(uuid, uuid, text) from public, anon, authenticated, service_role;
comment on function private.refinance_transactions(uuid, uuid, text) is
  'FLOW-1200: the transactions of a property that hold a refinance''s loan proceeds (decision 0270).';

do $returns$
declare
  def text;
  a_hold constant text := $a$  where a.currency = cur and a.line = 'holding' and not a.in_rehab
    and coalesce(c.loan_part::text, a.part, '') <> 'principal';$a$;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_hold) <> 1 then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, a_hold, $n$  where a.currency = cur and a.line = 'holding' and not a.in_rehab
    and coalesce(c.loan_part::text, a.part, '') <> 'principal'
    -- FLOW-1200 (decision 0270): a refinance closing's costs, other than interest, are the rental's.
    and not (
      a.transaction_id in (select private.refinance_transactions(cid, p_project_id, cur))
      and coalesce(c.loan_part::text, a.part, '') <> 'interest'
    );$n$);
  execute def;
end
$returns$;

do $lines$
declare
  def text;
  a_line constant text := $a$        when 'deal_holding' then x.line = 'holding' and not x.in_rehab
          and coalesce(lc.loan_part::text, x.part, '') <> 'principal'$a$;
begin
  def := pg_get_functiondef('public.get_property_return_lines(uuid,text,date,date,uuid,integer,integer)'::regprocedure);
  if pg_temp.anchor_count(def, a_line) <> 1 then
    raise exception 'get_property_return_lines is not the expected definition';
  end if;
  def := replace(def, a_line, $n$        when 'deal_holding' then x.line = 'holding' and not x.in_rehab
          and coalesce(lc.loan_part::text, x.part, '') <> 'principal'
          -- FLOW-1200 (decision 0270): a refinance closing's costs, other than interest, are the rental's.
          and not (
            x.transaction_id in (select private.refinance_transactions(cid, p_project_id, cur))
            and coalesce(lc.loan_part::text, x.part, '') <> 'interest'
          )$n$);
  execute def;
end
$lines$;

drop function pg_temp.anchor_count(text, text);

commit;
