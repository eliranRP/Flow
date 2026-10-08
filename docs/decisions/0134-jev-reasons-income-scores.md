# Jev on income lines, reasons for a suggestion, and scores on anomaly flags

**Date:** 2026-10-08
**Status:** Accepted (owner's FLOW-701 answers, 2026-10-08)

## Context

FLOW-701 item 2 asked for faster review: a reason next to Jev's suggestion and suggestions on income lines (the "approve all sure ones" part was dropped; FLOW-324). Item 3 says SQL finds anomaly candidates and Jev only scores them ([0131](0131-jev-patterns.md)). Jev answers choices and probabilities; it does not write text, and it never computes a number or approves a line ([0084](0084-jev-auto-prefill.md)). Income lines are in review and need a project unless their category is off the P&L ([0091](0091-income-in-review.md)).

## Decision

**Income lines.** The jev-tag job sends open income lines too. It asks for a project and an income category (income categories only), and the state names the customer instead of the supplier. The party history ([0127](0127-jev-supplier-history.md)) now covers customers: `jev_supplier_history` takes supplier or customer ids and returns each filing's `direction`; the job keeps filings of the line's own direction. Auto mode does not pre-fill income: the suggestion shows on the card like shadow mode, and the review card now shows a Jev project on income. `get_jev_status` and the run check count open income lines.

**Reasons.** `jev_suggestions(ids[])` (the card, at most 500 ids) and `mcp_jev_suggestions()` (MCP `get_jev_suggestions`, the open review lines, newest 500) return each line's newest suggestion with current names and a reason computed in SQL from the party's last 5 filed lines of the same direction (filed: the newest review row is approved or changed; the line itself is not counted):

- `same_as_last`: the answered fields equal the last filed line.
- `usual_for_party`: they equal at least 2 of those lines.
- `new_party`: nothing filed for the party yet, or the line has no party.
- `model_only`: none of these.

`party_filings` and `matching_filings` are the counts behind it. The app turns the reason into words.

**Scores on flags.** When the job sends a line that SQL flags (`jev_line_flags`, service role only), the same call adds a yes-or-no question: is the flag a real problem the owner should look at? The flags (kind and numbers, no other line's id) go in the state. No extra call is spent, and a line with nothing else to ask is not sent for its flag alone. The answer is stored with the suggestion (`answers.anomaly`). `review_anomalies` and `get_anomalies` add `jev_score` (0 to 1, or null when Jev did not score that line); the suggestion read has `anomaly_score`. A line flagged after Jev labelled it has no score. If the flag read fails, the line is still labelled, without a score.

**#160 follow-ups.** A voided credit note no longer hides a duplicate. An income line that is not an invoice (a receipt paying several invoices) is not compared with single invoices for `amount_spike` or `new_party_large`. The MCP pick of open lines starts from the open review rows.

## Alternatives rejected

- Asking Jev to explain in words: the model does not write text, and the reason would not come from SQL.
- Storing the reason with the suggestion: it goes stale once the owner files more lines; reading it is cheap.
- A separate Jev call per flag: it spends the daily cap twice on the same line.
- Pre-filling income in auto mode now: an income project and category go through other rules (0091); it waits for FLOW-702.

## Consequences

- The reason line and the score on the card are UI work for the UI lane.
- Jev's accuracy report ([0126](0126-jev-outcomes.md)) now includes income lines that had a suggestion.
