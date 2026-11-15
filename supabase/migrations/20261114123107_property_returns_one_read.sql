-- FLOW-1203: get_property_returns reads the property's lines once.
--
-- private.property_lines filters the company's lines by a project that comes from a CASE over the
-- item legs, so no index serves it: each call reads every line of the company. get_property_returns
-- called it about 8 times, two more for each purchase loan (FLOW-1199), and once more through
-- private.refinance_transactions (FLOW-1200). On production that is 164 to 310 ms a call.
--
-- Every one of those calls asks for the same lines of one property, cut to a date range. Now the
-- function reads them once into an array, and reads each range from the array
-- (private.property_lines_in: the same filter property_lines ends with). Same answers.
-- The refinance set (decision 0270) is taken from the same array. Its rule lives in one place,
-- private.refinance_transactions_in; private.refinance_transactions (get_property_return_lines
-- calls it) reads the lines once through it, and none when the property has no loan in the currency.
--
-- The function body is patched in place, as 20261114123027 did, so a migration that patches it
-- in between still applies.

begin;

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- One line of a property, as private.property_lines returns it.
create type private.property_line as (
  transaction_id uuid,
  part text,
  category_id uuid,
  currency text,
  amount_minor bigint,
  line_date date,
  shared boolean,
  line text,
  in_rehab boolean
);

-- A date range of lines read once: what private.property_lines(…, p_from, p_to) returns, cut from
-- the all-time lines. No range keeps every line, a range keeps the lines dated inside it.
create function private.property_lines_in(p_lines private.property_line[], p_from date, p_to date)
returns setof private.property_line
language sql
stable
set search_path = ''
as $$
  select x.* from unnest(p_lines) x where p_from is null or x.line_date between p_from and p_to;
$$;
revoke all on function private.property_lines_in(private.property_line[], date, date) from public, anon, authenticated, service_role;
grant execute on function private.property_lines_in(private.property_line[], date, date) to authenticated, service_role;
comment on function private.property_lines_in(private.property_line[], date, date) is
  'FLOW-1203: a date range of a property''s lines read once, as private.property_lines returns it.';

-- The property's refinance transactions (decision 0270), from lines the caller already has.
create function private.refinance_transactions_in(
  p_company_id uuid, p_project_id uuid, p_currency text, p_lines private.property_line[])
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with l as (
    select * from unnest(p_lines) x where x.currency = p_currency
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
revoke all on function private.refinance_transactions_in(uuid, uuid, text, private.property_line[]) from public, anon, authenticated, service_role;
grant execute on function private.refinance_transactions_in(uuid, uuid, text, private.property_line[]) to authenticated, service_role;
comment on function private.refinance_transactions_in(uuid, uuid, text, private.property_line[]) is
  'FLOW-1203: private.refinance_transactions on lines the caller already read.';

-- The old entry point (get_property_return_lines calls it) keeps its answer and reads the lines
-- once; a property with no loan in the currency has no refinance, so it reads none.
create or replace function private.refinance_transactions(p_company_id uuid, p_project_id uuid, p_currency text)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select private.refinance_transactions_in(p_company_id, p_project_id, p_currency, array(
    select row(x.*)::private.property_line
    from private.property_lines(p_company_id, p_project_id, null, null) x
    where exists (
      select 1 from public.loans lo
      where lo.company_id = p_company_id and lo.project_id = p_project_id and lo.currency = p_currency
    )
  ));
$$;

do $returns$
declare
  def text;
  a_prefix constant text := 'private.property_lines(cid, p_project_id, ';
  a_decl constant text := E'  irr numeric;\nbegin\n';
  a_load constant text := E'  -- All time: the first rent and the money in.\n  with a as (\n';
  a_refi constant text := 'a.transaction_id in (select private.refinance_transactions(cid, p_project_id, cur))';
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_prefix) <> 11
    or pg_temp.anchor_count(def, a_decl) <> 1
    or pg_temp.anchor_count(def, a_load) <> 1
    or pg_temp.anchor_count(def, a_refi) <> 1 then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  -- The 11 reads (the first rent and sums, the period, the other currencies, the closing date, the
  -- draws and repayments of each loan and the loan's own proceeds, the purchase date, the holding,
  -- the IRR's two) become reads of the array.
  def := replace(def, a_prefix, 'private.property_lines_in(pl, ');
  def := replace(def, a_refi, 'a.transaction_id = any(refi)');
  def := replace(def, a_decl, E'  irr numeric;\n  pl private.property_line[];\n  refi uuid[];\nbegin\n');
  def := replace(def, a_load, E'  -- FLOW-1203: the property''s lines, read once; every range below is cut from them.\n'
    || E'  pl := array(select row(x.*)::private.property_line from private.property_lines(cid, p_project_id, null, null) x);\n'
    || E'  refi := array(select private.refinance_transactions_in(cid, p_project_id, cur, pl));\n\n' || a_load);
  execute def;
end
$returns$;

drop function pg_temp.anchor_count(text, text);

commit;
