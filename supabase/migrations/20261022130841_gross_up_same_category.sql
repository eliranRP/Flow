-- FLOW-949. A normal part and a gross-up part may share a category and project on one line.
-- Decision 0207 (amended).
--
-- 0207's own example is a payment with a normal Property-taxes cost and a gross-up contra credit
-- on the same Property taxes / project, so the category nets to a credit. Three layers refused it
-- by keying "one part per (category, project) per line": the flow-mcp schema, save_line_split's
-- duplicate check and this table's unique constraint. The key now includes gross_up: a line holds
-- at most one normal and one gross-up part per (category, project). Two normal parts, or two
-- gross-up parts, on the same pair are still refused ('same category and project twice').
--
-- No existing row changes: every row already satisfies the narrower key, so no P&L figure moves.
-- A normal and a gross-up part are never summed: they stay separate rows, and their P&L amounts
-- always carry opposite signs (0206 D4, 0207 D1).
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- The constraint: (transaction, category, project) becomes (transaction, category, project,
-- gross_up). Nulls stay not distinct, so a null project still names one pair.
alter table public.line_splits
  drop constraint line_splits_transaction_id_category_id_project_id_key;
alter table public.line_splits
  add constraint line_splits_transaction_id_category_id_project_id_gross_up_key
  unique nulls not distinct (transaction_id, category_id, project_id, gross_up);

-- save_line_split: the duplicate pair key gains the gross_up flag. One anchored replace on the
-- live definition (20261022093629); the message for a real duplicate is unchanged.
do $patch$
declare
  def text;
  anchor constant text :=
    $a$    pair := category::text || '|' || coalesce(coalesce(project, line_project)::text, '');$a$;
begin
  def := pg_get_functiondef('public.save_line_split(uuid, jsonb, boolean)'::regprocedure);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'save_line_split is not the expected definition';
  end if;
  def := replace(def, anchor,
    $a$    -- FLOW-949 (0207): one normal and one gross-up part per category and project.
    pair := category::text || '|' || coalesce(coalesce(project, line_project)::text, '')
      || case when gross_up then '|gross_up' else '' end;$a$);
  execute def;
end
$patch$;

-- private.category_move (merge_category, move_category_lines): a line with a part in each category
-- on the same project is refused, since the move would make two parts of one pair. The pair now
-- includes gross_up, so only parts with the same flag collide; a normal and a gross-up part move
-- side by side and stay separate rows (never summed). Based on the live definition.
do $patch$
declare
  def text;
  anchor constant text := $a$      and s.project_id is not distinct from f.project_id
$a$;
begin
  def := pg_get_functiondef('private.category_move(uuid, uuid, uuid)'::regprocedure);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'category_move is not the expected definition';
  end if;
  def := replace(def, anchor, $a$      and s.project_id is not distinct from f.project_id
      and s.gross_up = f.gross_up
$a$);
  execute def;
end
$patch$;

-- projects_cash_month: a shared line's parts were grouped and their rounding cents settled by
-- (transaction, part, category). Two parts of one category on a shared line (a normal and a
-- gross-up part, which carry opposite signs, or two parts on different projects) fell into one
-- partition, so the remainder of one absorbed the other's shares and the project cash no longer
-- summed to the bank line. Each part is now its own group: its own project and signed amount join
-- the key. A line with one part per category reads exactly as before. Based on the live
-- definition (20261019124024).
do $patch$
declare
  def text;
  edits constant text[][] := array[
    array[
      $a$      p.transaction_id, p.part, p.category_id, p.currency, p.kind, p.amount_minor,
$a$,
      $a$      p.transaction_id, p.part, p.category_id, p.project_id as part_project_id, p.currency, p.kind, p.amount_minor,
$a$, '1'],
    array[
      $a$    group by p.transaction_id, p.part, p.category_id, p.currency, p.kind, p.amount_minor
$a$,
      $a$    group by p.transaction_id, p.part, p.category_id, p.project_id, p.currency, p.kind, p.amount_minor
$a$, '1'],
    array[
      $a$      sp.transaction_id, sp.part, sp.category_id, sp.currency, sp.kind, sp.amount_minor,
$a$,
      $a$      sp.transaction_id, sp.part, sp.category_id, sp.part_project_id, sp.currency, sp.kind, sp.amount_minor,
$a$, '1'],
    array[
      $a$partition by x.transaction_id, x.part, x.category_id$a$,
      $a$partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor$a$, '2']
  ];
  i integer;
begin
  def := pg_get_functiondef('public.projects_cash_month(date, date, uuid)'::regprocedure);
  for i in 1..array_length(edits, 1) loop
    if (length(def) - length(replace(def, edits[i][1], ''))) / length(edits[i][1]) <> edits[i][3]::integer then
      raise exception 'projects_cash_month is not the expected definition (edit %)', i;
    end if;
    def := replace(def, edits[i][1], edits[i][2]);
  end loop;
  execute def;
end
$patch$;

commit;
