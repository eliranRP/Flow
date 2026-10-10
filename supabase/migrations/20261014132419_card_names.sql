-- FLOW-707: the nickname the owner gave each card in the bank. mercury-sync stores the card
-- list as connector_connections.card_labels, [{last4, label}], beside account_labels. A line keeps
-- only its card's last 4, so get_line_meta resolves card_name from that list at read time, and a
-- line synced before this change gets its card's name too. The sync leaves out a last 4 that two
-- cards with different nicknames share. No other card field is stored.
-- Like account, card_name reads as null for a demo viewer: the connection's RLS is the owner's.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

alter table public.connector_connections
  add column card_labels jsonb not null default '[]'::jsonb;

grant select (card_labels) on public.connector_connections to authenticated;

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.get_line_meta(uuid[])'::regprocedure);
  anchor := $a$'card_last4', case when t.provider_meta->>'card_last4' ~ '^[0-9]{4}$' then t.provider_meta->>'card_last4' end,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_line_meta card_last4 anchor was not found once';
  end if;
  execute replace(def, anchor, anchor || $new$
    'card_name', case when t.provider_meta->>'card_last4' ~ '^[0-9]{4}$' then (
      select nullif(btrim(private.mask_long_digits(card.value->>'label')), '')
      from public.connector_connections cc
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(cc.card_labels) = 'array' then cc.card_labels else '[]'::jsonb end
      ) as card(value)
      where cc.company_id = t.company_id
        and cc.provider::text = t.source::text
        and card.value->>'last4' = t.provider_meta->>'card_last4'
      limit 1
    ) end,$new$);
end
$patch$;

commit;
