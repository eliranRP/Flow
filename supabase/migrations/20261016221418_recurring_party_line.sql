-- FLOW-447c (the charge page opens by party, as the board's קבועים row does): the newest counted line
-- of a party in one currency. The charge page reads its charges (party_charges), sets its pace and
-- keys its change alert by it. The lines counted are party_charges' (not removed, not void, income
-- only invoices, credits and invoice receipts). "Today" is Asia/Jerusalem. The caller's company only.
-- FLOW-920: also drops list_skipped_review, which no screen calls.

begin;

set local lock_timeout = '5s';

create function public.recurring_party_line(
  p_direction text, p_party_id uuid, p_currency text, p_today date default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  line_id uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('income', 'expense') then
    raise exception 'validation';
  end if;
  select t.id into line_id
  from public.transactions t
  where t.company_id = cid
    and t.direction = p_direction::public.txn_direction
    and t.currency = p_currency
    and p_party_id = case when t.direction = 'expense' then t.supplier_id else t.customer_id end
    and t.removed_at is null
    and t.line_status <> 'void'
    and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
    and t.doc_date <= coalesce(p_today, private.flow_today())
  order by t.doc_date desc, t.created_at desc
  limit 1;
  return line_id;
end;
$$;

comment on function public.recurring_party_line(text, uuid, text, date) is
  'FLOW-447c. The newest counted line of a recurring party in one currency: the charge page''s line (its charges, pace and change alert). Same lines as party_charges.';

revoke all on function public.recurring_party_line(text, uuid, text, date) from public, anon;
grant execute on function public.recurring_party_line(text, uuid, text, date) to authenticated, service_role;

-- FLOW-920: no screen calls list_skipped_review (grep app/ packages/ supabase/functions finds nothing);
-- the skipped review rows and reopen_review stay. The drop also removes its grants.
drop function public.list_skipped_review();

commit;
