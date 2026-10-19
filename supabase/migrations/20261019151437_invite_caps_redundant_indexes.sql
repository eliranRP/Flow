-- Invite send caps and redundant indexes (FLOW-928, decision 0195). From a Supabase advisors review.
-- 1. invite_member caps the invites a company and a user create: 10 per company and 20 per
--    inviting user in any 24 hours, counted from company_invites.created_at whatever the invite's
--    status now (a cancelled invite still counts, so cancel and invite again cannot loop). Over a
--    cap it raises invite_limit (23514) and writes nothing. Inviting an email with a pending invite
--    again sends no email and is not counted. The 50-pending check stays and runs first.
-- 2. The invite-email function claims each send with claim_invite_email: the owner's pending,
--    unexpired invite, at most 3 emails per invite (company_invites.email_sends), else
--    invite_email_limit (23514). Emails a day are bounded by the invite caps times three.
-- 3. company_invites gets (company_id, created_at) for the company count; it also covers
--    company_invites_company_id_fkey, which only a partial index covered.
-- 4. 12 indexes go: another valid index on the same table leads with the same column(s), and every
--    foreign key keeps an index on its columns (all are (company_id, ...) composites). Checked in
--    the local and the production catalogs; none of the 12 had a production index scan.
-- 5. mcp_refused names invite_limit, so flow-mcp's invite_member says why it was refused.
begin;
set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- 4. Redundant indexes. Each line names the index that serves the same lookups.
drop index if exists public.invoice_match_dismissals_company_idx;  -- invoice_match_dismissals_bank_idx (company_id, bank_transaction_id)
drop index if exists public.invoice_paid_marks_company_idx;        -- invoice_paid_marks_company_id_transaction_id_fk_idx
drop index if exists public.invoice_payment_links_company_idx;     -- invoice_payment_links_company_id_bank_transaction_id_key
drop index if exists public.jev_line_failures_company_idx;         -- jev_line_failures_company_id_transaction_id_fk_idx
drop index if exists public.overhead_company_idx;                  -- overhead_company_id_transaction_id_fk_idx
drop index if exists public.split_rule_targets_company_idx;        -- split_rule_targets_company_id_project_id_fk_idx
drop index if exists public.split_rules_company_idx;               -- split_rules_company_id_id_key
drop index if exists public.split_rules_supplier_idx;              -- split_rules_company_id_supplier_id_fk_idx (the FK is (company_id, supplier_id))
drop index if exists public.loans_project_idx;                     -- loans_company_id_project_id_fk_idx (the FK is (company_id, project_id))
drop index if exists public.loans_escrow_category_idx;             -- loans_company_id_escrow_category_id_fk_idx (FK (company_id, escrow_category_id))
drop index if exists public.loans_fees_category_idx;               -- loans_company_id_fees_category_id_fk_idx (FK (company_id, fees_category_id))
drop index if exists public.loans_principal_category_idx;          -- loans_company_id_principal_category_id_fk_idx (FK (company_id, principal_category_id))

-- 2 and 3. The invite row counts its emails; the company count has an index.
alter table public.company_invites
  add column email_sends smallint not null default 0 check (email_sends between 0 and 3),
  add column emailed_at timestamptz;

create index company_invites_company_created_idx on public.company_invites (company_id, created_at);

-- 1. invite_member as in 20261013175142_team_members.sql, plus the two daily caps after the
-- 50-pending check.
create or replace function public.invite_member(p_email text, p_role text default 'viewer')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  clean text := lower(btrim(coalesce(p_email, '')));
  found_invite public.company_invites%rowtype;
begin
  cid := private.team_owner_company();
  if coalesce(p_role, '') not in ('editor', 'viewer') then
    raise exception 'validation';
  end if;
  if char_length(clean) not between 3 and 254
    or clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'invalid email';
  end if;
  -- One invite write at a time per company.
  perform pg_advisory_xact_lock(hashtextextended('company_invites:' || cid::text, 0));
  if exists (
    select 1 from auth.users u
    join public.companies c on c.owner_id = u.id
    where c.id = cid and lower(u.email) = clean
  ) or exists (
    select 1 from auth.users u
    join public.company_members m on m.user_id = u.id
    where m.company_id = cid and lower(u.email) = clean
  ) then
    raise exception 'already a member';
  end if;
  select * into found_invite
  from public.company_invites i
  where i.company_id = cid and i.email = clean and i.status = 'pending'
  for update;
  if found then
    if found_invite.role is distinct from p_role then
      update public.company_invites i set role = p_role where i.id = found_invite.id;
    end if;
    return jsonb_build_object(
      'id', found_invite.id, 'email', clean, 'role', p_role, 'status', 'pending', 'existing', true
    );
  end if;
  if (select count(*) from public.company_invites i where i.company_id = cid and i.status = 'pending') >= 50 then
    raise exception 'too many invites';
  end if;
  -- Decision 0195: 10 new invites per company and 20 per inviting user in any 24 hours. The
  -- company lock above serialises the company count; two companies of one user can each pass
  -- the user count at the same instant, at most one invite over.
  if (
    select count(*) from public.company_invites i
    where i.company_id = cid and i.created_at > now() - interval '24 hours'
  ) >= 10 or (
    select count(*) from public.company_invites i
    where i.invited_by = uid and i.created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'invite_limit' using errcode = '23514';
  end if;
  insert into public.company_invites (company_id, email, role, invited_by)
  values (cid, clean, p_role, uid)
  returning * into found_invite;
  return jsonb_build_object(
    'id', found_invite.id, 'email', clean, 'role', p_role, 'status', 'pending', 'existing', false
  );
end;
$$;

revoke all on function public.invite_member(text, text) from public, anon, authenticated;
grant execute on function public.invite_member(text, text) to authenticated, service_role;

-- 2. The invite-email function's claim on one send: the caller owns the company, the invite is
-- pending and unexpired, and it has had fewer than 3 emails.
create or replace function public.claim_invite_email(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  inv public.company_invites%rowtype;
begin
  cid := private.team_owner_company();
  select * into inv
  from public.company_invites i
  where i.id = p_invite_id and i.company_id = cid
  for update;
  if not found or inv.status <> 'pending' or inv.expires_at <= now() then
    raise exception 'invite not found';
  end if;
  if inv.email_sends >= 3 then
    raise exception 'invite_email_limit' using errcode = '23514';
  end if;
  update public.company_invites i
  set email_sends = i.email_sends + 1, emailed_at = now()
  where i.id = inv.id;
  return jsonb_build_object('id', inv.id, 'email_sends', inv.email_sends + 1);
end;
$$;

revoke all on function public.claim_invite_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_invite_email(uuid) to authenticated, service_role;

-- 5. flow-mcp's invite_member names the cap.
do $refused$
declare
  def text;
  anchor text := $a$'too many invites'$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
        -- FLOW-928 (decision 0195).
        'invite_limit'$n$);
end
$refused$;

commit;
