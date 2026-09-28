# The Sunday alert is the largest loss, and the nudge is one minute per item

**Date:** 2026-09-28
**Status:** Accepted

## Context

[0018](0018-two-notifications.md) left open which project is mentioned, and how the minute estimate is calculated.

## Decision

Sunday 08:00 Israel time queues one weekly row. The project named is the one with the most negative profit in the previous Sunday–Saturday window. If none lost money, the body has no project. The 18:00 nudge is queued only when the review queue is open, including Sunday, and not on Saturday. The minute estimate is the number of open items.

Delivery is Web Push with VAPID keys in the Edge Function. There is no paid push gateway. Rows stay pending until `push-send` runs. Without the VAPID secrets the function sends nothing and leaves the rows pending.

## Consequences

`dispatch_notifications` is not granted to the browser. The hourly cron calls it when `pg_cron` exists. Otherwise the operator POSTs `push-send` with `CRON_SECRET`.
