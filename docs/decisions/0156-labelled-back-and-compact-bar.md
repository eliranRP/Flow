# A labelled Back in place of the kicker, and a compact bar on long pages

**Date:** 2026-10-09
**Status:** Accepted (owner picks on FLOW-334, 2026-10-08: "H1 sticky bar, H2 labelled Back")

## Context

Cycle 4 of the mobile UI/UX review (deploy 6b3a05e) found two header problems after the stacked `ScreenHeader` (FLOW-326, mockups 07 and 14).

- **H1:** `header.ui-page` is static. On long pushed lists (שויכו היום runs 2.8 to 4.3 screens, and the breakdown lines, the category lines and the review list are long too), Back scrolls off, and the only way out is scrolling back up.
- **H2:** Back is a lone 44x44 icon in the top start corner, about 520px above a resting thumb. The kicker under it ("הגדרות") repeats where Back goes.

## Decision

- **A labelled Back (H2).** When a header has Back and a kicker, the kicker becomes Back's label: "‹ הגדרות", "‹ שיפוץ הרצל 12". The kicker line is gone. The label is `label` type in `accent-text`, cut with an ellipsis at about 16 characters. The arrow sits where the icon Back's arrow sits, and the whole button is the target, at least 44px high. Its name for screen readers is "חזרה ל" plus the label. A header with Back and no kicker keeps the icon Back. A screen's own leading control (the transaction, Split) is never labelled. Settings sub-screens (קטגוריות, חיבורים, הלוואות, התראות) and the project's "לפי חודש" use it.
- **A compact bar (H1).** On a stacked page with Back, once the large title has scrolled up under the top, a bar pins to the top under the safe area: 44px high, with Back and the title in `title-3`, one line with an ellipsis. It has a 1px `line` hairline and the page background, and it fades in over 120ms (no fade with reduced motion). It goes when the title comes back. Like iOS large titles, the bar's title is an echo for sighted users; the page's h1 stays the only heading. Month heads pin under the bar while it shows. The start-edge swipe (FLOW-332) stays with the page's own Back. Inline headers, tab roots and screens with their own leading control have no bar.

This changes the mockups 07 and 14 header rule (Back, then the kicker, then the title) to Back with its label, then the title.

## Alternatives rejected

- A sticky header that is always the full stacked header: it takes about a quarter of a 667px screen.
- Showing the compact bar from the start: it doubles the Back on a short page.
- Keeping the kicker and adding a label: the same word twice, one line apart.

## Consequences

A long parent name is cut, so the label is a hint and the title stays the place where a name is read in full. A new stacked screen gets the compact bar without asking for it; a screen that must not have it uses `layout="inline"` or its own leading control.
