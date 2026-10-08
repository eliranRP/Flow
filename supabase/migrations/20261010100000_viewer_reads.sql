-- FLOW-507 / FLOW-315 (viewer reads). 20261004010000_company_viewers.sql let a demo viewer read
-- the screens' RPCs through private.readable_company_id(). Later redefinitions put
-- private.current_company_id() back, so a viewer got an empty review queue, transaction, bank
-- details, category list, project category, waiting list and search. Each read below scopes to
-- the readable company again; writes stay on current_company_id(). The owner reads as before,
-- since readable_company_id() is the owner's company first. supabase/tests/database/
-- viewer_reads.test.sql fails when a later redefinition drops it again.
-- The audit log is the owner's: a viewer no longer reads the demo company's audit log.
-- FLOW-315: get_line_meta re-checks card_last4 as 4 digits on read, and mask_long_digits also
-- masks a long number written with spaces or dashes (9 or more digits; a date or a phone
-- number stays), keeping the last 4.
-- FLOW-205: private.mcp_batches rows are deleted with their token.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

do $reads$
declare
  name text;
  def text;
begin
  foreach name in array array[
    'public.list_review()',
    'public.list_skipped_review()',
    'public.get_transaction(uuid)',
    'public.get_line_meta(uuid[])',
    'public.list_categories()',
    'public.list_project_category(uuid,uuid,integer,integer,date,date)',
    'public.project_waiting(uuid)',
    'public.search_transactions(text,text,integer,integer)'
  ]
  loop
    def := pg_get_functiondef(name::regprocedure);
    if position('private.current_company_id()' in def) = 0 then
      raise exception 'expected current_company_id in %', name;
    end if;
    execute replace(def, 'private.current_company_id()', 'private.readable_company_id()');
  end loop;

  def := pg_get_functiondef('public.get_line_meta(uuid[])'::regprocedure);
  if position($old$'card_last4', t.provider_meta->>'card_last4',$old$ in def) = 0 then
    raise exception 'get_line_meta card_last4 was not found';
  end if;
  execute replace(
    def,
    $old$'card_last4', t.provider_meta->>'card_last4',$old$,
    $new$'card_last4', case when t.provider_meta->>'card_last4' ~ '^[0-9]{4}$' then t.provider_meta->>'card_last4' end,$new$
  );
end
$reads$;

create or replace function private.mask_long_digits(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- A run of 9 or more digits with single spaces or dashes between them first, then any
  -- unbroken run of 5 or more. Each keeps its last 4 digits.
  select regexp_replace(
    regexp_replace(
      p_text,
      '[0-9](?:[ -]?[0-9]){4,}[ -]?([0-9])[ -]?([0-9])[ -]?([0-9])[ -]?([0-9])',
      '••\1\2\3\4',
      'g'
    ),
    '[0-9]+([0-9]{4})',
    '••\1',
    'g'
  );
$$;

drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (company_id = (select private.current_company_id()));

-- FLOW-205: a batch row follows its token, like the other MCP tables that point at a credential.
alter table private.mcp_batches
  drop constraint mcp_batches_token_id_fkey,
  add constraint mcp_batches_token_id_fkey
    foreign key (token_id) references private.mcp_credentials (id) on delete cascade;

commit;
