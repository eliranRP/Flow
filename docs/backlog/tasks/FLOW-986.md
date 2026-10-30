<a id="flow-986"></a>
# FLOW-986 · דוחות takes קבועים's place in the tab bar; קבועים moves to an icon in Home's band
- **Type:** SMALL UI · **Status:** in-progress (#874) · **Source:** the owner, 2026-10-30: "replace the recurring tab with reports on the bottom nav, and suggest 3 design concepts for where to move it".
- **Files:** `app/src/ui/tab-bar.tsx`, `app/src/screens/home-parts.tsx` (`HomeBandActions`), `app/src/screens/HomeScreen.tsx`, `app/src/dev/routes/home.tsx`, `app/src/ui/css/07-band-home.css` (`.ui-band-action`, `.ui-band-dot`), `app/src/screens/project-detail-screen.stories.tsx`, `app/src/ui/icons.tsx` (`ReportsIcon`), `app/src/ui/icons.stories.tsx`, `app/src/ui/recurring-list.tsx` (`RecurringBack`), `app/src/screens/recurring-screen.tsx`, `app/src/screens/reports-screen.tsx` (header), `app/src/dev/routes/index.ts`, the tab tests and e2e specs, `docs/design/DESIGN-RULES.md` (row 18), a design log entry, a changelog fragment.

- [x] The tab bar reads בית · פרויקטים · דוחות · הלוואות, in the board's ReportTab order and icon. דוחות is lit on `/reports` and its drill-downs.
- [x] דוחות is a tab root: no "‹ בית" in its header.
- [x] קבועים (`/recurring`, `/missing-bills`) lights בית, and its header gets "‹ בית".
- [x] The owner picked concept B (2026-10-30) of three on the board's "In design · for approval" page: a repeat icon in Home's band, between search and the avatar, with a signal dot when a recurring bill or income is late.
- [ ] Left for later: the board's one-time tip ("קבועים עברו לכאן") under the icon.
- **Acceptance:** the tab unit tests and e2e specs pass with four tabs; the reports screen has no Back; קבועים opens from the band's icon and from Home's late-bills row, and goes back to Home.
