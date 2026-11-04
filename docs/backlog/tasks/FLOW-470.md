<a id="flow-470"></a>
# FLOW-470 · Using the land from the books can be undone, and is the row's one action
- **Type:** SMALL UI · **Status:** done (#964) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-461 (#939).
- **Files:** `app/src/screens/project-investment-screen.tsx` (`saveLand`), `project-investment-cards.tsx`.

- [x] "השתמש" writes the land (it drives the tax savings) with a toast and no undo, while every other figure's save has ביטול. Add the undo (set the prior land account back). Rule: feedback-and-states § 10.
- [x] Three accent actions for one input (the row's הוספה, the card's הוספה, השתמש): while a suggestion shows, it is the row's one action. Rule: hierarchy-and-actions § 1.

**Acceptance:** the land-suggestion story has one accent action; the unit test shows ביטול restoring the prior land.

**Done (2026-11-04):** ביטול calls `set_land_account` with the call's `prior` (none before a suggestion). The land row reads "לא הוזן" while the suggestion shows; the total card's חיסכון מס says "חסר · שווי הקרקע" with no הוספה.
