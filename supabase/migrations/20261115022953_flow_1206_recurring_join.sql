-- FLOW-1206 (perf review, 2026-11-15). Three functions are patched in place; no table changes.
--
-- 1. private.recurring_match_suggestions: the join to public.transactions still tests the party only
--    as a join filter (c.id = case ... t.supplier_id / t.customer_id), so transactions_party_date_idx
--    (company_id, coalesce(supplier_id, customer_id), doc_date) cannot serve it: 87 rows read per loop,
--    261 removed per charge. The same condition written as coalesce(...) = c.id is added (as FLOW-1192
--    did for the anti-join); the case test stays as an extra filter. Same rows: for a line of the
--    direction, the coalesce is the party the case tests, and a line with neither party is not a match.
--
-- 2. private.jev_has_work: a refused line's inputs key (private.jev_inputs_key) was computed once per
--    refused line. The keys are now computed once per company that has a refusal still in its wait
--    (a materialized CTE), and each line reads its company's key from it.
--
-- 3. public.mcp_jev_status: the same key was computed for every row of the count of refused lines.
--    It is now computed once, into a variable, when the function starts.
--
-- Grants, security definer, search_path, volatility and the signatures are unchanged: create or
-- replace keeps the ACLs, and each function is re-created from its own definition (pg_get_functiondef),
-- with each anchor required to match exactly once, as 20261114123107 did.

begin;

do $flow_1206$
declare
  def text;
  n integer;
  a text;
  b text;
begin
  -- 1. The party's index condition on the look-alike join.
  def := pg_get_functiondef('private.recurring_match_suggestions(uuid,date,jsonb)'::regprocedure);
  a := $a$and c.id = case when ch.direction = 'expense' then t.supplier_id else t.customer_id end$a$;
  b := $n$and c.id = case when ch.direction = 'expense' then t.supplier_id else t.customer_id end
         and coalesce(t.supplier_id, t.customer_id) = c.id$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'recurring_match_suggestions is not the expected definition (%)', n;
  end if;
  def := replace(def, a, b);
  execute def;

  -- 2. jev_has_work: one key per company with a live refusal.
  def := pg_get_functiondef('private.jev_has_work()'::regprocedure);
  a := $a$  select exists (
    select 1
    from public.company_integrations ci$a$;
  b := $n$  with refused_keys as materialized (
    select f.company_id, private.jev_inputs_key(f.company_id) as inputs_key
    from public.jev_line_failures f
    where f.refused_at is not null
      and f.model_version = 'jev-1.13.0'
      and f.retry_after > now()
    group by f.company_id
  )
  select exists (
    select 1
    from public.company_integrations ci$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'jev_has_work is not the expected definition (head %)', n;
  end if;
  def := replace(def, a, b);
  a := $a$and (f.refused_at is null or f.refused_inputs = private.jev_inputs_key(f.company_id))$a$;
  b := $n$and (f.refused_at is null or f.refused_inputs = (
            select k.inputs_key from refused_keys k where k.company_id = f.company_id))$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'jev_has_work is not the expected definition (key %)', n;
  end if;
  def := replace(def, a, b);
  execute def;

  -- 3. mcp_jev_status: one key per call.
  def := pg_get_functiondef('public.mcp_jev_status()'::regprocedure);
  a := $a$  filled_open integer;
begin
$a$;
  b := $n$  filled_open integer;
  refused_key text;
begin
$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'mcp_jev_status is not the expected definition (declare %)', n;
  end if;
  def := replace(def, a, b);
  a := $a$  select * into integration
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
$a$;
  b := $n$  select * into integration
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
  -- FLOW-1206: the refused lines are compared with one key, read once here.
  refused_key := private.jev_inputs_key(cid);
$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'mcp_jev_status is not the expected definition (key read %)', n;
  end if;
  def := replace(def, a, b);
  a := $a$and f.refused_inputs = private.jev_inputs_key(cid)$a$;
  b := $n$and f.refused_inputs = refused_key$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'mcp_jev_status is not the expected definition (compare %)', n;
  end if;
  def := replace(def, a, b);
  execute def;
end
$flow_1206$;

commit;
