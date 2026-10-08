# One period bar on Home and on each project

**Date:** 2026-10-08
**Status:** Accepted (owner approved option A of the profit-by-period plan, 2026-10-08; the owner asked that the stepper arrows point outward)

## Context

The owner wants Home to show the period he picks at the top, each project to have its own period, a way to step between months, and presets for 3 months, 6 months, a year and all time. Until now Home had one quiet period pill ([0019](0019-home-periods-and-comparison.md), [0028](0028-period-sheet-with-custom-range.md)) and the project band was all time without saying so (FLOW-411). The server side is [0129](0129-profit-by-month.md).

## Decision

- **`PeriodBar` (`app/src/ui/period-bar.tsx`) is the one period control** on Home's band and on the project band. It has five presets on a segmented control: חודש · 3 חודשים · 6 חודשים · שנה · הכול (under 360px: "3 ח׳", "6 ח׳"). One tap applies a preset. Each window ends with the current month and counts the open month, cut at today ("עד היום"). שנה is the calendar year.
- **A stepper under the presets.** The arrow on the start side (right) goes to the earlier window and the one on the end side (left) to the later one, by the preset's own length (a year by calendar year). Both are SVG chevrons that point outward, away from the label; never ‹ › glyphs, which RTL mirrors. The later arrow stays focusable but `aria-disabled` at the current window, with a hidden "זו התקופה הנוכחית". הכול and a custom range have no arrows (their slots stay, so the label stays centred).
- **The label opens the period sheet** (16) with the five presets and "טווח מותאם". With a custom range no preset is selected and the label shows the dates.
- **Home** opens on 3 חודשים (plan question 1) and keeps the choice for the session. The hero label names the window ("רווח נקי ב־3 חודשים", "הפסד בספטמבר 2026"). "פרויקטים" lists up to 5 projects with lines in the period, losses first, each with "▲ ברווח" (muted) or "▼ הפסד" (`bad`) under the name.
- **A project has its own period.** It starts as Home's on each visit from Home and never changes Home; the history entry remembers it, so Back from a line reopens the same window. On a project הכול reads "מתחילת הפרויקט". The band names its period ("רווח ב־6 חודשים"). Below the band: "לפי חודש" (for a range longer than a month), the overhead switch, the budget (only on מתחילת הפרויקט, since the budget is for the whole project), loans, categories for the period, then the period's lines with month heads, open on arrival.
- **"לפי חודש"** (`/projects/:id/months`) lists the range's months, newest first: the month, "נכנס · יצא", and the month's profit (a loss in `bad` with a minus). The open month carries "בתהליך". A tap opens the project with that month as its period. No chart.

This amends 0019 (the period list) and 0028 (the sheet opens from the period bar's label as well as the pill). DESIGN-RULES 3.1 "one quiet period pill" becomes "one period bar"; the design lead copies it in the next cycle's backlog PR.

## Alternatives rejected

- Option B: one pill with arrows and the presets in the sheet, plus a small bar chart on the project. Every preset was 2 taps and the chart needed a DESIGN-RULES §5 change.
- Glyph arrows (‹ ›): dir=rtl mirrors them, so they pointed inward.

## Consequences

The breakdown screen's pill lists the same five presets. The comparison under נכנס and יצא compares with the window of the same length just before. A company "לפי חודש" page (plan question 6) is not built yet.
