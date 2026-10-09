<a id="flow-122"></a>
# FLOW-122 · Loan categories by key in the app and the Mercury hint
- **Type:** SMALL CYCLE · **Status:** done (#112) · **Depends on:** FLOW-112 (#81); FLOW-304 (#107), whose `upsert_connector_lines` this PR's migration builds on
- **What:** Follow-up from FLOW-112. `app/src/screens/loan-match.tsx` reads the three loan categories with `.in("name", ...)` and offers a match when the line's category name equals the principal name; the Mercury connector's loan hint resolves `תשלומי הלוואה` by name; the categories screen's locked loan line (`loanCategoryLine` in `app/src/screens/categories-screen.tsx`, FLOW-113) matches the Hebrew names too. Read `categories.loan_part` instead. No visible change.
- **Acceptance:** app unit test with a renamed loan category; connector test; no design review needed.
