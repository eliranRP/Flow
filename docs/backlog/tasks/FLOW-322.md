<a id="flow-322"></a>
# FLOW-322 · Copy and dead-end fixes from the UX review
- **Type:** SMALL UI · **Status:** ready; split: UI lane 2 takes the transaction detail's document-row hint, UI lane 1 the rest. Mark `done` only when both PRs merged · **Depends on:** —
- **What:** From the 2026-10-07 UX review: a period control on the group-lines screen and an empty state that offers choosing a period (today a dead end); singular copy for one waiting item on the breakdown; the detail's document-row hint names only what the row shows; the Review subtitle covers bank lines too; category rows in Settings open that category's lines; the `/notifications` route that nothing links to is removed or linked.
- **MCP:** none.
- **Acceptance:** each string in a test; no empty state is a dead end; a category row opens its lines; design review.
- [x] (UI lane 3, 2026-10-09) The group-lines screen takes the period pill and its empty state offers "בחירת תקופה"; one waiting line on the breakdown reads "תנועה אחת ממתינה לאישור"; the review queue subtitle is "תנועות שמחכות לשיוך"; a category row in Settings opens that category's lines in search.
- [x] (UI lane 3, 2026-10-09) `/notifications`, which nothing linked to and only said nothing is sent yet, is removed; an old link lands on Settings. FLOW-502 brings a real notifications screen.
- [x] (UI lane 2, #278) The transaction detail's document-row hint: the "חשבונית ותשלום" row and its hint ("מע״מ, מספר חשבונית, שורת הבנק") went in #121, and the VAT shows as a plain line; a test now checks that the detail names no invoice number or bank line.
