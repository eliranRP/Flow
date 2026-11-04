<a id="flow-519"></a>
# FLOW-519 · The legal links on sign-in and Settings: rows that fit 320 and clear the tab bar
- **Type:** SMALL UI · **Status:** claimed (UI/UX review, 2026-11-04, claude/flow-519-legal-ux) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-1028 (#958).
- **Files:** `app/src/screens/SignInScreen.tsx`, `app/src/screens/legal-links.tsx`, `app/src/screens/settings-screen.tsx`, `app/src/ui/css/10-settings-onboarding.css` (`.ui-settings-legal`).

- [ ] On Settings at 320 the fourth link (הצהרת נגישות) and the version line sit under the tab bar (settings-main story). The page's end clears the tab bar. Rule: tables-and-responsive § 21.
- [ ] The four links run as a "·" line that wraps at 320 and leaves a "·" at a line end, on sign-in and Settings. Lay them out as rows or a 2×2 grid with 44px targets and no separators. Rule: visual-system § 8.
- [ ] On sign-in the consent sentence is the screen's weakest text; show it in the secondary text colour at body size, right above the button. Rule: hierarchy-and-actions § 5; visual-system § 7.

**Acceptance:** the sign-in and settings-main stories at 320 show all four links whole and above the tab bar.
