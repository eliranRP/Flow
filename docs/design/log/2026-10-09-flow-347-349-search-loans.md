# FLOW-347 (Search and loans items) + FLOW-349: one period list, chips that read, loans at 320

- PR: #345 (UI lane 4).
- What changed:
  - One shared period sheet (`PresetPeriodSheet`, `presetPeriodOptions` in app/src/ui/period-picker.tsx). Home's period bar, the breakdown pill and Search all show Home's list: חודש, 3 חודשים, 6 חודשים, שנה, הכול, with Home's hints, then טווח מותאם. Search no longer starts with כל התקופה or names the year "2026".
  - Search's chip row puts תקופה first, so it is never the cut chip. While chips wait past the row's end, that end fades out over the gutter (new shared `ChipScroller`, Components/ChipScroller).
  - The loans list at 320: the hint is one line of whole parts, so a part that does not fit drops with its "·" instead of wrapping. Under 360px the bank icon, the same on every row, gives its width to the name, so "משכנתא דוגמה" stays on one line.
  - The loan sheet pins שמירה in its foot, so a 375x667 phone saves without scrolling the form.
- Rules: DESIGN-RULES §3.3 and §3.7 (pinned actions, a line never ends on "·"), cycle 8 findings.
- Rule: in a list whose rows all carry the same icon, the icon may give its width to the name under 360px (design lead, FLOW-347 loans list).
