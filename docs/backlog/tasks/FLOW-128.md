<a id="flow-128"></a>
# FLOW-128 · Unpaid supplier invoices on the cash basis
- **Type:** SMALL CYCLE · **Status:** done (#118) · **Depends on:** —
- **What:** Split out of FLOW-116. On the cash basis an expense line counts by its document date, so a posted supplier invoice that is not paid yet counts, which [0007](../../decisions/0007-bank-statement-is-primary-input.md) does not intend (follow-up named in [0101](../../decisions/0101-unassigned-and-overhead-project.md)). Decide the rule (count by payment date, or leave unpaid invoices out of the cash basis) and apply it in `private.pnl_lines` so every P&L read follows.
- **Acceptance:** decision; pgTAP on both bases for a paid and an unpaid supplier invoice; TOOLS.md and calculations.md updated.
- **Answer:** an unpaid supplier invoice stays out of the cash basis; other expenses keep their document date (decision [0118](../../decisions/0118-unpaid-invoices-cash-basis.md)). Built as recommended; the owner was asked on 2026-10-08 and can still pick "count by payment date".
