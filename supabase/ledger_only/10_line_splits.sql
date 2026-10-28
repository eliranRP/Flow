-- ===========================================================================
-- 10 line splits: the split-by-category functions read and write the parts through the legs.
-- ===========================================================================

-- A part keeps how the person entered it (a percent share, or "the rest"), as the old rows did.
-- The core's views and writer carry the two columns.
alter table public.legs
  add column part_percent numeric(7,4),
  add column part_rest boolean not null default false;

alter table public.legs
  add constraint legs_part_percent_check check (
    (part_percent is null or (split_part and part_percent > 0 and part_percent <= 100))
    and (not part_rest or split_part)
  );

comment on column public.legs.part_percent is
  'Decision 0232. The percent the person gave for a split part (null for an exact amount).';
comment on column public.legs.part_rest is
  'Decision 0232. The split part is the rest of the line (the person gave no amount).';

create or replace view private.split_parts with (security_invoker = true) as
  select l.company_id, l.transaction_id, l.part_ordinal as ordinal, l.category_id,
    case when l.project_explicit then l.project_id end as project_id,
    abs(l.amount_minor) as amount_minor, l.gross_up, l.draft, l.id as leg_id,
    l.part_percent as percent, l.part_rest as is_rest
  from public.legs l
  where l.split_part;

do $patch$
declare
  def text;
  hits integer;
  fix record;
begin
  -- post_lines keeps the percent and rest marker when it writes the part legs back.
  def := pg_get_functiondef('private.post_lines(uuid, uuid[])'::regprocedure);
  for fix in
    select * from (values
      ($a$l.gross_up, l.split_part, l.part_ordinal, l.loan_id, l.part, l.scheduled_minor, l.needs_review$a$,
       $b$l.gross_up, l.split_part, l.part_ordinal, l.loan_id, l.part, l.scheduled_minor, l.needs_review,
      l.part_percent, l.part_rest$b$),
      ($a$split_part, part_ordinal, loan_id, scheduled_minor, needs_review, draft)$a$,
       $b$split_part, part_ordinal, loan_id, scheduled_minor, needs_review, draft, part_percent, part_rest)$b$),
      ($a$e.split_part, e.part_ordinal, e.loan_id, e.scheduled_minor, e.needs_review, e.draft$a$,
       $b$e.split_part, e.part_ordinal, e.loan_id, e.scheduled_minor, e.needs_review, e.draft,
    pp.part_percent, coalesce(pp.part_rest, false)$b$),
      ($a$  from entries e$a$,
       $b$  from entries e
  left join parts pp on pp.transaction_id = e.transaction_id and e.split_part
    and pp.split_part and pp.part_ordinal = e.part_ordinal$b$)
    ) as v(a, b)
  loop
    hits := (length(def) - length(replace(def, fix.a, ''))) / length(fix.a);
    if hits <> 1 then
      raise exception 'post_lines anchor not found once: %', left(fix.a, 60);
    end if;
    def := replace(def, fix.a, fix.b);
  end loop;
  execute def;

  -- set_line_parts takes percent and is_rest per part, and lets one normal and one gross-up part
  -- share a category and project (the old unique key had gross_up in it).
  def := pg_get_functiondef('private.set_line_parts(uuid, uuid, jsonb)'::regprocedure);
  for fix in
    select * from (values
      ($a$group by (e->>'category_id'), (e->>'project_id')$a$,
       $b$group by (e->>'category_id'), (e->>'project_id'), coalesce((e->>'gross_up')::boolean, false)$b$),
      ($a$project_explicit, split_part, part_ordinal, draft)$a$,
       $b$project_explicit, split_part, part_ordinal, draft, part_percent, part_rest)$b$),
      ($a$e->>'project_id' is not null, true, x.ord::smallint, true$a$,
       $b$e->>'project_id' is not null, true, x.ord::smallint, true,
    (e->>'percent')::numeric, coalesce((e->>'is_rest')::boolean, false)$b$)
    ) as v(a, b)
  loop
    hits := (length(def) - length(replace(def, fix.a, ''))) / length(fix.a);
    if hits <> 1 then
      raise exception 'set_line_parts anchor not found once: %', left(fix.a, 60);
    end if;
    def := replace(def, fix.a, fix.b);
  end loop;
  execute def;
end
$patch$;

CREATE OR REPLACE FUNCTION private.line_has_loose_reversal(p_transaction_id uuid, p_parts jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with parts as (
    select s.category_id, s.project_id
    from private.split_parts s
    where p_parts is null and s.transaction_id = p_transaction_id
    union all
    select (b->>'category_id')::uuid, (b->>'project_id')::uuid
    from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) b
    where p_parts is not null
  )
  select exists (
    select 1
    from parts s
    join public.transactions t on t.id = p_transaction_id
    join public.categories pc on pc.id = s.category_id and pc.company_id = t.company_id
    left join public.categories lc on lc.id = t.category_id and lc.company_id = t.company_id
    where s.project_id is null
      and s.category_id is distinct from t.category_id
      and pc.kind::text is distinct from coalesce(lc.kind::text, t.direction::text)
  );
$function$;

CREATE OR REPLACE FUNCTION private.line_pnl_state(p_transaction_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when t.line_status = 'posted' then coalesce(
      -- The parts on this project and category, when the caller names them. A shared line's
      -- parts sit on the line's own project, so they match the category alone.
      (
        select case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end
        from private.pnl_lines pl
        where pl.transaction_id = t.id
          and (p_project_id is not null or p_category_id is not null)
          and (p_project_id is null or pl.project_id = p_project_id or pl.pnl_role = 'shared')
          and (p_category_id is null or pl.category_id = p_category_id)
        having count(*) > 0
      ),
      -- Every part of the line.
      (
        select case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end
        from private.pnl_lines pl
        where pl.transaction_id = t.id
        having count(*) > 0
      ),
      pending.state
    )
    else pending.state
  end
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
  cross join lateral (
    select case when private.line_in_pnl(
      case when not exists (
        select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ) then 'in' else 'out' end as state
  ) pending
  where t.id = p_transaction_id
    -- Definer, so the reads skip row security, which kept the planner off the line's own index
    -- (11 ms a line on a 3,600-line company). The caller still sees only its own company.
    and (auth.role() = 'service_role' or t.company_id = private.readable_company_id());
$function$;

CREATE OR REPLACE FUNCTION private.line_pnl_states(p_ids uuid[], p_project_id uuid, p_category_id uuid)
 RETURNS TABLE(transaction_id uuid, state text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    with parts as (
      select pl.transaction_id,
        case
          when count(*) filter (where scoped.on_it) = 0 then null
          when bool_and(pl.in_pnl) filter (where scoped.on_it) then 'in'
          when not bool_or(pl.in_pnl) filter (where scoped.on_it) then 'out'
          else 'mixed'
        end as scoped_state,
        case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end as state
      from private.pnl_lines pl
      cross join lateral (
        select ($2 is not null or $3 is not null)
          and ($2 is null or pl.project_id = $2 or pl.pnl_role = 'shared')
          and ($3 is null or pl.category_id = $3) as on_it
      ) scoped
      where pl.transaction_id = any($1)
      group by pl.transaction_id
    ),
    states as (
      select coalesce(jsonb_object_agg(p.transaction_id, coalesce(p.scoped_state, p.state)), '{}'::jsonb) as map
      from parts p
    )
    select t.id,
      case
        when t.line_status = 'posted' then coalesce((select s.map from states s) ->> t.id::text, pending.state)
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
    cross join lateral (
      select case when private.line_in_pnl(
        case when not exists (
          select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
        ) then t.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
        c.loan_part
      ) then 'in' else 'out' end as state
    ) pending
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids, p_project_id, p_category_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.line_pnl_states(p_ids uuid[])
 RETURNS TABLE(transaction_id uuid, state text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    select t.id,
      case
        when t.line_status = 'posted' then coalesce(
          (
            select coalesce(jsonb_object_agg(parts.transaction_id, parts.state), '{}'::jsonb)
            from (
              select pl.transaction_id,
                case
                  when bool_and(pl.in_pnl) then 'in'
                  when not bool_or(pl.in_pnl) then 'out'
                  else 'mixed'
                end as state
              from private.pnl_lines pl
              where pl.transaction_id = any($1)
              group by pl.transaction_id
            ) parts
          ) ->> t.id::text,
          pending.state
        )
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
    cross join lateral (
      select case when private.line_in_pnl(
        case when not exists (
          select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
        ) then t.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
        c.loan_part
      ) then 'in' else 'out' end as state
    ) pending
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids;
end;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_parts(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', s.category_id,
    'project_id', s.project_id,
    'amount_minor', s.amount_minor,
    'gross_up', s.gross_up
  ) order by s.ordinal), '[]'::jsonb)
  from private.split_parts s
  where s.transaction_id = p_transaction_id;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_parts_full(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', s.category_id,
    'project_id', s.project_id,
    'amount_minor', s.amount_minor,
    'percent', s.percent,
    'is_rest', s.is_rest,
    'gross_up', s.gross_up
  ) order by s.ordinal), '[]'::jsonb)
  from private.split_parts s
  where s.transaction_id = p_transaction_id;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_review_sync(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line record;
  parts integer;
  parts_minor bigint;
  mismatch boolean;
begin
  select t.company_id, t.amount_net, t.removed_at, t.line_status
  into line
  from public.transactions t
  where t.id = p_transaction_id;
  if not found then
    return;
  end if;

  select count(*)::integer,
    coalesce(sum(case when s.gross_up then -s.amount_minor else s.amount_minor end), 0)
  into parts, parts_minor
  from private.split_parts s
  where s.transaction_id = p_transaction_id;

  mismatch := parts > 0
    and parts_minor <> abs(line.amount_net)
    and line.removed_at is null
    and line.line_status = 'posted'::public.line_status;

  if mismatch then
    insert into public.review_queue (company_id, transaction_id, status, reason)
    select line.company_id, p_transaction_id, 'open', 'split_mismatch'
    where not exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_transaction_id and q.status = 'open'
    );
  else
    delete from public.review_queue q
    where q.transaction_id = p_transaction_id
      and q.company_id = line.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.line_split_valid(p_transaction_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select count(*) >= 2
    and sum(case when s.gross_up then -s.amount_minor else s.amount_minor end)
      = (select abs(t.amount_net) from public.transactions t where t.id = p_transaction_id)
  from private.split_parts s
  where s.transaction_id = p_transaction_id;
$function$;

CREATE OR REPLACE FUNCTION private.review_queue_line_split_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.transaction_id is null
    or not exists (select 1 from private.split_parts s where s.transaction_id = old.transaction_id)
  then
    return null;
  end if;
  if old.status = 'open'
    and old.reason is distinct from 'split_mismatch'
    and (tg_op = 'DELETE' or new.status is distinct from 'open')
  then
    perform private.line_split_review_sync(old.transaction_id);
  elsif tg_op = 'UPDATE'
    and new.status = 'open'
    and old.status is distinct from 'open'
    and new.reason = 'split_mismatch'
  then
    perform private.line_split_review_sync(new.transaction_id);
  elsif tg_op = 'UPDATE'
    and new.status = 'open'
    and old.status is distinct from 'open'
    and new.reason is distinct from 'split_mismatch'
  then
    -- Another review came back (undo of a skip): it holds the line again, one open review.
    delete from public.review_queue q
    where q.transaction_id = new.transaction_id
      and q.company_id = new.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.transactions_line_split_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from private.split_parts s where s.transaction_id = new.id) then
    perform private.line_split_review_sync(new.id);
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_line_split(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'transaction_id', t.id,
    'currency', coalesce(t.currency, 'ILS'),
    'line_minor', abs(t.amount_net),
    'parts', coalesce((
      select jsonb_agg((jsonb_build_object(
        'category_id', s.category_id,
        'category_name', c.name,
        'project_id', s.project_id,
        'project_name', p.name,
        'amount_minor', s.amount_minor,
        'percent', s.percent,
        'rest', s.is_rest,
        'gross_up', s.gross_up
      ) || case when s.gross_up then jsonb_build_object(
        'effect', case when c.kind::text = t.direction::text then 'contra' else 'normal' end
      ) else '{}'::jsonb end) order by s.ordinal)
      from private.split_parts s
      join public.categories c on c.id = s.category_id
      left join public.projects p on p.id = s.project_id
      where s.transaction_id = t.id
    ), '[]'::jsonb),
    'parts_match', coalesce((
      select count(*) >= 2
        and sum(case when s.gross_up then -s.amount_minor else s.amount_minor end) = abs(t.amount_net)
      from private.split_parts s
      where s.transaction_id = t.id
      having count(*) > 0
    ), true)
  )
  from public.transactions t
  where t.id = p_transaction_id
    and t.removed_at is null
    and t.company_id = (select private.readable_company_id());
$function$;

CREATE OR REPLACE FUNCTION public.set_transaction_pnl(p_id uuid, p_in_pnl boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  line record;
begin
  -- The owner's own company comes first, so an owner who is also listed as a viewer is not refused.
  cid := private.current_company_id();
  if cid is null then
    if exists (
      select 1 where private.is_read_only()
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select t.id, c.loan_part,
    private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part) as excluded_from_pnl
  into line
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update of t;
  if not found then
    raise exception 'transaction not found';
  end if;
  if line.loan_part is not null
    or exists (select 1 from private.loan_parts s where s.transaction_id = p_id and s.company_id = cid)
  then
    raise exception 'loan line is fixed';
  end if;
  if p_in_pnl is true and private.line_has_loose_reversal(p_id) then
    raise exception 'a reversal part needs a project';
  end if;
  update public.transactions
  set in_pnl_override = p_in_pnl
  where id = p_id and company_id = cid;
  return jsonb_build_object(
    'id', p_id,
    'in_pnl_override', p_in_pnl,
    'in_pnl', private.line_in_pnl(p_in_pnl, line.excluded_from_pnl, null)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_assign_expense(p_idempotency_key text, p_transaction_id uuid, p_project_id uuid, p_category_id uuid, p_remember boolean DEFAULT false, p_unshare boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  review uuid;
  outcome jsonb;
  undo_id uuid;
  response jsonb;
  locked boolean;
  line record;
  shared boolean := false;
  category uuid := p_category_id;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or (p_category_id is null and not coalesce(p_unshare, false))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  -- Without unshare the hash is the one before FLOW-150, so a replay of an earlier key still matches.
  hash := 'assign|' || p_transaction_id::text || '|' || coalesce(p_project_id::text, '') || '|'
    || coalesce(p_category_id::text, '') || '|' || coalesce(p_remember, false)::text
    || case when coalesce(p_unshare, false) then '|unshare' else '' end;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Lock the line before the review so assign and category share one order.
    select t.category_id, t.pnl_role into line
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;
    locked := found;

    if locked and coalesce(p_unshare, false) then
      shared := line.pnl_role is not distinct from 'shared'::public.pnl_role or exists (
        select 1 from public.review_queue q
        where q.transaction_id = p_transaction_id and q.company_id = cid
          and q.status = 'open' and q.reason = 'unallocated_shared'
      );
      -- The line keeps its category unless a new one is given.
      category := coalesce(p_category_id, line.category_id);
    end if;

    if exists (
      select 1
      from public.review_queue q
      where q.id = p_transaction_id
        and q.company_id = cid
    ) and not locked then
      response := private.mcp_error(
        'validation',
        'id is not a transaction; list_review.id is the review id'
      );
    elsif not locked then
      response := private.mcp_refused('transaction not found');
    elsif category is null then
      response := private.mcp_refused('category is required');
    elsif shared and p_project_id is null then
      response := private.mcp_error('validation', 'validation');
    elsif shared and exists (
      select 1 from private.split_parts s where s.transaction_id = p_transaction_id and s.company_id = cid
    ) then
      -- A split line's parts carry their own shares: split_line moves them.
      response := private.mcp_refused('line has a split by category');
    elsif shared then
      -- FLOW-150: the shares go and the whole line goes to the one project. reassign_transaction keeps
      -- the shares and the shared role in its undo row, and resolves an open review as changed.
      if not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid) then
        response := private.mcp_refused('project or category not found');
      else
        perform set_config('flow.unshare', 'on', true);
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, category);
        perform set_config('flow.unshare', '', true);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
        if response->>'ok' = 'true' then
          response := jsonb_set(response, '{data,unshared}', 'true'::jsonb);
        end if;
      end if;
    else
      if p_project_id is null and not exists (
        select 1
        from public.categories c
        where c.id = category
          and c.company_id = cid
          and c.kind = 'income'
          and c.excluded_from_pnl
      ) then
        response := private.mcp_error('validation', 'validation');
      elsif p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        response := private.mcp_refused('project or category not found');
      else
      select q.id into review
      from public.review_queue q
      where q.transaction_id = p_transaction_id
        and q.company_id = cid
        and q.status = 'open'
      order by q.created_at desc
      limit 1
      for update;

      if review is not null then
        outcome := public.approve_review_item(
          review,
          p_project_id,
          category,
          coalesce(p_remember, false),
          null,
          null,
          false
        );
        if outcome->>'ok' is distinct from 'true' then
          response := outcome;
        else
          response := private.mcp_record_write(token, p_transaction_id, review, null, 'review');
        end if;
      else
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, category);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
      end if;
      end if;
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

CREATE OR REPLACE FUNCTION private.undo_line_split_write(p_company uuid, p_write private.mcp_writes)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid := p_company;
  p_id uuid := p_write.transaction_id;
  rec private.mcp_writes := p_write;
  response jsonb;
begin
  perform 1 from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    response := private.mcp_error('not_found', 'not found');
  elsif private.line_split_parts(p_id) is distinct from rec.prior->'written' then
    response := private.mcp_error('conflict', 'conflict');
  elsif (select t.in_pnl_override from public.transactions t where t.id = p_id and t.company_id = cid) is true
    and private.line_has_loose_reversal(p_id, rec.prior->'before') then
    response := private.mcp_error('conflict', 'conflict');
  else
    -- A write stored before FLOW-133 has no percent or rest in before: they stay empty.
    perform private.set_line_parts(
      cid, p_id,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'category_id', b.part->>'category_id', 'project_id', b.part->>'project_id',
        'amount_minor', (b.part->>'amount_minor')::bigint, 'percent', b.part->>'percent',
        'is_rest', coalesce((b.part->>'is_rest')::boolean, false),
        'gross_up', coalesce((b.part->>'gross_up')::boolean, false)
      ) order by b.ord), '[]'::jsonb)
      from jsonb_array_elements(rec.prior->'before') with ordinality as b(part, ord))
    );
    update public.transactions
    set user_assigned = (rec.prior->>'user_assigned')::boolean,
        category_suggested = (rec.prior->>'category_suggested')::boolean
    where id = p_id and company_id = cid;
    update private.mcp_writes
    set undone_at = clock_timestamp()
    where id = rec.id and undone_at is null;
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object('kind', 'line_split', 'id', p_id)
    );
  end if;
  return response;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_line_split(p_transaction_id uuid, p_parts jsonb, p_preview boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  line_net bigint;
  line_minor bigint;
  line_direction public.txn_direction;
  line_category uuid;
  line_project uuid;
  line_override boolean;
  kept_out boolean;
  line_kind text;
  item jsonb;
  n integer;
  i integer := 0;
  categories uuid[] := '{}';
  projects uuid[] := '{}';
  amounts bigint[] := '{}';
  percents numeric[] := '{}';
  gross_ups boolean[] := '{}';
  rest_at integer;
  category uuid;
  project uuid;
  gross_up boolean;
  kind text;
  fixed_total bigint := 0;
  percent_total numeric := 0;
  percent_minor bigint := 0;
  leftover bigint;
  rest_minor bigint;
  seen text[] := '{}'::text[];
  pair text;
  pick record;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' then
    raise exception 'validation';
  end if;
  n := jsonb_array_length(p_parts);
  if n = 1 or n > 50 then
    raise exception 'validation';
  end if;

  select t.amount_net, t.direction, t.category_id, t.project_id, t.in_pnl_override
  into line_net, line_direction, line_category, line_project, line_override
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  -- The line's role was set for its own category's kind (the direction when it has none).
  select coalesce(c.kind::text, line_direction::text) into line_kind
  from (select 1) one
  left join public.categories c on c.id = line_category and c.company_id = cid;

  if n = 0 then
    if p_preview then
      return '[]'::jsonb;
    end if;
    perform private.set_line_parts(cid, p_transaction_id, '[]'::jsonb);
    return '[]'::jsonb;
  end if;

  if line_net = 0 then
    raise exception 'line amount is zero';
  end if;
  line_minor := abs(line_net);
  if exists (select 1 from private.loan_parts s where s.transaction_id = p_transaction_id) then
    raise exception 'line has a loan split';
  end if;
  if exists (
    select 1 from public.review_queue q
    where q.transaction_id = p_transaction_id and q.company_id = cid and q.status = 'open'
      and coalesce(q.reason, '') not in ('split_mismatch', 'unallocated_shared')
  ) then
    raise exception 'line has an open review';
  end if;

  for item in select value from jsonb_array_elements(p_parts)
  loop
    i := i + 1;
    if jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) k
        where k not in ('category_id', 'project_id', 'amount_minor', 'percent', 'rest', 'gross_up', 'effect')
      )
      -- Exactly one of amount_minor, percent and rest.
      or ((item ? 'amount_minor')::integer + (item ? 'percent')::integer + (item ? 'rest')::integer) <> 1
      or (item ? 'rest' and item->'rest' is distinct from 'true'::jsonb)
      or (item ? 'gross_up' and jsonb_typeof(item->'gross_up') is distinct from 'boolean')
      -- 0207: effect is a gross-up-only string marker, one of 'contra' or 'normal'.
      or (item ? 'effect' and (
        jsonb_typeof(item->'effect') is distinct from 'string'
        or (item->>'effect') not in ('contra', 'normal')
        or item->'gross_up' is distinct from 'true'::jsonb))
      or (item ? 'amount_minor' and (
        jsonb_typeof(item->'amount_minor') is distinct from 'number'
        or (item->>'amount_minor') !~ '^[0-9]{1,15}$'))
      or (item ? 'percent' and (
        jsonb_typeof(item->'percent') is distinct from 'number'
        or (item->>'percent') !~ '^[0-9]{1,3}(\.[0-9]{1,4})?$'))
      or (not item ? 'rest' and not item ? 'category_id')
      or (item ? 'category_id' and (
        jsonb_typeof(item->'category_id') is distinct from 'string'
        or (item->>'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      or (item ? 'project_id' and jsonb_typeof(item->'project_id') not in ('string', 'null'))
      or (jsonb_typeof(item->'project_id') = 'string'
        and (item->>'project_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then
      raise exception 'validation';
    end if;

    gross_up := coalesce((item->>'gross_up')::boolean, false);
    -- v1: a gross_up part is an exact amount only.
    if gross_up and not (item ? 'amount_minor') then
      raise exception 'validation';
    end if;

    if item ? 'rest' then
      if rest_at is not null then
        raise exception 'validation';
      end if;
      rest_at := i;
    end if;
    if item ? 'amount_minor' and (item->>'amount_minor')::bigint <= 0 then
      raise exception 'validation';
    end if;
    if item ? 'percent' and ((item->>'percent')::numeric <= 0 or (item->>'percent')::numeric > 100) then
      raise exception 'validation';
    end if;

    category := (item->>'category_id')::uuid;
    if category is null then
      -- A rest part with no category keeps the line's own category.
      category := line_category;
      if category is null then
        raise exception 'line has no category for the rest';
      end if;
    end if;
    project := (item->>'project_id')::uuid;

    -- FLOW-949 (0207): one normal and one gross-up part per category and project.
    pair := category::text || '|' || coalesce(coalesce(project, line_project)::text, '')
      || case when gross_up then '|gross_up' else '' end;
    if pair = any(seen) then
      raise exception 'same category and project twice';
    end if;
    seen := seen || pair;

    select c.kind::text, c.excluded_from_pnl into kind, kept_out
    from public.categories c
    where c.id = category and c.company_id = cid;
    if kind is null then
      raise exception 'category not found';
    end if;
    -- 0207: a gross_up part may carry EITHER kind. The effect is derived from (category kind vs
    -- line direction): the SAME kind is a contra entry, the OPPOSITE kind a normal real item. An
    -- explicit effect, when given, must match the derived value. A gross_up part names its project.
    if gross_up then
      if project is null then
        raise exception 'a gross-up part needs a project';
      end if;
      if item ? 'effect'
        and (item->>'effect') is distinct from
          (case when kind is not distinct from line_direction::text then 'contra' else 'normal' end) then
        raise exception 'validation';
      end if;
    end if;
    -- A part of another kind than the line's own category needs its own project: the line's
    -- role was set for that kind, so the part cannot borrow it.
    if kind is distinct from line_kind and project is null
      and category is distinct from line_category
      and not (kept_out and line_override is distinct from true) then
      raise exception 'a reversal part needs a project';
    end if;
    if project is not null and not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;

    categories := categories || category;
    projects := projects || project;
    amounts := amounts || (item->>'amount_minor')::bigint;
    percents := percents || (item->>'percent')::numeric;
    gross_ups := gross_ups || gross_up;
    if item ? 'amount_minor' then
      -- Signed: a gross_up amount nets against the line's primary side.
      fixed_total := fixed_total
        + case when gross_up then -(item->>'amount_minor')::bigint else (item->>'amount_minor')::bigint end;
    elsif item ? 'percent' then
      percent_total := percent_total + (item->>'percent')::numeric;
    end if;
  end loop;

  if percent_total > 100 then
    raise exception 'parts exceed the line';
  end if;

  -- Percent parts: floor each share of the line, then hand the cents still missing from the
  -- rounded total to the largest remainders, first part first on a tie.
  if percent_total > 0 then
    percent_minor := case
      when percent_total = 100 then line_minor
      else round(line_minor * percent_total / 100)::bigint
    end;
    for pick in
      select u.ord, floor(line_minor * u.pct / 100)::bigint as base,
        line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) as frac
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
    loop
      amounts[pick.ord] := pick.base;
    end loop;
    select percent_minor - coalesce(sum(amounts[u.ord]), 0) into leftover
    from unnest(percents) with ordinality as u(pct, ord)
    where u.pct is not null;
    for pick in
      select u.ord
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
      order by line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) desc, u.ord
      limit leftover
    loop
      amounts[pick.ord] := amounts[pick.ord] + 1;
    end loop;
    if exists (
      select 1 from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null and amounts[u.ord] = 0
    ) then
      raise exception 'a part rounds to zero';
    end if;
  end if;

  if fixed_total + percent_minor > line_minor then
    raise exception 'parts exceed the line';
  end if;
  if rest_at is null then
    if fixed_total + percent_minor <> line_minor then
      raise exception 'parts must sum to the line';
    end if;
  else
    rest_minor := line_minor - fixed_total - percent_minor;
    amounts[rest_at] := rest_minor;
    -- Nothing left: the rest part is dropped, and the others must still be a split.
    if rest_minor = 0 and n - 1 < 2 then
      raise exception 'nothing is left for the rest';
    end if;
  end if;

  -- A preview returns what a save would store, with each part's percent, rest marker and
  -- gross_up flag, and writes nothing.
  if p_preview then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', categories[u.i],
        'project_id', projects[u.i],
        'amount_minor', amounts[u.i],
        'percent', percents[u.i],
        'rest', coalesce(u.i = rest_at, false),
        'gross_up', gross_ups[u.i]
      ) order by u.i)
      from generate_series(1, n) as u(i)
      where amounts[u.i] > 0
    ), '[]'::jsonb);
  end if;

  -- The parts without a cent are dropped; the others keep the person's order.
  perform private.set_line_parts(
    cid, p_transaction_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', categories[u.i],
        'project_id', projects[u.i],
        'amount_minor', amounts[u.i],
        'percent', percents[u.i],
        'is_rest', coalesce(u.i = rest_at, false),
        'gross_up', gross_ups[u.i]
      ) order by u.i)
      from generate_series(1, n) as u(i)
      where amounts[u.i] > 0
    ), '[]'::jsonb)
  );

  -- The owner chose these categories, so the line is no longer a suggestion.
  update public.transactions
  set user_assigned = true,
      category_suggested = false
  where id = p_transaction_id and company_id = cid;

  -- The split is the answer to a shared line's review: the queue's אישור opened it.
  update public.review_queue q
  set status = 'changed', resolved_at = now()
  where q.company_id = cid and q.transaction_id = p_transaction_id
    and q.status = 'open' and q.reason = 'unallocated_shared';

  return private.line_split_parts(p_transaction_id);
end;
$function$;
