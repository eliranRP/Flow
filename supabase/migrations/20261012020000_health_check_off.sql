-- FLOW-802 is on hold (the owner chose "Not now"): drop private.health(), added by
-- 20261012010000_health_check.sql. That file stays because merged migrations are append-only.

begin;

drop function if exists private.health(timestamptz);

commit;
