-- FLOW-702 (#231 review): MCP set_jev_mode, the assistant's way to do what Settings → תיוג חכם
-- does (decision 0095, MCP-first). It calls public.set_company_integration with the idempotency
-- key and the write rate limit, and records undo kind jev_mode: undo puts back the switch, mode
-- and threshold before (or removes the row when there was none), a conflict once they changed.
-- A viewer cannot write (private.mcp_require_writer and set_company_integration refuse it).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

create function public.mcp_set_jev_mode(
  p_idempotency_key text,
  p_enabled boolean,
  p_mode text default null,
  p_threshold numeric default null
)
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
  cid uuid;
  stored public.company_integrations%rowtype;
  before jsonb;
  changed jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_enabled is null
    or (p_mode is not null and p_mode not in ('off', 'shadow', 'auto'))
    or (p_threshold is not null and (p_threshold < 0.50 or p_threshold > 1))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'jev_mode|' || p_enabled::text || '|' || coalesce(p_mode, '') || '|' || coalesce(p_threshold::text, '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    cid := private.current_company_id();
    select * into stored
    from public.company_integrations ci
    where ci.company_id = cid and ci.provider = 'jev'
    for update;
    before := case when stored.company_id is null then null else jsonb_build_object(
      'enabled', stored.enabled, 'mode', stored.mode, 'threshold', stored.threshold
    ) end;
    changed := public.set_company_integration(p_enabled, p_mode, p_threshold);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
    values (
      token, auth.uid(), 'jev_mode', (changed->>'company_id')::uuid,
      jsonb_build_object(
        'before', before,
        'after', jsonb_build_object('enabled', changed->'enabled', 'mode', changed->'mode', 'threshold', changed->'threshold')
      ),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', changed->>'company_id',
        'enabled', changed->'enabled',
        'mode', changed->'mode',
        'threshold', changed->'threshold',
        'prior', before,
        'undo_kind', 'jev_mode'
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

revoke all on function public.mcp_set_jev_mode(text, boolean, text, numeric) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_jev_mode(text, boolean, text, numeric) to authenticated;
comment on function public.mcp_set_jev_mode(text, boolean, text, numeric) is
  'MCP set_jev_mode: the Jev switch, mode (off, shadow, auto) and threshold, with undo kind jev_mode. Decisions 0095 and 0145.';

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the jev_mode kind.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'category_name'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'jev_mode'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'category_name'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'jev_mode'::text) AND (company_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  -- public.mcp_undo: put the switch, mode and threshold back while the write still stands.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'category_name'
    )$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'category_name', 'jev_mode'
    )$n$);

  anchor := $a$        or (p_kind = 'category_name' and w.kind = 'category_name' and w.category_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'jev_mode' and w.kind = 'jev_mode' and w.company_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'category_name' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo category_name branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'jev_mode' then
      declare
        jev_row public.company_integrations%rowtype;
      begin
        select * into jev_row
        from public.company_integrations ci
        where ci.company_id = p_id and ci.company_id = cid and ci.provider = 'jev'
        for update;
        if jev_row.company_id is null then
          response := private.mcp_error('not_found', 'not found');
        elsif jsonb_build_object('enabled', jev_row.enabled, 'mode', jev_row.mode, 'threshold', jev_row.threshold)
            is distinct from rec.prior->'after' then
          response := private.mcp_error('conflict', 'conflict');
        else
          if jsonb_typeof(rec.prior->'before') = 'object' then
            update public.company_integrations ci
            set enabled = (rec.prior->'before'->>'enabled')::boolean,
                mode = rec.prior->'before'->>'mode',
                threshold = (rec.prior->'before'->>'threshold')::numeric
            where ci.company_id = cid and ci.provider = 'jev';
          else
            delete from public.company_integrations ci
            where ci.company_id = cid and ci.provider = 'jev';
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
$n$ || anchor);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
