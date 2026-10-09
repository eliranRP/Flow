<a id="flow-324"></a>
# FLOW-324 · Approve all suggestions in the review queue
- **Type:** PLAN FIRST · **Status:** dropped · **Owner (2026-10-08):** no approve-all in the app; the owner reviews lines one by one. MCP keeps batch approve through `assign_expenses` as today. · **Depends on:** —
- **What:** The owner's ask (2026-10-08), to be planned first: an "approve all suggestions" button on the review queue, so a queue of lines that already carry a suggested project and category is cleared in one tap instead of one card at a time. The plan settles which lines count (both fields suggested, no split, no unallocated shared cost, no reversal, no loan line), what the button says with its count, a confirm or a toast with ביטול that restores every line, how a partial failure reads, and how it sits beside the list and the card. Overlaps the "approve all sure ones" item in FLOW-701.
- **MCP:** a batch approve over `list_review` items, matching the button's rules, or a documented reason to leave it to `assign_expenses`.
- **Acceptance:** plan and mockup approved; the rules for which lines are approved are written down; undo covers the whole batch; tenant isolation test on any new RPC.
