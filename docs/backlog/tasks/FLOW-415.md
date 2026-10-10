<a id="flow-415"></a>
# FLOW-415 · Recurring charges: where they're paid from, a big change on Home, and the user's say on each payment
- **Type:** PLAN FIRST (layout approved) · **Status:** ready · **Depends on:** FLOW-403 · **Source:** owner, 2026-10-10 ("How missing bills works" thread); layout card answered 08:39Z: option A, "Today's screens"
- **Mockups (390px, option A):** project files `mockups/plan-first/recurring/a-1-missing.png`, `a-2-home.png`, `a-3-transaction.png`. The team builds and merges on the design lead's sign-off; no screenshot card to the owner.
- [ ] Server: `missing_bills()` returns each row's project and category, the usual day of the month and the last bill's date and amount. A charge that came in this month and differs from its usual amount by 20% or more is returned for Home with both amounts.
- [ ] Server: a payment can be marked recurring or not by the user, and that choice wins over the automatic detection in `private.recurring_parties`. A payment can be kept out of the cash view (תזרים) on its own, the way a category can (FLOW-413). MCP gets the same two switches.
- [ ] App, לא הגיעו: each row shows the supplier, then a hint of two lines: "project · category" and "בדרך כלל ב־N לחודש · אחרון dd/mm"; the amount stays "כ־₪…" (a-1).
- [ ] App, Home: the attention card gets one row per big change, "<category> עלה ב־38%" (or ירד), hint "₪now · בדרך כלל ₪usual", with the up/down arrow as on the transaction card; a tap opens that payment. Percentages, never "פי X" (a-2).
- [ ] App, payment page: two switches under נספר ברווח: "נספר בתזרים" and "חיוב קבוע". When the app found it, the hint says "בדרך כלל ב־N לחודש · זוהה לבד"; each change has an undo toast (a-3).
