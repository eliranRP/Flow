<a id="flow-108"></a>
# FLOW-108 · Take a single transaction out of the P&L, with an MCP batch
- **Type:** PLAN FIRST · **Status:** done (#105) · **Depends on:** #67 (merged)
- **Approved:** 2026-10-07, the design reviewer's option A of the [mockups](https://claude.ai/artifact/QPLXZjbEdoy8x2H49EEuYS) (עוד sheet button, ⊘ pill, save on tap with ביטול; loan lines locked), under the owner's standing rule for UI tasks. Decision [0112](../../decisions/0112-line-out-of-pnl.md).
- **What:** Let the user move one expense or income line out of the P&L. It then shows in a visible "out expenses" / "out income" group (not hidden), and can move back anytime. A per-transaction override wins over the category default. MCP: a single tool and a batch tool to take out or restore many lines at once, with idempotency, the write bucket, `undo` and `undo_batch`; plus an API. Icon-based, minimal wording.
- **Acceptance:** plan and mockup approved by the owner, then: pgTAP for override precedence on both bases, totals moved to the excluded side, batch partial success and batch undo.
