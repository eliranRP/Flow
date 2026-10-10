# FLOW-115: a year jump in the date sheet

- PR: (set when claimed)
- Kind: component (shared `DateSheet`)
- Changed: the month title is a button with a small chevron. A tap swaps the days for a four-column list of years, newest first, at the days' height, with the picked year filled and centred. The month arrows rest while the years show. Picking a year keeps the month, clamped to `min`, `max` and the no-future rule, and brings the days back. With no `min` the list reaches 40 years back; with no upper bound, 10 years ahead. The title stays on one line at 320.
- Rule: A date older than a year is never more than two taps away; the month title is the way to the years.
- Shots: /mnt/project-files/mockups/flow-115/year-jump/ (390 light, 320 dark; closed and open).
- Source: FLOW-115's last open item (lane manager order).
