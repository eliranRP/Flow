-- FLOW-166: a per-user limit on flow-mcp's report route (the app's share button, FLOW-162). Rendering a
-- report costs about 0.1 to 0.4 s of CPU and three or four reads, so a user gets 10 files a minute, counted
-- in private.mcp_rate's per-minute windows under a bucket of its own. flow-mcp calls it with the secret key
-- before it builds the file; no client can.

alter table private.mcp_rate drop constraint mcp_rate_bucket_check;
alter table private.mcp_rate add constraint mcp_rate_bucket_check check (bucket in ('read', 'write', 'report'));

comment on table private.mcp_rate is
  'Per-minute counters. A token allows 60 reads and 20 writes. A user allows 120 reads, 40 writes and 10 report files.';

create or replace function public.bump_report_rate(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_hits integer;
  minute_start timestamptz := date_trunc('minute', clock_timestamp());
  retry integer;
begin
  if p_user is null then
    raise exception 'validation';
  end if;
  insert into private.mcp_rate (subject_id, subject_kind, bucket, window_start, hits)
  values (p_user, 'user', 'report', minute_start, 1)
  on conflict (subject_id, subject_kind, bucket, window_start)
  do update set hits = private.mcp_rate.hits + 1
  returning private.mcp_rate.hits into report_hits;
  retry := greatest(
    1,
    ceil(extract(epoch from (minute_start + interval '1 minute' - clock_timestamp())))::integer
  );
  if report_hits > 10 then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', retry);
  end if;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.bump_report_rate(uuid) from public, anon, authenticated;
grant execute on function public.bump_report_rate(uuid) to service_role;
