# Jev sees how the owner filed the same supplier before

**Date:** 2026-10-08
**Status:** Accepted

## Context

FLOW-701 asks Jev to learn from confirmations. Part 2 ([0126](0126-jev-outcomes.md)) records them. TypeSafe has no training or memory per customer: each request is `{ model, state, questions }`, and the model sees only what the state carries. Most of a company's expenses repeat by supplier, and what the owner filed for that supplier last time is the strongest hint.

## Decision

The `jev-tag` job adds `past_filings` to each request state: up to 5 lines the owner filed for the same supplier, newest document date first. Filed means the line's current review (its newest `review_queue` row) is `approved` or `changed`, and the line is a live expense (a pending card line the owner approved counts). Each entry has the date, the description cut to 120 characters, `amount_net`, the project id and name, the category id and name, the P&L role, and whether the line is split (by category or across allocations). The ids are the same ids the questions offer. A project or category that is no longer offered has a name of null.

The history comes from SQL: `public.jev_supplier_history(company, suppliers[], per)`, service role only, one call per company per run, for the suppliers of the lines the run listed (before the daily cap drops any). A line with no supplier gets no history. A failed history read fails the listing like the other reads, so the run tags nothing rather than tagging without it.

Jev still only suggests; it never approves a line ([0084](0084-jev-auto-prefill.md)).

## Alternatives rejected

Supplier history from `jev_outcomes` only. It would leave out every line the owner filed without a Jev suggestion, which is all of them before this phase. A supplier rule (`split_rules`, remembered categories) in the state instead of history. Rules are already applied before review, and they hold one answer, not the owner's recent choices.

## Consequences

Each request carries a little more text, a few hundred tokens for a supplier with history. The `get_jev_accuracy` report ([0126](0126-jev-outcomes.md)) shows whether it helps. Only the company's own lines are sent, and only for suppliers already in the run.
