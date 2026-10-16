-- FLOW-514 (onboarding steps 3 and 4). The names the setup suggests from the company's bank lines.
-- get_setup_suggestions returns { projects, lenders }, for the owner or a viewer:
-- - projects: [] for now. No bank line names a project yet, so the setup hides that block until
--   a source is chosen. The key stays so the read's shape does not change later.
-- - lenders: the recurring suppliers (private.recurring_parties, seen in at least three months)
--   that the company pays in its own currency and that no loan has a line of yet. Amounts are
--   minor units, positive. A lender is only a suggestion: the owner picks it in the setup.
-- p_today is for the tests; the app and the MCP read use today (Israel time).
-- Read only, no write, so no idempotency key or undo.

begin;

create or replace function public.get_setup_suggestions(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  cur text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.base_currency into cur from public.companies c where c.id = cid;

  return jsonb_build_object(
    'projects', '[]'::jsonb,
    'lenders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', s.name,
          'monthly_agorot', -r.typical_amount_minor,
          'since', f.first_doc_date
        )
        order by s.name, s.id
      )
      from private.recurring_parties(cid, today) r
      join public.suppliers s on s.company_id = cid and s.id = r.party_id
      join lateral (
        select min(t.doc_date) as first_doc_date
        from public.transactions t
        where t.company_id = cid
          and t.supplier_id = r.party_id
          and t.removed_at is null
          and t.line_status <> 'void'
      ) f on true
      where r.direction = 'expense'
        and r.currency = cur
        and r.months_seen >= 3
        and not exists (
          select 1 from public.loans l
          where l.company_id = cid
            and lower(btrim(l.name)) = lower(btrim(s.name))
        )
        and not exists (
          select 1
          from public.loan_splits ls
          join public.transactions lt on lt.company_id = cid and lt.id = ls.transaction_id
          where ls.company_id = cid
            and lt.supplier_id = r.party_id
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_setup_suggestions(date) from public, anon;
grant execute on function public.get_setup_suggestions(date) to authenticated, service_role;

comment on function public.get_setup_suggestions(date) is
  'FLOW-514. Setup suggestions from the bank lines: projects (none yet) and lenders (recurring suppliers in the company currency, not yet a loan). Read only.';

commit;
