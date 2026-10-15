<a id="flow-442"></a>
# FLOW-442 · The "not counted in profit" list names the loan part it leaves out
- **Type:** BUG · **Status:** claimed · **Depends on:** — · **Related:** [FLOW-440](FLOW-440.md) (the same loan parts on the profit page) · **Source:** owner report 2026-10-11, with a phone shot of a project's cash month "לא נספר ברווח" page. The shot holds real data, so it is not in the repo.
- **What happens:** The cash month's "לא נספר ברווח" page ("כסף שזז בבנק, אבל אינו הכנסה או הוצאה") lists a loan payment as the lender's name with "<date> · תשלומי הלוואה" and an amount. The row doesn't say which part of the payment is the one left out of profit (principal), so the reader can't tell what was excluded or how it relates to the whole payment. Example with invented figures: a −$1,500 payment (principal $900, interest $500, escrow $100). This page should read the $900 as principal, not as an unexplained "loan payment".
- [ ] A loan row on this page names the part it leaves out: "קרן" in its hint, with the amount of that part. When more than one part is left out, it names each one, few words.
- [ ] The whole payment shows only as context (for example "מתוך $1,500" in the hint), so the page's figure still adds up to the listed rows.
- [ ] The same wording wherever kept-out loan parts are listed (project and company cash month), from the shared money terms (DESIGN-RULES §3.6: קרן · ריבית · מסים וביטוח).
- [ ] The MCP tool that lists the kept-out lines returns each loan part's kind and amount.
- **Acceptance:** a unit test that a split loan payment's kept-out row reads its part (קרן) and amount. A story with invented figures at 320 and 393 with no clipping. A sample test that the rows add up to the page's figure.
- **Redesign (2026-10-11):** the redesigned profit pages ([FLOW-140](FLOW-140.md)) and transaction page ([FLOW-366](FLOW-366.md)) read the kept-out loan parts with this task's wording.
