<a id="flow-357"></a>
# FLOW-357 · Open invoices fit more than three rows at 320
- **Type:** PLAN FIRST · **Status:** building (owner picked A "Rows only", 2026-10-10 05:34Z); real-app shots to the owner before merge · **Depends on:** — · **Source:** cycle 13 (open invoices at 320)
- **What:** Each open invoice carries a full-width tinted "סימון כשולם" button under its row, so an invoice takes about 140px and only three fit at 320. With one invoice, its amount shows twice (the head and the row). A repeated action on every row makes a light list busy (§2.1, §3.7 pinned bar rule).
- **Options:** A, the row opens a sheet whose main action is "סימון כשולם", with an undo toast; the list shows rows only. B, keep the button under each row. With one invoice, the head drops its repeated figure in both. Mockups at 390, one option per frame.
- **Acceptance:** owner's pick on a card. (Owner, 2026-10-10 05:34Z: A, rows only.) Real-app 390px shots approved by the owner before merge.
