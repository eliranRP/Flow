<a id="flow-987"></a>
# FLOW-987 · The one-time "קבועים עברו לכאן" tip under the band's קבועים icon
- **Type:** SMALL UI · **Status:** in-progress (flow-987-recurring-tip) · **Source:** the owner, 2026-10-30: "add the one-time tip too", left for later in [FLOW-986](FLOW-986.md) (board RecurringConceptB).
- **Files:** `app/src/recurring-tip.ts` (new), `app/src/screens/home-parts.tsx` (`HomeBandActions`), `app/src/screens/HomeScreen.tsx`, `app/src/dev/routes/home.tsx`, `app/src/ui/css/07-band-home.css` (`.ui-band-actions`, `.ui-band-tip*`), `app/src/screens/home-parts.test.tsx`, `app/e2e/forecast.spec.ts`, `docs/design/DESIGN-RULES.md`, a design log entry, a changelog fragment.

- [x] On the live Home's current month, a bubble under the קבועים icon: "קבועים עברו לכאן" and "נקודה אדומה: חשבון קבוע לא הגיע.", with a ✕ (סגירה).
- [x] The ✕, or a tap on the icon, hides it for good on this phone (`localStorage`, as the weekly card's ✕). Previews and stories never show it; the dev fixture shows it with `?tip=1`.
- **Acceptance:** the unit tests and the e2e check pass; the bubble stays inside the screen at 320 and 390, in dark and light.
