# Jev auto pre-fills and still waits for one tap

**Date:** 2026-10-03
**Status:** Accepted

## Context

[0083](0083-jev-connector.md) stores `mode` and `threshold` and leaves what `auto` does to the tagging job. [0011](0011-auto-approve-high-confidence.md) auto-approves an invoice match or a supplier rule. A Jev score is not that.

## Decision

The tagging job calls Jev only for an open לאישור expense that has no `tag_suggestions` row for the pinned model. A company with no `company_integrations` row is off. `enabled` false disables the connector, and `mode` `off` disables it too. Either one is enough. The job does not call Jev for that company.

`shadow` stores the suggestion and does not change the expense. The review stays open.

`auto` stores the suggestion. Confidence is the lower of the project answer and the category answer for the questions that were asked. A missing or unusable answer counts as 0. When that confidence is at or above the company's threshold, the job pre-fills a project and a category the user has not set, marks the fill as a suggestion, and leaves the item in לאישור. Below the threshold it only stores the suggestion.

A suggestion never approves a line. The job does not call `resolve_review` and does not set the review row to approved.

The user owns a project when `user_assigned` or `project_assigned` is set, and owns a category when `user_assigned` or `category_assigned` is set. Those fields are left as they are. A shared cost, an overhead line, or a split with more than one allocation does not receive a single project. The job does not ask Jev for a project on those lines and does not store a project suggestion. A pre-filled category sets `category_suggested`. A pre-filled project leaves `project_assigned` and `user_assigned` false, so `list_review` still reports `project_suggested`. Amounts, VAT, and dates are not written. The model may see them in the request state.

The choice keys are the company's active project ids and its visible expense category ids. A key that is not one of those is not written. More than 255 options omits that question. The job does not ask Jev to apply overhead or an anomaly score.

`model_version` is the pin the client sent. `response_model` is the model string in the response, including when it is not the pin.

The function accepts only the `CRON_SECRET` header `x-flow-cron` or a bearer token equal to the service-role key. A member JWT is refused and does not call Jev. One accepted run per isolate per 60 seconds; the next returns 429 and does not call Jev. An expense whose company is not the company being labelled is not sent and is not stored.

## Alternatives rejected

Approving the line when confidence is high. Treating `auto` as [0011](0011-auto-approve-high-confidence.md). Overwriting a project or category the user already set. Gating each field on its own confidence, which would pre-fill one field while the other answer was weak.

## Consequences

<<<<<<< HEAD
The card shows a stored suggestion as הצעה when the connector is on, and אישור sends that project and category in one tap. A stored supplier rule stays, including when `user_assigned` and the field flag are both false. With the connector off, or with no suggestion, the card is unchanged. A confirm or fix row in `corrections` is a follow-up (superseded in part by [0126](0126-jev-outcomes.md), which records outcomes in the database and removes the pending file). The job is not scheduled. A `pg_cron` row would be a migration, and this change does not add one. The next SUMIT sync can replace a pre-fill the user has not accepted, because `project_assigned` and `category_assigned` stay false. The suggestion row remains.
=======
The card shows a stored suggestion as הצעה when the connector is on (amended 2026-10-08: a field whose value is Jev's answer reads "✦ הצעת Jev"), and אישור sends that project and category in one tap. A stored supplier rule stays, including when `user_assigned` and the field flag are both false. With the connector off, or with no suggestion, the card is unchanged. A confirm or fix row in `corrections` is a follow-up. `supabase/pending/20261005120000_jev_corrections.sql` is not applied, and the app does not call it. The migration slot is taken by `20261003180000`. Move this file after that timestamp once the slot is free. The job is not scheduled. A `pg_cron` row would be a migration, and this change does not add one. The next SUMIT sync can replace a pre-fill the user has not accepted, because `project_assigned` and `category_assigned` stay false. The suggestion row remains.
>>>>>>> origin/main

`mode` `auto` is implemented here and covered by the mock. The released connector migration still refuses to store `auto`. The follow-up SQL is `supabase/pending/20261004120000_jev_auto_mode.sql`. It is not in `supabase/migrations.lock` and it is not applied. It waits until the migration slot is free.

## Decisions needed

Whether an unaccepted Jev pre-fill should survive the next SUMIT sync. Keeping it would mean the sync treats that pre-fill as owned, which is a migration.
