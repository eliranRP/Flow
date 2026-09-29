-- Decision 0068, r18. Append-only. Do not edit 20260929180000 or anything older.
-- Retiring a SUMIT ledger only set removed_at. The old idempotency key and external id
-- stayed unique, so the next company's document 50 updated that row and came back
-- with the previous assignment. Party ids and budget section ids are also per SUMIT
-- company. Leaving them made the next sync either fail the unique index or file a
-- new document on the previous company's project.

create or replace function public.replace_sumit_connection(
  p_company uuid,
  p_sumit_company_id bigint,
  p_key_ciphertext text,
  p_key_nonce text,
  p_dek_ciphertext text,
  p_dek_nonce text,
  p_kek_version text,
  p_envelope_version text,
  p_validated boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous bigint;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or p_sumit_company_id is null or p_sumit_company_id <= 0 then
    raise exception 'company id is required';
  end if;
  if p_validated is not true then
    raise exception 'validation failed';
  end if;

  select s.sumit_company_id into previous
  from public.sumit_connections s
  where s.company_id = p_company
  for update;

  if previous is null then
    select c.last_sumit_company_id into previous
    from public.companies c
    where c.id = p_company
    for update;
  end if;

  if previous is not null and previous is distinct from p_sumit_company_id then
    update public.review_queue q
    set status = 'skipped',
        resolved_at = pg_catalog.now()
    where q.company_id = p_company
      and q.status = 'open'
      and q.transaction_id in (
        select t.id
        from public.transactions t
        where t.company_id = p_company
          and t.source = 'sumit'
          and t.removed_at is null
      );

    update public.transactions t
    set removed_at = pg_catalog.now(),
        idempotency_key = t.idempotency_key || ':retired:' || t.id::text,
        external_id = case
          when t.external_id is null then null
          else t.external_id || ':retired:' || t.id::text
        end
    where t.company_id = p_company
      and t.source = 'sumit'
      and t.removed_at is null;

    update public.projects
    set sumit_budget_section_id = null
    where company_id = p_company
      and sumit_budget_section_id is not null;

    update public.suppliers
    set sumit_external_id = null
    where company_id = p_company
      and sumit_external_id is not null;

    update public.customers
    set sumit_external_id = null
    where company_id = p_company
      and sumit_external_id is not null;
  end if;

  insert into public.sumit_connections (
    company_id, sumit_company_id,
    key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
    kek_version, envelope_version,
    last_error, reject_attempts, next_attempt_at, last_sync_at
  ) values (
    p_company,
    p_sumit_company_id,
    private.bytea_from_hex(p_key_ciphertext),
    private.bytea_from_hex(p_key_nonce),
    private.bytea_from_hex(p_dek_ciphertext),
    private.bytea_from_hex(p_dek_nonce),
    p_kek_version,
    p_envelope_version,
    null,
    0,
    null,
    null
  )
  on conflict (company_id) do update
  set sumit_company_id = excluded.sumit_company_id,
      key_ciphertext = excluded.key_ciphertext,
      key_nonce = excluded.key_nonce,
      dek_ciphertext = excluded.dek_ciphertext,
      dek_nonce = excluded.dek_nonce,
      kek_version = excluded.kek_version,
      envelope_version = excluded.envelope_version,
      last_error = null,
      reject_attempts = 0,
      next_attempt_at = null,
      last_sync_at = null;

  update public.companies
  set last_sumit_company_id = p_sumit_company_id
  where id = p_company;
end;
$$;

revoke all on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) to service_role;
