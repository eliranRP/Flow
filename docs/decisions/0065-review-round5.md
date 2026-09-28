# Review round 5: real saves, a real drain, and the overhead share

**Date:** 2026-09-28
**Status:** Accepted

## Context

The code review of `413b60d` passed the security rule. Four controls still pretended to work: reassignment from the transaction sheet, the monthly split toggle, status chips that were not read from the books, and an overhead share of zero. The drain was scheduled with an empty cron header, Home Empty promised an Excel upload, notification switches looked live, story lists were inlined in the screen, a new category did not save, and a failed overhead save left the switch on.

## Decision

1. `reassign_transaction(p_id, p_project_id, p_category_id)` is security definer with `search_path = ''`. It checks the company and that the category kind matches the direction. Income clears the project, the role, the allocations, and any overhead row. An expense requires a project of the same company and replaces the allocations with one 100% share, the same shape as one share in `save_split`. It sets `user_assigned`, so a later sync keeps the assignment. An open review item is closed as `changed`. The prior state is stored in `reassign_undo`, which is revoked from public, anon, and authenticated. The function returns that row's id. `undo_reassign` restores the project, category, role, flag, allocations, overhead, and the open review item, then sets `undone_at`. Both functions are revoked from public and anon. The transaction sheet "שינוי שיוך" calls this RPC and offers "ביטול" on the toast. Income sends a null project. There is no second reassignment path.
2. The split monthly toggle is disabled and off. Its hint is "כלל חודשי יגיע בהמשך". Save still sends only `p_shares`.
3. `get_transaction` returns `review_status`, `paid`, and `open_gross_agorot`. An open item shows "ממתין לאישור". Approved or changed shows "מאושר". Skipped or unknown shows no review chip. A non-zero open gross shows "טרם נגבה". Otherwise a paid row shows "שולם". There is no hard-coded "ידני" chip.
4. `ScreenHeader` has `leading`, `trailing`, and `size="compact"`. "נותר לשייך" is a `FigureLine`. `ListRow` has a skeleton variant. Each has a story.
5. Overhead share follows [0021](0021-shared-costs-and-overhead.md) and `docs/module-1-project-pnl/calculations.md`. The share is overhead profit times this project's income divided by company project income. No owner weights are used. This amends point 2 of [0064](0064-review-round4.md). Rounding is to the nearest ₪100 (10,000 agorot), half away from zero. The remainder goes to the project whose exact share was reduced the most. If none was reduced, it goes to the largest income. Ties use `projects.name` ascending, because there is no project-code column. A project with no income gets 0 and does not absorb the remainder. When company project income is 0, `overhead_weighted` is false and `overhead_share_agorot` is null. The hint says the share cannot be split. The hero stays on the before-overhead profit. The stored share is a cost, so displayed profit is own profit minus that share. A negative cost means overhead was net income.
6. `sumit-sync` has `verify_jwt = false` and still checks `x-flow-cron` against `CRON_SECRET` in constant time, or a user bearer. The migration creates `pg_net` and `pg_cron` when the image allows it, and does not fail when it cannot. `flow-sumit-drain` is scheduled only when both extensions exist and Vault `cron_secret` is non-empty. An empty header is not a fallback, on the local stack or anywhere else. This amends point 8 of [0064](0064-review-round4.md). A local drain check inserts a marker, POSTs `x-flow-cron`, and expects `claimed_at`.
7. Home Empty body is "הרווח יופיע כאן אחרי ש-SUMIT מחובר." The action stays "חיבור SUMIT". There is no Excel upload. This amends point 14 of [0064](0064-review-round4.md). The band placeholder "כאן יופיע הרווח הנקי של העסק" stays.
8. The three notification switches are disabled, off, and hint "לא פעיל" until push exists.
9. Story project and category lists are arguments of `TransactionScreen`. The screen does not inline them.
10. `create_category(p_name, p_kind)` is security definer with `search_path = ''`. It checks the company, trims the name, requires two characters, and keeps the name unique per kind. "קטגוריה חדשה" calls it. Categories Empty stays "אין עדיין קטגוריות" / "קטגוריות נוצרות מהמסמכים של SUMIT או כשמוסיפים אחת".
11. A failed overhead save rolls the switch back to the previous value, on the project screen and in Settings.
12. A static `ListRow` does not show a chevron. Settings rows that do not navigate (Google, the company, "SUMIT מחובר") are static. Rows that navigate or open a sheet keep the chevron.
13. Reference frames live in `reference-frames.stories-support.tsx`. ESLint treats that file like a story and blocks screens from importing it.
14. The change form's phase includes the review query. While it loads or fails, an income item is not treated as an expense. A missing item does not show the expense form.
15. The invoice disclosure sets `aria-expanded`.
16. `reopen_review` restores `remembered_category_id` only when it still equals `written_remembered_category_id`, the value that approval wrote. A later supplier change is left in place.
17. Home and Unpaid both take the absolute value of `open_gross_agorot` through `absAgorot`.
18. Authenticated insert is refused on projects, customers, suppliers, transactions, allocations, split_rules, split_rule_targets, and review_queue, the same 42501 as categories and overhead.
19. Raw pixel leftovers in `ui.css` use tokens. Token definitions in `:root` stay in pixels.
20. A toast action runs once. The second tap in the same turn is ignored.
21. A successful sync stamps `last_sync_at` with `stamp_sumit_sync`. That update keeps `last_error` only when it already starts with `sync_sweep`. The function is service_role only.
22. Sync opens every seal with the one `SUMIT_KEK`. `kek_version` is stored and is not consulted. Rotation is recorded and is not supported. This is also in [0048](0048-sumit-key-envelope.md).
23. The category grip is removed. Reorder is not implemented, so the control is not shown.
24. The period sheet pads with tokens, scrolls inside the 56px cap, and keeps "כל התקופה" on screen. Library components do not set a native `title` attribute. `aria-label` stays. This amends the `title` sentence in [0062](0062-audit-layout-calls.md).
25. The review-count badge sits on the icon's top corner, with a surface ring, and is not clipped. Counts above 99 render as 99+.
26. Toast, notice, form error, and empty copy use an icon and isolated RTL text. The error mark is an SVG, not a "!" character.
27. A loading band uses the same side gutter as the loaded band (`--space-side`). Home loading stacks greeting, label, figure, change pill, and the sub-line with `--space-3` between rows. Project loading uses that same stack. "מצב תצוגה" sits in the band's bottom padding (`--band-pad-bottom`) instead of on top of the bars.
28. A row tint (hover, pressed, and selected) is a layer behind the content. It extends `--space-3` past the content on each side and uses `--radius-input`. The content stays on the screen gutter, and its position does not change between states. Block padding stays `--row-pad`. The same layer covers `ListRow`, `RadioRow` (change-sheet and period options), and `ReviewCard` lines. Settings rows are `ListRow`s. Hover still applies only inside `@media (hover: hover)`. This amends point 5 of [0060](0060-library-review-calls.md).

## Alternatives rejected

Leaving "שינוי שיוך" as a local rename. Enabling the monthly toggle before a rule exists. Showing ₪0 when project income is zero. Scheduling the drain with an empty cron header. Promising an Excel upload on Home Empty. Keeping a grip that does not reorder.

## Consequences

`pnpm db:test` covers the share, the remainder, a missing share, cross-tenant reassignment and categories, a re-sync that keeps the assignment, undo, the eight insert refusals, and the supplier-category undo. The app tests cover the switch, its rollback, the chips, the reassignment call, the disabled monthly toggle, the notification switches, and a toast action that runs once. The drain check is `playwright test -c playwright.drain.config.ts` from `app/`.
