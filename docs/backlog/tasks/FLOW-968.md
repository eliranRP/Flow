<a id="flow-968"></a>
# FLOW-968 · Invoices v2: the UX/UI rules review of חשבוניות פתוחות
- **Type:** UI (design approved) · **Status:** in-progress (#828) · **Depends on:** — · **Source:** a review of the unpaid invoices list and the invoice page against a UX/UI rule set. The owner approved the design on 2026-10-26; on a card the same day: an overdue invoice offers "שליחת תזכורת ל־<לקוח>", sent through SUMIT after a 10s ביטול. On a card on 2026-10-27 the owner dropped that reminder for now (Flow has no SUMIT call that sends one). Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Invoices row and its findings note.
- **Files:** `app/src/screens/unpaid-screen.tsx`, `app/src/screens/invoice-screen.tsx`, `app/src/screens/unpaid-actions.ts`, `app/src/ui/css/45-invoices.css`, their stories and tests, `supabase/migrations/20261026193000_invoice_match_undismiss.sql`, decision 0218, a design log entry.

- [x] The bar's open part reaches 3:1; a new invoice's age line is already the secondary text (above 4.5:1).
- [x] The PDF card says what it opens. A full-screen viewer is not built: Flow holds no PDF, only SUMIT's document page.
- [x] A row marked as paid keeps full contrast; its line says the state.
- [x] Failed and offline states on the list and the invoice page.
- [x] "סימון כשולם", "ביטול" and the refresh are 44px.
- [x] "לא זה" and un-marking have a 5s ביטול; toasts sit under the header (decision 0218).
- [x] ~~An invoice open past 30 days offers the SUMIT reminder.~~ Dropped by the owner (card, 2026-10-27); no follow-up task.
- [x] The paid/open bar has a text alternative with both amounts (already so).
- [x] The match box's "לא זה" edge reaches 3:1.
- [x] Type scale only; the status chip is 13px (already so).
- **Acceptance:** stories of each state (failed, offline, marked, overdue); tests for the undo toasts and their place, the states and the bar's label; decision record; design log entry.
