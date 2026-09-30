# Confirm, don't type

**Date:** 2026-09-26
**Status:** Accepted. [0050](0050-demo-splits-and-review.md) amends this for SUMIT rows that are already in the books: they stay in the P&L while they wait in Review.

[0011](0011-auto-approve-high-confidence.md) decides what happens to a high-confidence row. [0021](0021-shared-costs-and-overhead.md) adds a split across active projects and a recurring split rule. This record stays Accepted for confirm-not-type. A one-project remember rule is unchanged.

## Context

Classifying every bank row by typing a project and a category will not happen in a truck between site visits. The owner will abandon a queue that feels like data entry. The same suppliers repeat: a timber yard is almost always materials on a known site.

## Decision

The product suggests a project and a category. The owner confirms. The daily operation is a tap, not a form.

- Suggestion order: link the row to an existing invoice (amount, date, supplier), then apply a learned rule, then an AI guess. A deposit from a client is suggested onto that client's project.
- High confidence means a matched invoice or a learned rule. Those items are auto-approved and skip the review queue. See [0011](0011-auto-approve-high-confidence.md).
- Other items go to the review queue (`לאישור`). Actions are Approve, Change, and Split.
- Change opens a bottom sheet. The owner picks a project and a category (two taps) and saves. "Remember for this supplier" (`לזכור לספק הזה`) is on by default and creates a rule: this supplier or counterparty maps to that project and category.
- The next document or statement row from that supplier uses the rule, so it does not return to the queue as an unknown.
- Only approved transactions count in reports. A banner with the pending count stays on Home so the owner can see that the numbers are not final.
- Split sends one transaction across more than one project, by amount or by percent. Each resulting shekel still belongs to one project or to overhead.

## Alternatives rejected

A type-first flow: the owner fills project and category on every row, with suggestions as an optional hint.

## Consequences

An assistant connection is specified in [0080](0080-mcp-connector.md). The confirm-not-type rules above are unchanged.

The review card, the change sheet, and the rule are core product, not settings buried in a menu. The success metric "at least 80% of AI suggestions accepted unchanged after month one" depends on rules accumulating. A wrong default on the remember toggle would write bad rules, so the sheet shows the rule it is about to save (supplier, project, category) while the toggle is on. Zero untagged transactions means every approved row has a project or overhead, and a category, before it enters a report.
