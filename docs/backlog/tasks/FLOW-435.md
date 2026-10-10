<a id="flow-435"></a>
# FLOW-435 · The project page like Home: "לכל החודשים" and Home's alerts
- **Type:** SMALL UI · **Status:** in progress (#534) · **Depends on:** [FLOW-417](FLOW-417.md), [FLOW-419](FLOW-419.md) · **Source:** owner, 2026-10-10 13:27Z ("why under project I can't see לכל החודשים like I see in the main page? Also make it behave the same with the suggestion cards"). The owner's "Like Home" layout (FLOW-419) is already approved; the design lead signs it off.
- [x] Server: `project_cash_years(p_project)` and `project_cash_year_months(p_project, p_year)`, FLOW-417's history reads for one project on FLOW-419's rules (a shared bill counts the project's share).
- [x] App: "לכל החודשים" under the project's earlier months opens its history (years, then a year's months, then the project's month page); an older month's page reads its year.
- [x] App: Home's attention card on the project page with the project's own rows: items waiting for approval (opening the review on the project), late bills and income, changed recurring charges. The server already leaves out what this user hid (decision 0175).
- [x] Design lead: the history band names the project on a small line above Home's label.
- **Acceptance:** stories and tests; the history page opens in under 0.7 s (`perf/project-history-open.spec.ts`).
