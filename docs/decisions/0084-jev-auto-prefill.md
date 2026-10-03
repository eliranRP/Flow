# Jev auto pre-fills and still waits for one tap

**Date:** 2026-10-03
**Status:** Accepted

## Context

[0083](0083-jev-connector.md) stores `mode` and `threshold` and leaves what `auto` does to the tagging job. [0011](0011-auto-approve-high-confidence.md) auto-approves an invoice match or a supplier rule. A Jev score is not that.

## Decision

The tagging job calls Jev only for an open לאישור expense that has no `tag_suggestions` row for the pinned model. A company with no `company_integrations` row, or `enabled` false, is off. The job does not call Jev.

`shadow` stores the suggestion and does not change the expense. The review stays open.

`auto` stores the suggestion. Confidence is the lower of the project answer and the category answer for the questions that were asked. A missing or unusable answer counts as 0. When that confidence is at or above the company's threshold, the job pre-fills a project and a category the user has not set, marks the fill as a suggestion, and leaves the item in לאישור. Below the threshold it only stores the suggestion.

A suggestion never approves a line. The job does not call `resolve_review` and does not set the review row to approved.

The user owns a project when `user_assigned` or `project_assigned` is set, and owns a category when `user_assigned` or `category_assigned` is set. Those fields are left as they are. A shared cost, an overhead line, or a split with more than one allocation does not receive a single project. A pre-filled category sets `category_suggested`. A pre-filled project leaves `project_assigned` and `user_assigned` false, so `list_review` still reports `project_suggested`. Amounts, VAT, and dates are not written. The model may see them in the request state.

The choice keys are the company's active project ids and its visible expense category ids. A key that is not one of those is not written. More than 255 options omits that question. The job does not ask Jev to apply overhead or an anomaly score.

## Alternatives rejected

Approving the line when confidence is high. Treating `auto` as [0011](0011-auto-approve-high-confidence.md). Overwriting a project or category the user already set. Gating each field on its own confidence, which would pre-fill one field while the other answer was weak.

## Consequences

The card can show the pre-fill as הצעה, and אישור sends that project and category. The job is not scheduled. A `pg_cron` row would be a migration, and this change does not add one. The next SUMIT sync can replace a pre-fill the user has not accepted, because `project_assigned` and `category_assigned` stay false. The suggestion row remains.

## Decisions needed

Whether an unaccepted Jev pre-fill should survive the next SUMIT sync. Keeping it would mean the sync treats that pre-fill as owned, which is a migration.
