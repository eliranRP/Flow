# Back returns to the previous screen, and אישור accepts the suggestion

**Date:** 2026-09-29
**Status:** Accepted

## Context

Eliran opened an expense from a project on the live app and the back control landed on Home. The control was a link to a fixed parent, so it disagreed with iOS swipe-back. On לאישור, חומרי בניין השרון (22,000 ₪, 12/04/2026) showed only the project שיפוץ דירה ביאליק 8 חולון. SUMIT's budget section maps to a Flow project and has no Flow category. The importer copied a remembered supplier category and otherwise left the expense null, so אישור toasted and asked for שינוי.

The r17 review also left six nits: the companies UPDATE grant was wider than the screens write, the connect test read the function source, the runbook described document creates as the default live check, the `reassign_undo` pgTAP only checked catalogue flags, a network failure used the bad-key sentence, and the 29 September notes sat under 28 September.

## Decision

1. One back control, `app/src/ui/back.tsx`, is the only back affordance. When React Router's history index is above zero it pops, which is the same entry as the browser back button and the iOS swipe. A fresh visit replaces itself with the logical parent: a transaction's project, otherwise the project list, otherwise Home. Period, scroll, and the tab stay with that entry. Sheets that are not routes push one history entry so a swipe closes the sheet.
2. The review card shows the suggested project and the suggested category as two short rows under הצעה. It does not show a confidence number. This amends the percent sentence in [0061](0061-review-undo.md).
3. אישור accepts those two values in one tap and passes `p_remember: false`. The change sheet still writes the supplier rule when remember is on. This amends the review sentence in [0065](0065-review-round5.md).
4. Before insert or update, a transaction with no category takes the supplier's remembered category, then the mode of that supplier's assigned history, then the default category for the direction. A rule match is the assignment and skips the queue, as in [0011](0011-auto-approve-high-confidence.md). History and the default stay a suggestion (`category_suggested`) and remain in the queue until the owner taps אישור. An unsplit shared cost is still `unallocated_shared`. When no category can be chosen, the card says "אין הצעה, בחרו בשינוי" and אישור is disabled.
5. `authenticated` may update `name`, `tax_id`, `vat_rate_bp`, `vat_registered`, `after_overhead`, and `updated_at` on `companies`. `id`, `owner_id`, `created_at`, `is_demo`, and `last_sumit_company_id` stay revoked.
6. A rejected key still says "החיבור נכשל. בדקו את המזהה ואת המפתח." A network or server failure says "לא הצלחנו להתחבר. נסו שוב."
7. The default live check does not create SUMIT documents. Creates stay behind `SUMIT_CREATE_DOCUMENTS=1`.
8. A toast sits under the page header, below the safe area, and never over the bottom actions. The host is `pointer-events: none`; only the toast itself takes a tap. A confirmation leaves after about 2.5 seconds, an error after about 4. A tap or a swipe dismisses it, and a new toast replaces the one on screen. Hover with a pointer still pauses the timer. This amends the "above the tab bar" and 4-second sentences in the implementation guide, and the sheet-padding sentence in [0067](0067-review-round8.md) point 8. On לאישור, skip and approve move the card out and advance `{i} מתוך {n}` for this visit. The toast is only the words.
9. The Home hero is calm and self-explanatory. It holds one plain label, the big number, and one explanation, for example "הכנסות פחות הוצאות, מ־1 בינואר עד היום". The period pill is the only other control on the band, on the same start edge as the label. The greeting is gone. The Flow wordmark is gone from Home; sign-in keeps it. Income and expenses leave the band and sit below as two rows, "נכנס" and "יצא", a section apart from the band and with space between the rows. When the period is החודש, the label says so ("רווח נקי החודש"). A negative figure says "הפסד" in that same label. The number stays white, including the minus, because red on the violet band does not read. The comparison pill moves under the two rows. This amends the Home greeting in [0045](0045-phase-0-design-gaps.md) and the band contents in the design rules. The Home loading band matches this shape, which amends the ".ui-skel-stack" sentence in [0068](0068-review-round9.md).

## Alternatives rejected

A per-screen back link. Auto-approving the default category, which would hide a guess the owner has not confirmed. Showing the confidence percent on a rule that is not an AI score. Leaving אישור enabled so it can toast. Granting UPDATE on the whole companies row. Leaving the toast above the tab bar, where it covers דלג. Stacking toasts. Keeping the greeting, the wordmark, and the income line inside the violet band. Painting a loss red on that band.

## Consequences

Existing expenses with a null category are filled by the same trigger, and an open review row keeps its reason. The card can show both names, and one tap approves them without teaching the supplier. A later change-sheet save with remember on is what writes the rule. Install dismiss uses this same history index, which amends [0068](0068-review-round9.md) point 9. Home no longer greets by name. The owner reads the period in the label and the formula in the line under the number.
