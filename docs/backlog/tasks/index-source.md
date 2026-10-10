# Flow backlog

Open tasks only. How to claim and finish a task is in the [backlog guide](README.md). Keep each task's status line current; a claim lives in an open draft PR titled `FLOW-<id>: <title>` with a `Claim` block in its body ([how](README.md#tracking-progress-so-lanes-dont-collide)). Before you start, read the open PRs and the table below.

Types: `SMALL CYCLE` (one PR, no new screen), `SMALL UI` (one PR with a UI change, design review), `PLAN FIRST` (plan and mockup, owner approval before any build), `BUG`, `MCP` (flow-mcp work), `BACKLOG NIT` (reviewer follow-ups, batch several per PR).

Statuses: `ready`, `claimed`, `in-progress`, `plan-first`, `on-hold` (owner's go needed), `future` (parked by the owner, in [Future features](#future-features)), `blocked`, `done`.

Last full sync: 2026-10-07. Lanes table: 2026-10-10 14:45Z.

## Lanes now

Which lanes run and what each one is on ([lanes](README.md#lanes-and-how-many-run-at-once)). At most 2 dev task lanes at once. The open PRs and their `Claim` blocks say exactly which files are taken; this table says who owns what. Only the lane manager edits it (in tasks/index-source.md, in its own commits) when a lane starts, stops, or changes what it owns; a lane's PR changes only its own task files.

| Lane | Owns now | Next |
| --- | --- | --- |
| Dev lane 3 | Parked (FLOW-309 pairing server done); takes the next server task | Server side of the next plan-first feature |
| Dev lane 4 | FLOW-911 done (#542); real-user `get_project` snapshot at 15:00Z (edge logs, read-only) | Compute-size evidence for the owner only if typical project opens stay over 0.7 s |
| UI lane 1 | FLOW-422 done (#537); idle | Next cycle 18 item from the design lead |
| UI lane 2 | FLOW-423 done (#538); idle | Next cycle 18 item on the review and transaction screens |
| UI lane 3 | FLOW-912: steadier page-speed check (median of 5 opens, same 700 ms limit, `app/perf`), then FLOW-910: reload once when a new service worker takes control (`app/src/sw-reload.ts`) | Settings, project screens, and other areas outside the review and transaction screens |
| Temporary lanes (owner asks, one thread each) | FLOW-430 #528 missing-bill suggested match · FLOW-432 #531 split parts on the list row (merges after #540, migration order) · FLOW-434 #536 loan page (owner picked A plus percentages and a future-payments view; building) · FLOW-908 #540 search month totals. Closed today at their merge: FLOW-422, 423, 431, 433, 435, 707, 909, 911 | Each closes at its merge |
| UI/UX review cycle | Design lead; cycle 18 on the 14:31Z deploy (e645191), findings from FLOW-424; signs off UI PRs in a PR comment | Next deploy batch |
| Production QA | Deploy and prod check after each deploy, sandbox QA company only (13:50Z and 14:31Z deploys verified) | Next deploy batch |
| Backlog bug fixes | Idle; the owner's bugs run in their own threads today | Next bug the lane manager routes |
| MCP/data agent | Real data through the MCP tools; never changes the repo | Requests go to the top of the queue |
| Retired | Dev lane 1 (2026-10-10 08:21Z), Dev lane 2 (FLOW-406 done), UI lane 4 (2026-10-10 10:41Z, nothing ready in Search, loans, push), File split (FLOW-807 done #287) | Reopened by the lane manager when the backlog needs them |
## Priority queue

Take tasks in this order. On-hold and plan-first items are listed so nobody starts them by mistake. Future features are not in the queue; they wait in [Future features](#future-features).

| # | Id |
| --- | --- |
| 1 | FLOW-102 |
| 2 | FLOW-109 |
| 3 | FLOW-111 |
| 4 | FLOW-201 |
| 5 | FLOW-202 |
| 6 | FLOW-105 |
| 7 | FLOW-311 |
| 8 | FLOW-602 |
| 9 | FLOW-603 |
| 10 | FLOW-112 |
| 10b | FLOW-121 |
| 10c | FLOW-122 |
| 10d | FLOW-126 |
| 10e | FLOW-127 |
| 11 | FLOW-204 |
| 12 | FLOW-203 |
| 13 | FLOW-116 |
| 13b | FLOW-128 |
| 13c | FLOW-206 |
| 14 | FLOW-509 |
| 15 | FLOW-902 |
| 16 | FLOW-901 |
| 17 | FLOW-107 |
| 18 | FLOW-511 |
| 19 | FLOW-113 |
| 20 | FLOW-301 |
| 21 | FLOW-302 |
| 22 | FLOW-303 |
| 23 | FLOW-108 |
| 24 | FLOW-103 |
| 25 | FLOW-106 |
| 26 | FLOW-701 |
| 27 | FLOW-501 |
| 28 | FLOW-604 |
| 29 | FLOW-117 |
| 30 | FLOW-118 |
| 31 | FLOW-119 |
| 32 | FLOW-120 |
| 32b | FLOW-129 |
| 32c | FLOW-130 |
| 33 | FLOW-208 |
| 34 | FLOW-605 |
| 34b | FLOW-606 |
| 35 | FLOW-209 |
| 36 | FLOW-125 |
| 37 | FLOW-123 |
| 37b | FLOW-131 |
| 37c | FLOW-312 |
| 37d | FLOW-133 |
| 37e | FLOW-132 |
| 37f | FLOW-134 |
| 37g | FLOW-135 |
| 37h | FLOW-136 |
| 38 | FLOW-313 |
| 39 | FLOW-314 |
| 40 | FLOW-124 |
| 41 | FLOW-319 |
| 42 | FLOW-320 |
| 43 | FLOW-410 |
| 44 | FLOW-321 |
| 45 | FLOW-322 |
| 46 | FLOW-411 |
| 47 | FLOW-323 |
| 48 | FLOW-324 |
| 49 | FLOW-325 |
| 50 | FLOW-326 |
| 51 | FLOW-327 |
| 52 | FLOW-328 |
| 53 | FLOW-329 |
| 54 | FLOW-330 |
| 55 | FLOW-331 |
| 56 | FLOW-332 |
| 57 | FLOW-333 |
| 58 | FLOW-334 |
| 59 | FLOW-335 |
| 60 | FLOW-336 |
| 61 | FLOW-337 |
| 62 | FLOW-706 |
| 63 | FLOW-338 |
| 64 | FLOW-339 |
| 65 | FLOW-340 |
| 66 | FLOW-341 |
| 67 | FLOW-342 |
| 68 | FLOW-343 |
| 69 | FLOW-344 |
| 70 | FLOW-345 |
| 71 | FLOW-347 |
| 72 | FLOW-348 |
| 73 | FLOW-349 |
| 74 | FLOW-413 |
| 75 | FLOW-350 |
| 76 | FLOW-414 |
| 77 | FLOW-351 |
| 78 | FLOW-352 |
| 79 | FLOW-353 |
| 80 | FLOW-354 |
| 81 | FLOW-355 |
| 82 | FLOW-138 |
| 83 | FLOW-356 |
| 84 | FLOW-357 |
| 85 | FLOW-358 |
| 86 | FLOW-359 |
| 87 | FLOW-360 |
| 78 | FLOW-346 |

Everything else follows by area, roughly in priority order inside each area.

## P&L and loans

- FLOW-102
- FLOW-109
- FLOW-111
- FLOW-123
- FLOW-131
- FLOW-112
- FLOW-121
- FLOW-126
- FLOW-127
- FLOW-122
- FLOW-113
- FLOW-116
- FLOW-128
- FLOW-107
- FLOW-125
- FLOW-108
- FLOW-124
- FLOW-103
- FLOW-105
- FLOW-117
- FLOW-118
- FLOW-119
- FLOW-120
- FLOW-129
- FLOW-130
- FLOW-132
- FLOW-134
- FLOW-135
- FLOW-136
- FLOW-106
- FLOW-110
- FLOW-114
- FLOW-115
- FLOW-414

## MCP

- FLOW-201
- FLOW-202
- FLOW-203
- FLOW-204
- FLOW-205
- FLOW-206
- FLOW-210
- FLOW-211
- FLOW-212
- FLOW-207
- FLOW-208
- FLOW-209
- FLOW-213

## Transactions and app UX

- FLOW-311
- FLOW-133
- FLOW-137
- FLOW-312
- FLOW-301
- FLOW-302
- FLOW-313
- FLOW-303
- FLOW-314
- FLOW-304
- FLOW-315
- FLOW-305
- FLOW-307
- FLOW-308
- FLOW-309
- FLOW-310
- FLOW-319
- FLOW-320
- FLOW-321
- FLOW-322
- FLOW-323
- FLOW-324
- FLOW-325
- FLOW-326
- FLOW-327
- FLOW-328
- FLOW-329
- FLOW-330
- FLOW-331
- FLOW-332
- FLOW-333
- FLOW-334
- FLOW-335
- FLOW-336
- FLOW-337
- FLOW-338
- FLOW-339
- FLOW-340
- FLOW-341
- FLOW-342
- FLOW-343
- FLOW-344
- FLOW-345
- FLOW-347
- FLOW-348
- FLOW-349
- FLOW-350
- FLOW-351
- FLOW-352
- FLOW-353
- FLOW-354
- FLOW-355
- FLOW-138
- FLOW-356
- FLOW-357
- FLOW-358
- FLOW-359
- FLOW-361
- FLOW-362
- FLOW-420
- FLOW-422
- FLOW-423
- FLOW-346
- FLOW-431

## Projects and reports

- FLOW-401
- FLOW-402
- FLOW-403
- FLOW-404
- FLOW-405
- FLOW-406
- FLOW-360
- FLOW-407
- FLOW-408
- FLOW-409
- FLOW-410
- FLOW-411
- FLOW-412
- FLOW-413
- FLOW-432
- FLOW-418
- FLOW-415
- FLOW-416
- FLOW-417
- FLOW-419
- FLOW-433
- FLOW-435

## Onboarding, Settings and connectors

- FLOW-501
- FLOW-502
- FLOW-503
- FLOW-504
- FLOW-505
- FLOW-506
- FLOW-507
- FLOW-508
- FLOW-509
- FLOW-511
- FLOW-510

## Multi-company and team

- FLOW-601
- FLOW-602
- FLOW-604
- FLOW-603
- FLOW-606
- FLOW-605
- FLOW-421

## Jev

- FLOW-701
- FLOW-702
- FLOW-703
- FLOW-704
- FLOW-707

## Infra and CI


- FLOW-705
- FLOW-706
- FLOW-801
- FLOW-802
- FLOW-804
- FLOW-807
- FLOW-808
- FLOW-809
- FLOW-810
- FLOW-811
- FLOW-812
- FLOW-813

## Data hygiene (public repo)

- FLOW-901
- FLOW-902
- FLOW-903
- FLOW-904
- FLOW-905
- FLOW-906
- FLOW-907
- FLOW-908
- FLOW-909
- FLOW-911

## Future features

Features the owner parked for later. Nobody claims, plans, or builds them, and the lane manager doesn't schedule them, until the owner brings one back; then it moves to its area and the priority queue with a new status.

| Id | Parked |
| --- | --- |
| FLOW-306 | 2026-10-09 |
| FLOW-803 | 2026-10-09 |
| FLOW-805 | 2026-10-09 |
| FLOW-806 | 2026-10-09 |

## Done

Recently finished tasks move here with their PR, so the history stays readable. Older history is in [docs/changelog.md](../changelog.md).

| Id | Title | PR |
| --- | --- | --- |
| FLOW-209 | get_project follow-ups (#90 review) | #126 |
| FLOW-130 | Lock timeouts return retry in every MCP write (#123 review) | #124 |
| FLOW-120 | Loan project follow-ups (#89 review) | #121 |
| FLOW-104 | Reversals across directions | #76 |
| FLOW-101 | Loan payments count by their split parts | #70 |
| — | Categories kept out of the P&L, `set_category_pnl` | #67 |
| — | MCP `get_project` with a basis parameter | #66 |
| — | MCP `assign_expense_split` | #68 |
