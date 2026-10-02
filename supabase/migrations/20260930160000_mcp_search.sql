-- MCP cycle 2. search_transactions is the filed and all scopes of search_expenses.
-- The company is private.current_company_id(), which is the signed-in user.
-- Decision 0080. A caller cannot pass another company.

create or replace function public.search_transactions(
  p_query text default null,
  p_scope text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  lim integer;
  off integer;
  needle text;
  scope text;
begin
  if p_scope is not null and p_scope not in ('filed', 'all') then
    raise exception 'validation';
  end if;
  cid := private.current_company_id();
  if cid is null then
    return jsonb_build_object('total', 0, 'expenses', '[]'::jsonb);
  end if;
  scope := case when p_scope = 'filed' then 'filed' else 'all' end;
  lim := least(greatest(coalesce(p_limit, 50), 0), 100);
  off := greatest(coalesce(p_offset, 0), 0);
  needle := nullif(btrim(coalesce(p_query, '')), '');

  return (
    with matched as (
      select
        t.id,
        t.description,
        t.doc_date,
        t.doc_kind,
        t.amount_net,
        t.vat_amount,
        t.direction,
        t.project_id,
        t.category_id,
        p.name as project_name,
        c.name as category_name,
        s.name as supplier_name
      from public.transactions t
      left join public.projects p on p.id = t.project_id
      left join public.categories c on c.id = t.category_id
      left join public.suppliers s on s.id = t.supplier_id
      where t.company_id = cid
        and t.removed_at is null
        and (
          scope = 'all'
          or not exists (
            select 1
            from public.review_queue q
            where q.transaction_id = t.id
              and q.company_id = cid
              and q.status = 'open'
          )
        )
        and (
          needle is null
          or t.description ilike '%' || needle || '%'
          or coalesce(s.name, '') ilike '%' || needle || '%'
        )
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'expenses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', page.id,
          'description', page.description,
          'doc_date', page.doc_date,
          'doc_kind', page.doc_kind,
          'amount_net', page.amount_net,
          'vat_agorot', page.vat_amount,
          'direction', page.direction,
          'project_id', page.project_id,
          'category_id', page.category_id,
          'project_name', page.project_name,
          'category_name', page.category_name,
          'supplier_name', page.supplier_name
        ))
        from (
          select *
          from matched
          order by doc_date desc, description
          limit lim
          offset off
        ) page
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.search_transactions(text, text, integer, integer) from public, anon;
grant execute on function public.search_transactions(text, text, integer, integer) to authenticated, service_role;
