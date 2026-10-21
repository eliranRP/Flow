# A new company starts with Jev on, in auto, at 90%

**Date:** 2026-10-21
**Status:** Accepted (owner request 2026-10-21, FLOW-940)
**Amends:** [0083](0083-jev-connector.md) (the connector is off unless a member turns it on)

## Context

[0083](0083-jev-connector.md) left Jev off until a member turned it on: a company with no `company_integrations` row is off, and the setup's Jev step saved `shadow` when its switch stayed on. Auto mode is safe to turn on since [0145](0145-jev-auto-mode.md): it never approves a line ([0084](0084-jev-auto-prefill.md)), it skips a line SQL flags, every fill has an audit row and one-tap undo, and a company's calls stop at its daily cap ([0124](0124-jev-after-sync.md), 200 by default). The owner asked that every new company start the way their own does: Settings › עוזרים › תיוג חכם on, מצב מילוי אוטומטי, סף ביטחון 90%.

## Decision

`create_company` writes the new company's Jev row in the same transaction: `enabled` true, `mode` `auto`, `threshold` 0.90, the default `daily_call_cap`. It is `on conflict do nothing`, so it never overwrites a row. It is the only way a user makes a company (the direct insert was revoked in `20261004020000`), so the default lives there rather than in a trigger on `companies`: a trigger would also fire for service-role and fixture inserts (seed data, pgTAP fixtures) that mean "a company with no row".

Companies made before this change are not touched. A company with no row is still off, and a saved row keeps its values. The column defaults stay `enabled` false and `mode` `shadow`.

The setup's Jev step (step 5) saves `auto` at 90% when its switch stays on, and `off` when the owner turns it off, so walking through setup keeps the new default instead of moving it to `shadow`. Because the row exists from the start, the step counts as done; the done card reads the stored row when the step did not save, so a skipped step on a new company says פעיל.

The owner can still turn Jev off or to הצעות בלבד at any time (Settings, `set_company_integration`, MCP `set_jev_mode`). No new MCP tool: this is a default, not a user action ([0095](0095-mcp-first.md)).

## Alternatives rejected

- An `AFTER INSERT` trigger on `companies`, like the starter categories: it would give every fixture and seeded company a row, changing what "no row" means in tests and demo data.
- Changing the column defaults to `true` and `auto`: they also apply to `set_company_integration`'s first save and to any other insert, and do not by themselves create a row.
- Backfilling existing companies: the owner asked for new companies only.

## Consequences

- A new company's open lines are tagged and, at 90% or more, pre-filled from its first bank sync, newest first, within the daily cap. There is no "since" date: the first sync's older open lines are labelled too, as they would be for an owner who turns Jev on later. Each fill still waits in לאישור and can be undone.
- With no Jev key on the server Jev is never called (the cron still wakes the tagging function, which stops at the missing key), and the Settings row locks off with "צריך מפתח Jev" (FLOW-704), as before.
- The table comment on `company_integrations` says so.
