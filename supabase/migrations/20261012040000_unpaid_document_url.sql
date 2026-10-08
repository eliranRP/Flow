-- FLOW-335 server part: each Unpaid row carries the SUMIT document's download link, so the row
-- can open the invoice. Server only; the screen is UI lane 1's.
-- 1. private.clean_provider_meta keeps a `document_url` on SUMIT's own download host only
--    (https://pay.sumit.co.il/...), and keeps the stored one when a sync sends none, so a sync
--    whose document list failed does not erase it.
-- 2. public.upsert_sumit_documents passes each document's `document_url` into provider_meta.
-- 3. public.list_unpaid returns `document_url` (null until a sync stores one).
-- Patched functions are read from their current definitions, with counted anchors, so changes
-- merged since stay. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('private.clean_provider_meta(jsonb,jsonb)'::regprocedure);
  anchor := $a$    'account_id', case$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'clean_provider_meta is not the expected definition';
  end if;
  execute replace(def, anchor, $n$    'document_url', case
      when length(p_meta->>'document_url') <= 500
        and p_meta->>'document_url' ~ '^https://pay\.sumit\.co\.il/[^\s"''<>\\]+$' then p_meta->>'document_url'
      when length(p_prior->>'document_url') <= 500
        and p_prior->>'document_url' ~ '^https://pay\.sumit\.co\.il/[^\s"''<>\\]+$' then p_prior->>'document_url'
    end,
$n$ || anchor);

  def := pg_get_functiondef('public.upsert_sumit_documents(uuid,jsonb)'::regprocedure);
  anchor := $a$'provider_meta', '{}'::jsonb$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'upsert_sumit_documents is not the expected definition';
  end if;
  execute replace(def, anchor,
    $n$'provider_meta', jsonb_strip_nulls(jsonb_build_object('document_url', nullif(doc->>'document_url', '')))$n$);

  def := pg_get_functiondef('public.list_unpaid()'::regprocedure);
  anchor := $a$      inv.external_id,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_unpaid open_docs is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
      inv.provider_meta->>'document_url' as document_url,$n$);
  anchor := $a$    'customer_name', d.customer_name,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_unpaid output is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$
    'document_url', d.document_url,$n$);
end
$patch$;

comment on function public.list_unpaid() is
  'Open SUMIT invoices for the Unpaid screen, oldest first, with the document''s download link (document_url) when a sync stored one. FLOW-335.';

drop function pg_temp.anchor_count(text, text);

commit;
