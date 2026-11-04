<a id="flow-519"></a>
# FLOW-519 · The legal links on sign-in and Settings: rows that fit 320 and clear the tab bar
- **Type:** SMALL UI · **Status:** done (#967) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-1028 (#958).
- **Files:** `app/src/screens/SignInScreen.tsx`, `app/src/screens/legal-links.tsx`, `app/src/screens/settings-screen.tsx`, `app/src/ui/css/10-settings-onboarding.css` (`.ui-settings-legal`).

- [x] On Settings at 320 the fourth link (הצהרת נגישות) and the version line sit under the tab bar (settings-main story). The page's end clears the tab bar. Rule: tables-and-responsive § 21. Done: measured at the end of the scroll (320 and 393, light and dark) the version line ends at 744px and the tab bar starts at 760px, so the page's end already clears it (`.below-tabbar` pads the tab bar's height plus 16px). The story's full-page shot draws the fixed tab bar at the 844px viewport's bottom over a page that is 946px tall, which is what the review saw; no change was needed.
- [x] The four links run as a "·" line that wraps at 320 and leaves a "·" at a line end, on sign-in and Settings. Lay them out as rows or a 2×2 grid with 44px targets and no separators. Rule: visual-system § 8. Done: `LegalLinks` is a `nav` with a 2×2 list (`.ui-legal-links`), each link a 44px target, no separators.
- [x] On sign-in the consent sentence is the screen's weakest text; show it in the secondary text colour at body size, right above the button. Rule: hierarchy-and-actions § 5; visual-system § 7. Done: `t-body text-text-secondary`, directly above the button.

**Acceptance:** the sign-in and settings-main stories at 320 show all four links whole and above the tab bar.
