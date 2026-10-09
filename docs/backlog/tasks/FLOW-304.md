<a id="flow-304"></a>
# FLOW-304 · Record metadata and richer transaction detail
- **Type:** PLAN FIRST · **Status:** done (#107) · **Depends on:** —
- **Approved:** 2026-10-07, the design reviewer's option A of the [mockups](https://claude.ai/artifact/4Wsob4i3XEuLcMgX4SRj3M) (one meta line on the review card, a static "פרטי הבנק" section on the detail), under the owner's standing rule for UI tasks. Decision [0113](../../decisions/0113-bank-details-per-line.md).
- **What:** Show the bank or provider metadata per line on the review card and the detail: payment method (card and last 4, ACH, wire, check), memo, counterparty, bank account, original bank description. Icon-based (a card icon and ••1234, a memo on tap). Source: `transactions.provider_meta`. Also a better detail screen for what isn't shown at first glance. MCP: `get_expense`, `list_review` and `search_expenses` return the normalized fields.
- **Acceptance:** mockup approved; no account numbers beyond the last 4 anywhere.
