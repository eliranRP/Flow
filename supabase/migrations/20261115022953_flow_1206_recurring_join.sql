-- FLOW-1206 (perf review, 2026-11-15). Three functions are patched in place; no table changes.
--
-- 1. private.recurring_match_suggestions: the look-alike join to public.transactions tested the party
--    only as a join filter (c.id = the supplier for an expense, the customer for an income), so
--    transactions_party_date_idx (company_id, coalesce(supplier_id, customer_id), doc_date) could not
--    serve it. The join is now a lateral union of three arms, one per way a line can match, which
--    together give exactly the rows the join gave before:
--      a. an expense charge, the line's supplier is the party: the coalesce test is implied, so it is
--         added and the index serves it;
--      b. an income charge, the line has no supplier and its customer is the party: coalesce is the
--         customer, so the index serves it;
--      c. an income charge, the line has a supplier too and its customer is the party: the old
--         customer test, with no index (no production line has both parties: 0 of 2,828 on
--         2026-11-14, per the FLOW-1192 note).
--    The arms are exclusive, so union all adds no row twice. A coalesce(supplier, customer) test
--    alone would drop case c (the supplier is what coalesce returns), which is why the arms are split.
--    The anti-join ("first seen lately") is unchanged from main.
--
-- 2. private.jev_has_work: a refused line's inputs key (private.jev_inputs_key) was computed once per
--    refused line. It is now computed once per company that has a refusal still in its wait, for an
--    enabled Jev integration (a materialized CTE), and each line reads its company's key from it.
--
-- 3. public.mcp_jev_status: the same key was computed for every row of the count of refused lines.
--    It is now computed once per call, into a variable, whether or not the company has a refusal.
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
  -- 1. The look-alike join, as three arms (see the header).
  def := pg_get_functiondef('private.recurring_match_suggestions(uuid,date,jsonb)'::regprocedure);
  a := $a$join public.transactions t
         on t.company_id = p_company and t.direction = ch.direction and t.currency = ch.currency
         and c.id = case when ch.direction = 'expense' then t.supplier_id else t.customer_id end$a$;
  b := $n$join lateral (
         -- a. an expense: the supplier is the party (coalesce is the supplier, so the index serves it)
         select x.* from public.transactions x
         where x.company_id = p_company and x.direction = ch.direction and x.currency = ch.currency
           and ch.direction = 'expense' and x.supplier_id = c.id
           and coalesce(x.supplier_id, x.customer_id) = c.id
         union all
         -- b. an income with no supplier: the customer is the party (coalesce is the customer)
         select x.* from public.transactions x
         where x.company_id = p_company and x.direction = ch.direction and x.currency = ch.currency
           and ch.direction = 'income' and x.supplier_id is null and x.customer_id = c.id
           and coalesce(x.supplier_id, x.customer_id) = c.id
         union all
         -- c. an income with a supplier too: the customer is the party (no index; no line has both today)
         select x.* from public.transactions x
         where x.company_id = p_company and x.direction = ch.direction and x.currency = ch.currency
           and ch.direction = 'income' and x.supplier_id is not null and x.customer_id = c.id
       ) t on true$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'recurring_match_suggestions is not the expected definition (%)', n;
  end if;
  def := replace(def, a, b);
  execute def;

  -- 2. jev_has_work: one key per company with a live refusal, for an enabled Jev integration.
  def := pg_get_functiondef('private.jev_has_work()'::regprocedure);
  a := $a$  select exists (
    select 1
    from public.company_integrations ci$a$;
  b := $n$  with refused_keys as materialized (
    select f.company_id, private.jev_inputs_key(f.company_id) as inputs_key
    from public.jev_line_failures f
    join public.company_integrations ci
      on ci.company_id = f.company_id and ci.provider = 'jev' and ci.enabled and ci.mode in ('shadow', 'auto')
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
  -- FLOW-1206: the refused lines are compared with one key, read once per call (whether or not the
  -- company has a refusal).
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
