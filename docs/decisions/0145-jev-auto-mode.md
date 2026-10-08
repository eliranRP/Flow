# Jev auto mode: anomaly gate, income, audit trail and one-tap undo

**Date:** 2026-10-08
**Status:** Accepted (FLOW-702, server side; plan approved by the owner 2026-10-08)

## Context

Auto mode already pre-filled expense lines at or above the company's threshold ([0084](0084-jev-auto-prefill.md), [0139](0139-jev-corrections.md)), but it was not safe to turn on. It filled a line that SQL had flagged as a possible duplicate or spike, it skipped income lines, it left no record of what it replaced, and the owner had no way to take a fill back except by setting the fields again. Jev still never approves a line, and every number still comes from SQL.

## Decision

**Anomaly gate.** `jev_prefill` writes nothing on a line that `line_anomalies` flags, unless Jev scored that flag below 0.5 in its newest suggestion. A score of 0.5 or more, or no score, returns `skipped: "flagged"`. The suggestion stays on the card, unfilled.

**Income.** Auto also fills income lines: the project (no allocation, no role) and an income category. A category must match the line's direction.

**Finished projects in SQL.** The prefill checks again what the job offers: a finished project only goes on a line dated on or before that project's last line.

**Audit trail.** Every fill that writes anything inserts one `jev_prefills` row in the same transaction: the line, the project and category written, the values before (project, category, its suggested flag, the allocations as JSON), the model and the confidence. Members read their company's rows.

**One-tap undo.** `undo_jev_prefill(line)` (members, and MCP `undo_jev_prefill` with idempotency) puts back the values before while the line's newest review is open, the owner has not assigned it, and its project and category still hold Jev's values. It marks the audit row undone. The line stays in לאישור.

**Status.** `get_jev_status` adds `prefilled_today` and `prefilled_open`; `jev_suggestions` and `get_jev_suggestions` add `prefilled`.

**Kill switch.** The job fills only when the company's mode is `auto`, so off or shadow stops new fills at the next run. Fills already made stay, still undoable.

**Review nits from #177.** The overhead project counts as a `no_project` match in suggestion reasons, and `approve_split_review` refuses a hidden, missing or non-expense category. A fill does not set `pnl_role`: the line stays unassigned until the owner approves it.

## Alternatives rejected

- Holding every flagged line regardless of Jev's score: Jev scores flags to tell a real problem from noise, and most duplicates are an invoice and its payment.
- Undo through the generic MCP `undo`: that covers MCP writes only, and the app needs the same call.
- Keeping income in shadow: the owner chose auto for both.

## Consequences

- The app part goes to a UI lane: the Settings mode choice (הצעות בלבד / מילוי אוטומטי), threshold chips 80/85/90/95% in auto only, a "✦ מולא ע״י Jev" label with בטל on a filled card, and a held flagged line showing its flag with no fill.
- Deploy the jev-tag function with this migration: the new function passes `p_model` and `p_confidence`, which the old `jev_prefill` signature does not take.
