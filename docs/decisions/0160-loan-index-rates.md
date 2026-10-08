# Prime-linked loan rates

**Date:** 2026-10-08
**Status:** Accepted (FLOW-137, a Flow MCP agent request)

## Context

Some demand loans charge the Bank of Israel prime rate plus a margin, for example prime + 0.75% and prime + 0.25%. When prime moved, the assistant had to call `set_loan_rate` on each such loan, and a missed loan gets its interest wrong from that day on.

## Decision

A loan can carry `rate_index` (`il_prime`, the only index for now) and `rate_margin_ppm`, the margin over it in ppm, which may be negative. Both are set together or both are null. MCP `set_loan_index` links or unlinks a loan; its undo (`loan_index`) puts the link before back.

MCP `set_index_rate` takes the index, a date and the index's new rate. For every loan of the company linked to that index, it writes a `loan_rates` row on that date at index plus margin, kept between 0% and 100%. That is the same row `set_loan_rate` writes (decision 0132), so a row already on that date is replaced, and the schedule, demand interest and `list_loans` read it as before. A loan that starts after the date is skipped and listed. The loans are locked in id order, as every loan write does (0121).

One write records every row it touched, with the rate each held before. Undo (`index_rate`, by the write's id) is all or nothing: if any of those rows changed since, nothing moves and the answer is `conflict`.

Flow fetches no index. The rate is what the caller enters, and the numbers stay in SQL (decision 0084).

## Consequences

- A loan linked later gets no past index rates. Set them with `set_loan_rate` or another `set_index_rate` call.
- The app has no screen for this yet. The link and the rates show on the loan's rates like any other.
- More indexes need only a new value in the `rate_index` check and in the MCP enum.
