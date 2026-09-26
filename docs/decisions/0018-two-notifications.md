# Two notifications

**Date:** 2026-09-26
**Status:** Accepted

## Context

A ping for every bank row will be switched off. The owner needs two reminders: how last week turned out, and that the review queue is waiting at the end of the day.

Times are `Asia/Jerusalem`. iPhone delivery depends on the Home Screen install in [0015](0015-installable-mobile-web-app.md).

## Decision

Exactly two notifications.

1. **Weekly summary.** Every Sunday at 08:00. Body: last week's profit, plus the single most important project alert (for example a project over budget, or a project losing money). Tap opens Home.
2. **Daily action nudge.** At 18:00, and only when at least one row is waiting for review. At most once a day. Body: the waiting count and an estimated number of minutes. Tap opens Review.

No notification per transaction.

Last week, for the Sunday 08:00 send, is the seven days that just ended: the previous Sunday 00:00 through Saturday 23:59.

## Alternatives rejected

Per-transaction notifications. Any third recurring notification in this phase.

## Consequences

If the review queue is empty at 18:00, nothing is sent that day. Auto-approved rows do not trigger a nudge. Which project wins when several are losing money and several are over budget is [open](../open-questions.md#which-project-alert-is-the-weekly-one). How the minute estimate is calculated is [open](../open-questions.md#estimated-minutes-on-the-daily-nudge). The notification list itself is not a settings screen in this decision; enabling notifications is part of onboarding.
