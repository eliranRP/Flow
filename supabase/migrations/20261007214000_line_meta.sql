-- FLOW-304. Bank metadata per line: how the money moved, the card's last 4, the memo, and
-- the account. The connector stores them in provider_meta through one allowlist, and
-- get_line_meta returns them normalized for the app and flow-mcp. No account or card
-- number beyond the last 4 is stored or returned. Decision 0113.

begin;

-- A run of 5 or more digits (an account or routing number) keeps only its last 4: ••1234.
create or replace function private.mask_long_digits(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p_text, '[0-9]+([0-9]{4})', '••\1', 'g');
$$;
revoke all on function private.mask_long_digits(text) from public, anon;
grant execute on function private.mask_long_digits(text) to authenticated, service_role;

-- The provider_meta allowlist. Anything else, including account and routing numbers,
-- is dropped. p_prior keeps the last status recheck time when the new line has none.
create or replace function private.clean_provider_meta(p_meta jsonb, p_prior jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', nullif(p_meta->>'kind', ''),
    'providerCategory', nullif(p_meta->>'providerCategory', ''),
    'checked_at', coalesce(nullif(p_meta->>'checked_at', ''), nullif(p_prior->>'checked_at', '')),
    'method', case
      when p_meta->>'method' in ('card', 'ach', 'wire', 'check', 'transfer', 'other') then p_meta->>'method'
    end,
    'card_last4', case when p_meta->>'card_last4' ~ '^[0-9]{4}$' then p_meta->>'card_last4' end,
    'memo', left(nullif(btrim(private.mask_long_digits(p_meta->>'memo')), ''), 200),
    'account_id', case
      when length(p_meta->>'account_id') between 1 and 128 then p_meta->>'account_id'
    end
  ));
$$;
revoke all on function private.clean_provider_meta(jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.clean_provider_meta(jsonb, jsonb) to service_role;

-- Lines imported before FLOW-304 have only the provider's kind. Same rules as the connector.
create or replace function private.payment_method_of_kind(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(p_kind, '') is null then null
    when p_kind ilike '%card%' then 'card'
    when p_kind ilike '%wire%' then 'wire'
    when p_kind ilike '%check%' then 'check'
    when p_kind in ('internalTransfer', 'treasuryTransfer') then 'transfer'
    when p_kind ilike '%ach%' or p_kind in ('externalTransfer', 'outgoingPayment') then 'ach'
    else 'other'
  end;
$$;
revoke all on function private.payment_method_of_kind(text) from public, anon;
grant execute on function private.payment_method_of_kind(text) to authenticated, service_role;

-- Same as 20261004130000_mercury_ils_totals.sql, with provider_meta through the allowlist.
create or replace function public.upsert_connector_lines(
  p_company uuid,
  p_provider public.connector_provider,
  p_lines jsonb,
  p_next_cursor text,
  p_expected_prev_cursor text
)
returns public.connector_upsert_result
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  result public.connector_upsert_result;
  line jsonb;
  has_connection boolean := false;
  prev_cursor text;
  import_from date;
  source_value public.txn_source;
  income_category uuid;
  seen_ids text[] := array[]::text[];
  removed_ids text[] := array[]::text[];
  ext text;
  key text;
  direction public.txn_direction;
  kind public.doc_kind;
  role public.pnl_role;
  line_status public.line_status;
  gross bigint;
  net bigint;
  vat bigint;
  original bigint;
  negated boolean;
  section_name text;
  section_id bigint;
  project uuid;
  named uuid;
  mapped_section bigint;
  party_name text;
  party_kind text;
  party_external bigint;
  party_external_text text;
  supplier uuid;
  customer uuid;
  remembered uuid;
  hint_category uuid;
  txn uuid;
  assigned boolean;
  allocated bigint;
  existing_id uuid;
  existing_void boolean;
  existing_removed timestamptz;
  existing_user boolean;
  existing_project_assigned boolean;
  existing_category_assigned boolean;
  existing_count integer;
  remove_count integer;
  removed_now integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'no company';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'object' then
    raise exception 'lines must be an object';
  end if;
  if jsonb_typeof(p_lines->'lines') <> 'array' then
    raise exception 'lines must be an array';
  end if;
  if p_provider::text = 'sumit' then
    source_value := 'sumit';
  elsif p_provider::text = 'mercury' then
    source_value := 'mercury';
  else
    raise exception 'provider is not a ledger source yet';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company::text || ':' || p_provider::text, 0)
  );
  perform 1 from public.companies where id = p_company for update;

  select c.sync_cursor, c.import_from, true
  into prev_cursor, import_from, has_connection
  from public.connector_connections c
  where c.company_id = p_company
    and c.provider = p_provider
  for update;
  if has_connection and prev_cursor is distinct from p_expected_prev_cursor then
    raise exception 'sync_cursor_conflict';
  end if;

  select c.id into income_category
  from public.categories c
  where c.company_id = p_company
    and c.kind = 'income'
    and c.is_default = true
    and c.hidden = false
  order by c.sort_order
  limit 1;

  result.inserted := 0;
  result.updated := 0;
  result.removed := 0;
  result.skipped := 0;

  for line in select value from jsonb_array_elements(p_lines->'lines')
  loop
    if coalesce(line->>'source', '') is distinct from p_provider::text then
      result.skipped := result.skipped + 1;
      continue;
    end if;
    ext := nullif(line->>'external_id', '');
    if ext is null then
      raise exception 'line is missing an external id';
    end if;
    key := coalesce(nullif(line->>'idempotency_key', ''), p_provider::text || ':' || ext);
    direction := (line->>'direction')::public.txn_direction;
    kind := (line->>'doc_kind')::public.doc_kind;
    role := nullif(line->>'pnl_role', '')::public.pnl_role;
    line_status := coalesce(nullif(line->>'line_status', '')::public.line_status, 'posted');
    negated := coalesce((line->>'amount_negated')::boolean, false);
    original := (line->>'amount_original')::bigint;
    vat := (line #>> '{vat,amount}')::bigint;
    if original is null or original < 0 or vat is null or vat < 0 then
      raise exception 'line amounts are not valid';
    end if;
    gross := case when negated then -original else original end;
    vat := case when negated then -vat else vat end;
    net := gross - vat;

    section_name := nullif(btrim(coalesce(line #>> '{project_hint,name}', '')), '');
    section_id := nullif(line #>> '{project_hint,external_id}', '')::bigint;
    project := null;
    if section_id is not null then
      select p.id into project
      from public.projects p
      where p.company_id = p_company and p.sumit_budget_section_id = section_id
      limit 1;
    end if;
    if project is null and section_name is not null then
      select p.id, p.sumit_budget_section_id into named, mapped_section
      from public.projects p
      where p.company_id = p_company and p.name = section_name;
      if named is null then
        insert into public.projects (company_id, name, sumit_budget_section_id)
        values (p_company, section_name, section_id)
        on conflict (company_id, name) do update
          set sumit_budget_section_id = coalesce(public.projects.sumit_budget_section_id, excluded.sumit_budget_section_id)
        returning id into project;
        select p.sumit_budget_section_id into mapped_section
        from public.projects p where p.id = project;
        if section_id is not null and mapped_section is distinct from section_id then
          project := null;
        end if;
      elsif mapped_section is null then
        update public.projects
        set sumit_budget_section_id = section_id
        where id = named and sumit_budget_section_id is null;
        project := named;
      elsif section_id is null or mapped_section = section_id then
        project := named;
      end if;
    end if;

    party_name := nullif(btrim(coalesce(line #>> '{counterparty,name}', '')), '');
    party_kind := line #>> '{counterparty,kind}';
    party_external_text := nullif(line #>> '{counterparty,external_id}', '');
    -- Mercury ids are text. Only a SUMIT id is a bigint on the party row.
    party_external := case
      when p_provider = 'sumit' then party_external_text::bigint
      else null
    end;
    supplier := null;
    customer := null;
    remembered := null;
    if party_name is not null and party_kind = 'supplier' then
      insert into public.suppliers (company_id, name, sumit_external_id)
      values (p_company, party_name, case when p_provider = 'sumit' then party_external else null end)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.suppliers.sumit_external_id)
      returning id, remembered_category_id into supplier, remembered;
      if party_external_text is not null then
        insert into public.party_external_refs (company_id, provider, kind, external_id, supplier_id)
        values (p_company, p_provider, 'supplier', party_external_text, supplier)
        on conflict on constraint party_external_refs_pkey do update
          set supplier_id = excluded.supplier_id;
      end if;
    elsif party_name is not null and party_kind = 'customer' then
      insert into public.customers (company_id, name, sumit_external_id)
      values (p_company, party_name, case when p_provider = 'sumit' then party_external else null end)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.customers.sumit_external_id)
      returning id into customer;
      if party_external_text is not null then
        insert into public.party_external_refs (company_id, provider, kind, external_id, customer_id)
        values (p_company, p_provider, 'customer', party_external_text, customer)
        on conflict on constraint party_external_refs_pkey do update
          set customer_id = excluded.customer_id;
      end if;
    end if;

    if direction = 'income' or role is distinct from 'project' then
      project := null;
    end if;
    if direction = 'income' then
      role := null;
    end if;

    hint_category := null;
    if nullif(line->>'category_hint', '') is not null then
      select c.id into hint_category
      from public.categories c
      where c.company_id = p_company
        and c.name = line->>'category_hint'
        and c.kind::text = direction::text
      limit 1;
    end if;

    existing_id := null;
    select t.id, t.line_status = 'void', t.removed_at,
           t.user_assigned, t.project_assigned, t.category_assigned
    into existing_id, existing_void, existing_removed,
         existing_user, existing_project_assigned, existing_category_assigned
    from public.transactions t
    where t.company_id = p_company
      and t.source = source_value
      and t.external_id = ext
    for update;
    if existing_id is null then
      select t.id, t.line_status = 'void', t.removed_at,
             t.user_assigned, t.project_assigned, t.category_assigned
      into existing_id, existing_void, existing_removed,
           existing_user, existing_project_assigned, existing_category_assigned
      from public.transactions t
      where t.company_id = p_company
        and t.idempotency_key = key
      for update;
    end if;

    if existing_id is null then
      insert into public.transactions (
        company_id, direction, doc_kind, pnl_role, line_status,
        amount_gross, amount_net, vat_amount, vat_status,
        currency, amount_original, provider_meta,
        doc_date, cash_date, source, external_id, idempotency_key,
        project_id, customer_id, supplier_id, category_id,
        description, linked_external_id, user_assigned, removed_at
      ) values (
        p_company,
        direction,
        kind,
        role,
        line_status,
        gross,
        net,
        vat,
        (line #>> '{vat,status}')::public.vat_status,
        coalesce(nullif(line->>'currency', ''), 'ILS'),
        original,
        private.clean_provider_meta(line->'provider_meta', null),
        (line->>'doc_date')::date,
        nullif(line->>'cash_date', '')::date,
        source_value,
        ext,
        key,
        project,
        customer,
        supplier,
        case
          when hint_category is not null then hint_category
          when direction = 'income' then income_category
          when direction = 'expense' then remembered
          else null
        end,
        coalesce(line->>'description', ''),
        nullif(line->>'linked_external_id', ''),
        false,
        case when line_status = 'void' then pg_catalog.now() else null end
      )
      returning id, false, project_id, pnl_role, amount_net
      into txn, assigned, project, role, net;
      result.inserted := result.inserted + 1;
    else
      update public.transactions t
      set direction = direction,
          doc_kind = kind,
          amount_gross = gross,
          amount_net = net,
          vat_amount = vat,
          vat_status = (line #>> '{vat,status}')::public.vat_status,
          currency = coalesce(nullif(line->>'currency', ''), t.currency),
          amount_original = original,
          provider_meta = private.clean_provider_meta(line->'provider_meta', t.provider_meta),
          doc_date = (line->>'doc_date')::date,
          cash_date = nullif(line->>'cash_date', '')::date,
          external_id = ext,
          description = coalesce(line->>'description', ''),
          linked_external_id = nullif(line->>'linked_external_id', ''),
          customer_id = customer,
          supplier_id = supplier,
          line_status = case when existing_void then 'void'::public.line_status else line_status end,
          removed_at = case
            when existing_void then existing_removed
            when line_status = 'void' then coalesce(existing_removed, pg_catalog.now())
            else null
          end,
          project_id = case
            when existing_user or existing_project_assigned then t.project_id
            else project
          end,
          category_id = case
            when existing_user or existing_category_assigned then t.category_id
            when hint_category is not null then hint_category
            when direction = 'income' then income_category
            when direction = 'expense' then remembered
            else null
          end,
          pnl_role = case
            when existing_user or existing_project_assigned then t.pnl_role
            else role
          end
      where t.id = existing_id
      returning t.id, (t.user_assigned or t.project_assigned), t.project_id, t.pnl_role, t.amount_net
      into txn, assigned, project, role, net;
      result.updated := result.updated + 1;
    end if;

    seen_ids := array_append(seen_ids, ext);

    if assigned then
      update public.allocations
      set amount_net = (net * share_bp) / 10000
      where transaction_id = txn;
      select coalesce(sum(a.amount_net), 0) into allocated
      from public.allocations a
      where a.transaction_id = txn;
      if allocated <> 0 and allocated <> net then
        update public.allocations
        set amount_net = amount_net + (net - allocated)
        where id = (
          select a.id from public.allocations a
          where a.transaction_id = txn
          order by a.project_id
          limit 1
        );
      end if;
    else
      delete from public.allocations where transaction_id = txn;
      delete from public.overhead where transaction_id = txn;
      if direction <> 'income' and role = 'project' and project is not null then
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (p_company, txn, project, 10000, net);
      elsif direction <> 'income' and role = 'overhead' then
        insert into public.overhead (company_id, transaction_id)
        values (p_company, txn);
      end if;
    end if;
  end loop;

  if jsonb_typeof(p_lines->'removed_ids') = 'array' then
    select coalesce(array_agg(value), array[]::text[])
    into removed_ids
    from jsonb_array_elements_text(p_lines->'removed_ids') as value;
    update public.transactions t
    set line_status = 'void',
        removed_at = coalesce(t.removed_at, pg_catalog.now())
    where t.company_id = p_company
      and t.source = source_value
      and t.external_id = any (removed_ids)
      and t.line_status is distinct from 'void';
    get diagnostics removed_now = row_count;
    result.removed := result.removed + removed_now;
  end if;

  if coalesce((p_lines->>'complete')::boolean, false) and p_provider = 'sumit' then
    select count(*) into existing_count
    from public.transactions t
    where t.company_id = p_company
      and t.source = source_value
      and t.removed_at is null
      and (import_from is null or t.doc_date >= import_from);

    select count(*) into remove_count
    from public.transactions t
    where t.company_id = p_company
      and t.source = source_value
      and t.removed_at is null
      and (import_from is null or t.doc_date >= import_from)
      and not (t.external_id = any (seen_ids));

    if coalesce(array_length(seen_ids, 1), 0) = 0 then
      update public.connector_connections
      set last_error = 'sync_sweep_empty'
      where company_id = p_company
        and provider = p_provider;
    elsif existing_count > 0 and remove_count * 2 > existing_count then
      update public.connector_connections
      set last_error = 'sync_sweep_suspicious'
      where company_id = p_company
        and provider = p_provider;
    else
      update public.transactions t
      set removed_at = pg_catalog.now()
      where t.company_id = p_company
        and t.source = source_value
        and t.removed_at is null
        and (import_from is null or t.doc_date >= import_from)
        and not (t.external_id = any (seen_ids));
      get diagnostics removed_now = row_count;
      result.removed := result.removed + removed_now;
    end if;
  end if;

  if has_connection then
    update public.connector_connections
    set sync_cursor = p_next_cursor,
        sync_claimed_at = null
    where company_id = p_company
      and provider = p_provider
      and sync_cursor is not distinct from p_expected_prev_cursor;
  end if;

  perform public.sync_review_queue(p_company);
  return result;
end;
$$;
revoke all on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text) to service_role;

create or replace function public.get_transaction(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'description', t.description,
    'direction', t.direction,
    'doc_kind', t.doc_kind,
    'doc_date', t.doc_date,
    'amount_gross', t.amount_gross,
    'amount_net', t.amount_net,
    'vat_amount', t.vat_amount,
    'vat_status', t.vat_status,
    'currency', t.currency,
    'source', t.source,
    'pnl_role', t.pnl_role,
    'project_id', t.project_id,
    'project_name', p.name,
    'category_id', t.category_id,
    'category_name', c.name,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'review_status', (
      select q.status
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id
      order by case when q.status = 'open' then 0 else 1 end, q.created_at desc
      limit 1
    ),
    'review_reason', (
      select q.reason
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
    'paid', t.cash_date is not null,
    'open_gross_agorot', case
      when t.doc_kind = 'invoice' and t.external_id is not null then
        t.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = t.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = t.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = t.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = t.external_id
        ), 0)
      else null
    end,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id,
        'project_name', ap.name,
        'share_bp', a.share_bp,
        'amount_net', a.amount_net
      ) order by ap.name)
      from public.allocations a
      join public.projects ap on ap.id = a.project_id
      where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = p_id
    and t.removed_at is null
    and t.company_id = (select private.current_company_id());
$$;

revoke all on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text) to service_role;

-- The bank details of up to 200 lines of the caller's company, in no set order.
-- method is null for a line that has no provider data (a manual or SUMIT document line
-- without it). account is the connection's label for the account, with any masked
-- digits dropped. No number beyond a card's last 4 is returned.
create or replace function public.get_line_meta(p_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id', t.id,
    'method', case
      when t.source::text = 'mercury'
        then coalesce(t.provider_meta->>'method', private.payment_method_of_kind(t.provider_meta->>'kind'))
      else t.provider_meta->>'method'
    end,
    'card_last4', t.provider_meta->>'card_last4',
    'memo', private.mask_long_digits(t.provider_meta->>'memo'),
    'account', (
      select nullif(btrim(regexp_replace(
        regexp_replace(label.value->>'label', '\s*(••|\*\*)[*0-9]*', '', 'g'),
        '[0-9]{5,}', '', 'g'
      )), '')
      from public.connector_connections cc
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(cc.account_labels) = 'array' then cc.account_labels else '[]'::jsonb end
      ) as label(value)
      where cc.company_id = t.company_id
        and cc.provider::text = t.source::text
        and label.value->>'id' = t.provider_meta->>'account_id'
      limit 1
    ),
    'counterparty', coalesce(s.name, cu.name),
    'bank_description', case when private.is_connector_source(t.source) then nullif(btrim(private.mask_long_digits(t.description)), '') end
  )), '[]'::jsonb)
  from public.transactions t
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = any((p_ids)[1:200])
    and t.company_id = (select private.current_company_id());
$$;
revoke all on function public.get_line_meta(uuid[]) from public, anon;
grant execute on function public.get_line_meta(uuid[]) to authenticated, service_role;

commit;
