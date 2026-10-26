<a id="flow-960"></a>
# FLOW-960 · Review v2: the UX/UI rules review of לאישור
- **Type:** UI (design approved) · **Status:** in-progress (#820) · **Depends on:** — · **Source:** a review of לאישור against a UX/UI rule set. The owner approved the design on 2026-10-26, with the missing mark drawn as an icon; on cards the same day: after a pick from the missing path the card comes back (no auto-approve), the toasts sit under the header (superseding [0137](../../decisions/0137-review-toast-above-bar.md) for לאישור), the undo stays 5s and a failed approve stays until it is acted on, on לאישור only. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", boards Review v2, no project yet, approve failed, a long queue.
- **Files:** `app/src/screens/review-queue.tsx`, `app/src/screens/review-screen.tsx`, `app/src/ui/review-card.tsx`, `app/src/ui/toast.tsx`, `app/src/ui/toast-layout.tsx`, the visit meter, the review CSS under `app/src/ui/css/`, their stories and tests, a decision record, a design log entry.

- [ ] אישור is never a dead button: with no project (or no category) a tap opens the picker, which says "בוחרים פרויקט, ואז אפשר לאשר"; after a pick the card comes back with the field filled. The hint under the bar reads "חסר פרויקט · אישור יפתח את הבחירה" in the warning tone. It is disabled only while the card settles (under a second).
- [ ] The missing project row carries an alert icon before "חסר" and a warning outline on the box, not only a colour.
- [ ] Jev's reason heads the project and category box, so the why is read before the choice.
- [x] The card's text uses the type tokens only: already so in the app (the 11px tags were the board's own).
- [ ] Above 12 items the visit meter is one continuous bar, with its value for screen readers.
- [ ] In כל הפריטים, "חסר פרויקט" carries the warning icon and tone.
- [ ] The project picker shows its search from 10 options.
- [ ] On לאישור every toast sits under the header. The approve and skip undo stay 5s; a failed approve stays until ניסיון חוזר or a dismiss.
- **Acceptance:** stories of the card (missing project, a long queue, the failure toast) at 320 and 393; tests for the approve path with no project, the meter above 12, the toast place and times; decision record; design log entry.
