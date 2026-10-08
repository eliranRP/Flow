# Swipe the band figure to step the period; "לפי חודש" is the whole project

**Date:** 2026-10-08
**Status:** Accepted (owner picks on the FLOW-336 and FLOW-337 cards, 2026-10-08: "add the swipe on the band figure; the arrows stay" and "the page always lists every month since the project started")

## Context

Cycle 5 of the UI/UX review found that the period bar sits in the top third of Home and of the project band, so stepping a month from Home's default takes two taps at the top edge, about 550px above a resting thumb (FLOW-336). It also found that "לפי חודש" followed the project's period, so at the default 3 חודשים it listed three months with a third of the screen empty, and seeing the year took Back, שנה and לפי חודש again (FLOW-337). Decision [0141](0141-period-bar.md) set the period bar, the stepper and the by-month page.

## Decision

- **A sideways swipe on the band's hero figure steps the period** (`PeriodSwipe`, `app/src/ui/period-swipe.tsx`), on Home (the hero: label, figure, explanation) and on the project band (the profit label, the figure and the income and expense line). It steps by the preset's own length, exactly as the stepper does (`stepPeriod`): a year by calendar year, and the later step stops at the current window. הכול and a custom range do not swipe, as they have no arrows.
- **Direction follows the arrows.** In RTL the arrow on the start side (right) points right and goes to the earlier window. So a finger moving right, toward that arrow, goes earlier, and a finger moving left goes later. The figure follows the finger by half the move; at the current window the later side gives only a little and springs back, with no change.
- **Gesture rules are FLOW-314's,** so the swipe never fights the transaction swipe, the edge swipe-back (FLOW-332) or the page scroll: touch only, one finger; a start within 24px of either screen edge is left alone (the start edge belongs to swipe-back); a start inside a field or a sheet, or while a sheet is open, is left alone; nothing is decided until the finger moved 10px, and a mostly vertical move goes to the page scroll (`touch-action: pan-y` on the figure); it commits past 30% of the figure's width or on a flick (at least 30px at 0.5px/ms or faster). A committed step gives a short haptic where the platform has one.
- **Reduced motion:** the figure does not follow the finger and does not animate back; the period swaps on release. Otherwise the figure settles with `transform` only, `--dur-fast`.
- **The arrows stay.** They are the accessible path (keyboard, screen readers, switch control). The swipe adds no control and no accessible name; the period label and the figure announce the new window as they do after an arrow.
- **"לפי חודש" lists every month since the project started,** whatever period the band shows. The page reads `get_profit_months` with no dates, which per [0129](0129-profit-by-month.md) runs from the project's first month with a line to the current month; no server change. Its subtitle reads "מתחילת הפרויקט · רווח ₪…". The project's "לפי חודש" row is always shown (it was only for ranges longer than a month) and its hint counts the same months. Back returns to the project with its own period unchanged (the period stays in the URL); a month row still opens the project on that month.

This amends 0141 on two points: the by-month page lists the whole project, not the band's range, and the project's "לפי חודש" row shows for every period.

## Alternatives rejected

- Moving the period bar to the bottom of the band or the screen: the owner keeps it where it is.
- A swipe that follows the content (finger right shows the later window, as when dragging a left-to-right timeline): it would run against the arrows, where the right arrow is earlier.
- Starting the swipe anywhere on the band: the band row holds Back and ⋯, and the preset row is a control of its own.
- A compact preset row on the by-month page (`PeriodBar tone="page"`): the owner chose the whole project.

## Consequences

The project's first month is its first month with a line, not a start date the owner set; a project has no start date field. A project with no line yet shows the empty state, with no wider period to offer. A future company "לפי חודש" page should follow the same rule. FLOW-332 must keep its edge zone at 24px or more so the two gestures never share a start point.
