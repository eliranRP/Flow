# Review round 7: library chrome, a real drain, and shared costs stay split

**Date:** 2026-09-28
**Status:** Accepted

## Context

The review of `6a75ac2` asked for one blocking library fix and seven should-fix items, plus the UI review's should-fix list, nits, and two open conflicts. The Flow Test SUMIT account is restricted by ActionsBilling obligo, so this round does not call the live SUMIT API.

## Decision

1. Split uses `ScreenHeader` (`leading`, `trailing`, `size="compact"`), `Chip`, `PercentField`, and `FigureLine` for "נותר לשייך". Onboarding uses `ProgressBar`. The meter says "שלב 1 מתוך 1", because that flow is one screen. It never says "שלב 1 מתוך 4".
2. `private.schedule_drain()` schedules `flow-sumit-drain` every five minutes when `pg_cron`, `pg_net`, and a non-empty Vault `cron_secret` exist. The job posts to Vault `flow_sync_url`, or to `http://kong:8000/functions/v1/sumit-sync` when that URL is missing. Create `CRON_SECRET` once, store it as the Edge secret and as Vault `cron_secret`, store `flow_sync_url`, then migrate or call `private.schedule_drain()`. The drain check fails when the secret or the service role is missing. A wrong or empty `x-flow-cron` is 401. The real path uses ciphertext that cannot be opened, so decrypt fails before any SUMIT request, `last_error` is `sync_failed`, and the marker is unclaimed.
3. `reassign_transaction` refuses `pnl_role = 'shared'` and an open review item whose reason is `unallocated_shared`, with `shared costs are split, not assigned to one project`. The transaction screen sends those rows to Split. A normal expense reassignment is one 100% allocation. Undo restores a multi-row split. Income reassignment clears the project. Another company cannot undo. Anon cannot execute either function.
4. A SUMIT body with `Status` other than 0 sets `last_error` to `sumit_rejected`. The Hebrew is "SUMIT חסמה זמנית את החיבור. נבדוק שוב מאוחר יותר." `reject_attempts` increments and `next_attempt_at` is now plus 5 minutes, 15 minutes, 1 hour, 6 hours, then 24 hours. The drain and the cron job skip a row until that time. A successful stamp resets both columns. HTTP other than 200 stays `sync_failed`. This round does not call the live SUMIT API.
5. The add sheet drops the AI promise until a Gemini path exists. There is no Gemini client and no key in the repo.
6. The "העלאת דוח בנק" row is removed. This supersedes the bank-row sentence in [0065](0065-review-round5.md) point 35 and point 40. Disabled rows do not show a chevron, and a disabled row is at 45% opacity.
7. `/upload` is removed. `txn_source` is `sumit`, `manual`, or `photo`. The UploadProcessing story and the Hapoalim line in `04-add.md` are removed.
8. The production build writes `app/bundle-graph.json` outside `dist`. The hosted bundle does not contain that file.
9. `/install` renders `InstallScreen` from the browser, and Settings links there while the app is not standalone.
10. The close control is at the inline start on Install, Split, and invoice reading. The example tag is at the inline end. This amends [0065](0065-review-round5.md) point 39 and [0029](0029-pwa-install-prompt.md).
11. Hover and pressed use `--surface-hover`. Selected and focus-visible keep `--color-tint`. This amends [0065](0065-review-round5.md) point 29.
12. The preview banner sits in the band's existing bottom padding, so a loading Home band matches the loaded band. A toast over an open sheet sits above the sheet foot. Invoice reading titles align to the inline start. The lock-screen cards sit in the lower half, the tile is larger, and a home indicator is drawn. An error toast uses the info mark. A balanced split keeps the check in the figure value. A sheet title draws its focus ring only after Tab. One category transaction reads "תנועה אחת". The change picker hides a hidden category.

## Alternatives rejected

Showing "שלב 1 מתוך 4" on a one-screen onboarding. Leaving the bank row disabled. Retrying a SUMIT rejection every five minutes. Calling the live SUMIT API while the test account is billing-restricted. Serving `bundle-graph.json` from the host. Painting hover with the selected accent tint.

## Consequences

`pnpm db:test` covers the shared refusal, the 100% allocation, undo of a split, income, cross-tenant undo, and anon. The drain check is `playwright test -c playwright.drain.config.ts` from `app/`. The live SUMIT e2e stays unrun until the Flow Test account is unblocked.
