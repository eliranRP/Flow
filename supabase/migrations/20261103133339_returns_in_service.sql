-- FLOW-466 (decision 0250): a newly let rental's total return, tax savings and appreciation, and
-- the part of a loan paid out at closing.
--
-- - The total return scales over the days since the first rent, like cash on cash (0249): its cash
--   flow and principal run from the first rent.
-- - Tax savings run from the first rent, when the property is placed in service, not over the whole
--   period: nothing before it, and a property first let in October saves for the days since.
-- - Appreciation, with no value on or before the period's start, runs from the first value recorded
--   in the period to the last; one value alone leaves it missing (value_history) until a second.
-- - loans.closing_paid_minor: what the settlement statement shows the loan paid at closing (owner,
--   set_loan_closing_paid; MCP undo kind loan_closing_paid). A loan paid out at closing adds that
--   to the purchase price, else its whole principal as before; a hard-money loan's renovation
--   holdback is then not counted as the price.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

alter table public.loans add column closing_paid_minor bigint;
alter table public.loans add constraint loans_closing_paid_range
  check (closing_paid_minor is null or (closing_paid_minor >= 0 and closing_paid_minor <= principal_minor));
comment on column public.loans.closing_paid_minor is
  'FLOW-466: what the loan paid at closing, from the settlement statement; null is the whole principal. Decision 0250.';

-- The amount a loan paid at closing (owner only; null is the whole principal).
create function public.set_loan_closing_paid(p_loan_id uuid, p_closing_paid_minor bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior bigint;
  principal bigint;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select l.closing_paid_minor, l.principal_minor into prior, principal
  from public.loans l where l.id = p_loan_id and l.company_id = cid
  for update;
  if not found then
    raise exception 'loan not found';
  end if;
  if p_closing_paid_minor is not null and (p_closing_paid_minor < 0 or p_closing_paid_minor > principal) then
    raise exception 'validation' using errcode = '22023';
  end if;
  update public.loans l set closing_paid_minor = p_closing_paid_minor where l.id = p_loan_id and l.company_id = cid;
  return jsonb_build_object('id', p_loan_id, 'closing_paid_minor', p_closing_paid_minor, 'prior', prior);
end;
$$;
revoke all on function public.set_loan_closing_paid(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.set_loan_closing_paid(uuid, bigint) to authenticated;
comment on function public.set_loan_closing_paid(uuid, bigint) is
  'Sets what a loan paid at closing, from the settlement statement (owner only; null is the whole principal). Decision 0250.';

create function public.mcp_set_loan_closing_paid(p_idempotency_key text, p_loan_id uuid, p_closing_paid_minor bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  changed jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_closing_paid|' || coalesce(p_loan_id::text, 'null') || '|' || coalesce(p_closing_paid_minor::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    changed := public.set_loan_closing_paid(p_loan_id, p_closing_paid_minor);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, loan_id, prior, created_at)
    values (
      token, auth.uid(), 'loan_closing_paid', private.current_company_id(), p_loan_id,
      jsonb_build_object('before', changed->'prior', 'after', changed->'closing_paid_minor'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', changed->>'id',
        'closing_paid_minor', changed->'closing_paid_minor',
        'prior', changed->'prior',
        'undo_kind', 'loan_closing_paid'
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_set_loan_closing_paid(text, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_loan_closing_paid(text, uuid, bigint) to authenticated;

-- private.mcp_writes and mcp_undo: the loan_closing_paid kind, put back unless changed since.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'land_account'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'loan_closing_paid'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'loan_closing_paid'::text) AND (loan_id IS NOT NULL) AND (prior ? 'before'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, $a$, 'land_account'$a$) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, $a$, 'land_account'$a$, $n$, 'land_account', 'loan_closing_paid'$n$);

  anchor := $a$        or (p_kind = 'land_account' and w.kind = 'land_account' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'loan_closing_paid' and w.kind = 'loan_closing_paid' and w.loan_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'land_account' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo land_account branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'loan_closing_paid' then
      -- FLOW-466 (decision 0250).
      declare
        held bigint;
      begin
        select l.closing_paid_minor into held
        from public.loans l
        where l.id = p_id and l.company_id = cid
        for update;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif held is distinct from (rec.prior->>'after')::bigint then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.loans l
          set closing_paid_minor = (rec.prior->>'before')::bigint
          where l.id = p_id and l.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        end if;
      end;
$n$ || anchor);
  execute def;
end
$kinds$;

-- get_property_returns: the total over the days since the first rent, tax savings from it, the
-- appreciation from the first value in the period, and what each loan paid at closing.
do $returns$
declare
  def text;
  a_decl constant text := $a$  earn_annual numeric;
$a$;
  a_taken constant text := $a$    select coalesce(sum(lo.principal_minor), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('loan_id', lo.id, 'name', lo.name, 'principal_minor', lo.principal_minor)$a$;
  a_start constant text := $a$  if v_end.value_minor is null or p.value_minor is null then
$a$;
  a_tax constant text := $a$      tax := private.div_half_even(building::numeric * 10 * bracket * days, 275::numeric * 10000 * 365);$a$;
  a_bldg constant text := $a$  if purchase is not null and rehab is not null and land is not null then
    building := greatest(purchase + rehab - land, 0);$a$;
  a_total constant text := $a$'total_bp', case when money_in > 0 then round(total * annual * 10000 / money_in)::integer end$a$;
begin
  def := pg_get_functiondef('public.get_property_returns(uuid,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_decl) <> 1 or pg_temp.anchor_count(def, a_taken) <> 1
    or pg_temp.anchor_count(def, a_start) <> 1 or pg_temp.anchor_count(def, a_tax) <> 1
    or pg_temp.anchor_count(def, a_bldg) <> 1 or pg_temp.anchor_count(def, a_total) <> 1
  then
    raise exception 'get_property_returns is not the expected definition';
  end if;
  def := replace(def, a_decl, a_decl || $n$  service_days integer;
$n$);
  def := replace(def, a_taken, $n$    select coalesce(sum(coalesce(lo.closing_paid_minor, lo.principal_minor)), 0)::bigint,
      coalesce(jsonb_agg(jsonb_build_object('loan_id', lo.id, 'name', lo.name, 'principal_minor', lo.principal_minor,
        'closing_paid_minor', lo.closing_paid_minor, 'counted_minor', coalesce(lo.closing_paid_minor, lo.principal_minor))$n$);
  def := replace(def, a_start, $n$  -- FLOW-466: no value by the period's start, the first value recorded in it, before the last.
  if v_start.value_minor is null and v_end.value_minor is not null then
    select v.value_minor, v.value_date into v_start from public.project_values v
    where v.company_id = cid and v.project_id = p_project_id and v.value_date > d_from and v.value_date < v_end.value_date
    order by v.value_date limit 1;
  end if;
$n$ || a_start);
  def := replace(def, a_bldg, $n$  -- FLOW-466: depreciation runs while the property is in service, from the first rent.
  service_days := case when first_rent is null or first_rent > d_to then 0
    when first_rent > d_from then d_to - first_rent + 1 else days end;
$n$ || a_bldg);
  def := replace(def, a_tax, $n$      tax := private.div_half_even(building::numeric * 10 * bracket * service_days, 275::numeric * 10000 * 365);$n$);
  def := replace(def, a_total, $n$'total_bp', case when money_in > 0 then round(total * earn_annual * 10000 / money_in)::integer end$n$);
  execute def;
end
$returns$;

drop function pg_temp.anchor_count(text, text);

commit;
