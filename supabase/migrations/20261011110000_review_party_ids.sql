-- Two read gaps the review card and the split editor already read (UI lane 2, #175).
-- 1. public.list_review returns customer_name, the customer of an income line (null when none),
--    so an income card names who paid.
-- 2. public.get_transaction returns review_id, the id of the line's open review (null when none),
--    so the split editor's לתור link opens that card.
-- Both are patched from their current definitions, with counted anchors, so changes merged
-- since stay. The MCP list_review and get_expense pass both fields through.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.list_review()'::regprocedure);
  anchor := $a$'supplier_name', s.name,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_review supplier_name is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
    'customer_name', cu.name,$n$);
  anchor := $a$left join public.suppliers s on s.id = t.supplier_id$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_review suppliers join is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id$n$);
  execute def;

  def := pg_get_functiondef('public.get_transaction(uuid)'::regprocedure);
  anchor := $a$    'review_reason', ($a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_transaction review_reason is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    'review_id', (
      select q.id
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
$n$ || anchor);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
