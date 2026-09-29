-- Decision 0068, r16. Append-only. Do not edit 20260929160000 or anything older.
-- A table-level UPDATE grant covers every column, including last_sumit_company_id.
-- Revoke it and grant the other columns back. The remembered SUMIT id is written
-- only by the definer functions disconnect_sumit and replace_sumit_connection.

revoke update on table public.companies from public, anon, authenticated;

grant update (
  after_overhead,
  created_at,
  id,
  is_demo,
  name,
  owner_id,
  tax_id,
  updated_at,
  vat_rate_bp,
  vat_registered
) on table public.companies to authenticated;
