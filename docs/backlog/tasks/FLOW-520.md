<a id="flow-520"></a>
# FLOW-520 · Legal pages: a tappable contact, jump links, clear sections, readable offline
- **Type:** SMALL UI · **Status:** done (#967) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-1028 (#958, #960).
- **Files:** `app/src/screens/LegalScreen.tsx`, `app/src/legal-copy.ts`, `app/src/ui/css/60-help-legal.css`, the service worker's precache list if needed.

- [x] The contact address is plain text inside RTL sentences: make it a mailto link in `<bdi dir="ltr">`, with the period outside. Rule: DESIGN-RULES RTL; hierarchy-and-actions § 4. Done in `LegalScreen.tsx` (the copy is unchanged).
- [x] Privacy is about 7 screens at 320 with 12+ sections and no way to jump: a "בעמוד הזה" list of anchors under the date, each section with an id and scroll-margin-top. Rule: hierarchy-and-actions § 12. Done for every page with five or more sections (terms and privacy; cookies and accessibility have four). A jump scrolls to the heading and focuses it.
- [x] Sections run together: heading weight 600, more space above, a hairline between sections; body max-width 40rem on wide screens. Rule: visual-system § 3. Done: headings were already 600 (`--type-sheet-weight`); each section now has 24px, a `line` hairline, and 24px above its heading. The 40rem cap is not added: the app's column is already capped at 480px (`--content-max`), narrower than 40rem.
- [x] The texts load only on a tap (#960), so offline the consent's links fail: precache or prefetch the legal chunk after sign-in paints. Rule: feedback-and-states § 4. Precache, not a prefetch: vite-plugin-pwa's Workbox precache uses the default glob (`**/*.{js,css,html}`), so `assets/LegalScreen-*.js` and its CSS chunk were already in `sw.js`, installed on sign-in's first load. `pnpm check:bundle` now fails if that chunk leaves the precache (`precacheViolations` in `scripts/check-prod-bundle.mjs`).

**Acceptance:** the privacy story shows the jump list and a tappable address; the legal chunk is in the service worker's precache.
