-- FLOW-171: an account's movements from any start date, or from the very start.
--   public.get_account_lines gains p_from (date, default null) and p_from_start (boolean, default false),
--   last, so every existing call reads as before: with neither, the period starts on 1 January of as_of's
--   year. p_from starts it on that date: opening_minor is the balance before p_from, and the rows,
--   movement_minor and count are the lines from p_from to as_of. p_from_start is the sentinel for "from
--   the very start": no opening (opening_minor 0, so movement_minor is the balance) and every movement from
--   the account's first leg. p_from after as_of, or p_from with p_from_start, is 'validation'. The output
--   adds from (the period's first day, null from the start) and from_start (true from the start), and keeps
--   year_start (1 January of as_of's year) for one release: the deploy runs this migration before Pages and
--   flow-mcp, and the app before this PR requires year_start, so dropping it would break the account page
--   until the new bundle loads. A follow-up migration drops it. Every company and project check, the grants and the paging order are the same as FLOW-165's
--   (20261029054426_account_lines.sql); the six-argument function is dropped, so positional calls resolve
--   to the new one.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

drop function public.get_account_lines(uuid, date, uuid, text, integer, integer);

create function public.get_account_lines(
  p_account_id uuid,
  p_as_of date default null,
  p_project_id uuid default null,
  p_currency text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_from date default null,
  p_from_start boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  as_of date := coalesce(p_as_of, current_date);
  period_start date;
  proj_name text;
  acct public.accounts%rowtype;
  sign integer;
  lim integer;
  off integer;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  -- The project first: another company's project reads as unknown, before any other check on it.
  if p_project_id is not null then
    select p.name into proj_name from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      return null;
    end if;
  end if;
  select * into acct from public.accounts a
  where a.id = p_account_id and a.company_id = cid and a.type in ('asset', 'liability', 'equity');
  if not found then
    return null;
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'validation';
  end if;
  -- The period: from p_from, from the account's first leg (p_from_start), or from 1 January of as_of's year.
  if coalesce(p_from_start, false) and p_from is not null then
    raise exception 'validation';
  end if;
  if p_from is not null and p_from > as_of then
    raise exception 'validation';
  end if;
  period_start := case when coalesce(p_from_start, false) then null else coalesce(p_from, date_trunc('year', as_of)::date) end;
  sign := case when acct.type = 'asset' then 1 else -1 end;
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);

  with legs as (
    select l.transaction_id, l.amount_minor, l.project_id, l.part, l.loan_id, t.doc_date,
      coalesce(t.currency, 'ILS') as currency
    from public.legs l
    join public.transactions t
      on t.id = l.transaction_id and t.company_id = l.company_id
     and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
    where l.company_id = cid and l.account_id = acct.id and not l.draft
      and (p_project_id is null or l.project_id = p_project_id)
      and (p_currency is null or coalesce(t.currency, 'ILS') = p_currency)
  ),
  -- The period's movements: a line's legs on the account are one movement. From the start, every one.
  moves as (
    select g.transaction_id, g.currency, max(g.doc_date) as doc_date, (sign * sum(g.amount_minor))::bigint as amount_minor,
      case when count(distinct g.project_id) = 1 and count(g.project_id) = count(*) then min(g.project_id::text)::uuid end as project_id,
      case when count(distinct g.part) = 1 and count(g.part) = count(*) then min(g.part::text) end as part,
      case when count(distinct g.loan_id) = 1 and count(g.loan_id) = count(*) then min(g.loan_id::text)::uuid end as loan_id
    from legs g
    where period_start is null or g.doc_date >= period_start
    group by g.transaction_id, g.currency
    having sum(g.amount_minor) <> 0
  ),
  page as (
    select m.*, row_number() over (order by m.doc_date desc, m.transaction_id, m.currency) as n
    from moves m
  )
  select jsonb_build_object(
    'account_id', acct.id,
    'name', acct.name,
    'type', acct.type,
    'is_system', acct.is_system,
    'as_of', as_of,
    -- Kept for the app before FLOW-171 (its schema requires it) until a follow-up drops it.
    'year_start', date_trunc('year', as_of)::date,
    'from', period_start,
    'from_start', period_start is null,
    'project_id', p_project_id,
    'project_name', proj_name,
    'currency', p_currency,
    'rule', 'a line''s legs count from its doc_date; posted, non-removed lines; draft legs excluded',
    -- The loans whose parts post here (a loan's principal): the screen links the loan's page.
    'loan_ids', coalesce((select jsonb_agg(distinct g.loan_id) from legs g where g.loan_id is not null), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
          'currency', c.currency,
          'opening_minor', c.opening,
          'movement_minor', c.balance - c.opening,
          'balance_minor', c.balance,
          'count', (select count(*) from moves m where m.currency = c.currency)
        ) order by c.currency)
      from (
        select g.currency,
          (sign * coalesce(sum(g.amount_minor) filter (where g.doc_date < period_start), 0))::bigint as opening,
          (sign * sum(g.amount_minor))::bigint as balance
        from legs g
        group by g.currency
      ) c
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
          'transaction_id', pg.transaction_id,
          'doc_date', pg.doc_date,
          'currency', pg.currency,
          'amount_minor', pg.amount_minor,
          'description', t.description,
          'party_name', coalesce(sup.name, cus.name),
          'project_id', pr.id,
          'project_name', pr.name,
          'part', pg.part,
          'loan_id', pg.loan_id,
          'line_amount_minor', t.amount_gross
        ) order by pg.n)
      from page pg
      join public.transactions t on t.id = pg.transaction_id and t.company_id = cid
      left join public.suppliers sup on sup.id = t.supplier_id and sup.company_id = cid
      left join public.customers cus on cus.id = t.customer_id and cus.company_id = cid
      left join public.projects pr on pr.id = pg.project_id and pr.company_id = cid
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_account_lines(uuid, date, uuid, text, integer, integer, date, boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_account_lines(uuid, date, uuid, text, integer, integer, date, boolean) to authenticated;
comment on function public.get_account_lines(uuid, date, uuid, text, integer, integer, date, boolean) is
  'MCP get_account_lines and the reports screen: one balance-sheet account''s balance, its opening balance and its movements (one per line, signed as get_balance_sheet shows them) from p_from, from the very start (p_from_start) or from 1 January of as_of''s year, optionally for one project and currency, paged; another company''s account or project is null. FLOW-165, FLOW-171.';

commit;
