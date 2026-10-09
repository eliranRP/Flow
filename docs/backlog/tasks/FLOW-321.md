<a id="flow-321"></a>
# FLOW-321 · Two rows in Home's attention card (review and unpaid)
- **Type:** SMALL UI · **Status:** done (#130) · **Depends on:** —
- **What:** From the 2026-10-07 tap-count review. Unpaid invoices can't be reached while the review queue has items: the Home card links only to Review. When both exist, the card shows two rows, one to Review and one to Unpaid with its total; one row when only one exists. Singular copy for a count of 1.
- **MCP:** none.
- **Acceptance:** unpaid is 1 tap from Home with items waiting; tests for 0, 1 and many on each side; each row has its own accessible name; light, dark, 320px; design review.
