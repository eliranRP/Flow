# Board proof status

Every frame in `design/proof/*-map.json`, measured against fresh board renders on 2026-10-18 after batch G (the type-alias rename, T-15, moved no frame).

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
| add | Add | /e2e/cash?state=usd-loss&preview=1&add=1 | 2.7 | 0.9 | 3.1 | 1 | yes | - |
| add | AddProject | /e2e/project-detail?preview=1&budget=1&add=1&entry=project | 4 | 0.5 | 4.2 | 0.5 | yes | - |
| add | AddCash | /e2e/cash?state=usd-loss&preview=1&add=1&entry=cash | 3.8 | 1.3 | 3.8 | 1.3 | yes | - |
| add | AddCheque | /e2e/cash?state=usd-loss&preview=1&add=1&entry=cheque | 4.1 | 1.5 | 4.1 | 1.5 | yes | - |
| forecast | MonthForecast | /e2e/forecast?kind=board | 6.3 | 0.5 | 6.2 | 0.4 | yes | FLOW-141b |
| forecast | MonthForecastEdit | /e2e/forecast?kind=board&sheet=1 | 5.6 | 1.5 | 6.2 | 1.6 | yes | FLOW-141b |
| forecast | MonthForecastChanged | /e2e/forecast?kind=board&state=changed | 5.9 | 0.3 | 5.8 | 0.2 | yes | - |
| forecast | StatesForecastEmpty | /e2e/forecast?kind=board&state=empty | 2.1 | 0.5 | 1.9 | 0.4 | yes | - |
| home | Flow | /e2e/cash?state=usd-loss | 5.4 | 1.7 | 4.6 | 0.9 | yes | FLOW-374 |
| home | FlowPicker | /e2e/cash?state=usd-loss&drawer=1 | 4.9 | 1.3 | 7.1 | 2.2 | yes | FLOW-374 |
| home | FlowSeptember | /e2e/cash?state=usd-loss&month=past | 5.8 | 2.2 | 5.2 | 1.6 | yes | FLOW-374 |
| home | FlowScrolled | /e2e/cash?state=usd-loss&scrolled=1&recurring=1 | 5.8 | 1.8 | 5.2 | 1.1 | yes | - |
| invest | Invest | /e2e/project-investment | 6.5 | 1.9 | 6.4 | 1.8 | yes | FLOW-446 |
| invest | InvestNoArv | /e2e/project-investment?arv=none | 5.4 | 1.7 | 5.3 | 1.6 | yes | FLOW-446 |
| invest | InvestEdit | /e2e/project-investment?sheet=edit&field=arv | 3.5 | 0.5 | 4.8 | 1.7 | yes | FLOW-446 |
| invest | InvestRehab | /e2e/project-investment?sheet=rehab | 6.3 | 2.2 | 6.7 | 2.6 | yes | FLOW-446 |
| invite | Invite | /e2e/invites?state=viewer | 2.9 | 0.5 | 2.9 | 0.5 | yes | - |
| invite | InviteEditor | /e2e/invites?state=editor | 4.7 | 0.8 | 4.7 | 0.8 | yes | - |
| invite | InviteNewUser | /e2e/invites?state=newuser | 2.6 | 0.5 | 2.6 | 0.5 | yes | - |
| invite | InviteJoined | /e2e/invites?state=joined | 3.2 | 0.7 | 3.1 | 0.6 | yes | - |
| invite | InviteExpired | /e2e/invites?state=expired | 2.1 | 0.4 | 2.1 | 0.4 | yes | - |
| invoices | Invoices | /e2e/invoices | 8.4 | 2.1 | 7.8 | 1.6 | yes | FLOW-367b |
| invoices | InvoicesMatch | /e2e/invoices?invoice=inv-1051 | 5.8 | 1 | 5.8 | 1 | yes | - |
| invoices | InvoicesDone | /e2e/invoices?state=done | 3.8 | 1.6 | 3.5 | 1.3 | yes | FLOW-367b |
| invoices | InvoicesDetail | /e2e/invoices?invoice=inv-1043 | 4.7 | 1.1 | 4.7 | 1.1 | yes | FLOW-367b |
| lines | Lines | /e2e/cash-lines?board=1 | 6.4 | 0.9 | 6 | 0.6 | yes | FLOW-366b |
| lines | LinesIn | /e2e/cash-lines?board=1&side=in | 6.3 | 0.8 | 6 | 0.6 | yes | FLOW-366b |
| lines | LinesDetail | /e2e/txn?board=1 | 5.1 | 1.5 | 4.9 | 1.2 | yes | FLOW-366b |
| lines | LinesRecurring | /e2e/txn?board=recurring | 6.2 | 2.4 | 6 | 2.2 | yes | FLOW-366b |
| lines | LinesFreq | /e2e/txn?board=recurring&sheet=pace | 4.3 | 0.8 | 4.6 | 1 | yes | FLOW-366b |
| lines | LinesAll | /e2e/txn?board=recurring&sheet=all | 4.2 | 0.1 | 4.7 | 0.5 | yes | FLOW-366b |
| lines | LinesDetailLoan | /e2e/txn?board=loan | 6.6 | 2.2 | 6.6 | 2.2 | yes | FLOW-366b |
| loans | Loans | /e2e/loans | 4.9 | 0.4 | 4.8 | 0.3 | yes | FLOW-139b/139c |
| loans | LoansClosed | /e2e/loans?closed=1 | 4.9 | 0.4 | 4.8 | 0.3 | yes | - |
| loans | LoanAmortizing | /e2e/loans/loan-mortgage?today=2026-10-17 | 3.9 | 0.4 | 3.9 | 0.4 | yes | - |
| loans | LoanInterestOnly | /e2e/loans/loan-bridge?today=2026-10-17 | 3.5 | 0.3 | 3.4 | 0.2 | yes | - |
| loans | LoanPayments | /e2e/loans/loan-mortgage/payments?today=2026-10-17 | 6.6 | 1.6 | 5.7 | 0.7 | yes | - |
| loans | LoanAdd | /e2e/loans?sheet=new&today=2026-10-17 | 2.8 | 1.4 | 3 | 1.6 | yes | - |
| loans | LoanKind | /e2e/loans/loan-mortgage?today=2026-10-17&sheet=kind | 5.2 | 0.5 | 5.4 | 0.5 | yes | - |
| onboarding | Onboarding | /e2e/setup/welcome | 0 | 0 | 0 | 0 | yes | FLOW-514b |
| onboarding | OnboardingBusiness | /e2e/setup/business | 0.9 | 0.4 | 0.8 | 0.3 | yes | - |
| onboarding | OnboardingConnect | /e2e/setup/connect | 0.8 | 0 | 0.8 | 0 | yes | FLOW-514b |
| onboarding | OnboardingSkip | /e2e/setup/skip | 1.1 | 0 | 1.2 | 0 | yes | FLOW-514b |
| profit | Profit | /e2e/company-profit | 3.1 | 0.2 | 3.1 | 0.2 | yes | - |
| profit | ProfitBasis | /e2e/company-profit?sheet=basis | 4.1 | 0.9 | 4.3 | 0.9 | yes | - |
| profit | ProfitProject | /e2e/project-profit | 4.9 | 0.2 | 4.8 | 0.2 | yes | FLOW-140c1/FLOW-920 |
| profit | ProfitMonth | /e2e/project-month-profit | 5 | 0.5 | 5 | 0.4 | yes | FLOW-140c1/FLOW-920 |
| profit | ProfitByCategory | /e2e/company-profit?by=category | 2.4 | 0.2 | 2.4 | 0.2 | yes | FLOW-140c2 |
| projects | Projects | /e2e/projects | 5 | 0.3 | 4.9 | 0.3 | yes | FLOW-445b |
| projects | ProjectFlip | /e2e/project-detail?preview=1&budget=1 | 5.4 | 1.2 | 4.6 | 0.4 | yes | FLOW-445b |
| projects | ProjectNewSheet | /e2e/projects?new=project | 3.1 | 0.7 | 3.2 | 0.7 | yes | FLOW-445b |
| projects | ProjectMenu | /e2e/project-detail?preview=1&budget=1&sheet=menu | 4.6 | 0.1 | 4.8 | 0.2 | yes | FLOW-445b |
| projects | ProjectMenuDeletable | /e2e/project-detail?preview=1&budget=1&sheet=menu&deletable=1 | 3.4 | 0.1 | 3.5 | 0.1 | yes | FLOW-445b (decision 1 commit) |
| projects | ProjectFinishConfirm | /e2e/project-detail?preview=1&budget=1&sheet=finish | 3.9 | 0.3 | 4.1 | 0.3 | yes | FLOW-445b |
| projects | ProjectsFinished | /e2e/projects?finished=1 | 5 | 0.3 | 4.9 | 0.3 | yes | FLOW-445b |
| projects | ProjectRental | /e2e/project-detail?preview=1&kind=rental | 6.5 | 2.2 | 5.7 | 1.4 | yes | FLOW-445b |
| projects | ProjectClient | /e2e/project-detail?preview=1&kind=client | 5.8 | 1.4 | 4.9 | 0.6 | yes | FLOW-445b |
| projects | ProjectNewCreated | /e2e/project-detail?preview=1&kind=new | 3.8 | 1.1 | 3 | 0.3 | yes | FLOW-445b |
| projects | StatesProjectsLoading | /projects?preview=loading | 0.4 | 0.2 | 0.4 | 0.2 | yes | FLOW-445b |
| projects | StatesProjectsEmpty | /projects?preview=empty | 1.1 | 0.3 | 1.1 | 0.3 | yes | FLOW-445b |
| recurring | Recurring | /e2e/recurring | 3.5 | 0.3 | 3.4 | 0.3 | yes | FLOW-447b |
| recurring | RecurringSwipe | /e2e/recurring?preset=swipe | 3.4 | 0.3 | 3.4 | 0.3 | yes | - |
| recurring | RecurringIgnored | /e2e/recurring?preset=ignored | 3.5 | 0.4 | 3.5 | 0.4 | yes | - |
| recurring | RecurringItem | /e2e/recurring-charge?preset=item | 4.2 | 0.9 | 4.2 | 0.9 | yes | - |
| recurring | RecurringLate | /e2e/recurring-charge?preset=late | 3.3 | 0.6 | 3.3 | 0.6 | yes | - |
| recurring | RecurringPace | /e2e/recurring-charge?preset=pace | 4.4 | 0.8 | 4.7 | 1 | yes | - |
| recurring | StatesRecurringLoading | /recurring?preview=loading | 0.4 | 0.3 | 0.4 | 0.2 | yes | - |
| recurring | StatesRecurringEmpty | /recurring?preview=1 | 3.6 | 1.9 | 2.5 | 0.8 | yes | - |
| review | Review | /review?preview=1&e2e=list&case=suggest | 3.8 | 0.6 | 3.8 | 0.7 | yes | - |
| review | ReviewSheet | /review?preview=1&e2e=list&case=suggest&board=sheet | 4.5 | 0.8 | 4.9 | 1.2 | yes | - |
| review | ReviewNoSuggestion | /review?preview=1&e2e=list&case=none&rows=4&board=nosuggestion | 3.9 | 1.2 | 3.9 | 1.3 | yes | - |
| review | ReviewDone | /review?preview=1&e2e=list&rows=0&board=done | 3.8 | 1.9 | 3.3 | 1.3 | yes | - |
| review | ReviewSplitDone | /review?preview=1&e2e=list&case=split | 4.8 | 0.7 | 5 | 0.8 | yes | - |
| review | ReviewList | /review/all?preview=1&e2e=list | 7.5 | 2.2 | 7.5 | 2.2 | yes | FLOW-365b |
| search | Search | /search?preview=search | 2.6 | 0.8 | 2.6 | 0.8 | yes | - |
| search | SearchResults | /search?preview=search&q=northline%20supply | 5.6 | 0.5 | 5.5 | 0.4 | yes | - |
| search | SearchFilters | /search?preview=search&q=northline%20supply&sheet=filters | 3.4 | 0.4 | 3.5 | 0.4 | yes | - |
| search | SearchFiltered | /search?preview=search&q=northline%20supply&project=birch-lane | 4.2 | 0.7 | 4 | 0.5 | yes | - |
| search | SearchProject | /search?preview=search&q=birch | 5.2 | 0.4 | 5.1 | 0.3 | yes | - |
| search | SearchEmpty | /search?preview=search&q=tilemart&period=month&at=2026-10 | 2.4 | 0.7 | 2.2 | 0.4 | yes | - |
| settings | Settings | /e2e/settings?board=1 | 3.1 | 0.7 | 3.1 | 0.8 | yes | FLOW-512b |
| settings | SettingsCategories | /e2e/categories?preview=1 | 4.8 | 1.2 | 4.7 | 1.2 | yes | FLOW-512b |
| settings | SettingsTeam | /e2e/team?proof=1&sheet=invite&email=1&board=1 | 2.7 | 1.6 | 2.8 | 1.6 | yes | FLOW-512b |
| settings | SettingsMcp | /e2e/connections/ai | 4.6 | 0.9 | 4.4 | 0.7 | yes | - |
| settings | SettingsMcpCode | /e2e/connections/ai?assistant=empty&mint=1 | 5.7 | 0.9 | 5.8 | 1 | yes | - |
| settings | SettingsMcpConnected | /e2e/connections/ai?assistant=connected | 3.4 | 1.1 | 3.4 | 1.1 | yes | - |
| settings | SettingsSumit | /e2e/connections/sumit?state=problem | 4 | 0.8 | 3.8 | 0.7 | yes | - |
| settings | SettingsSumitNew | /e2e/connections/sumit?state=new | 3.7 | 0.8 | 3.5 | 0.7 | yes | - |
| settings | SettingsSumitConnected | /e2e/connections/sumit | 2.5 | 0.9 | 2.5 | 0.9 | yes | - |
| settings | SettingsMercury | /e2e/connections/mercury | 2.6 | 0.9 | 2.6 | 0.9 | yes | - |
| settings | SettingsMercuryNew | /e2e/connections/mercury?state=new | 4.3 | 0.5 | 4.1 | 0.4 | yes | - |
| settings | StatesTeamEmpty | /e2e/team?proof=1&team=alone | 1.6 | 0.4 | 1.4 | 0.3 | yes | - |
| settings | SettingsRename | /e2e/business?board=1&sheet=rename | 4 | 1.5 | 4.2 | 1.5 | yes | - |
| settings | SettingsNotifications | /e2e/notifications?board=1 | 2.4 | 1.4 | 2.4 | 1.4 | yes | - |
| settings | SettingsTheme | /e2e/settings?board=1&sheet=theme | 2.6 | 0.5 | 2.7 | 0.5 | yes | - |
| settings | SettingsSwitch | /e2e/settings?board=1&sheet=switch | 2.3 | 0.5 | 2.3 | 0.5 | yes | - |
| split | Split | /e2e/split-category?board=split | 2.9 | 0.3 | 2.9 | 0.4 | yes | - |
| split | SplitEmpty | /e2e/split-category?board=empty | 1.9 | 0.1 | 1.9 | 0.1 | yes | - |
| split | SplitPicker | /e2e/split-category?board=picker | 2.9 | 0.3 | 3 | 0.3 | yes | - |
| split | SplitOver | /e2e/split-category?board=over | 2.8 | 0.4 | 2.9 | 0.4 | yes | - |
| split | SplitTwice | /e2e/split-category?board=twice | 2.9 | 0.4 | 2.9 | 0.4 | yes | - |
| states | States | /e2e/cash-loading | 1.3 | 0.5 | 1.1 | 0.3 | yes | FLOW-375 |
| states | StatesHomeReveal | /e2e/cash-loading | 1.1 | 0.3 | 1.1 | 0.3 | yes | FLOW-375 |
| states | StatesHomeEmpty | /e2e/cash-empty | 4.7 | 1.4 | 4.7 | 1.4 | yes | FLOW-375 |
| states | StatesLoansEmpty | /e2e/loans?loans=none | 1.8 | 0.6 | 1.7 | 0.6 | yes | FLOW-375 |
| states | StatesSearching | /search?preview=loading&q=northline | 0.2 | 0.1 | 0.2 | 0.1 | yes | - |

Result: 106 frames measured, 106 pass, 0 fail. Largest text-masked mismatch: 2.6%. No route was blank or errored.
