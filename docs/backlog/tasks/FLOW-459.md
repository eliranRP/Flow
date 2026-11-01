<a id="flow-459"></a>
# FLOW-459 · השקעה והלוואות: shorter, with the inputs before the metrics
- **Type:** PLAN FIRST · **Status:** plan-first · **Source:** UX rules review 2026-11-01 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-450 and FLOW-451 (v3 of the page, owner-approved); this proposes changing the approved order.
- **Files:** `app/src/screens/project-investment-screen.tsx`, `project-investment-cards.tsx`, `project-returns-cards.tsx`.

- [ ] Three new cards come before נתוני הנכס and the loans: the page is about 1,850px at 320, with the loans at about 1,560px. Figures repeat ($36,300 as "על … בעסקה" and "כסף בעסקה"; 11.6% in two cards), with seven ⓘ buttons. Options: merge הון בנכס into the total card; ⓘ only on sources and metrics; נתוני הנכס before מדדים. In the missing state, a metric row shows only "הוספה", with the reason in the hint. Rule: DESIGN-RULES §2.1 Light; hierarchy-and-actions § 1, § 5.

**Acceptance:** the owner picks an order on a card, written here, before any build.
