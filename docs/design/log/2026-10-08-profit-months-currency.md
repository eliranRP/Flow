# Profit by period: no ₪0 rows in a dollar company

- PR: #TBD
- Kind: fix
- Changed: `profit-months.tsx` (`rangeCurrencies`; each month shows the period's currencies only), `by-currency.ts` (`projectRows` and `companyRows` take the company's currency for an empty period), new `company-currency.ts` (`useCompanyCurrency`), Home band and project band.
- Rule: none
- Source: Production QA on #199 (2026-10-08), `qa/p-months-all.png`.
