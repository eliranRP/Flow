-- FLOW-325 follow-up from the #189 review. Decision 0138.
-- MCP undo of line_split put the old parts back with no check, so a reversal part with no
-- project (allowed in a kept-out category, 0138) could come back on a line the owner has since
-- put in the P&L, where it would count with no project. private.line_has_loose_reversal holds
-- the check; set_transaction_pnl calls it in place of its inline copy, and the undo answers
-- `conflict` when the parts it would restore fail it on a line in the P&L.
-- Both functions are patched from their current definitions, with counted anchors.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- True when a part has no project and is a reversal: its category is not the line's and is
-- the other kind (the line's own kind is its category's, else its direction). The parts are
-- the line's stored parts, or p_parts (a stored split, as mcp_writes keeps it) when given.
create function private.line_has_loose_reversal(p_transaction_id uuid, p_parts jsonb default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with parts as (
    select s.category_id, s.project_id
    from public.line_splits s
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
$$;

revoke all on function private.line_has_loose_reversal(uuid, jsonb) from public, anon, authenticated;

do $patch$
declare
  def text;
  a_inline constant text := $a$  if p_in_pnl is true and exists (
    select 1
    from public.line_splits s
    join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
    join public.categories pc on pc.id = s.category_id and pc.company_id = s.company_id
    left join public.categories lc on lc.id = t.category_id and lc.company_id = t.company_id
    where s.transaction_id = p_id and s.company_id = cid
      and s.project_id is null
      and s.category_id is distinct from t.category_id
      and pc.kind::text is distinct from coalesce(lc.kind::text, t.direction::text)
  ) then$a$;
  a_undo constant text := $a$      elsif private.line_split_parts(p_id) is distinct from rec.prior->'written' then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.line_splits where transaction_id = p_id and company_id = cid;$a$;
begin
  def := pg_get_functiondef('public.set_transaction_pnl(uuid,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, a_inline) <> 1 then
    raise exception 'set_transaction_pnl is not the expected definition';
  end if;
  def := replace(def, a_inline, $n$  if p_in_pnl is true and private.line_has_loose_reversal(p_id) then$n$);
  execute def;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_undo) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  -- The line is locked above. A line in the P&L counts every part, kept-out ones too, so the
  -- old parts may not bring back a reversal part with no project.
  def := replace(def, a_undo, $n$      elsif private.line_split_parts(p_id) is distinct from rec.prior->'written' then
        response := private.mcp_error('conflict', 'conflict');
      elsif (select t.in_pnl_override from public.transactions t where t.id = p_id and t.company_id = cid) is true
        and private.line_has_loose_reversal(p_id, rec.prior->'before') then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.line_splits where transaction_id = p_id and company_id = cid;$n$);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
