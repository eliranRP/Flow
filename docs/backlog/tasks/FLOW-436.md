<a id="flow-436"></a>
# FLOW-436 · Loan money in cash: the one-category rule keeps the owner's choice
- **Type:** TASK · **Status:** done (#558) · **Depends on:** [FLOW-416](FLOW-416.md) · **Source:** owner's decision 2026-10-10 16:31Z on the Flow MCP agent's card ("I think it is better to count it and let the user change it afterwards if he wants to"), relayed by the lane manager
- [x] A new company's loan money counts in cash by default, and the owner switches it off with the category's cash switch (`set_category_cash`, or the app). Already done in FLOW-416 (#494): the seed and a new "loan proceeds" category start in cash.
- [x] The one-loan-money-category rule (`private.dedupe_loan_money_categories`, from FLOW-413) no longer takes the company's own loan money category out of cash when it removes the seeded copy: the surviving category keeps the value it has, the owner's choice included. No existing company's rows change.
- [x] A database test covers the rule; a changelog fragment says what changed.
