-- ===========================================================================
-- 99 drop. The legacy write model goes; nothing may still name it.
-- ===========================================================================

drop trigger if exists legs_txn_ins_legacy on public.transactions;
drop table public.line_splits;
drop table public.loan_splits;
drop view private.pnl_lines_legacy;
drop function private.ledger_pnl_diff(uuid);
drop function private.rebuild_legs_many(uuid, uuid[]);
drop function private.legs_sync_child_new();
drop function private.legs_sync_child_old();
drop function private.line_splits_exclusive();
drop function private.loan_splits_match();
drop function private.loan_splits_check(uuid);
drop function private.loan_splits_closed_check();
drop function private.line_splits_review();

do $scan$
declare
  left_over text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into left_over
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prosrc ~ '\m(line_splits|loan_splits|pnl_lines_legacy|rebuild_legs_many|ledger_pnl_diff|loan_splits_check)\M';
  if left_over is not null then
    raise exception 'ledger-only: still names the legacy model: %', left_over;
  end if;
end
$scan$;
