# Overhead project in one row (owner 20/10)

- PR: #752
- Kind: behaviour
- Changed: `app/src/breakdown-project-group.ts` (`projectGroupRow` takes the overhead project), `app/src/use-company-profit.ts`, `app/src/company-year-rows.ts`, `app/src/screens/company-profit-screen.tsx`, `app/src/screens/company-profit-period.tsx`, `app/src/project-cash.ts` (`useOverheadProject`), `app/src/screens/projects-screen.tsx` (the overhead row's title).
- Rule: The company's overhead project is one row wherever a project list shows it, titled with the project's own name. On the company profit page (month and year, לפי פרויקט) that row also holds the overhead costs and the lines with no project, and opens the overhead project's profit page; with no overhead project set it is כללי and opens nothing. On the Projects list it keeps the "תקורה · לא פרויקט" hint and the dashed home icon.
- Source: owner, 2026-10-20; decision [0200](../../decisions/0200-company-profit-year-and-since-start.md) point 3 (amended).
- Departures from the board: none; the board drew the general costs as כללי with no overhead project.
