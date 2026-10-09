# FLOW-309: The paid line on a paired review card, and long supplier names

- PR: #TBD
- Kind: component
- Changed: `ui/review-card.tsx` (`paid` prop, `ReviewPaidLine`), `review-copy.ts` (`reviewPaidView`, `REVIEW_PAID`, `REVIEW_PART_PAID`, `REVIEW_RECEIPT`), `screens/review-queue.tsx`, `css/06-review-card.css` (`.ui-review-paid*` block, `.ui-review-supplier` clamp), `css/02-fields-sheets.css` (`.ui-list-wrap-title`), `screens/unpaid-screen.tsx`, `packages/shared/src/dashboard.ts` (`receipts`, `paid`, `paid_on` on review rows, optional). Stories: Components/ReviewCard "Pair: paid / part paid / unpaid invoice / receipt only" at 390, 320 and dark 320, and "Stress: supplier on three lines, 320".
- Rule: a connector invoice paid by its receipt shows one muted hint line under the amount (under the VAT line when there is one): a ✓ icon, then "שולם · קבלה dd/mm" from `paid_on`; a part payment says "שולם חלקית · קבלה dd/mm" with the latest receipt's date and no ✓; no receipts, no line. Readers hear "שולם, קבלה מ־dd/mm". The line wraps rather than clips at 320.
- Rule: the review card's supplier name wraps up to three lines, then ends in an ellipsis. A list whose row names are their identity (the unpaid list) uses `.ui-list-wrap-title`: the name wraps up to two lines before it truncates.
- Source: owner pick on a card (FLOW-309 option A, 2026-10-09), decision 0165; long names from the FLOW-810 clip-check follow-ups.
