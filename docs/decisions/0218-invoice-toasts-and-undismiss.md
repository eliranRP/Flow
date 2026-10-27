# The invoice pages' toasts hang under the header, and "לא זה" can be taken back

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-968. Extends [0212](0212-review-toast-under-header.md) §1 to §3 to חשבוניות פתוחות and the invoice page, as [0215](0215-recurring-toast-under-header.md) and [0217](0217-add-toast-under-header.md) did; refines [0182](0182-toast-above-the-bottom-bar.md) for these pages only)

## Context

FLOW-968 reviewed the unpaid invoices list and the invoice page against the UX/UI rule set used for the other v2 screens. Their toasts sat above the tab bar for 3s, and two of their changes could not be undone: clearing a mark, and "לא זה" on a bank match. The owner approved the Invoices v2 board, whose toasts hang under the header with ביטול for 5s.

## Decision

1. Every toast of the two pages takes `place: "top"`: a mark and its ביטול, clearing a mark, a link to a deposit, "לא זה", the SUMIT refresh ("הרענון הסתיים.", live and in the sample, and its failure), and the writes' failures.
2. An undo (ביטול) stays 5s; a note stays 4s.
3. Clearing a mark offers ביטול, which marks the invoice again. The ביטול's own toast offers no further undo.
4. "לא זה" offers ביטול only when this tap wrote the dismissal: `dismiss_invoice_match` returns `created: true` then, and `created: false` when the pair was already dismissed (another tab, or the assistant as the same user), in which case the toast has no ביטול. The ביטול calls `undismiss_invoice_match(invoice, deposit, dismissed_at)` with the time `dismiss_invoice_match` returned, and takes back only that row, only while it still carries that time, and only the caller's own. Anything else is a conflict and changes nothing; the toast says the undo failed.
5. The MCP side already undoes a dismissal (`mcp_undo`, kind `invoice_dismiss`), so no MCP tool is added.
6. Every other screen keeps 0182's place and its times, as 0212 §4 says.

## Alternatives rejected

- No ביטול on "לא זה": a mistaken tap hid the right deposit until the owner marked the invoice by hand.
- Deleting any dismissal of the pair on ביטול: an older dismissal, from another tab or the assistant, would be lost with it.

**Since FLOW-973 (2026-10-27):** these toasts use the one under-the-header helper, `topToast()` / `useTopToast()` in `app/src/ui/top-toast.ts` (decision 0222), with the same times; the screen's own helper is gone.
