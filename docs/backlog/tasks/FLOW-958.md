<a id="flow-958"></a>
# FLOW-958 · Home v2: the UX/UI rules review
- **Type:** UI (design approved) · **Status:** in-progress (#819) · **Depends on:** [FLOW-364](FLOW-364.md) · **Source:** a review of Home against a UX/UI rule set (hierarchy, states, data-viz, motion, accessibility). The owner approved every change on 2026-10-26. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", boards Home v2, Home v2 · offline, Home v2 · load failed.
- **Files:** `app/src/screens/HomeScreen.tsx`, `app/src/screens/home-parts.tsx`, `app/src/ui/css/43-home.css`, `app/src/ui/css/07-band-home.css`, `app/src/ui/css/08-tabbar-empty.css`, `app/src/screens/attention-rows.tsx`, `app/src/screens/month-drawer.tsx`, `app/src/components/ThemeColor.tsx`, `app/src/preview.ts` (previewHidesBand is now previewFails), their stories and tests, `app/e2e/controls-home.spec.ts` and `app/e2e/storybook-layout.spec.ts` (the review button's label), a design log entry. The type weights stay the tokens' (owner, 2026-10-26: Home only); the app-wide change is [FLOW-959](FLOW-959.md).

- [ ] On the current month, דורש טיפול comes right after the band, before the split card. Its review row is the screen's one filled button: "לאישור N פריטים".
- [ ] The attention box is a neutral card, like the split card; its icons are grey. The accent stays on the button, the selected tab and the selected month.
- [ ] The split card's title is its takeaway ("רוב המינוס הלך לנכסים"); the metric name ("ממה מורכב המינוס") is a small label above it; the note line under the rows is gone.
- [ ] The נכנס and יצא rows are 44px tall.
- [ ] Every amount on Home uses tabular figures and never wraps.
- [ ] The active tab shows a pill behind its icon and a 600 label, not only another colour, and carries `aria-current="page"`.
- [ ] The month drawer's year arrows are hidden when the books have one year. Future months' "עוד לא" meets 4.5:1.
- [ ] Offline: Home keeps the last figures, with a status line in the band: "אין חיבור · מוצג המצב מ־HH:MM".
- [ ] Load failed: the band says "<month> לא נטען", with נסו שוב and צריך עזרה?.
- **Acceptance:** stories of Home (current, past, offline, failed) and the tab bar at 320 and 393; tests for the takeaway title, the order of the sections, the primary review row and aria-current; design log entry.
