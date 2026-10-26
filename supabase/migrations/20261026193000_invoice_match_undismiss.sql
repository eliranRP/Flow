-- FLOW-968 (decision 0218): the app's ביטול after "לא זה" on an invoice's bank match.
-- public.undismiss_invoice_match(p_invoice, p_transaction, p_dismissed_at) takes back the dismissal that
-- dismiss_invoice_match wrote: only the row of this invoice and deposit, only while it still carries the
-- time that write returned, and only the caller's own. Anything else is a conflict and changes nothing.
-- Owner or editor only, as dismiss_invoice_match; a viewer is refused (42501).
-- The MCP side already undoes a dismissal (mcp_undo kind invoice_dismiss), so no MCP tool is added.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

create function public.undismiss_invoice_match(p_invoice uuid, p_transaction uuid, p_dismissed_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  removed integer;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (
      select 1 from public.company_viewers v where v.user_id = (select auth.uid())
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_invoice is null or p_transaction is null or p_dismissed_at is null then
    raise exception 'invoice not found';
  end if;

  perform 1
  from public.transactions t
  where t.id = p_invoice and t.company_id = cid and t.removed_at is null
  for update of t;
  if not found then
    raise exception 'invoice not found';
  end if;

  delete from public.invoice_match_dismissals x
  where x.transaction_id = p_invoice
    and x.bank_transaction_id = p_transaction
    and x.company_id = cid
    and x.dismissed_at = p_dismissed_at
    and x.dismissed_by = (select auth.uid());
  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception 'conflict';
  end if;

  return jsonb_build_object('id', p_invoice, 'bank_transaction_id', p_transaction, 'dismissed', false);
end;
$$;

revoke all on function public.undismiss_invoice_match(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.undismiss_invoice_match(uuid, uuid, timestamptz) to authenticated;

commit;
