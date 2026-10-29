<a id="flow-171"></a>
# FLOW-171 · Reports: an account's movements from the start, any year, and a long Latin title that wraps
- **Type:** MCP + UI · **Status:** claimed (dev lane 1, 2026-10-29, flow-171-account-history) · **Depends on:** [FLOW-165](FLOW-165.md) · **Source:** the owner's report on 2026-10-29, with phone screenshots ("keep building without waiting").

On the balance sheet, an equity account (a partner's contributions and distributions) opened the FLOW-165 account page with the balance today, the balance on 1 January, the year's change and only this year's movements. The earlier years' money is inside the opening balance, but their movements can't be seen.

- [ ] Database: `get_account_lines` takes an optional start date. The opening balance is the balance before it, and the movements run from it to the as-of date. A sentinel reads "from the very start": no opening, every movement from the account's first leg. With no start date the read is as before (1 January of the as-of year). Company and project checks, grants and the paging order stay; pgTAP covers the start, a custom start, a start after the as-of date (rejected), another company's account and a viewer.
- [ ] MCP: `get_account_lines` takes `from` and the start option, validated like the other dates; deno tests; TOOLS.md.
- [ ] App: the account page has a period choice next to the movements, "השנה" (this year) or "מההתחלה" (from the start), kept in the URL (`span=all`) and in the query key. From the start, the summary shows the balance and the change since the start, and the movements are grouped by month across years, with year headings, paged.
- [ ] The account page for a balance sheet dated in an earlier year shows that year's movements (a test).
- [ ] A long Latin account name in the right-to-left title wraps inside the screen at 320 and 393px, and so do the balance sheet's account rows, breaking after "/" and at spaces before mid-word (story play checks, clip-check).
