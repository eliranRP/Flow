-- mcp_undo applies an undo only to a write made in the caller's current company.
-- mcp_undo found the past write in private.mcp_writes by user only, and most branches then applied
-- it to the caller's current company (cid). For forecast_item and forecast_reset that copied
-- override rows from the write into cid: a user who reset a month in company B, was removed from B,
-- and then undid the write with a token for their own company A got B's overrides written into A.
-- Only invite, member_role, member_remove and project_forecast checked the write's company.
-- - private.mcp_writes.company_id is now set on every write: a before-insert trigger fills it from
--   the write's token (mcp_require_writer only lets a token write in the token's own company), so
--   every writer, present and future, records it. Older rows get it from their token the same way,
--   and the column becomes not null.
-- - mcp_undo's write lookup requires w.company_id = cid for every kind; a write from another
--   company is not found (the same not_found it returns for a missing write). The per-kind company
--   checks the lookup had are folded into it. The body is otherwise the live one.
begin;
set local lock_timeout = '5s';

create function private.mcp_writes_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null then
    select c.company_id into new.company_id
    from private.mcp_credentials c
    where c.id = new.token_id;
  end if;
  return new;
end;
$$;

revoke all on function private.mcp_writes_company() from public, anon, authenticated;

create trigger mcp_writes_company
before insert on private.mcp_writes
for each row execute function private.mcp_writes_company();

update private.mcp_writes w
set company_id = c.company_id
from private.mcp_credentials c
where c.id = w.token_id
  and w.company_id is null;

alter table private.mcp_writes alter column company_id set not null;

CREATE OR REPLACE FUNCTION public.mcp_undo(p_idempotency_key text, p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  rec private.mcp_writes%rowtype;
  txn uuid;
  cur_project uuid;
  cur_category uuid;
  cur_role public.pnl_role;
  response jsonb;
  cur_hidden boolean;
  cur_excluded boolean;
  written_excluded boolean;
  cur_loan record;
  written jsonb;
  before jsonb;
  cur_overhead uuid;
  cur_name text;
  restored boolean;
  cur_override boolean;
  attach_reassign uuid;
  cur_rate integer;
  cur_marked timestamptz;
  cur_found boolean;
  cur_project_row public.projects%rowtype;
  cur_linked timestamptz;
  cur_dismissed timestamptz;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in ('recurring_match', 'line_pace', 'line_recurring', 'line_amount', 'category_cash', 'line_cash', 'cash_basis', 'invite', 'member_role', 'member_remove', 
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split',
      'line_pnl', 'loan_rate', 'invoice_paid', 'loan_detach', 'loan_delete', 'loan_order', 'project_investment', 'category_rehab', 'category_delete', 'category_move', 'company_currency', 'category_group', 'category_parent', 'project_group', 'project_group_member', 'category_name', 'jev_mode', 'loan_index', 'index_rate', 'project_update', 'project_delete', 'forecast_item', 'forecast_reset', 'project_forecast', 'invoice_link', 'invoice_dismiss', 'manual_entry', 'document_attach'
    )
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'undo|' || p_kind || '|' || p_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('not_found', 'not found');
  begin
    select * into rec
    from private.mcp_writes w
    where w.user_id = auth.uid()
      -- Only a write made in the caller's current company: every branch below applies the undo
      -- to cid, so a write from another company (one the user has since left) is not found.
      and w.company_id = cid
      and w.undone_at is null
      and (
        (p_kind = 'invite' and w.kind = 'invite' and w.prior->>'invite_id' = p_id::text)
        or (p_kind = 'member_role' and w.kind = 'member_role' and w.prior->>'user_id' = p_id::text)
        or (p_kind = 'member_remove' and w.kind = 'member_remove' and w.prior->>'user_id' = p_id::text)
        or (p_kind = 'recurring_match' and w.kind = 'recurring_match' and w.prior->>'match_party_id' = p_id::text)
        or (p_kind in ('project_update', 'project_delete') and w.kind = p_kind and w.project_id = p_id)
        or (p_kind in ('forecast_item', 'forecast_reset') and w.kind = p_kind and w.id = p_id)
        or (p_kind = 'project_forecast' and w.kind = p_kind and w.id = p_id)
        or (p_kind in ('invoice_link', 'invoice_dismiss') and w.kind = p_kind and w.transaction_id = p_id)
        or (p_kind = 'line_pace' and w.kind = 'line_pace' and w.transaction_id = p_id)
        or (p_kind = 'line_recurring' and w.kind = 'line_recurring' and w.transaction_id = p_id)
        or (p_kind = 'line_amount' and w.kind = 'line_amount' and w.transaction_id = p_id)
        or (p_kind = 'category_cash' and w.kind = 'category_cash' and w.category_id = p_id)
        or (p_kind = 'line_cash' and w.kind = 'line_cash' and w.transaction_id = p_id)
        or (p_kind = 'cash_basis' and w.kind = 'cash_basis' and w.company_id = p_id)
        or (p_kind = 'review' and w.kind = 'review' and w.review_id = p_id)
        or (p_kind = 'reassign' and w.kind = 'reassign' and w.reassign_id = p_id)
        or (p_kind = 'project' and w.kind = 'project' and w.project_id = p_id)
        or (p_kind in ('category', 'category_hidden', 'category_pnl') and w.kind = p_kind and w.category_id = p_id)
        or (p_kind = 'loan' and w.kind = 'loan' and w.loan_id = p_id)
        or (p_kind = 'loan_update' and w.kind = 'loan_update' and w.loan_id = p_id)
        or (p_kind = 'loan_split' and w.kind = 'loan_split' and w.transaction_id = p_id)
        or (p_kind = 'overhead_project' and w.kind = 'overhead_project' and w.prior->>'company_id' = p_id::text)
        or (p_kind = 'company' and w.kind = 'company' and w.company_id = p_id)
        or (p_kind = 'line_split' and w.kind = 'line_split' and w.transaction_id = p_id)
        or (p_kind = 'line_pnl' and w.kind = 'line_pnl' and w.transaction_id = p_id)
        or (p_kind = 'loan_rate' and w.kind = 'loan_rate' and w.prior->>'rate_id' = p_id::text)
        or (p_kind = 'invoice_paid' and w.kind = 'invoice_paid' and w.transaction_id = p_id)
        or (p_kind = 'loan_detach' and w.kind = 'loan_detach' and w.transaction_id = p_id)
        or (p_kind = 'loan_delete' and w.kind = 'loan_delete' and w.loan_id = p_id)
        or (p_kind = 'loan_order' and w.kind = 'loan_order' and w.company_id = p_id)
        or (p_kind = 'project_investment' and w.kind = 'project_investment' and w.project_id = p_id)
        or (p_kind = 'category_rehab' and w.kind = 'category_rehab' and w.category_id = p_id)
        or (p_kind = 'category_delete' and w.kind = 'category_delete' and w.category_id = p_id)
        or (p_kind = 'category_move' and w.kind = 'category_move' and w.category_id = p_id)
        or (p_kind = 'company_currency' and w.kind = 'company_currency' and w.company_id = p_id)
        or (p_kind = 'category_group' and w.kind = 'category_group' and w.category_id = p_id)
        or (p_kind = 'category_parent' and w.kind = 'category_parent' and w.category_id = p_id)
        or (p_kind = 'project_group' and w.kind = 'project_group' and w.prior->>'group_id' = p_id::text)
        or (p_kind = 'project_group_member' and w.kind = 'project_group_member' and w.project_id = p_id)
        or (p_kind = 'category_name' and w.kind = 'category_name' and w.category_id = p_id)
        or (p_kind = 'jev_mode' and w.kind = 'jev_mode' and w.company_id = p_id)
        or (p_kind = 'loan_index' and w.kind = 'loan_index' and w.loan_id = p_id)
        or (p_kind = 'index_rate' and w.kind = 'index_rate' and w.id = p_id)
        or (p_kind = 'manual_entry' and w.kind = 'manual_entry' and w.transaction_id = p_id)
        or (p_kind = 'document_attach' and w.kind = 'document_attach' and w.transaction_id = p_id)
      )
    order by w.created_at desc
    limit 1
    for update;

    if not found then
      response := private.mcp_error('not_found', 'not found');
    elsif p_kind in ('invite', 'member_role', 'member_remove') then
      -- FLOW-601. Each undo goes through the owner's own RPC, so the owner check stays there.
      response := null;
      begin
        if p_kind = 'invite' then
          if not exists (
            select 1 from public.company_invites i
            where i.id = p_id and i.company_id = cid and i.status = 'pending'
          ) then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform public.cancel_invite(p_id);
          end if;
        elsif p_kind = 'member_role' then
          if (
            select m.role from public.company_members m
            where m.company_id = cid and m.user_id = p_id
          ) is distinct from rec.prior->>'after' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform public.set_member_role(p_id, rec.prior->>'before');
          end if;
        else
          if private.company_role(cid, p_id) is not null then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform private.team_owner_company();
            insert into public.company_members (company_id, user_id, role, invited_by, created_at)
            values (
              cid, p_id, rec.prior->>'before',
              nullif(rec.prior->>'invited_by', '')::uuid,
              coalesce((rec.prior->>'since')::timestamptz, now())
            );
          end if;
        end if;
        if response is null then
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
    elsif p_kind = 'manual_entry' then
      -- FLOW-369. The line is deleted only while it is the one the write made: the same project,
      -- category, amount and date. A line with a split or a loan on it fails the delete (conflict).
      perform 1 from public.transactions t
      where t.id = rec.transaction_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif (
        select jsonb_build_object(
          'project_id', t.project_id, 'category_id', t.category_id,
          'amount_gross', t.amount_gross, 'doc_date', t.doc_date
        )
        from public.transactions t
        where t.id = rec.transaction_id and t.company_id = cid
      ) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          delete from public.transactions t
          where t.id = rec.transaction_id and t.company_id = cid and t.source = 'manual';
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23503' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'document_attach' then
      -- FLOW-369. The list goes back to what it was, while it is still the list the write made.
      perform 1 from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif (
        select t.attachments from public.transactions t where t.id = p_id and t.company_id = cid
      ) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.transactions t
        set attachments = rec.prior->'before', updated_at = now()
        where t.id = p_id and t.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'project_update' then
      select p.* into cur_project_row
      from public.projects p
      where p.id = p_id and p.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif (
        select jsonb_build_object(
          'name', cur_project_row.name, 'type', cur_project_row.state_label,
          'budget_minor', cur_project_row.budget_agorot, 'status', cur_project_row.status::text,
          'finished_on', cur_project_row.finished_on
        )
      ) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          update public.projects p
          set name = rec.prior->'before'->>'name',
              state_label = rec.prior->'before'->>'type',
              budget_agorot = (rec.prior->'before'->>'budget_minor')::bigint,
              status = (rec.prior->'before'->>'status')::public.project_status,
              finished_on = (rec.prior->'before'->>'finished_on')::date
          where p.id = p_id and p.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23505' or sqlstate '23514' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'project_delete' then
      if exists (select 1 from public.projects p where p.id = p_id and p.company_id = private.current_company_id())
        or (rec.prior->'row'->>'company_id')::uuid is distinct from private.current_company_id()
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          insert into public.projects
          select * from jsonb_populate_record(null::public.projects, rec.prior->'row');
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23505' or sqlstate '23503' or sqlstate '23514' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'invoice_link' then
      -- The invoice row is the lock, as in set_invoice_paid.
      perform 1
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update of t;
      cur_found := found;
      select l.linked_at into cur_linked
      from public.invoice_payment_links l
      where l.transaction_id = p_id and l.company_id = cid
        and l.bank_transaction_id = (rec.prior->>'written')::uuid;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_linked is distinct from (rec.prior->>'written_at')::timestamptz then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.invoice_payment_links l
        where l.transaction_id = p_id and l.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'invoice_dismiss' then
      perform 1
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update of t;
      cur_found := found;
      select x.dismissed_at into cur_dismissed
      from public.invoice_match_dismissals x
      where x.transaction_id = p_id and x.company_id = cid
        and x.bank_transaction_id = (rec.prior->>'written')::uuid;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_dismissed is distinct from (rec.prior->>'written_at')::timestamptz then
        response := private.mcp_error('conflict', 'conflict');
      else
        -- A dismissal that was there before stays; only one this write added is taken away.
        if rec.prior->>'before' is null then
          delete from public.invoice_match_dismissals x
          where x.transaction_id = p_id and x.company_id = cid
            and x.bank_transaction_id = (rec.prior->>'written')::uuid;
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'project_forecast' then
      -- The project's forecast goes back to before the write, when the rows it left are unchanged.
      if not private.pfe_unchanged(cid, rec.prior->'after') then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          perform private.pfe_undo(cid, (rec.prior->>'project_id')::uuid, rec.prior->'undo');
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        exception
          when sqlstate '23505' or sqlstate '23514' or sqlstate '22023' or sqlstate 'P0002' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'forecast_item' then
      -- The item goes back to the state it had before the write, when nothing changed since.
      if coalesce(private.forecast_state(cid, rec.prior->>'month', rec.prior->>'item_key'), 'null'::jsonb)
        is distinct from coalesce(rec.prior->'after', 'null'::jsonb)
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          delete from public.forecast_overrides f
          where f.company_id = cid and f.month = rec.prior->>'month' and f.item_key = rec.prior->>'item_key';
          if rec.prior->'before' is not null and jsonb_typeof(rec.prior->'before') = 'object' then
            insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out)
            values (
              cid, rec.prior->>'month', rec.prior->>'item_key',
              (rec.prior->'before'->>'amount_minor')::bigint,
              (rec.prior->'before'->>'due_on')::date,
              coalesce((rec.prior->'before'->>'moved_out')::boolean, false)
            );
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        exception
          when sqlstate '23505' or sqlstate '23514' or sqlstate '22023' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'forecast_reset' then
      -- The month's overrides come back, when none was set since the reset.
      if exists (select 1 from public.forecast_overrides f where f.company_id = cid and f.month = rec.prior->>'month') then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out)
          select cid, rec.prior->>'month', x->>'item_key', (x->>'amount_minor')::bigint,
            (x->>'due_on')::date, coalesce((x->>'moved_out')::boolean, false)
          from jsonb_array_elements(rec.prior->'rows') x;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        exception
          when sqlstate '23505' or sqlstate '23514' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'recurring_match' then
      -- FLOW-430. The pair's answer changed since the write is a conflict; else
      -- answer_recurring_match puts back the answer from before (null: no answer).
      declare
        cur jsonb;
      begin
        select coalesce(
          (select to_jsonb(m.same) from public.recurring_matches m
           where m.company_id = cid and m.direction = (rec.prior->>'direction')::public.txn_direction
             and m.party_id = (rec.prior->>'party_id')::uuid and m.match_party_id = p_id
           for update),
          'null'::jsonb
        ) into cur;
        if cur is distinct from rec.prior->'written' then
          response := private.mcp_error('conflict', 'conflict');
        else
          perform public.answer_recurring_match((rec.prior->>'direction')::public.txn_direction,
            (rec.prior->>'party_id')::uuid, p_id, (rec.prior->>'before')::boolean);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
    elsif p_kind = 'line_pace' then
      -- FLOW-415. The party's pace changed since the write is a conflict; else set_payment_pace
      -- puts back the pace from before (null: the detected pace).
      declare
        party record;
        cur jsonb;
      begin
        select * into party from private.payment_party(cid, p_id);
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select coalesce(
            (select to_jsonb(o.pace) from public.recurring_overrides o
             where o.company_id = cid and o.direction = party.direction
               and o.party_id = party.party_id and o.currency = party.currency
               and o.project_id is not distinct from (rec.prior->>'project')::uuid
             for update),
            'null'::jsonb
          ) into cur;
          if cur is distinct from rec.prior->'written' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
              (rec.prior->>'project')::uuid, 'pace', rec.prior->'before');
            update private.mcp_writes
            set undone_at = clock_timestamp()
            where id = rec.id and user_id = auth.uid() and undone_at is null;
            response := jsonb_build_object(
              'ok', true,
              'data', jsonb_build_object('kind', p_kind, 'id', p_id)
            );
          end if;
        end if;
      end;
    elsif p_kind = 'line_amount' then
      -- Decision 0189. The charge's usual amount changed since the write is a conflict; else the amount
      -- from before (null: computed) goes back on the row of the charge the write was for.
      declare
        party record;
        cur jsonb;
      begin
        select * into party from private.payment_party(cid, p_id);
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select coalesce(
            (select to_jsonb(o.typical_amount_minor) from public.recurring_overrides o
             where o.company_id = cid and o.direction = party.direction
               and o.party_id = party.party_id and o.currency = party.currency
               and o.project_id is not distinct from (rec.prior->>'project')::uuid
             for update),
            'null'::jsonb
          ) into cur;
          if cur is distinct from rec.prior->'written' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
              (rec.prior->>'project')::uuid, 'amount', rec.prior->'before');
            update private.mcp_writes
            set undone_at = clock_timestamp()
            where id = rec.id and user_id = auth.uid() and undone_at is null;
            response := jsonb_build_object(
              'ok', true,
              'data', jsonb_build_object('kind', p_kind, 'id', p_id)
            );
          end if;
        end if;
      end;
    elsif p_kind = 'line_recurring' then
      -- FLOW-415. The party's switch changed since the write is a conflict; else
      -- set_payment_recurring puts back the switch from before (null: automatic).
      declare
        party record;
        cur jsonb;
      begin
        select * into party from private.payment_party(cid, p_id);
        if not found then
          response := private.mcp_error('not_found', 'not found');
        else
          select coalesce(
            (select to_jsonb(o.recurring) from public.recurring_overrides o
             where o.company_id = cid and o.direction = party.direction
               and o.party_id = party.party_id and o.currency = party.currency
               and o.project_id is not distinct from (rec.prior->>'project')::uuid
             for update),
            'null'::jsonb
          ) into cur;
          if cur is distinct from rec.prior->'written' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
              (rec.prior->>'project')::uuid, 'recurring', rec.prior->'before');
            update private.mcp_writes
            set undone_at = clock_timestamp()
            where id = rec.id and user_id = auth.uid() and undone_at is null;
            response := jsonb_build_object(
              'ok', true,
              'data', jsonb_build_object('kind', p_kind, 'id', p_id)
            );
          end if;
        end if;
      end;
    elsif p_kind in ('category_cash', 'line_cash', 'cash_basis') then
      -- FLOW-413. A value changed since the write is a conflict; else the owner's own setter
      -- puts back the value from before.
      declare
        cur jsonb;
      begin
        if p_kind = 'category_cash' then
          select coalesce(to_jsonb(c.in_cash), 'null'::jsonb) into cur
          from public.categories c
          where c.id = p_id and c.company_id = cid
          for update;
        elsif p_kind = 'line_cash' then
          select coalesce(to_jsonb(t.in_cash_override), 'null'::jsonb) into cur
          from public.transactions t
          where t.id = p_id and t.company_id = cid and t.removed_at is null
          for update;
        else
          select coalesce(to_jsonb(c.cash_basis), 'null'::jsonb) into cur
          from public.companies c
          where c.id = p_id and c.id = cid
          for update;
        end if;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif cur is distinct from rec.prior->'written' then
          response := private.mcp_error('conflict', 'conflict');
        else
          if p_kind = 'category_cash' then
            perform public.set_category_cash(p_id, (rec.prior->>'before')::boolean);
          elsif p_kind = 'line_cash' then
            perform public.set_transaction_cash(p_id, (rec.prior->>'before')::boolean);
          else
            perform public.set_cash_basis(rec.prior->>'before');
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
    elsif p_kind = 'company' then
      select c.name into cur_name
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found or rec.prior->>'before' is null then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_name is distinct from rec.prior->>'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.companies c
        set name = rec.prior->>'before'
        where c.id = p_id and c.id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_index' then
      declare
        link record;
      begin
        select l.rate_index, l.rate_margin_ppm into link
        from public.loans l
        where l.id = p_id and l.company_id = cid
        for no key update;
        if not found then
          response := private.mcp_error('not_found', 'not found');
        elsif jsonb_build_object('rate_index', link.rate_index, 'rate_margin_ppm', link.rate_margin_ppm)
            is distinct from rec.prior->'after' then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.loans l
          set rate_index = rec.prior->'before'->>'rate_index',
              rate_margin_ppm = (rec.prior->'before'->>'rate_margin_ppm')::integer
          where l.id = p_id and l.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
    elsif p_kind = 'index_rate' then
      -- All or nothing: every row must still hold what the write put there.
      declare
        row_item record;
        held integer;
        changed boolean := false;
        on_date date := (rec.prior->>'effective_date')::date;
      begin
        perform 1 from public.loans l
        where l.company_id = cid
          and l.id in (select (x->>'loan_id')::uuid from jsonb_array_elements(rec.prior->'rows') x)
        order by l.id
        for no key update;
        for row_item in select x.value as item from jsonb_array_elements(rec.prior->'rows') x loop
          select r.annual_rate_ppm into held
          from public.loan_rates r
          where r.company_id = cid
            and r.loan_id = (row_item.item->>'loan_id')::uuid
            and r.effective_date = on_date
          for update;
          if not found or held is distinct from (row_item.item->>'written')::integer then
            changed := true;
          end if;
        end loop;
        if changed then
          response := private.mcp_error('conflict', 'conflict');
        else
          for row_item in select x.value as item from jsonb_array_elements(rec.prior->'rows') x loop
            if row_item.item->>'before' is null then
              delete from public.loan_rates r
              where r.company_id = cid
                and r.loan_id = (row_item.item->>'loan_id')::uuid
                and r.effective_date = on_date;
            else
              update public.loan_rates r
              set annual_rate_ppm = (row_item.item->>'before')::integer
              where r.company_id = cid
                and r.loan_id = (row_item.item->>'loan_id')::uuid
                and r.effective_date = on_date;
            end if;
          end loop;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
    elsif p_kind = 'jev_mode' then
      declare
        jev_row public.company_integrations%rowtype;
      begin
        select * into jev_row
        from public.company_integrations ci
        where ci.company_id = p_id and ci.company_id = cid and ci.provider = 'jev'
        for update;
        if jev_row.company_id is null then
          response := private.mcp_error('not_found', 'not found');
        elsif jsonb_build_object('enabled', jev_row.enabled, 'mode', jev_row.mode, 'threshold', jev_row.threshold)
            is distinct from rec.prior->'after' then
          response := private.mcp_error('conflict', 'conflict');
        else
          if jsonb_typeof(rec.prior->'before') = 'object' then
            update public.company_integrations ci
            set enabled = (rec.prior->'before'->>'enabled')::boolean,
                mode = rec.prior->'before'->>'mode',
                threshold = (rec.prior->'before'->>'threshold')::numeric
            where ci.company_id = cid and ci.provider = 'jev';
          else
            delete from public.company_integrations ci
            where ci.company_id = cid and ci.provider = 'jev';
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
    elsif p_kind = 'category_name' then
      -- Conflict once renamed again, or while another category of the kind has the old name.
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid and c.name = rec.prior->>'after'
        and not exists (
          select 1 from public.categories o
          where o.company_id = cid and o.kind = c.kind and o.name = rec.prior->>'before' and o.id <> c.id
        )
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        -- Keep excluded_from_pnl: the name trigger may set it from the old name.
        declare
          was_excluded boolean;
        begin
          select c.excluded_from_pnl into was_excluded
          from public.categories c
          where c.id = p_id and c.company_id = cid;
          update public.categories c
          set name = rec.prior->>'before'
          where c.id = p_id and c.company_id = cid;
          update public.categories c
          set excluded_from_pnl = was_excluded
          where c.id = p_id and c.company_id = cid and c.excluded_from_pnl is distinct from was_excluded;
        end;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'project_group' then
      perform 1 from public.project_groups g
      where g.id = p_id and g.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.projects p
        where p.company_id = cid and p.group_id = p_id
      ) or exists (
        -- An open set_project_group write would put a project back in this group.
        select 1 from private.mcp_writes w
        where w.user_id = auth.uid()
          and w.kind = 'project_group_member'
          and w.undone_at is null
          and w.prior->>'before' = p_id::text
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.project_groups g
        where g.id = p_id and g.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'project_group_member' then
      perform 1 from public.projects p
      where p.id = p_id and p.company_id = cid
        and coalesce(to_jsonb(p.group_id), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          update public.projects p
          set group_id = (rec.prior->>'before')::uuid
          where p.id = p_id and p.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23503' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'category_parent' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
        and coalesce(to_jsonb(c.parent_id), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          update public.categories c
          set parent_id = (rec.prior->>'before')::uuid
          where c.id = p_id and c.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23514' or sqlstate '23503' or raise_exception then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'category_group' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
        and coalesce(to_jsonb(c.group_name), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.categories c
        set group_name = rec.prior->>'before'
        where c.id = p_id and c.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'company_currency' then
      select c.base_currency into cur_name
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_name is distinct from rec.prior->>'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.companies c
        set base_currency = rec.prior->>'before'
        where c.id = p_id and c.id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'overhead_project' then
      select c.overhead_project_id into cur_overhead
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_overhead::text is distinct from rec.prior->>'written' then
        response := private.mcp_error('conflict', 'conflict');
      elsif rec.prior->>'before' is not null and not exists (
        -- Key-share lock: a delete of that project waits until this undo commits, so it
        -- cannot slip in between this check and set_overhead_project.
        select 1 from public.projects p
        where p.id = (rec.prior->>'before')::uuid and p.company_id = cid
        for key share
      ) then
        -- The project it was before has been deleted since: nothing to go back to.
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_overhead_project((rec.prior->>'before')::uuid);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'invoice_paid' then
      -- The document row is the lock, as in set_invoice_paid.
      perform 1
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update of t;
      cur_found := found;
      select m.marked_at into cur_marked
      from public.invoice_paid_marks m
      where m.transaction_id = p_id and m.company_id = cid;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      -- The mark this write left, to the microsecond: a mark cleared and set again since is a
      -- change too.
      elsif cur_marked is distinct from (rec.prior->>'written_at')::timestamptz then
        response := private.mcp_error('conflict', 'conflict');
      else
        -- Put the mark back as it was, with its first time, or take it away.
        delete from public.invoice_paid_marks m where m.transaction_id = p_id and m.company_id = cid;
        if rec.prior->>'before' is not null then
          insert into public.invoice_paid_marks (transaction_id, company_id, marked_at, marked_by)
          values (p_id, cid, (rec.prior->>'before')::timestamptz, (rec.prior->>'before_by')::uuid);
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'line_pnl' then
      select t.in_pnl_override into cur_override
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_override is distinct from (rec.prior->>'written')::boolean then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_transaction_pnl(p_id, (rec.prior->>'before')::boolean);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'line_split' then
      perform 1 from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif private.line_split_parts(p_id) is distinct from rec.prior->'written' then
        response := private.mcp_error('conflict', 'conflict');
      elsif (select t.in_pnl_override from public.transactions t where t.id = p_id and t.company_id = cid) is true
        and private.line_has_loose_reversal(p_id, rec.prior->'before') then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.line_splits where transaction_id = p_id and company_id = cid;
        -- A write stored before FLOW-133 has no percent or rest in before: they stay empty.
        insert into public.line_splits (
          company_id, transaction_id, ordinal, category_id, project_id, amount_minor, percent, is_rest
        )
        select cid, p_id, b.ord::smallint, (b.part->>'category_id')::uuid, (b.part->>'project_id')::uuid,
          (b.part->>'amount_minor')::bigint, (b.part->>'percent')::numeric,
          coalesce((b.part->>'is_rest')::boolean, false)
        from jsonb_array_elements(rec.prior->'before') with ordinality as b(part, ord);
        update public.transactions
        set user_assigned = (rec.prior->>'user_assigned')::boolean,
            category_suggested = (rec.prior->>'category_suggested')::boolean
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan' then
      perform 1 from public.loans l
      where l.id = p_id and l.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.loan_splits s
        where s.company_id = cid and s.loan_id = p_id
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.loans where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_update' then
      written := rec.prior->'after';
      before := rec.prior->'before';
      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
             l.status, l.closed_on,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id,
             l.fees_category_id, l.kind, l.interest_only_months, l.amortization_months
      into cur_loan
      from public.loans l
      where l.id = p_id and l.company_id = cid
      for update;
      if not found or written is null or before is null then
        response := private.mcp_error('not_found', 'not found');
      elsif (
        -- Compare only the fields the edit snapshotted. An edit written before FLOW-105
        -- has no project_id, and one written before FLOW-106 has no status or closed_on.
        select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
        from jsonb_each(jsonb_build_object(
          'name', cur_loan.name,
          'principal_minor', cur_loan.principal_minor,
          'annual_rate_ppm', cur_loan.annual_rate_ppm,
          'term_months', cur_loan.term_months,
          'start_date', cur_loan.start_date,
          'payment_minor', cur_loan.payment_minor,
          'escrow_minor', cur_loan.escrow_minor,
          'project_id', cur_loan.project_id,
          'status', cur_loan.status,
          'closed_on', cur_loan.closed_on,
          'interest_category_id', cur_loan.interest_category_id,
          'escrow_category_id', cur_loan.escrow_category_id,
          'principal_category_id', cur_loan.principal_category_id,
          'fees_category_id', cur_loan.fees_category_id,
          'kind', cur_loan.kind,
          'interest_only_months', cur_loan.interest_only_months,
          'amortization_months', cur_loan.amortization_months
        )) f
        where written ? f.key
      ) is distinct from written then
        response := private.mcp_error('conflict', 'conflict');
      elsif before->>'project_id' is not null and not exists (
        select 1 from public.projects p
        where p.id = (before->>'project_id')::uuid and p.company_id = cid
      ) then
        response := private.mcp_refused('project not found');
      elsif exists (
        select 1
        from (values ('interest_category_id'), ('escrow_category_id'), ('principal_category_id'), ('fees_category_id')) v(k)
        where before->>v.k is not null
          and not exists (
            select 1 from public.categories c
            where c.id = (before->>v.k)::uuid and c.company_id = cid
          )
      ) then
        -- A category the edit replaced was deleted since.
        response := private.mcp_refused('category not found');
      else
        update public.loans l
        set
          name = (before->>'name')::text,
          principal_minor = (before->>'principal_minor')::bigint,
          annual_rate_ppm = (before->>'annual_rate_ppm')::integer,
          term_months = (before->>'term_months')::integer,
          start_date = (before->>'start_date')::date,
          payment_minor = (before->>'payment_minor')::bigint,
          escrow_minor = (before->>'escrow_minor')::bigint,
          project_id = case when before ? 'project_id'
            then (before->>'project_id')::uuid else l.project_id end,
          status = case when before ? 'status'
            then (before->>'status')::public.loan_status else l.status end,
          closed_on = case when before ? 'status'
            then (before->>'closed_on')::date else l.closed_on end,
          interest_category_id = case when before ? 'interest_category_id'
            then (before->>'interest_category_id')::uuid else l.interest_category_id end,
          escrow_category_id = case when before ? 'escrow_category_id'
            then (before->>'escrow_category_id')::uuid else l.escrow_category_id end,
          principal_category_id = case when before ? 'principal_category_id'
            then (before->>'principal_category_id')::uuid else l.principal_category_id end,
          fees_category_id = case when before ? 'fees_category_id'
            then (before->>'fees_category_id')::uuid else l.fees_category_id end,
          kind = case when before ? 'kind'
            then (before->>'kind')::public.loan_kind else l.kind end,
          interest_only_months = case when before ? 'kind'
            then (before->>'interest_only_months')::integer else l.interest_only_months end,
          amortization_months = case when before ? 'kind'
            then (before->>'amortization_months')::integer else l.amortization_months end
        where l.id = p_id and l.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_rate' then
      -- The loan first, as every loan write does (0121); then the rate row by its date.
      perform 1 from public.loans l
      where l.id = rec.loan_id and l.company_id = cid
      for no key update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      else
        select r.annual_rate_ppm into cur_rate
        from public.loan_rates r
        where r.loan_id = rec.loan_id
          and r.effective_date = (rec.prior->>'effective_date')::date
        for update;
        if not found then
          cur_rate := null;
        end if;
        if cur_rate is distinct from (rec.prior->>'written')::integer then
          -- Changed since: leave it.
          response := private.mcp_error('conflict', 'conflict');
        else
          if rec.prior->>'before' is null then
            delete from public.loan_rates r
            where r.loan_id = rec.loan_id
              and r.effective_date = (rec.prior->>'effective_date')::date;
          elsif rec.prior->>'written' is null then
            insert into public.loan_rates (id, company_id, loan_id, effective_date, annual_rate_ppm)
            values (
              (rec.prior->>'rate_id')::uuid, cid, rec.loan_id,
              (rec.prior->>'effective_date')::date, (rec.prior->>'before')::integer
            );
          else
            update public.loan_rates r
            set annual_rate_ppm = (rec.prior->>'before')::integer
            where r.loan_id = rec.loan_id
              and r.effective_date = (rec.prior->>'effective_date')::date;
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end if;
    elsif p_kind = 'category_delete' then
      -- The delete this write made, if the app has not put the category back since.
      if not exists (
        select 1 from private.category_deletions d
        where d.id = (rec.prior->>'deletion_id')::uuid and d.company_id = cid and d.restored_at is null
      ) then
        response := private.mcp_error('not_found', 'not found');
      else
        begin
          perform private.category_restore(cid, (rec.prior->>'deletion_id')::uuid);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when check_violation then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'category_move' then
      if not exists (
        select 1 from private.category_moves m
        where m.id = (rec.prior->>'move_id')::uuid and m.company_id = cid and m.undone_at is null
      ) then
        response := private.mcp_error('not_found', 'not found');
      else
        begin
          perform private.category_move_undo(cid, (rec.prior->>'move_id')::uuid);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when check_violation then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'project_investment' then
      perform 1 from public.projects p where p.id = p_id and p.company_id = cid for update;
      if not found or private.project_figures(cid, p_id) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.projects p
        set purchase_minor = (rec.prior->'before'->>'purchase_minor')::bigint,
            arv_minor = (rec.prior->'before'->>'arv_minor')::bigint,
            value_minor = (rec.prior->'before'->>'value_minor')::bigint,
            value_date = (rec.prior->'before'->>'value_date')::date,
            investment_currency = coalesce(rec.prior->'before'->>'currency', 'ILS')
        where p.id = p_id and p.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_rehab' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
        and coalesce(to_jsonb(c.rehab), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.categories c
        set rehab = (rec.prior->>'before')::boolean
        where c.id = p_id and c.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_delete' then
      -- The delete this write made, if the app has not put the loan back since.
      select d.snapshot into written
      from private.loan_deletions d
      where d.id = (rec.prior->>'deletion_id')::uuid
        and d.company_id = cid
        and d.restored_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      else
        begin
          perform private.loan_restore(cid, written);
          update private.loan_deletions
          set restored_at = clock_timestamp()
          where id = (rec.prior->>'deletion_id')::uuid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when check_violation then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'loan_order' then
      if p_id is distinct from cid then
        response := private.mcp_error('not_found', 'not found');
      else
        perform 1 from public.loans l where l.company_id = cid order by l.id for update;
        -- Only while the order is still the one this write set, and no loan came or went.
        if to_jsonb(private.loan_order(cid)) is distinct from rec.prior->'after' then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.loans l
          set sort_order = o.place::integer
          from jsonb_array_elements_text(rec.prior->'before') with ordinality as o(id, place)
          where l.id = o.id::uuid and l.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end if;
    elsif p_kind = 'loan_detach' then
      -- The loan first, then the line, as every loan split write.
      select l.kind, l.start_date into cur_loan
      from public.loans l
      where l.id = rec.loan_id and l.company_id = cid
      for update;
      cur_found := found;
      if cur_found then
        select t.doc_date into written
        from (
          select to_jsonb(t.doc_date) as doc_date
          from public.transactions t
          where t.id = p_id and t.company_id = cid and t.removed_at is null
          for update
        ) t;
        cur_found := written is not null;
      end if;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.loan_splits s where s.transaction_id = p_id and s.company_id = cid
      ) then
        -- Matched again since (to this loan or another): leave it.
        response := private.mcp_error('conflict', 'conflict');
      elsif cur_loan.kind = 'demand'::public.loan_kind and (
        -- The demand order rules save_loan_split and attach_loan_payment apply (0132): interest
        -- runs from the last payment, so a payment attached since with a later date, or a
        -- start moved past this line, leaves no room to put this one back.
        (written #>> '{}')::date < cur_loan.start_date
        or exists (
          select 1
          from public.loan_splits s
          join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
          where s.loan_id = rec.loan_id
            and s.company_id = cid
            and t.removed_at is null
            and not s.needs_review
            and t.doc_date > (written #>> '{}')::date
        )
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        -- The line or the loan may have changed since (amount, balance, a part's category):
        -- parts that no longer fit are not put back, and the undo is a conflict.
        begin
          insert into public.loan_splits (
            company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id,
            needs_review
          )
          select cid, rec.loan_id, p_id, (e.value->>'part')::public.loan_split_part,
            (e.value->>'amount_minor')::bigint, (e.value->>'scheduled_minor')::bigint,
            (e.value->>'category_id')::uuid, coalesce((e.value->>'needs_review')::boolean, false)
          from jsonb_array_elements(rec.prior->'parts') e;
          perform private.loan_splits_check(p_id);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id, 'loan_id', rec.loan_id)
          );
        exception
          when check_violation or foreign_key_violation or unique_violation then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'loan_split' then
      perform 1 from public.loan_splits s
      where s.company_id = cid
        and s.transaction_id = p_id
        and s.loan_id = rec.loan_id
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif (
        -- Corrected in the app after the MCP wrote it: leave the owner's version.
        rec.prior->'parts' is not null
        and rec.prior->'parts' is distinct from (
          select jsonb_agg(jsonb_build_object(
            'part', s.part,
            'amount_minor', s.amount_minor,
            'category_id', s.category_id
          ) order by s.part)
          from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
        )
      ) or (
        -- Written before the parts were kept: any later touch counts as a correction.
        rec.prior->'parts' is null
        and exists (
          select 1 from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
            and s.updated_at > rec.created_at
        )
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.loan_splits s
        where s.company_id = cid
          and s.transaction_id = p_id
          and s.loan_id = rec.loan_id;
        -- Give the line back the project it had before the attach, but only if
        -- nobody has changed it since. A line that was changed is left as it is.
        restored := false;
        -- Since FLOW-120 the reassign id is in its column; older writes kept it in prior.
        attach_reassign := coalesce(rec.reassign_id, (rec.prior->>'reassign_id')::uuid);
        if attach_reassign is not null then
          select t.project_id, t.category_id, t.pnl_role
          into cur_project, cur_category, cur_role
          from public.transactions t
          where t.id = p_id and t.company_id = cid and t.removed_at is null
          for update;
          if found
            and cur_project::text is not distinct from rec.prior->>'project_id'
            and cur_category::text is not distinct from rec.prior->>'category_id'
            -- The role the attach gave the line. Writes before FLOW-120 did not keep
            -- it; reassign_transaction gave project for an expense category and none
            -- for an income (reversal) one, and the category is unchanged here.
            and (
              (rec.prior ? 'pnl_role'
                and cur_role::text is not distinct from rec.prior->>'pnl_role')
              or (not (rec.prior ? 'pnl_role')
                and cur_role is not distinct from (
                  case when exists (
                    select 1 from public.categories c
                    where c.id = cur_category
                      and c.company_id = cid
                      and c.kind = 'income'::public.category_kind
                  ) then null::public.pnl_role
                  else 'project'::public.pnl_role end
                ))
            )
            and exists (
              select 1 from public.reassign_undo u
              where u.id = attach_reassign
                and u.company_id = cid
                and u.undone_at is null
            )
          then
            perform public.undo_reassign(attach_reassign);
            restored := true;
          end if;
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', case when attach_reassign is not null
            then jsonb_build_object('kind', p_kind, 'id', p_id, 'project_restored', restored)
            else jsonb_build_object('kind', p_kind, 'id', p_id) end
        );
      end if;
    elsif p_kind = 'project' then
      perform 1 from public.projects p
      where p.id = p_id and p.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.project_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.allocations a
        where a.company_id = cid and a.project_id = p_id
      ) or exists (
        select 1 from public.split_rule_targets s
        where s.company_id = cid and s.project_id = p_id
      ) or exists (
        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.project_id = p_id
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_project_id = p_id
      ) or exists (
        select 1 from public.loans l
        where l.company_id = cid and l.project_id = p_id
      ) or exists (
        -- FLOW-205: a reopen or a reassign undo would restore this project.
        select 1 from public.review_queue q
        where q.company_id = cid
          and (q.prior_project_id = p_id
            or q.prior_allocations @> jsonb_build_array(jsonb_build_object('project_id', p_id)))
      ) or exists (
        select 1 from public.reassign_undo r
        where r.company_id = cid
          and r.undone_at is null
          and (r.prior_project_id = p_id
            or r.prior_allocations @> jsonb_build_array(jsonb_build_object('project_id', p_id)))
      ) or exists (
        -- An open split_line write would restore its parts on this project.
        select 1 from private.mcp_writes w
        where w.user_id = auth.uid()
          and w.kind = 'line_split'
          and w.undone_at is null
          and w.prior->'before' @> jsonb_build_array(jsonb_build_object('project_id', p_id))
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.projects
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.category_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_category_id = p_id
      ) or exists (
        select 1 from public.loan_splits ls
        where ls.company_id = cid and ls.category_id = p_id
      ) or exists (
        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.category_id = p_id
      ) or exists (
        select 1 from public.review_queue q
        where q.company_id = cid
          and (q.prior_remembered_category_id = p_id or q.written_remembered_category_id = p_id
            or q.prior_category_id = p_id)
      ) or exists (
        -- FLOW-205: a reassign undo would restore this category.
        select 1 from public.reassign_undo r
        where r.company_id = cid and r.undone_at is null and r.prior_category_id = p_id
      ) or exists (
        -- An open split_line write would restore its parts in this category.
        select 1 from private.mcp_writes w
        where w.user_id = auth.uid()
          and w.kind = 'line_split'
          and w.undone_at is null
          and w.prior->'before' @> jsonb_build_array(jsonb_build_object('category_id', p_id))
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.categories
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_hidden' then
      select c.hidden into cur_hidden
      from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if found and cur_hidden is not distinct from rec.prior_hidden then
        -- FLOW-205: the app already put it back as it was before the hide; close the write.
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      elsif not found or cur_hidden is distinct from true then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_hidden(p_id, rec.prior_hidden);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_pnl' then
      select c.excluded_from_pnl into cur_excluded
      from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      written_excluded := (rec.prior->>'written')::boolean;
      if not found or cur_excluded is distinct from written_excluded then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_excluded_from_pnl(p_id, (rec.prior->>'excluded_from_pnl')::boolean);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    else
      txn := rec.transaction_id;
      select t.project_id, t.category_id, t.pnl_role
      into cur_project, cur_category, cur_role
      from public.transactions t
      where t.id = txn
        and t.company_id = cid
        and t.removed_at is null
      for update;

      if not found
        or cur_project is distinct from rec.project_id
        or cur_category is distinct from rec.category_id
        or cur_role is distinct from rec.pnl_role
        or private.mcp_shares(txn) is distinct from rec.shares
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        if p_kind = 'review' then
          perform public.reopen_review(p_id);
        else
          perform public.undo_reassign(p_id);
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    end if;
  exception
    when check_violation then
      if sqlerrm = 'loan_payment_below_interest' then
        response := private.mcp_refused('payment below interest');
      elsif sqlerrm = 'loan_payments_after_close' then
        response := private.mcp_refused('payments after closed_on');
      elsif sqlerrm = 'loan_category_not_allowed' then
        response := private.mcp_refused('category does not fit the loan part');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

commit;
