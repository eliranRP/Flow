-- FLOW-325, the #135 review items. Decision 0138.
-- 1. get_project transactions[].parts_minor is signed: a part in a category of the line's own
--    direction counts plus, a reversal part (the other kind) counts minus, as in the P&L.
-- 2. save_line_split (and so MCP split_line): a reversal part in a kept-out category needs no
--    project, as a kept-out whole line needs none (0103). It counts in no P&L.
-- 3. save_line_split: a part with no project keeps the line's project, so it and a part naming
--    that project with the same category are the same pair (`same category and project twice`).
-- Both functions are patched from their current definitions, with counted anchors, so changes
-- merged since stay. CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- How many times an anchor appears in a text (each patch below needs an exact count).
create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  a_declare constant text := $a$  line_category uuid;
$a$;
  a_select constant text := $a$  select t.amount_net, t.direction, t.category_id into line_net, line_direction, line_category
  from public.transactions t$a$;
  a_pair constant text := $a$    pair := category::text || '|' || coalesce(project::text, '');$a$;
  a_kind constant text := $a$    select c.kind::text into kind
    from public.categories c
    where c.id = category and c.company_id = cid;$a$;
  a_reversal constant text := $a$    if kind is distinct from line_kind and project is null
      and category is distinct from line_category then$a$;
  a_parts constant text := $a$          select sum(s.amount_minor)
          from public.line_splits s
          where s.transaction_id = t.id
            and s.company_id = cid
            and coalesce(s.project_id, t.project_id) = p.id$a$;
begin
  def := pg_get_functiondef('public.save_line_split(uuid,jsonb,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, a_declare) <> 1 or pg_temp.anchor_count(def, a_select) <> 1
    or pg_temp.anchor_count(def, a_pair) <> 1 or pg_temp.anchor_count(def, a_kind) <> 1
    or pg_temp.anchor_count(def, a_reversal) <> 1 then
    raise exception 'save_line_split is not the expected definition';
  end if;
  def := replace(def, a_declare, a_declare || $n$  line_project uuid;
  kept_out boolean;
$n$);
  def := replace(def, a_select, $n$  select t.amount_net, t.direction, t.category_id, t.project_id
  into line_net, line_direction, line_category, line_project
  from public.transactions t$n$);
  -- A part with no project keeps the line's project, so the pair is compared on that.
  def := replace(def, a_pair, $n$    pair := category::text || '|' || coalesce(coalesce(project, line_project)::text, '');$n$);
  def := replace(def, a_kind, $n$    select c.kind::text, c.excluded_from_pnl into kind, kept_out
    from public.categories c
    where c.id = category and c.company_id = cid;$n$);
  -- A kept-out part counts in no P&L, so it needs no project of its own (0103, 0138).
  def := replace(def, a_reversal, $n$    if kind is distinct from line_kind and project is null
      and category is distinct from line_category and not kept_out then$n$);
  execute def;

  def := pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, a_parts) <> 1 then
    raise exception 'get_project is not the expected definition';
  end if;
  -- Signed by the part's kind against the line's direction: a reversal part counts minus.
  def := replace(def, a_parts, $n$          select sum(case
              when coalesce(pc.kind::text, t.direction::text) = t.direction::text then s.amount_minor
              else -s.amount_minor
            end)
          from public.line_splits s
          left join public.categories pc on pc.id = s.category_id and pc.company_id = s.company_id
          where s.transaction_id = t.id
            and s.company_id = cid
            and coalesce(s.project_id, t.project_id) = p.id$n$);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
