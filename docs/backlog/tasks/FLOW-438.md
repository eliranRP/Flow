<a id="flow-438"></a>
# FLOW-438 · The month's transactions on the project's cash month page, and the profit page in the same layout
- **Type:** UI (plan-first, owner card) · **Status:** done (#572) · **Depends on:** [FLOW-437](FLOW-437.md) · **Source:** owner asks in the cash month thread, 2026-10-10 ("On the cash page i want to see all the transactions… and also to see in the same pattern the non count transactions"; "The רווח page should be aligned with the new design"). Mockups: `/mnt/project-files/mockups/cash-month-list/`.
- [x] The project's cash month page keeps its layout and lists the month's transactions under it in the project transactions page's rows, kept-out ones inline with the "לא נספר ברווח" hint (the owner's layout, not mockup A or B).
- [x] A cash lines side for the counted lines only (`in_profit`), so the page reads them without subtracting the kept-out ones.
- [x] The project's profit page moves off the purple band to the same white stacked layout, with its transactions inline.
- [x] Design lead fixes: the listed lines add up to the figures (sample test), the profit rows in the cash rows' look, no "תנועות" row, counted lines only; owner: the profit page's month header and chevrons like the cash month page.
