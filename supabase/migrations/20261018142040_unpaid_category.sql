-- The month forecast's category view (לפי קטגוריה) puts each open invoice under its category, as the
-- recurring charges already are. list_unpaid now sends the document's category_id and category_name
-- (null when it is not filed). Nothing else changes: same rows, order, signature and grants.

create or replace function public.list_unpaid()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select private.readable_company_id() as id
  ),
  open_docs as (
    select
      inv.id,
      inv.company_id,
      inv.description,
      inv.doc_date,
      inv.external_id,
      inv.customer_id,
      coalesce(inv.currency, 'ILS') as currency,
      inv.direction,
      inv.provider_meta->>'document_url' as document_url,
      p.name as project_name,
      cu.name as customer_name,
      inv.category_id,
      cat.name as category_name,
      inv.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = inv.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = inv.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = inv.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = inv.external_id
        ), 0) as open_gross,
      inv.amount_net,
      inv.amount_gross as billed_gross,
      m.marked_at
    from public.transactions inv
    left join public.projects p on p.id = inv.project_id
    left join public.customers cu on cu.id = inv.customer_id
    left join public.categories cat on cat.id = inv.category_id and cat.company_id = inv.company_id
    left join public.invoice_paid_marks m on m.transaction_id = inv.id and m.company_id = inv.company_id
    where inv.company_id = (select id from cid)
      and inv.removed_at is null
      and inv.doc_kind = 'invoice'
      and inv.external_id is not null
      and not exists (
        select 1 from public.invoice_payment_links l
        where l.transaction_id = inv.id and l.company_id = inv.company_id
      )
  ),
  matched as (
    select d.id, mt.bank_id
    from open_docs d
    left join lateral (
      select private.invoice_match_id(d.company_id, d.id, d.open_gross::bigint, d.customer_id, d.doc_date) as bank_id
      where d.direction = 'income' and d.open_gross > 0 and d.marked_at is null
    ) mt on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'description', d.description,
    'doc_date', d.doc_date,
    'currency', d.currency,
    'direction', d.direction,
    'project_name', d.project_name,
    'customer_name', d.customer_name,
    'category_id', d.category_id,
    'category_name', d.category_name,
    'open_gross_agorot', d.open_gross::bigint,
    'open_net_agorot', case
      when d.billed_gross = 0 then 0::bigint
      else (d.open_gross * d.amount_net) / d.billed_gross
    end,
    'marked_paid_at', d.marked_at,
    'document_url', d.document_url,
    'days_open', current_date - d.doc_date,
    'match', case
      when b.id is null then null
      else jsonb_build_object(
        'transaction_id', b.id,
        'date', b.doc_date,
        'account_name', acct.name,
        'raw_description', b.description,
        'amount_minor', b.amount_gross
      )
    end
  ) order by d.doc_date, d.description), '[]'::jsonb)
  from open_docs d
  left join matched mt on mt.id = d.id
  left join public.transactions b on b.id = mt.bank_id
  left join lateral (
    select nullif(btrim(regexp_replace(
      regexp_replace(label.value->>'label', '\s*(••|\*\*)[*0-9]*', '', 'g'),
      '[0-9]{5,}', '', 'g'
    )), '') as name
    from public.connector_connections cc
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cc.account_labels) = 'array' then cc.account_labels else '[]'::jsonb end
    ) as label(value)
    where b.id is not null
      and cc.company_id = b.company_id
      and cc.provider::text = b.source::text
      and label.value->>'id' = b.provider_meta->>'account_id'
    limit 1
  ) acct on true
  where d.open_gross <> 0;
$$;

comment on function public.list_unpaid() is
  'Open SUMIT invoices for the Unpaid screen, oldest first, with the document''s download link (document_url), days_open, the document''s category (category_id, category_name), and the Mercury deposit that matches it (match) when one does. A linked invoice leaves the list. FLOW-335, FLOW-367.';

revoke all on function public.list_unpaid() from public, anon;
grant execute on function public.list_unpaid() to authenticated, service_role;
