# A stored company currency, with no conversion

**Date:** 2026-10-08
**Status:** Accepted. Numbered 0146 when merged (the migration and its comments still say 0146, since a merged migration is locked). Replaces the display part of [0087](0087-multi-currency.md) (no ₪/$ toggle and no conversion for now). Amends [0094](0094-usd-totals.md) and [0096](0096-currency-display.md) (the base currency's row comes first, not ILS) and [0129](0129-profit-by-month.md) (an empty month's zero row is in the base currency).

## Context

Flow keeps each line in its own currency and never converts it. No company currency was stored: the app and `mcp_company_loan_currency` guessed one from the newest lines, and several figures were ILS only (Home's net profit and its change, the previous period, the overhead share, the project order). A dollar company such as a US LLC saw ₪ or nothing there, and one shekel line flipped its defaults back to ₪. The owner chose "Company currency" (option A of the [FLOW-504](../backlog/TASKS.md#flow-504) plan): a stored currency, with no exchange rates.

## Decision

1. **`companies.base_currency`**, a three-letter code, default `ILS`. Existing companies whose lines (not removed) are all USD start as `USD`. A new project's investment currency starts in it, and so does the loan default (`mcp_company_loan_currency`).
2. **Changing it.** `public.set_company_currency(currency)`, owner only, returns the id, the new currency and the prior one. MCP `set_company_currency` has the idempotency key, the write rate limit and undo kind `company_currency` (with the company id), which is a conflict once the currency was changed again.
3. **The base currency leads.** Its row is first in every `by_currency` list (company and project), the projects are ordered by their base-currency income and direct cost, and `get_profit_months` gives an empty month one zero row in it (not ILS). MCP `get_breakdown` lines default to it.
4. **Base-currency twins of the ILS-only figures**, in minor units: `company_pnl.by_currency[].prev_income_minor`, `prev_expense_minor` and `prev_net_profit_minor` (null without a period); `get_home.net_profit_minor`; `get_project.overhead_share_minor`; `get_profit_months` `months[].overhead_share_minor` for a project. Each response carries `base_currency`.
5. **Nothing is converted.** Lines in other currencies stay their own rows, and every `*_agorot` field stays ILS, so nothing that reads them changes.

## Alternatives rejected

- Converting at display time with Bank of Israel rates (0087 as designed): every number would depend on a rate source, rounding and missing-rate handling, about three times the work, for a need no company has yet. It can come later on top of this.
- Keeping the guess: a dollar company with one shekel line flips back to ₪, and the ILS-only figures stay blank.

## Consequences

The app can read `base_currency` instead of guessing (`useCompanyCurrency`), show Home's profit and change in it, show the overhead share in it, and offer the choice in Settings → company. Budgets are read in the base currency and are never converted.
