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

## Alternatives rejected

A per-screen back link. Auto-approving the default category, which would hide a guess the owner has not confirmed. Showing the confidence percent on a rule that is not an AI score. Leaving אישור enabled so it can toast. Granting UPDATE on the whole companies row.

## Consequences

Existing expenses with a null category are filled by the same trigger, and an open review row keeps its reason. The card can show both names, and one tap approves them without teaching the supplier. A later change-sheet save with remember on is what writes the rule. Install dismiss uses this same history index, which amends [0068](0068-review-round9.md) point 9.
