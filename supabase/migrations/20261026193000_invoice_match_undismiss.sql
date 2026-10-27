-- FLOW-968 (decision 0218): the app's ביטול after "לא זה" on an invoice's bank match.
-- public.undismiss_invoice_match(p_invoice, p_transaction, p_dismissed_at) takes back the dismissal that
-- dismiss_invoice_match wrote: only the row of this invoice and deposit, only while it still carries the
-- time that write returned, and only the caller's own. Anything else is a conflict and changes nothing.
-- Owner or editor only, as dismiss_invoice_match; a viewer is refused (42501).
-- The MCP side already undoes a dismissal (mcp_undo kind invoice_dismiss), so no MCP tool is added.
-- dismiss_invoice_match is replaced to also return created: true only when this call wrote the row. A
-- dismissal already there (another tab, or the assistant as the same user) returns created: false, so the
-- app offers no ביטול that would take back a dismissal it did not write. The MCP write reads the prior
-- row itself and ignores the new key.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

create or replace function public.dismiss_invoice_match(p_invoice uuid, p_transaction uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  open_amount bigint;
  dismissed timestamptz;
  created boolean;
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
  if p_invoice is null or p_transaction is null then
    raise exception 'invoice not found';
  end if;

  perform 1
  from public.transactions t
  where t.id = p_invoice and t.company_id = cid and t.removed_at is null
  for update of t;
  open_amount := private.open_invoice_gross(cid, p_invoice);
  if open_amount is null or open_amount = 0 then
    raise exception 'invoice not found';
  end if;
  if not exists (
    select 1 from public.transactions b
    where b.id = p_transaction and b.company_id = cid and b.removed_at is null and b.direction = 'income'
  ) then
    raise exception 'payment not matched';
  end if;

  insert into public.invoice_match_dismissals (transaction_id, bank_transaction_id, company_id, dismissed_by)
  values (p_invoice, p_transaction, cid, (select auth.uid()))
  on conflict (transaction_id, bank_transaction_id) do nothing;
  created := found;

  select x.dismissed_at into dismissed
  from public.invoice_match_dismissals x
  where x.transaction_id = p_invoice and x.bank_transaction_id = p_transaction and x.company_id = cid;

  return jsonb_build_object(
    'id', p_invoice,
    'bank_transaction_id', p_transaction,
    'dismissed', true,
    'dismissed_at', dismissed,
    'created', created
  );
end;
$$;

revoke all on function public.dismiss_invoice_match(uuid, uuid) from public, anon;
grant execute on function public.dismiss_invoice_match(uuid, uuid) to authenticated, service_role;

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
  if p_invoice is null or p_transaction is null then
    raise exception 'invoice not found';
  end if;

  perform 1
  from public.transactions t
  where t.id = p_invoice and t.company_id = cid and t.removed_at is null
  for update of t;
  if not found then
    raise exception 'invoice not found';
  end if;
  -- Another company's invoice is not found first, so the time says nothing about it.
  if p_dismissed_at is null then
    raise exception 'validation';
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
