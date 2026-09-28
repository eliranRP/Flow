# Library review calls where the pack is silent

**Date:** 2026-09-28
**Status:** Accepted

## Context

The component-library review (r1, against `b5e80be`) listed gaps that have no mockup. [0059](0059-live-sumit-only.md) was already accepted for the live SUMIT rule, so these calls are 0060. The review's Blocking, Should-fix, and duplication items are implemented against the implementation guide. These five calls cover only the gaps the pack does not decide.

## Decision

1. Avatar and the generic bordered Card are removed. Screens use the existing band, rows, sheets, and plain sections.
2. A supplier line is a `ListRow` with a secondary line. There is no supplier component.
3. An over-budget bar fills to 100% in `--color-bad`. The overage is a text line under the bar in that same colour. There is no second bar component.
4. The cash/invoiced control is removed. The proof of concept shows the invoiced basis only, which is the basis of the golden check (net profit 37,700, open receivables 134,520). This amends the basis switch in [0047](0047-onboarding-and-period.md). כל התקופה stays, because that record and the golden check need it. On that invoiced basis, open invoices count in profit. [0063](0063-owner-ledger.md) drops the line "לא נכלל ברווח". A hint, when one is needed, says "טרם נגבה".
5. Hover exists only inside `@media (hover: hover)`. It is a background tint from `--color-tint`, with no change to size or position.

The Add sheet on this proof of concept is the [0045](0045-phase-0-design-gaps.md) sheet: title "הוספה" and the hint "בקרוב תוכלו להוסיף כאן הכנסה או הוצאה".

## Alternatives rejected

Keeping Avatar and Card until a later screen needs them. The review found no use, and a second container next to Banner and Notice is the duplication the library rule forbids.

Drawing a cash basis beside the invoiced one. The golden check is invoiced, and the control has no mockup.

A hover that shifts padding or colour on touch devices. The pack is a phone, and a pressed state already covers the finger.

## Consequences

Home, Projects, and Unpaid still read the live SUMIT ledger. Home defaults to this month on the invoiced basis. כל התקופה is how the golden 37,700 is reached. Storybook screen stories render the route components. A books story may pass data into those components. It does not import `expected-pnl.json`, and the production bundle does not import the story.
