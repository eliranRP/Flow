-- A bank line the user's project forecast expects is filed as that forecast line (decision 0187).
-- The user adds a line to a project's next-month forecast (project_forecast_edits, kind add: a
-- category, a direction and an amount, once or on a pace). When a bank line of that amount comes in
-- a month the line applies to, Flow suggests the forecast line's project and category, even with Jev off.
-- 1. public.forecast_line_matches: one row per add edit and month, and per transaction. RLS on, no
--    grants to the app's roles: read and written only by the functions below.
-- 2. private.forecast_line_match(company, ids): for each line, the best add edit it fits.
--    - same company, an active project, an add edit with a category a line may take;
--    - the line's sign is the edit's direction (an expense is negative, income positive), and its
--      direction too;
--    - the line's month (doc_date, the month the books file it in) is the edit's start month or a
--      later month on its pace, and the add line is not removed from that month;
--    - its currency is the company's base currency (the currency the project forecast shows);
--    - the amount: the net or the gross amount, without its sign, is within max(10% of the expected
--      amount, 1.00) of it. The expected amount is the add line's, or the change of it that applies
--      to the month (the latest start wins, as in the forecast);
--    - a line whose category is firm (not a guess and not the default: a supplier rule or a bank
--      hint) fits only an edit of that same category;
--    - one line per edit and month: an edit month another line holds is taken.
--    The closest amount wins, then the earliest edit.
-- 3. private.forecast_line_sync(company, ids): the sync's pass (upsert_connector_lines, just before
--    sync_review_queue, over the lines that sync touched). A line nobody set (not user_assigned,
--    project_assigned or category_assigned; one project at most, not shared or overhead) takes the
--    edit's project (an expense with its one allocation) and, unless its category is firm, the edit's
--    category with category_suggested. The match is recorded. A line the owner set is never changed;
--    it keeps or gets its match only when its project and category are the edit's.
-- 4. A match is dropped when its line is removed or voided, moves to another month, or is filed to
--    another project or category (a trigger), and when its add edit goes (cascade).
-- 5. private.jev_suggestions_for: reason forecast_line, and forecast_month, when the line has a match
--    and Jev's suggestion agrees with it. public.list_review: forecast_match {month, amount_minor,
--    category_name, project_name}. public.jev_forecast_lines: the matches for the jev-tag job.
--    public.project_forecast_edits_for: matched_transaction_id on an add line that matched in the month.
-- upsert_connector_lines is patched in place (anchor checked, as in 20261013050000_mercury_sync_atomic.sql).

begin;

set local lock_timeout = '5s';

-- 1. The matches.
create table public.forecast_line_matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  edit_id uuid not null references public.project_forecast_edits (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  expected_minor bigint not null check (expected_minor > 0),
  matched_at timestamptz not null default now(),
  unique (edit_id, month),
  unique (transaction_id)
);

comment on table public.forecast_line_matches is
  'A bank line that is a line the user added to a project forecast, for that month (decision 0187). expected_minor is the amount the forecast expected when the line matched. Read and written only through the forecast line functions.';

create index forecast_line_matches_company on public.forecast_line_matches (company_id);

alter table public.forecast_line_matches enable row level security;
revoke all on public.forecast_line_matches from public, anon, authenticated;
grant select, insert, update, delete on public.forecast_line_matches to service_role;

-- 2. The best add edit for each line.
create function private.forecast_line_match(p_company uuid, p_ids uuid[])
returns table (line_id uuid, edit_id uuid, month text, project_id uuid, category_id uuid, expected_minor bigint)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  base text := private.company_base_currency(p_company);
  c record;
  lines_taken uuid[] := array[]::uuid[];
  months_taken text[] := array[]::text[];
begin
  -- Every pair a line fits, closest first: each line takes its best edit month that is still free,
  -- so of two lines for one edit and month the closer one wins.
  for c in
    with l as (
      select t.id, t.direction::text as direction, t.amount_net, t.amount_gross, t.category_id, t.doc_date,
        to_char(t.doc_date, 'YYYY-MM') as line_month,
        -- A category the line did not guess: a supplier rule or a bank hint, never the default.
        (t.category_id is not null and not t.category_suggested and not exists (
          select 1 from public.categories dc where dc.id = t.category_id and dc.is_default
        )) as firm
      from public.transactions t
      where t.company_id = p_company
        and t.id = any (coalesce(p_ids, array[]::uuid[]))
        and t.removed_at is null
        and t.line_status <> 'void'
        and coalesce(t.currency, 'ILS') = base
        and ((t.direction = 'expense' and t.amount_net < 0) or (t.direction = 'income' and t.amount_net > 0))
    )
    select l.id as lid, l.line_month, e.id as eid, e.project_id as pid, e.category_id as cid, x.expected, x.diff
    from l
    join public.project_forecast_edits e
      on e.company_id = p_company and e.kind = 'add' and e.direction = l.direction
     and private.pfe_hits(e.start_month, e.pace, l.line_month)
    join public.projects p on p.id = e.project_id and p.company_id = p_company and p.status = 'active'
    cross join lateral (
      select coalesce((
        select ch.amount_minor from public.project_forecast_edits ch
        where ch.company_id = p_company and ch.project_id = e.project_id and ch.kind = 'change'
          and ch.row_key = 'add:' || e.id::text
          and private.pfe_hits(ch.start_month, ch.pace, l.line_month)
        order by ch.start_month desc, ch.created_at desc
        limit 1
      ), e.amount_minor) as expected
    ) a
    cross join lateral (
      select a.expected,
        least(abs(abs(l.amount_net) - a.expected), abs(abs(l.amount_gross) - a.expected)) as diff
    ) x
    where private.pfe_category_ok(p_company, e.category_id)
      and not exists (
        select 1 from public.project_forecast_edits r
        where r.company_id = p_company and r.project_id = e.project_id and r.kind = 'remove'
          and r.row_key = 'add:' || e.id::text
          and private.pfe_hits(r.start_month, r.pace, l.line_month)
      )
      and x.expected > 0
      and x.diff <= greatest(x.expected / 10, 100)
      and (not l.firm or l.category_id = e.category_id)
      and not exists (
        select 1 from public.forecast_line_matches m
        where m.edit_id = e.id and m.month = l.line_month and m.transaction_id <> l.id
      )
    order by x.diff, e.created_at, e.id, l.doc_date, l.id
  loop
    if c.lid = any (lines_taken) or (c.eid::text || ':' || c.line_month) = any (months_taken) then
      continue;
    end if;
    lines_taken := lines_taken || c.lid;
    months_taken := months_taken || (c.eid::text || ':' || c.line_month);
    line_id := c.lid;
    edit_id := c.eid;
    month := c.line_month;
    project_id := c.pid;
    category_id := c.cid;
    expected_minor := c.expected;
    return next;
  end loop;
end;
$$;

-- 3. The sync's pass over the lines it touched. Returns how many lines hold a match.
create function private.forecast_line_sync(p_company uuid, p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  found_rows jsonb;
  r record;
  line public.transactions%rowtype;
  shares integer;
  kept integer := 0;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then
    return 0;
  end if;
  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into found_rows
  from private.forecast_line_match(p_company, p_ids) f;

  -- A touched line that no longer fits its edit (the bank changed its amount) loses the match.
  delete from public.forecast_line_matches m
  where m.company_id = p_company
    and m.transaction_id = any (p_ids)
    and not exists (
      select 1 from jsonb_to_recordset(found_rows) as f(line_id uuid, edit_id uuid, month text)
      where f.line_id = m.transaction_id and f.edit_id = m.edit_id and f.month = m.month
    );

  for r in
    select * from jsonb_to_recordset(found_rows)
      as f(line_id uuid, edit_id uuid, month text, project_id uuid, category_id uuid, expected_minor bigint)
  loop
    select * into line from public.transactions t where t.id = r.line_id and t.company_id = p_company for update;
    if line.user_assigned or line.project_assigned or line.category_assigned then
      -- The owner's line is never changed: it is the forecast line only when it is filed as one.
      if line.project_id is distinct from r.project_id or line.category_id is distinct from r.category_id then
        continue;
      end if;
    else
      select count(*)::integer into shares
      from public.allocations a
      where a.company_id = p_company and a.transaction_id = line.id;
      if coalesce(line.pnl_role::text, 'project') <> 'project' or shares > 1 then
        continue;
      end if;
      if line.project_id is distinct from r.project_id then
        update public.transactions t set project_id = r.project_id where t.id = line.id;
        -- An expense carries one allocation with the line's amount; income has none.
        if line.direction = 'expense' then
          delete from public.allocations where company_id = p_company and transaction_id = line.id;
          insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
          values (p_company, line.id, r.project_id, 10000, line.amount_net);
        end if;
      end if;
      -- A guessed or missing category takes the forecast line's, still a suggestion. A firm one is
      -- already the edit's (the match asks for it).
      if line.category_id is distinct from r.category_id then
        -- fill_suggested_category reads a category change that keeps the flag as an assignment, so
        -- the flag is cleared first and set with the new category.
        if line.category_suggested then
          update public.transactions t set category_suggested = false where t.id = line.id;
        end if;
        update public.transactions t
        set category_id = r.category_id, category_suggested = true
        where t.id = line.id;
      end if;
    end if;
    insert into public.forecast_line_matches (company_id, edit_id, month, transaction_id, expected_minor)
    values (p_company, r.edit_id, r.month, line.id, r.expected_minor)
    on conflict (transaction_id) do update
    set edit_id = excluded.edit_id, month = excluded.month, expected_minor = excluded.expected_minor,
        matched_at = case
          when public.forecast_line_matches.edit_id = excluded.edit_id and public.forecast_line_matches.month = excluded.month
            then public.forecast_line_matches.matched_at
          else now()
        end;
    kept := kept + 1;
  end loop;
  return kept;
end;
$$;

revoke all on function private.forecast_line_match(uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.forecast_line_sync(uuid, uuid[]) from public, anon, authenticated;

-- 4. A line removed, voided, moved to another month, or filed elsewhere is no longer the forecast line.
create function private.forecast_line_refiled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.forecast_line_matches m
  using public.project_forecast_edits e
  where m.transaction_id = new.id
    and e.id = m.edit_id
    and (
      new.removed_at is not null
      or new.line_status = 'void'
      or to_char(new.doc_date, 'YYYY-MM') <> m.month
      or new.project_id is distinct from e.project_id
      or new.category_id is distinct from e.category_id
    );
  return null;
end;
$$;

revoke all on function private.forecast_line_refiled() from public, anon, authenticated;

create trigger transactions_forecast_line_refiled
after update of project_id, category_id, removed_at, line_status, doc_date on public.transactions
for each row
when (
  old.project_id is distinct from new.project_id
  or old.category_id is distinct from new.category_id
  or old.removed_at is distinct from new.removed_at
  or old.line_status is distinct from new.line_status
  or old.doc_date is distinct from new.doc_date
)
execute function private.forecast_line_refiled();

-- 5. What a match says: the month, the amount the forecast expected, and the forecast line's names.
create function private.forecast_match_rows(p_company uuid, p_ids uuid[])
returns table (
  transaction_id uuid, month text, amount_minor bigint, edit_id uuid,
  project_id uuid, project_name text, category_id uuid, category_name text
)
language sql
stable
set search_path = ''
as $$
  select m.transaction_id, m.month, m.expected_minor, e.id, e.project_id, p.name, e.category_id, c.name
  from public.forecast_line_matches m
  join public.project_forecast_edits e on e.id = m.edit_id and e.company_id = p_company
  left join public.projects p on p.id = e.project_id and p.company_id = p_company
  left join public.categories c on c.id = e.category_id and c.company_id = p_company
  where m.company_id = p_company
    and m.transaction_id = any (coalesce(p_ids, array[]::uuid[]));
$$;

revoke all on function private.forecast_match_rows(uuid, uuid[]) from public, anon, authenticated;

-- list_review's forecast_match: the caller's company's open review lines only.
create function private.review_forecast_matches()
returns table (transaction_id uuid, forecast_match jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select f.transaction_id, jsonb_build_object(
    'month', f.month,
    'amount_minor', f.amount_minor,
    'category_name', f.category_name,
    'project_name', f.project_name
  )
  from private.forecast_match_rows(
    private.readable_company_id(),
    array(
      select q.transaction_id from public.review_queue q
      where q.company_id = private.readable_company_id() and q.status = 'open'
    )
  ) f;
$$;

revoke all on function private.review_forecast_matches() from public, anon;
grant execute on function private.review_forecast_matches() to authenticated, service_role;

-- jev-tag: the forecast lines of the lines in a run, as the model's expected_line. Service role only.
create function public.jev_forecast_lines(p_company uuid, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'validation';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', f.transaction_id,
      'month', f.month,
      'amount_minor', f.amount_minor,
      'category_name', f.category_name,
      'project_name', f.project_name
    ) order by f.transaction_id), '[]'::jsonb)
    from private.forecast_match_rows(p_company, p_ids) f
  );
end;
$$;

revoke all on function public.jev_forecast_lines(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.jev_forecast_lines(uuid, uuid[]) to service_role;

-- The edits of a month, with matched_transaction_id on an add line that matched in that month.
create or replace function public.project_forecast_edits_for(p_project_id uuid, p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'validation' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(
      private.pfe_json(e.*) || jsonb_build_object('category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matched_transaction_id', m.transaction_id) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
    from public.project_forecast_edits e
    left join public.categories c on c.id = e.category_id
    left join public.forecast_line_matches m on m.edit_id = e.id and m.month = p_month and m.company_id = e.company_id
    where e.company_id = private.readable_company_id()
      and e.project_id = p_project_id
      and private.pfe_hits(e.start_month, e.pace, p_month)
  );
end;
$$;

-- Jev's reasons: forecast_line when the line has a match and the suggestion agrees with it.
create or replace function private.jev_suggestions_for(p_company uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select r.*, t.direction, coalesce(t.supplier_id, t.customer_id) as party_id
    from private.jev_suggestion_rows(p_company, p_ids) r
    join public.transactions t on t.company_id = p_company and t.id = r.transaction_id
    where r.project_id is not null or r.category_id is not null or r.no_project
  ),
  parties as (
    select distinct s.party_id, s.direction from s where s.party_id is not null
  ),
  candidates as (
    select t.id, coalesce(t.supplier_id, t.customer_id) as party_id, t.direction, t.doc_date,
      t.project_id, t.category_id, t.pnl_role
    from public.transactions t
    join parties p on p.party_id = coalesce(t.supplier_id, t.customer_id) and p.direction = t.direction
    where t.company_id = p_company and t.removed_at is null
  ),
  -- The current (newest) review row of each candidate, read once.
  latest as (
    select distinct on (q.transaction_id) q.transaction_id, q.status
    from public.review_queue q
    join candidates c on c.id = q.transaction_id
    where q.company_id = p_company
    order by q.transaction_id, q.created_at desc, q.updated_at desc, q.id desc
  ),
  -- The last 6 filed lines per party and direction: 5 once the line itself is left out.
  recent as (
    select r.* from (
      select c.*, row_number() over (
          partition by c.party_id, c.direction order by c.doc_date desc, c.id desc
        ) as rank
      from candidates c
      join latest l on l.transaction_id = c.id and l.status in ('approved', 'changed')
    ) r
    where r.rank <= 6
  ),
  filings as (
    select f.* from (
      select s.transaction_id, r.project_id, r.category_id, r.pnl_role,
        row_number() over (partition by s.transaction_id order by r.doc_date desc, r.id desc) as n
      from s
      join recent r on r.party_id = s.party_id and r.direction = s.direction and r.id <> s.transaction_id
    ) f
    where f.n <= 5
  ),
  matched as (
    select f.transaction_id, f.n,
      (case
         when s.no_project then f.project_id is null or f.pnl_role::text in ('shared', 'overhead')
           or f.project_id = (select co.overhead_project_id from public.companies co where co.id = p_company)
         else s.project_id is null or f.project_id = s.project_id
       end)
      and (s.category_id is null or f.category_id = s.category_id) as hit
    from filings f
    join s on s.transaction_id = f.transaction_id
  ),
  counted as (
    select s.transaction_id,
      count(m.n) as party_filings,
      count(m.n) filter (where m.hit) as matching_filings,
      bool_or(m.n = 1 and m.hit) as last_matches
    from s
    left join matched m on m.transaction_id = s.transaction_id
    group by s.transaction_id
  ),
  -- Decision 0187: the forecast line the user added, when Jev's answer agrees with it.
  forecast as (
    select f.transaction_id, f.month
    from private.forecast_match_rows(p_company, array(select s.transaction_id from s)) f
    join s on s.transaction_id = f.transaction_id
    where not s.no_project
      and (s.project_id is null or s.project_id = f.project_id)
      and (s.category_id is null or s.category_id = f.category_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', s.transaction_id,
      'direction', s.direction,
      'project_id', s.project_id,
      'project_name', p.name,
      'no_project', s.no_project,
      'category_id', s.category_id,
      'category_name', c.name,
      'confidence', s.confidence,
      'reason', case
        when fc.transaction_id is not null then 'forecast_line'
        when c2.party_filings = 0 then 'new_party'
        when coalesce(c2.last_matches, false) then 'same_as_last'
        when c2.matching_filings >= 2 then 'usual_for_party'
        else 'model_only'
      end,
      'forecast_month', fc.month,
      'party_filings', c2.party_filings,
      'matching_filings', c2.matching_filings,
      'anomaly_score', s.anomaly_score,
      'prefilled', exists (
        select 1 from public.jev_prefills jp
        where jp.company_id = p_company and jp.transaction_id = s.transaction_id and jp.undone_at is null
      )
    ) order by s.transaction_id), '[]'::jsonb)
  from s
  join counted c2 on c2.transaction_id = s.transaction_id
  left join forecast fc on fc.transaction_id = s.transaction_id
  left join public.projects p on p.company_id = p_company and p.id = s.project_id
  left join public.categories c on c.company_id = p_company and c.id = s.category_id;
$$;

revoke all on function private.jev_suggestions_for(uuid, uuid[]) from public, anon, authenticated;

-- לאישור carries the forecast line a line matched (forecast_match), so the card can say so.
create or replace function public.list_review()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'company_id', q.company_id,
    'transaction_id', t.id,
    'description', t.description,
    'doc_date', t.doc_date,
    'doc_kind', t.doc_kind,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'currency', t.currency,
    'vat_agorot', t.vat_amount,
    'direction', t.direction,
    'line_status', t.line_status,
    'source', t.source,
    'kept_out', kept.state = 'out',
    'reason', q.reason,
    'pnl_role', t.pnl_role,
    'share_count', (
      select count(*)::int
      from public.allocations a
      where a.transaction_id = t.id
    ),
    'project_id', t.project_id,
    'category_id', t.category_id,
    'project_name', p.name,
    'category_name', c.name,
    'category_suggested', t.category_suggested,
    'project_suggested', (
      t.project_id is not null
      and not t.user_assigned
      and not t.project_assigned
      and coalesce(t.pnl_role, 'project') is distinct from 'shared'
      and (
        select count(*)
        from public.allocations a
        where a.transaction_id = t.id
          and a.company_id = t.company_id
      ) <= 1
      and not exists (
        select 1
        from public.suppliers sp
        where sp.id = t.supplier_id
          and sp.company_id = t.company_id
          and sp.remembered_project_id = t.project_id
      )
    ),
    'confidence', null,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'auto_approved_today', filed.n,
    'assistant_filed_today', filed.assistant,
    'receipts', coalesce(pair.receipts, '[]'::jsonb),
    'paid', coalesce(
      pair.receipts is not null
        and t.amount_gross + pair.credit_gross - pair.receipt_gross <= 0,
      false
    ),
    'paid_on', pair.paid_on,
    'forecast_match', fm.forecast_match
  ) order by t.doc_date, q.created_at), '[]'::jsonb)
  from public.review_queue q
  -- The lines filed today, read once for the whole list (it was read twice).
  cross join (
    select count(*)::int as n, coalesce(bool_or(f.assistant), false) as assistant
    from private.filed_today_rows() f
  ) filed
  left join (
    select st.transaction_id, st.state
    from private.line_pnl_states(array(
      select open_row.transaction_id
      from public.review_queue open_row
      where open_row.company_id = (select private.readable_company_id())
        and open_row.status = 'open'
    )) st
  ) kept on kept.transaction_id = q.transaction_id
  -- Decision 0187: the forecast line the user added that this line is.
  left join private.review_forecast_matches() fm on fm.transaction_id = q.transaction_id
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  -- FLOW-309: the invoice's receipts (the matching rule in private.invoice_receipts).
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'transaction_id', r.id,
        'doc_date', r.doc_date,
        'amount_gross', r.amount_gross,
        'currency', r.currency
      ) order by r.doc_date, r.id) as receipts,
      sum(r.amount_gross)::bigint as receipt_gross,
      max(r.doc_date) as paid_on,
      coalesce((
        select sum(cred.amount_gross)::bigint
        from public.transactions cred
        where cred.company_id = t.company_id
          and cred.removed_at is null
          and cred.doc_kind = 'credit'
          and cred.linked_external_id = t.external_id
      ), 0) as credit_gross
    from public.transactions r
    where t.direction = 'income'
      and t.doc_kind = 'invoice'
      and t.external_id is not null
      and private.is_connector_source(t.source)
      and r.company_id = t.company_id
      and r.source = t.source
      and r.linked_external_id = t.external_id
      and r.direction = 'income'
      and r.doc_kind = 'receipt'
      and r.removed_at is null
      and r.line_status <> 'void'
    having count(*) > 0
  ) pair on true
  where q.company_id = (select private.readable_company_id())
    and q.status = 'open'
    and t.removed_at is null
    and t.line_status <> 'pending';
$function$;

-- upsert_connector_lines: the forecast pass over the lines this sync touched, just before the
-- review queue is synced (anchor checked: it must occur once in the live definition).
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $sync$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)'::regprocedure);
  anchor := $a$
  perform public.sync_review_queue(p_company);
  return result;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'upsert_connector_lines is not the expected definition';
  end if;
  def := replace(def, anchor, $n$
  -- Decision 0187: a line the user's project forecast expects takes the forecast line's project and
  -- category (a suggestion), after the supplier rules above.
  perform private.forecast_line_sync(p_company, array(
    select t.id from public.transactions t
    where t.company_id = p_company
      and t.source = source_value
      and t.external_id = any (seen_ids)
  ));
$n$ || anchor);
  execute def;
end
$sync$;

drop function pg_temp.anchor_count(text, text);

commit;
