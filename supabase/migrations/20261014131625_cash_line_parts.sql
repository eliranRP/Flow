-- FLOW-432: a split line's parts on the cash list row.
--
-- cash_month_lines and project_cash_month_lines merge a line's parts on one side into one row,
-- so a line split by category (decision 0104) shows only the sum of the parts the list counts,
-- with no category. Each row now also carries, for a line with a valid split by category:
-- - parts: the parts this row counts, [{name, amount_minor}], signed like the row's amount,
--   largest first; name is the part's category.
-- - line_minor: the whole line's bank amount (gross, positive), so the row can say what the parts
--   are out of.
-- Both are null on any other row (a loan split's parts are rows of their own already).

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (length(p_def) - length(replace(p_def, p_anchor, ''))) / nullif(length(p_anchor), 0);
$$;

-- A split by category counts only when it is valid: two or more parts that sum to the line's
-- net, as private.pnl_lines reads it.
create or replace function private.line_split_valid(p_transaction_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select count(*) >= 2 and sum(s.amount_minor) = (select abs(t.amount_net) from public.transactions t where t.id = p_transaction_id)
  from public.line_splits s
  where s.transaction_id = p_transaction_id;
$$;

revoke all on function private.line_split_valid(uuid) from public, anon, authenticated;

do $lines$
declare
  def text;
  fn text;
  merged_anchor text := E'      sum(r.side_minor)::bigint as amount_minor,\n';
  page_anchor text := E'      t.doc_date,\n';
  json_anchor text := E'        ''kept_out'', p_side = ''excluded''\n';
begin
  foreach fn in array array[
    'public.cash_month_lines(date,text,text,integer,integer)',
    'public.project_cash_month_lines(uuid,date,text,text,integer,integer)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, merged_anchor) <> 1
       or pg_temp.anchor_count(def, page_anchor) <> 1
       or pg_temp.anchor_count(def, json_anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    def := replace(def, merged_anchor, merged_anchor || $n$      jsonb_agg(jsonb_build_object('category_id', r.category_id, 'amount_minor', r.side_minor)
        order by abs(r.side_minor) desc, r.category_id) filter (where r.part is null) as part_list,
$n$);
    def := replace(def, page_anchor, page_anchor || $n$      abs(t.amount_gross) as line_gross,
      m.part is null and private.line_split_valid(m.transaction_id) as split_shown,
$n$);
    def := replace(def, json_anchor, $n$        'kept_out', p_side = 'excluded',
        'line_minor', case when pg.split_shown then pg.line_gross end,
        'parts', case when pg.split_shown then (
          select jsonb_agg(jsonb_build_object('name', c.name, 'amount_minor', (e.v ->> 'amount_minor')::bigint) order by e.ord)
          from jsonb_array_elements(pg.part_list) with ordinality e(v, ord)
          left join public.categories c on c.id = (e.v ->> 'category_id')::uuid
        ) end
$n$);
    execute def;
  end loop;
end;
$lines$;

drop function pg_temp.anchor_count(text, text);

commit;
