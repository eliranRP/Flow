<a id="flow-459"></a>
# FLOW-459 · השקעה והלוואות: shorter, with the inputs before the metrics
- **Type:** SMALL UI · **Status:** in-progress (#931) · **Source:** UX rules review 2026-11-01 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-450 and FLOW-451 (v3 of the page, owner-approved); this proposes changing the approved order.
- **Owner's pick (2026-11-02):** shorten it: merge הון בנכס into the total-return card, ⓘ only on the sources and the metrics, and נתוני הנכס above מדדים.
- **Files:** `app/src/screens/project-investment-screen.tsx`, `project-investment-cards.tsx`, `project-returns-cards.tsx`.

- [x] Three new cards come before נתוני הנכס and the loans: the page is about 1,850px at 320, with the loans at about 1,560px. Figures repeat ($36,300 as "על … בעסקה" and "כסף בעסקה"; 11.6% in two cards), with seven ⓘ buttons. Options: merge הון בנכס into the total card; ⓘ only on sources and metrics; נתוני הנכס before מדדים. In the missing state, a metric row shows only "הוספה", with the reason in the hint. Rule: DESIGN-RULES §2.1 Light; hierarchy-and-actions § 1, § 5.

**Acceptance:** the page at 320 reads the total card, נתוני הנכס, מדדים, הלוואות, with ⓘ only on the sources.

**Done (claude/flow-457-returns-ux):** the page reads the total card (the total, its sources, then הון בנכס: הון עצמי היום, השבחה צפויה, כסף בעסקה), נתוני הנכס, מדדים, הלוואות. The three equity rows lost their ⓘ: each row is the button to its sheet, with a chevron, so the page has four ⓘ, not seven. The money in the deal is named once, in its row (the meta under the total reads "על הכסף בעסקה"); with the per-cent beside each source gone (FLOW-458), cash-on-cash no longer repeats either. A metric or equity row whose input is missing shows only הוספה, with "חסר · …" in its hint.
