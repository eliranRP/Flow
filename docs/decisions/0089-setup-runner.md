# First-run setup runner

**Date:** 2026-10-04
**Status:** Accepted
**Amended by:** [0111](0111-setup-card-close.md). Point 3: the Home card closes with a ✕ "סגירת ההגדרה" instead of הסתרה, the toast is "ההגדרה לא תופיע שוב. אפשר לחזור אליה מההגדרות.", and closing the card also stops the one automatic resume. [0162](0162-setup-state-on-the-server.md): point 5, the flags also live on the server in `setup_states`.

## Context

A new account needs a company before SUMIT, Jev, or the books can be saved ([0047](0047-onboarding-and-period.md)). The first-run design is one uncounted company step and five counted steps. Done comes from the data that already exists. A skip must survive a later visit, and a viewer must never see the run ([company viewers](0082-settings-redesign.md) stays the owner check).

## Decision

1. `/setup/0` is פרטי העסק. It has no דלג and no "מתוך 5". `/setup/1` … `/setup/5` are the counted steps. The counter is שלב N מתוך 5, and N is the step id.
2. דלג stores a timestamp and moves on. It does not write SUMIT, Jev, or a confirm flag, so the step stays not done and stays on the Home card.
3. The Home card lists only the remaining steps. N is how many of the five are done. הסתרה sets `card_dismissed_at` and toasts "ההגדרה זמינה בהגדרות." with ביטול. Those Home toasts sit above the tab bar. When SUMIT was skipped and Home is still the empty screen, the card hides its SUMIT row. The empty screen keeps חיבור SUMIT.
4. A company with `run_started_at` unset opens the first not-done step and stamps the start. The next launch resumes once at the first step that is neither done nor skipped, then only the card remains. An account that already finished all five does not start a run. No company opens step 0 every time. A viewer is redirected away from `/setup`.
5. The stored shape is the design jsonb, plus `completed_toast_at` so "ההגדרה הושלמה." fires once. v1 keeps it in `localStorage` under `flow.setup.<user>.<company>`. There is no per-user jsonb column, and the migration slot is held. A server column can replace this key later without changing the shape.
6. Notifications are not a step and do not change "מתוך 5". Mercury stays hidden. The demo stage is an empty slot.

## Alternatives rejected

- A new table in this pull request. The migration slot is taken, and the flags are not ledger data.
- Counting step 0 inside "מתוך 5". A company is a precondition, not one of the five setup tasks.
- Treating a skip as done. The card would hide a step the user never confirmed.

## Consequences

Settings › עוד › הגדרה ראשונה reopens the next remaining step after the card is hidden, and disappears at 5 of 5. Step screens that call SUMIT, the sample review, and the install prompt land in the follow-up. iOS 26 Hebrew Safari labels still need a check on a real device. Drawings use `location.host`.
