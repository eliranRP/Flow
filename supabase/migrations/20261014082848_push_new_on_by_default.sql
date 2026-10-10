-- FLOW-502: saying yes to the notifications card also turns on תנועה חדשה (owner's pick, 2026-10-10).
-- Before this a user who allowed notifications got only the evening reminder, and no push for a
-- new bank line until they found the switch in Settings. Only the first yes does this: a user who
-- later turns the switch off keeps it off, and the count starts from now, so old lines never arrive
-- as new. One transaction: begin is first, commit is last.

begin;

set local lock_timeout = '5s';

create or replace function public.answer_push_prompt(p_yes boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.push_user();
begin
  if p_yes is null then
    raise exception 'answer is required' using errcode = '22023';
  end if;
  insert into public.notification_prefs (user_id, new_transaction, evening_reminder, prompt_answered_at, new_line_mark)
  values (uid, p_yes, p_yes, pg_catalog.now(), case when p_yes then pg_catalog.now() end)
  on conflict (user_id) do update
  set new_transaction = public.notification_prefs.new_transaction
        or (p_yes and public.notification_prefs.prompt_answered_at is null),
      new_line_mark = case
        when p_yes and public.notification_prefs.prompt_answered_at is null
          and not public.notification_prefs.new_transaction then pg_catalog.now()
        else public.notification_prefs.new_line_mark
      end,
      prompt_answered_at = pg_catalog.now(),
      evening_reminder = public.notification_prefs.evening_reminder or p_yes;
  return private.notification_prefs_json(uid);
end;
$$;

commit;
