-- FLOW-513 (server part). An invite expires 7 days after it is sent. The invitee sees it once
-- on their first sign-in (seen_at); it then waits in החלפת עסק. my_invites also returns the
-- invites that expired in the last 14 days, with status 'expired', so the screen can say so.

alter table public.company_invites
  add column expires_at timestamptz not null default (now() + interval '7 days'),
  add column seen_at timestamptz;

update public.company_invites set expires_at = created_at + interval '7 days';

-- The invitee's inbox: their pending invites, and the ones that expired in the last 14 days.
create or replace function public.my_invites()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'company_id', i.company_id,
      'company_name', c.name,
      'email', i.email,
      'role', i.role,
      'status', case when i.expires_at <= now() then 'expired' else i.status end,
      'invited_by_name', private.user_display_name(i.invited_by),
      'invited_by_role', private.company_role(i.company_id, i.invited_by),
      'created_at', i.created_at,
      'expires_at', i.expires_at,
      'seen_at', i.seen_at
    )
    order by i.created_at desc, i.id
  ), '[]'::jsonb)
  from public.company_invites i
  join public.companies c on c.id = i.company_id
  where i.status = 'pending'
    and i.expires_at > now() - interval '14 days'
    and i.email = private.my_confirmed_email()
    and private.company_role(i.company_id, (select auth.uid())) is null;
$$;

-- Join: an expired invite cannot be accepted.
create or replace function public.accept_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.company_invites%rowtype;
  my_role text;
begin
  inv := private.my_invite_for_update(p_invite_id);
  if inv.status <> 'pending' then
    raise exception 'invite is not pending';
  end if;
  if inv.expires_at <= now() then
    raise exception 'invite expired';
  end if;
  my_role := private.company_role(inv.company_id, uid);
  if my_role is null then
    insert into public.company_members (company_id, user_id, role, invited_by)
    values (inv.company_id, uid, inv.role, inv.invited_by);
    my_role := inv.role;
  end if;
  update public.company_invites i
  set status = 'accepted', decided_by = uid, decided_at = now()
  where i.id = inv.id;
  insert into public.active_companies (user_id, company_id)
  values (uid, inv.company_id)
  on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  return jsonb_build_object(
    'id', inv.id,
    'company_id', inv.company_id,
    'name', (select c.name from public.companies c where c.id = inv.company_id),
    'role', my_role
  );
end;
$$;

-- The invitee has seen the invite. Idempotent: the first time stays.
create or replace function public.mark_invite_seen(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.company_invites%rowtype;
begin
  inv := private.my_invite_for_update(p_invite_id);
  update public.company_invites i
  set seen_at = coalesce(i.seen_at, now())
  where i.id = inv.id;
  return jsonb_build_object(
    'id', inv.id,
    'seen_at', (select i.seen_at from public.company_invites i where i.id = inv.id)
  );
end;
$$;

revoke all on function public.mark_invite_seen(uuid) from public, anon;
grant execute on function public.mark_invite_seen(uuid) to authenticated, service_role;
