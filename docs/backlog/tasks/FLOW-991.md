<a id="flow-991"></a>
# FLOW-991 · The צפי page leads with the cash its project card shows
- **Type:** SMALL UI · **Status:** in-progress · **Source:** the owner, 2026-10-30, two screenshots of a project with a loan: the project page's card said תזרים צפוי −$301 and its "פירוט ועריכה" page said צפי נובמבר +$106 ("the revenue and cashflow numbers are interchangeable, confusing"). The owner chose to fix the terminology and the calculation on the existing screens, cash for both. Decision [0236](../../decisions/0236-forecast-page-leads-with-cash.md).
- **Files:** `app/src/screens/project-next-month-screen.tsx` and its test, `app/src/ui/css/45-project-profit.css` (`.ui-pn-figure-label`), `docs/decisions/0236-forecast-page-leads-with-cash.md`, `docs/decisions/README.md`, a design log entry, a changelog fragment.

- [x] The page's figure is תזרים צפוי, the card's cash (cashForecast), labelled under the title.
- [x] The summary reads צפוי להיכנס / צפוי לצאת; רווח צפוי (the profit page card's net) follows when the loans hold a part the profit leaves out.
- [x] That part is the list's last row, "לא נספר ברווח · לפי ההלוואה", with no edit page, so the rows add up to the figure.

**Acceptance:** on a project with a loan, the page's figure equals the project card's net, its רווח צפוי the profit card's net, and its last row the difference.
