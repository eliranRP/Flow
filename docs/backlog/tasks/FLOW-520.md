<a id="flow-520"></a>
# FLOW-520 · Legal pages: a tappable contact, jump links, clear sections, readable offline
- **Type:** SMALL UI · **Status:** ready · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-1028 (#958, #960).
- **Files:** `app/src/screens/LegalScreen.tsx`, `app/src/legal-copy.ts`, `app/src/ui/css/60-help-legal.css`, the service worker's precache list if needed.

- [ ] The contact address is plain text inside RTL sentences: make it a mailto link in `<bdi dir="ltr">`, with the period outside. Rule: DESIGN-RULES RTL; hierarchy-and-actions § 4.
- [ ] Privacy is about 7 screens at 320 with 12+ sections and no way to jump: a "בעמוד הזה" list of anchors under the date, each section with an id and scroll-margin-top. Rule: hierarchy-and-actions § 12.
- [ ] Sections run together: heading weight 600, more space above, a hairline between sections; body max-width 40rem on wide screens. Rule: visual-system § 3.
- [ ] The texts load only on a tap (#960), so offline the consent's links fail: precache or prefetch the legal chunk after sign-in paints. Rule: feedback-and-states § 4.

**Acceptance:** the privacy story shows the jump list and a tappable address; the legal chunk is in the service worker's precache.
