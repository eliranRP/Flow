# Board proof status (baseline)

Baseline of every frame in `design/proof/*-map.json`, measured against fresh board renders on 2026-10-17.

## How to re-run

```
PORT=4180 bash scripts/board-proof-build.sh &
FLOW_BOARD_PNG=<dir of board renders> node scripts/board-proof.mjs --base http://localhost:4180 \
  --map design/proof/<area>-map.json --out <proof dir>/<area>
```

Renders come from `node scripts/board-render.mjs --project <board project> --runtime <dc-runtime.js> --out <dir>`.
`node scripts/board-coverage.mjs --project <board project>` lists the board frames no map names.

Gate: the text-masked mismatch must be under 3% in dark and in light for each frame. Passing the number is not enough: read the side-by-side PNG for each frame too (board, app, diff).

## Mapped frames

Raw = mismatch, masked = text-masked mismatch (percent). Pass = masked under 3% in both themes.

| Area | Frame | Route | Dark raw | Dark masked | Light raw | Light masked | Pass? | Owner |
|---|---|---|---|---|---|---|---|---|
| forecast | MonthForecast | /e2e/forecast?kind=board | 9.1 | 2.4 | 8.3 | 1.7 | yes | FLOW-141b |
| forecast | MonthForecastEdit | /e2e/forecast?kind=board&sheet=1 | 14.1 | 5.4 | 19.5 | 8.7 | no | FLOW-141b |
| home | Flow | /e2e/cash?state=usd-loss | 9.0 | 3.2 | 8.1 | 2.3 | no | FLOW-374 |
| home | FlowPicker | /e2e/cash?state=usd-loss&drawer=1 | 15.7 | 6.2 | 27.5 | 13.0 | no | FLOW-374 |
| home | FlowSeptember | /e2e/cash?state=usd-loss&month=past | 8.3 | 2.5 | 7.7 | 1.9 | yes | FLOW-374 |
| invoices | Invoices | /e2e/invoices | 10.3 | 3.2 | 10.0 | 2.9 | no | FLOW-367b |
| invoices | InvoicesDetail | /e2e/invoices?invoice=inv-1043 | 13.8 | 9.2 | 13.8 | 9.1 | no | FLOW-367b |
| invoices | InvoicesDone | /e2e/invoices?state=done | 12.5 | 8.8 | 10.3 | 7.8 | no | FLOW-367b |
| lines | Lines | /e2e/cash-lines?board=1 | 9.5 | 3.7 | 8.1 | 2.7 | no | FLOW-366b |
| lines | LinesIn | /e2e/cash-lines?board=1&side=in | 7.8 | 2.4 | 6.6 | 1.4 | yes | FLOW-366b |
| lines | LinesDetail | /e2e/txn?board=1 | 6.6 | 2.9 | 6.3 | 2.7 | yes | FLOW-366b |
| lines | LinesRecurring | /e2e/txn?board=recurring | 9.6 | 5.7 | 9.4 | 5.5 | no | FLOW-366b |
| lines | LinesFreq | /e2e/txn?board=recurring&sheet=pace | 11.7 | 6.6 | 12.1 | 6.9 | no | FLOW-366b |
| lines | LinesAll | /e2e/txn?board=recurring&sheet=all | 14.2 | 7.5 | 15.4 | 8.0 | no | FLOW-366b |
| lines | LinesDetailLoan | /e2e/txn?board=loan | 10.1 | 5.7 | 10.1 | 5.7 | no | FLOW-366b |
| loans | Loans | /e2e/loans | 8.2 | 5.2 | 7.0 | 3.9 | no | FLOW-139b/139c |
| onboarding | Onboarding | /e2e/setup/welcome | 27.6 | 16.2 | 8.1 | 4.0 | no | FLOW-514b |
| onboarding | OnboardingConnect | /e2e/setup/connect | 21.1 | 16.6 | 22.8 | 14.5 | no | FLOW-514b |
| onboarding | OnboardingSkip | /e2e/setup/skip | 7.5 | 4.6 | 9.4 | 5.9 | no | FLOW-514b |
| profit | ProfitProject | /e2e/project-profit | 9.8 | 4.2 | 9.8 | 4.1 | no | FLOW-140c1/FLOW-920 |
| profit | ProfitMonth | /e2e/project-month-profit | 11.6 | 4.8 | 10.1 | 3.9 | no | FLOW-140c1/FLOW-920 |
| projects | Projects | /e2e/projects | 9.5 | 4.9 | 7.0 | 2.7 | no | FLOW-445b |
| projects | ProjectFlip | /e2e/project-detail?preview=1&budget=1 | 18.2 | 12.3 | 12.2 | 6.5 | no | FLOW-445b |
| recurring | Recurring | /e2e/recurring | 8.8 | 3.0 | 8.2 | 2.5 | no (3.0 is not under 3) | FLOW-447b |
| review | ReviewList | /review/all?preview=1&e2e=list | 8.5 | 2.5 | 8.4 | 2.5 | yes | FLOW-365b |
| settings | Settings | /e2e/settings?board=1 | 5.0 | 2.9 | 5.0 | 2.9 | yes | FLOW-512b |
| settings | SettingsCategories | /e2e/categories?preview=1 | 7.4 | 3.4 | 7.4 | 3.4 | no | FLOW-512b |
| settings | SettingsTeam | /e2e/team?proof=1&sheet=invite&email=1 | 23.7 | 20.2 | 28.2 | 24.7 | no | FLOW-512b |
| states | States | /e2e/cash-loading | 6.8 | 6.4 | 4.3 | 3.8 | no | FLOW-375 |
| states | StatesHomeReveal | /e2e/cash-loading | 4.5 | 4.1 | 4.3 | 3.8 | no | FLOW-375 |
| states | StatesHomeEmpty | /e2e/cash-empty | 8.4 | 3.7 | 8.4 | 3.7 | no | FLOW-375 |
| states | StatesLoansEmpty | /e2e/loans?loans=none | 7.7 | 5.5 | 4.7 | 3.2 | no | FLOW-375 |

Result: 30 frames measured, 6 pass, 24 fail. No route was blank or errored, so no "route broken" entries. The maps for add, invest, invite, search and split are empty (no frames mapped).

## Unmapped board frames

99 of 129 board frames have no proof map entry (from `board-coverage.mjs`). Grouped by area:

- **add** (7): Add, AddCamera, AddCash, AddCheque, AddProject, AddReading, AddReceipt
- **home** (1): FlowScrolled
- **invest** (4): Invest, InvestEdit, InvestNoArv, InvestRehab
- **invite** (5): Invite, InviteEditor, InviteExpired, InviteJoined, InviteNewUser
- **invoices** (1): InvoicesMatch
- **loans** (6): LoanAdd, LoanAmortizing, LoanInterestOnly, LoanKind, LoanPayments, LoansClosed
- **forecast** (1): MonthForecastChanged
- **onboarding** (7): OnboardingBusiness, OnboardingDone, OnboardingInstall, OnboardingJev, OnboardingLoans, OnboardingProjects, OnboardingReview
- **profit** (3): Profit, ProfitBasis, ProfitByCategory
- **projects** (8): ProjectClient, ProjectFinishConfirm, ProjectMenu, ProjectMenuDeletable, ProjectNewCreated, ProjectNewSheet, ProjectRental, ProjectsFinished
- **recurring** (5): RecurringIgnored, RecurringItem, RecurringLate, RecurringPace, RecurringSwipe
- **review** (6): Review, ReviewDone, ReviewNoSuggestion, ReviewSheet, ReviewSplit, ReviewSplitDone
- **search** (6): Search, SearchEmpty, SearchFiltered, SearchFilters, SearchProject, SearchResults
- **settings** (16): SettingsBusiness, SettingsCategory, SettingsCategoryCount, SettingsMcp, SettingsMcpCode, SettingsMcpConnected, SettingsMercury, SettingsMercuryNew, SettingsNewCategory, SettingsNotifications, SettingsRename, SettingsSumit, SettingsSumitConnected, SettingsSumitNew, SettingsSwitch, SettingsTheme
- **split** (5): Split, SplitEmpty, SplitOver, SplitPicker, SplitTwice
- **states** (18): States, StatesDetailLoading, StatesFirstSync, StatesForecastEmpty, StatesHomeReveal, StatesLinesEmpty, StatesLinesLoading, StatesLoansLoading, StatesProfitEmpty, StatesProfitLoading, StatesProjectsEmpty, StatesProjectsLoading, StatesRecurringEmpty, StatesRecurringLoading, StatesSaving, StatesSearching, StatesSyncing, StatesTeamEmpty

