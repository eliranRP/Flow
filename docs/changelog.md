# Changelog

## 2026-10-03

Review queue, round 4. A SUMIT sync keeps a line pick: `category_assigned` owns the category, and a project pick keeps the project, the role, the allocations, and the overhead row. Picking the suggested category clears הצעה. אישור on a shared or split card still calls `approve_split_review`, because `resolve_review` raises. A confirmation toast stays under the header after the sheet closes. Decision [0081](decisions/0081-review-queue-list.md).

Review queue, round 3. A project pick from a card line removes the overhead row and refuses a shared cost, on the same guard as אישור. A field-only save owns only that field: `project_assigned` marks the project, and the other line keeps הצעה. The line-pick toast sits under the header. Focus returns to the line on a list-opened card. ✕ on a picker that is not a card line returns to the summary. Decision [0081](decisions/0081-review-queue-list.md).

## 2026-10-02

Settings cycle 2. The account row shows the business name and the Google email. With no company it is disabled and says "אין עסק עדיין". The sections are חיבורים, תצוגה, and עוד, and the footer is "Flow 0.1". The פרויקטים row and the three disabled switches are gone. SUMIT and עוזר keep their current actions. Decision [0082](decisions/0082-settings-redesign.md).

Settings becomes one screen: the account row, חיבורים, תצוגה, and עוד. The footer is "Flow 0.1". Three disabled switches and the פרויקטים row leave the screen. SUMIT and עוזר each open one sheet, and a failed status is one "ניסיון חוזר". Decision [0082](decisions/0082-settings-redesign.md) amends the Settings section of [0080](decisions/0080-mcp-connector.md). The screen is unchanged in this record. 0081 stays the review-queue list.

Review queue, round 2. The in-memory review fixture stays on the dev server and is absent from the hosted bundle. A pick from a card line saves only that field (`resolve_review` with `p_resolve` false) and leaves the item open, so the card stays and shows the new value. The queue address advances only on `/review`. A confirmation toast sits under the header, not on the tab bar. Decision [0081](decisions/0081-review-queue-list.md).

Review queue, round 1. אישור from a list card keeps the following item in the address, so the third step does not jump back to the oldest. A picker opened from a card line returns to that card. הצג הכול sits at the end of the "N מתוך M" row, and the project and category lines are one row tall. A list card shows its place, not the progress bar. After the last item, Back goes to `/review`. Decision [0081](decisions/0081-review-queue-list.md).

The review queue lists every pending item. הצג הכול sits under the progress bar and opens `/review/all`. A row opens that item's card, and אישור then continues with the item that followed it. The project and category lines open the picker, and the notes say הקישו לבחירה. The split title stays "מפוצל · N פרויקטים". Decision [0081](decisions/0081-review-queue-list.md).

Clip-check measures each text node on the nearest ancestor that is not `display: inline` or `display: contents`, once per container. A `<bdi>` in a hint, mixed text, and `<p><bdi class="ui-num">` are that container's clip. Only the `clip-no-text` tag skips a story. A pass names the skipped stories. One view says "1 story view". A setup failure deletes a stale crash report. `ui-pick-label` on `screens-routes--change-project-picker` stays in UI polish. Unpaid-list clips only at 320, as two hints that should use `wrapHint`. An inline box is as wide as its text and never clips, so the check measures the block around it. [PITFALLS.md](review/PITFALLS.md).

Clip-check measures every element that holds its own text, and skips a story tagged `clip-no-text`. A crash report keeps the views measured before the crash. The clip count is a count of views. `screens-routes--unpaid-list` and `screens-routes--add-sheet` hints stay for UI polish, where they should wrap with `.ui-row-hint-wrap`.

Clip-check review, second pass. A Storybook error, a story that never renders, and a story that measured nothing exit 2 before a clip, and those lines are printed. Visually hidden text, a box of about 1px, is not measured. Every run writes `clip-report.json` and `clip-report.txt`. Q-3 is a UI polish task: sheet titles and route-sheet titles opt into `data-clip-ok`, and button labels, `.ui-row-hint`, and `.ui-meter-label` wrap instead of truncating. It is not applied in this pull request.

Clip-check review. The script waits for the story, for `document.fonts.ready`, and for sheet panels. It fails when Storybook shows an error or when nothing was measured. One function decides a clip. Ellipsis is exempt only on `.ui-row-title` and `[data-clip-ok]`; a single-line hint is measured. A crash exits 3. The server picks an ephemeral port. The browser cases run in the Storybook smoke, after Playwright is installed. `pnpm test` does not launch a browser. Q-1: the signing spike and the CI runbook read Auth config with `SUPABASE_AUTH_READ_TOKEN`, not `SUPABASE_ACCESS_TOKEN`. Q-2: an unknown `?assistant=` preview value shows the error state. Both are tracked tasks and are not applied in this pull request.

Design findings. Inline text inside a vaul sheet inherits `user-select: none`, so selection is probed on a desktop fine pointer. A fast drag can dismiss shown-once content. A clip-check pass does not cover copy, select, or gesture. A `min-block-size` fix is re-sampled at 320. Button labels use the `ErrorState` action name. A state-table gap is spec drift. [PITFALLS.md](review/PITFALLS.md).

Review checklists. Read [PITFALLS.md](review/PITFALLS.md) at the start of every cycle. [CHECKLIST-code.md](review/CHECKLIST-code.md) and [CHECKLIST-design.md](review/CHECKLIST-design.md) are the handoff lists. `pnpm clip-check` measures text overflow at 320, 360, and 390 in light and dark after `pnpm build-storybook`. The range-sheet test ends on today, so it does not require a later day. The checklists also catch isolation tests with no positive control, fixtures that skip nullable fields, a reused secret name, a crash exit that collides with a criterion, ARIA names on generic elements, story-only props, real personal data, date-dependent tests, a live check with no person or method, and a self-check line that is a justification.

MCP cycle 2 design review, round 2. A mouse can select the shown-once secret, and a drag on it does not dismiss the sheet. Decision [0080](decisions/0080-mcp-connector.md) records the error row, "סיום", the step-2 labels, and the wrapped secret. The other design nits stay in the backlog.

MCP cycle 2 review, round 1. `search_expenses` can search filed and all rows. A missing signing key hides the tools and returns a tool error. A token without `read` is refused. Token shape is a warning, not a deploy failure. The עוזר section follows SUMIT, the connected hint wraps, and a failed status load does not offer mint. Row hints use `t-hint` and `aria-describedby`. Decision [0080](decisions/0080-mcp-connector.md).

## 2026-09-30

Signing spike, about 18:10 IDT. The standby ES256 key passed. Kid `46a0230c-733c-401d-a3fb-4a2d9ee7de72` is standby. Auth's current key is unchanged. `FLOW_MCP_SIGNING_KEY` is a Supabase function secret. `FLOW_JWT_LEGACY` is not set. PostgREST accepted a 60-second pass for Flow Test and for the Erie owner, each with its own company. GET `flow-mcp` is 405 and carries `x-flow-cf-connecting-ip`. The local private key is deleted. Decision [0080](decisions/0080-mcp-connector.md).

MCP cycle 2. Settings has an עוזר row: a scope `RadioRow`, יצירת קוד, and ניתוק. `tools/list` returns the six read tools. The signed pass takes its user, company, and scope from that user's token row. The signing key is shared and has no user identity. The owner chose standby. Criterion 3 is not run until the standby key exists. Decision [0080](decisions/0080-mcp-connector.md).

MCP cycle 1 review, second pass. A missing, invalid, or expired access token fails the deploy before migrations and Pages. `supabase secrets list` is that probe. There is no skip path. The token expires in 30 days, and the date is kept in the CI runbook. A `bump_mcp_rate` error returns `unavailable`. Decision [0080](decisions/0080-mcp-connector.md).

MCP cycle 1 review. The signing spike of 2026-09-30 stopped on criterion 1, so this cycle does not set a signing key. The deploy checks the scoped access token and the pepper before migrations and Pages, writes `FLOW_MCP_PEPPER` from an env file, then deploys `flow-mcp`. Each hash stores its pepper kid. A `bump_mcp_rate` error fails closed. GitHub does not store a `service_role` JWT. The access token can read injected function secrets, and `SUPABASE_DB_URL` is in the same environment. Decision [0080](decisions/0080-mcp-connector.md).

MCP cycle 1. `flow-mcp` answers mint, revoke, and status. `tools/list` is empty. The credential wrappers take the user id from GoTrue `getUser` and are granted to `service_role` only. `private.mcp_writes` has `undone_at`, so an undo is single-use. Decision [0080](decisions/0080-mcp-connector.md).

Decision [0080](decisions/0080-mcp-connector.md). Credential wrappers take the user id from GoTrue `getUser` inside the function, never from the request body, and set `search_path` to `''`. Undo compares a `private.mcp_writes` snapshot of project, category, role, and shares, not `updated_at`, and an id that was not an assistant write is `not_found`. GitHub does not store a `service_role` JWT. Hosted functions receive `SUPABASE_SECRET_KEYS`, which a deploy token that can read secrets can also read, and `SUPABASE_DB_URL` is in the same environment. The connect sheet is two steps: a `RadioRow`, then "יצירת קוד". [0006](decisions/0006-confirm-not-type.md), [0011](decisions/0011-auto-approve-high-confidence.md), and [0069](decisions/0069-back-and-one-tap-review.md) say this record extends them.

Decision [0080](decisions/0080-mcp-connector.md), Accepted for a first release of 18 hours in three cycles. Flow accepts an assistant write with no confirmation of its own. Undo of a closed review calls `reopen_review`. The עוזר row is cycle 2. The app's אישור check, the visit counter, and שויכו היום are cycle 3, with the writes.

Deploys stay automatic. After both reviewer bots approve and CI is green, a push to `main` deploys without a person. The `production` environment has no required reviewer, and required pull request approvals stay at 0. `.github/CODEOWNERS` is ownership and notification only. It does not enforce review. Eliran accepts that owner risk. Decision [0079](decisions/0079-automatic-deploy-owner-risk.md).

The dry-run classifier accepts only the JSON result. The log must contain the DRY RUN line and exactly one object with `dryRun: true`. Malformed JSON fails, and so does a JSON line whose `dryRun` is not true. A pending text list next to `upToDate: true` fails. Pending JSON next to an up-to-date text line fails. When the JSON `migrations` list and a text `.sql` list are both present, the names must be equal. There is no plain-text success path. `.github/CODEOWNERS` lists `@eliranRP` on the migration, preflight, workflow, package, and config paths. That file is ownership and notification only. It does not enforce review. Decision [0078](decisions/0078-schema-v1-rename.md).

The dry-run classifier takes `--target remote` on the production path and `--target local` when `FLOW_CD_PREFLIGHT_LOCAL=1`. The preflight passes `--output-format json`. Up to date requires `upToDate: true` and empty `migrations`, `seeds`, and `roles`, and in production the `message` must start with `Remote`. A non-empty `migrations` array is pending, and those names are reported. GitHub Actions sets `CI` and does not set a coding-agent variable, which is why an earlier local e2e run printed plain text. `scripts/preflight-r23.sql` runs only when `20260929240000`, `20260929250000`, or `20260929260000` is not recorded, and then only when `rule_transactions_at_risk` and `rule_undo_rows_at_risk` are both 0. `supabase/migrations.lock` stores a sha256 per file. The comment in `20260928140000_phase1_slice.sql` again says `Apply after 20260927120000_schema_v1.sql.`

`schema_v1` is `supabase/migrations/20260928080538_schema_v1.sql`, the version recorded in hosted history. The file bytes are unchanged. Hosted history is not repaired. `supabase/migrations.lock` makes CI fail when a migration filename is renamed, removed, or reordered.

The deploy preflight reads the last line of psql output. A `SET` tag on its own line is no longer glued onto `on`. The `preflight-r23.sql` counts run only while one of `20260929240000`, `20260929250000`, or `20260929260000` is unrecorded. The dry-run result is read from the JSON line only. The e2e job runs that preflight against local Supabase.

CI runs on a pull request and on a push to `main`: typecheck, lint, unit tests, both bundle guards, Storybook, pgTAP, and the main Playwright suite against local Supabase. A push to `main` deploys only after lint, check, and e2e succeed on that commit. The hosted build is stamped and checked before the read-only preflight and the migration push, then Cloudflare Pages project `flow-app` is updated. The hosted bundle check requires the public Supabase URL and anon key in the dist, and it refuses `service_role` and `sb_secret_`. The three deploy secrets live only on the `production` environment, which is limited to `main`. A missing secret fails the deploy. Decision [0077](decisions/0077-deploy-after-ci.md). Secrets and rollback are in [CI and CD](runbooks/ci-cd.md).

The strict lint findings that were already in the app are fixed in place. Unused imports and unused hook calls are removed, callbacks that only returned a promise now return that promise directly, and `void` is no longer written inside a union. Screen behavior is unchanged.

Decision [0075](decisions/0075-save-on-tap-and-on-leave.md), amended. A toast is placed from the sheet's resting top, after the open scroll and transform, and it stays invisible until that position is final. At safe area 0 or 20 the sheet keeps its own padding. At 47, ✕ sits `--space-2` under the toast. Above a short sheet the gap is `--space-2`, with the pad already gone. The change sheet tags a project only when `project_suggested` is true. Approving a categorised split puts it on שויכו היום with its shares, and ביטול takes it off.

Decision [0075](decisions/0075-save-on-tap-and-on-leave.md), amended. The toast pad moves for 200ms and the toast fades in after that move. A later toast keeps the pad. Resize, rotation, and the keyboard place a visible toast again. The timer waits until the toast is on screen. `list_review` returns `project_suggested`. הצעה on a project line follows that flag. `approve_split_review` locks the open review, and a foreign company cannot close it.

Decision [0075](decisions/0075-save-on-tap-and-on-leave.md), amended. אישור on a categorised split calls `approve_split_review` and leaves the shares in place. A toast measures its height once, pads the sheet in one 200ms move, and fades in only after that move. The gap is `--space-2`. הצעה is per line: a split line is not a suggestion, and an owner pick clears it.

Decision [0075](decisions/0075-save-on-tap-and-on-leave.md), amended. Closing an unchanged change sheet does not write. A split hides לזכור לספק הזה. A tall toast keeps a gap from the screen edge, may cover the grabber and the empty top of a sheet, and never covers a header control. The sheet pads only when a control would be covered, and that pad moves once. A category the owner picked is not labelled הצעה, and אישור is enabled after a split category is saved. `list_review` returns `category_suggested`.

## 2026-09-29

Decision [0075](decisions/0075-save-on-tap-and-on-leave.md), amended. A toast that does not fit above a sheet keeps its full height in the safe area and never clips; the sheet content pads down so the toast does not cover a control. ביטול השינוי is the quiet hint link, and the hold sentence is the muted hint on the change sheet and on Split. The other split choices are disabled, not only a cursor. An income review's second pick sends a null project. The reviewer queue carries the split fields, a category tap stays open, and the card shows the category. The radio spinner size is the `--spinner-radio` token.

Decision [0075](decisions/0075-save-on-tap-and-on-leave.md), amended. The saving row shows a spinner in place of the check. A dismiss during a save waits, then closes. A toast too tall for the gap above a sheet stays in the safe area above it. ביטול השינוי, and a second dismiss, discard an incomplete change. `list_review` reports `pnl_role` and `share_count`, so a category tap on a split in the queue calls `set_transaction_category` and a project tap calls `collapse_split`. The loaded review row stays after the item closes. `collapse_split` refuses a finished project. The project picker opened from לפרויקט אחד hides פיצול בין פרויקטים.

Decision [0076](decisions/0076-collapse-split-to-one-project.md), Accepted. A split can return to one project. The split screen adds לפרויקט אחד, which opens the project picker. The note is "החלוקה תרד, והסכום כולו יעבור לפרויקט הזה." `collapse_split` moves the full net, removes the other shares, and returns an undo id. The change-sheet project picker does the same on a split, including an unallocated shared cost. Project totals and "כולל חלק מהוצאות משותפות" follow the move. This amends [0075](decisions/0075-save-on-tap-and-on-leave.md) and [0071](decisions/0071-shared-cost-copy.md).

Decision [0075](decisions/0075-save-on-tap-and-on-leave.md), Accepted. A category or project tap in Change assignment saves immediately, including a split, and a failed tap rolls the check back. Leaving the sheet or the split screen saves a valid pending change and stays open when the change is invalid. The summary save button is removed. The new-project name still has שמירה, because the name is typed. `set_transaction_category` was already keeping the shares; the check had never been written.

Decision [0073](decisions/0073-review-handoff.md) point 2. The reviewer guard also rejects id 2375135516, the totals with thousands commas and a leading ₪, פ"ת, ת"א, and פתח תקווה. The hosted check reads quoted URL and key values, checks their shape, adds the project ref, and fails when `app/.env.production` is missing or has fewer than those two values.

Decision [0074](decisions/0074-toast-and-remembered-supplier.md), amended. The shared-cost sentence uses the muted hint colour. The review card supplier wraps, and it is not cut. The remember arrow stays on the destination's line. A toast above a tall sheet keeps its minimum height and does not cover the header.

Decision [0073](decisions/0073-review-handoff.md) point 2. The reviewer guard also rejects Flow Test 2 ids and totals, פ״ת, ת״א, צבעי הגליל, מנופי, and the hosted Supabase URL and anon key. The reviewers-only build runs that guard.

Decision [0074](decisions/0074-toast-and-remembered-supplier.md), amended. The supplier's full name wraps and is never truncated. A toast over an open sheet sits just above the sheet and does not cover its header. Toast text uses balanced wrapping. The timer also pauses while the toast is touched. "כולל חלק מהוצאות משותפות" shows only when a category line includes a shared share, in the primary text colour.

Decision [0071](decisions/0071-shared-cost-copy.md) point 6, amended. A rule restore confirms a guess made before the rule existed. The one-time `restore_rule` audit records the flag from before the restore, and the row ends as an assignment. A reopened missing-project rule and a pending undo of a rule stay untouched.

A reviewers-only build uses invented sample names. `pnpm check:reviewer-bundle` fails on a known Flow Test 2 name. A hosted build fails when `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is set but empty. `check:bundle` watches `sampleSaveMode`, `sampleRun`, `reviewerBooks`, and `reviewerQueue`.

Decision [0074](decisions/0074-toast-and-remembered-supplier.md), Accepted. A toast with an action stays 5 seconds. A plain confirmation stays 4 seconds. The two-line minimum applies only when the text shrinks or wraps. A tap on a toast does not close the sheet under it. "לזכור לספק הזה" shows the supplier's full name, with an ellipsis when it does not fit. This amends [0069](decisions/0069-back-and-one-tap-review.md).

Decision [0071](decisions/0071-shared-cost-copy.md) point 6, amended. A category that matches the supplier's remembered rule is an assignment, not a guess. The backfill leaves those rows alone, puts back a rule row an earlier backfill already flipped, and writes an audit row for every flip.

A reviewers-only build sets `VITE_REVIEWER_BUILD=1` and leaves the Supabase URL and anon key empty, so it uses the sample names and not the hosted key. The hosted build leaves the flag unset. `pnpm check:bundle` fails on `/e2e/` and on a reviewer marker.

Decision [0072](decisions/0072-design-review-rulings.md) points 2, 14, 15, and 16. A toast action keeps a text-sized label and a hit area of at least 44×44, and a tap there runs the action. When the slot under an open sheet covers a control, the toast sits fully above the sheet instead of across its top edge. A shared cost refused before the write or by the database uses the info tone, לחלוקה, and 5 seconds. The queue opened from a project goes back to that project, and its empty state says "חזרה לפרויקט". An empty category says "אין תנועות בקטגוריה הזו", and an empty filtered queue says "אין פריטים לאישור בפרויקט הזה". The reviewer preview and the stories show the category page and that filtered queue.

Decision [0073](decisions/0073-review-handoff.md), Accepted. From r23 on, a handoff summary includes a self-check against the PR reviewer's checklist and the UI design reviewer's checklist: DESIGN-RULES, CONTROLS.md with pass or fail, a 320px clipping and overflow sweep, a no-op-control sweep, the cursor rules, and that the numbers add up. `/reviewer` on the dev server shows sample books (a queue with a shared cost, today's filed list, and saves that succeed or fail on demand), marked "נתוני דוגמה · Example data", and that module is left out of the hosted build. Only Blocking and Should items block a merge. A nit waits for the next batch.

Decision [0071](decisions/0071-shared-cost-copy.md) points 4 and 6, amended. A category line and its drill-down are the same confirmed expenses, including this project's share of a shared cost, and the list is paged. "ממתינה לאישור" and `/review?project=` both use `project_waiting`. Undo of an approval restores whether the category was a suggestion. A guess already undone is marked suggested again from the review, from an undo that had no review, or from a reopened missing-project approval. A pending undo stores the flag. Audit meta is not that record: older rows stored an empty meta, and the backfill does not read it and writes no audit rows. This amends [0070](decisions/0070-split-remainder-and-undo-log.md) point 9.

Decision [0072](decisions/0072-design-review-rulings.md) point 14. A save the database refuses says "לא נשמר. בדקו את הפרטים ונסו שוב." and offers no ניסיון חוזר. "לא נשמר – אין חיבור" stays for a network or server error. Point 2: a toast that shrinks stays tall enough for two lines and for ביטול.

Decision [0071](decisions/0071-shared-cost-copy.md) point 6, amended. Undo of an approval restores whether the category was a suggestion. A guess already undone is marked suggested again from the review or the undo row, not from audit meta. This amends [0070](decisions/0070-split-remainder-and-undo-log.md) point 9. A shared cost is not retried as one project: the change sheet offers לחלוקה and opens Split, and ניסיון חוזר stays for a network or server error. A failed sync waits fifteen minutes, so a stuck page cannot fill the drain. [0072](decisions/0072-design-review-rulings.md) point 2: a toast moves until it is clear of every control, and shrinks into a free gap when it cannot. Point 13: a Hebrew prefix before a Latin word uses a maqaf. A project category row opens that category's transactions, and "ממתינה לאישור" opens the queue for that project. The split footer clears "הסך 100%" by a spacing step.

Decision [0072](decisions/0072-design-review-rulings.md), Accepted. An invalid manual split shows each row as its own percent of the amount, and the summary keeps the invalid message. A toast under an opening sheet is measured again after the sheet settles and stays inside the viewport. The idle split summary is primary text. An even split whose shekel parts differ says "₪1,000 מתחלק שווה בין 3 פרויקטים". A preview notice uses the info tone. The empty filed list says "כש־SUMIT". A project with no category says "חסר קטגוריה, בחרו בשינוי".

Decision [0071](decisions/0071-shared-cost-copy.md), Accepted. An unallocated shared cost says "הוצאה משותפת · אישור יפתח חלוקה", and אישור opens Split. Assigning that cost to one project toasts "עלות משותפת מחולקת במסך החלוקה." A project's category list keeps the guessed name out and adds "x ממתינות לאישור" with the amount, so the lines match the expenses. This amends [0070](decisions/0070-split-remainder-and-undo-log.md) points 6 and 8.

Decision [0070](decisions/0070-split-remainder-and-undo-log.md), Accepted. The split the owner sees is the split that is saved: the leftover agora stays on the last project, and the payload is reversed so `save_split` stores those same agorot. `SELECT` on `reassign_undo` is revoked from `authenticated` again. Income suggestions are filed and are not queued. A project's category breakdown omits a category the owner has not confirmed. A toast with ביטול stays about 5 seconds, and the status region stays mounted. This amends [0069](decisions/0069-back-and-one-tap-review.md) points 4, 8, and 10.

Decision [0069](decisions/0069-back-and-one-tap-review.md), Accepted. Back returns to the screen that opened this one, and a fresh visit opens the parent. אישור accepts the project and category on the card. A SUMIT expense with no category takes a rule, then history, then the default, and stays in the queue until that tap. The companies UPDATE grant drops id, owner, created_at, and is_demo. A network failure asks for a retry, and the default live check does not create documents. A toast sits under the header, leaves after 2.5 seconds (4 for an error), and does not cover דלג. Skip and approve move the card on and advance the visit meter. The Home hero keeps a label, the number, and one explanation. נכנס and יצא sit below the band. A loss says הפסד, and החודש is named in the label. Split v2 leads with presets: same percent for every project, or for the projects he ticks, in one tap. Nothing is selected until that tap. Manual percents sit behind "חלוקה ידנית", with no shekel typing. Eliran approved that direction on 2026-09-29. This amends DESIGN-RULES §11. צפייה on the review banner opens today's auto-assigned transactions. Each row can be opened and changed, and back returns to the queue. A tap anywhere in a text, amount, or percent field focuses it. ₪ sits outside the digits, `9,999,999.99` stays visible at 320px, and iOS does not offer AutoFill Contact.

Decision [0068](decisions/0068-review-round9.md) r17 addendum. A sheet panel draws no focus ring, Split labels stay on one line at 320, and the overhead hint wording stays as it is. `reassign_undo` enables row level security with no policies.

Decision [0068](decisions/0068-review-round9.md) r16 addendum. An unsplit shared cost saves as "שמירה", the owner cannot write the remembered SUMIT company id, a bad key in the connect sheet asks to check the id and the key, and the auth screen says reconnect only on "חיבור מחדש".

Decision [0068](decisions/0068-review-round9.md) addendum. A rejected SUMIT key puts "צריך לחבר מחדש את SUMIT" on the refresh row, and "חיבור מחדש" stays in place. Backoff says "SUMIT לא זמין כרגע" and keeps "אפשר לנסות שוב ב-HH:MM".

Decision [0068](decisions/0068-review-round9.md) further addendum. Disconnect keeps the last SUMIT company id, and the next connect retires that company's ledger only after one successful listfolders read. Saving a category on an unsplit shared cost opens the unallocated item in the same call. The live SUMIT check is read-only unless `SUMIT_CREATE_DOCUMENTS=1`.

Decision [0068](decisions/0068-review-round9.md) addendum. The retry clock stays in the hint colour at full opacity, and only the refresh row's title and icon fade. The Project Detail loading band matches the loaded band. Home's loading band is unchanged. A direct `/install` visit replaces itself with Settings.

Decision [0068](decisions/0068-review-round9.md), Accepted. An unsplit shared cost reads "עלות משותפת · טרם פוצלה", one share reads the project name, and two or more read "מפוצל · N פרויקטים". Saving a category closes an open missing category and leaves an unallocated split open. Connect resets the SUMIT backoff, and a different company id retires that company's ledger first. Migrations are append-only from here. This amends [0067](decisions/0067-review-round8.md).

A screen or sheet title focused for a screen reader never draws a focus ring. The ring stays on keyboard focus of real controls. This amends [0067](decisions/0067-review-round8.md) point 10.

The production bundle scan also rejects company `2393153301`. The live check does not create a SUMIT document unless `SUMIT_CREATE_DOCUMENTS=1`. `sumit_status` can read `next_attempt_at`, so Settings loads for the owner.

## 2026-09-28

Decision [0067](decisions/0067-review-round8.md), Accepted. A shared cost shows "מפוצל · N פרויקטים" and changes category through `set_transaction_category` without dropping its shares. A bad SUMIT key is `sumit_auth`, with "החיבור ל־SUMIT נכשל. צריך לחבר מחדש." and no backoff. Billing stays `sumit_rejected`. Refresh waits until `next_attempt_at`, and the attempt counter increments in one update. Install no longer promises notifications. A leftover `hapoalim` source raises instead of being relabelled. The hosted bundle drops "Example data" and `new-` ids. Split's title is its own row. This amends [0066](decisions/0066-review-round7.md) points 1, 3, 4, and 11. The live SUMIT check was not run: a new test company is being seeded.

Decision [0066](decisions/0066-review-round7.md), Accepted. Split and Onboarding use the library header, chip, percent field, figure line, and progress bar, and the step meter is "שלב 1 מתוך 1". `private.schedule_drain()` can be run after Vault holds `cron_secret` and `flow_sync_url`; the job is every five minutes. `reassign_transaction` refuses a shared cost and an open `unallocated_shared` item. A SUMIT rejection is `sumit_rejected`, with backoff from five minutes to 24 hours. The add sheet drops the bank row, the AI promise, and chevrons on disabled rows. `/upload` and the `hapoalim` source are gone. The bundle graph is not served from `dist`. `/install` is a real route. The close control is at the inline start, and hover uses `--surface-hover`. This amends [0065](decisions/0065-review-round5.md) points 29, 35, and 39, and [0029](decisions/0029-pwa-install-prompt.md). The live SUMIT check was not run: the Flow Test account is restricted by ActionsBilling obligo.

Decision [0065](decisions/0065-review-round5.md) point 40 drops the Bank Hapoalim import. Bank transactions come only through the SUMIT sync. There is no Hapoalim parser and no screen 08, 09c, or ld-05. [0012](decisions/0012-bank-hapoalim-first.md) is superseded, and the Hapoalim complement in [0042](decisions/0042-sumit-primary-income-and-expenses.md) is dropped. AI tagging stays off until a Gemini key is configured, under a $3 hard cap. The key is not in the repo.

Decision [0065](decisions/0065-review-round5.md), Accepted. Reassignment, a new category, and the overhead switch save for real. Unhide uses the same `set_category_hidden` call, and the menu label is "החזרה לרשימה". The split monthly toggle is hidden. The notification switches stay disabled, with honest copy. Overhead share is the income share from the calculation note, null when there is no project income. The drain runs only with a cron secret, and `sumit-sync` does not require a user JWT. Home Empty asks to connect SUMIT. The review badge has a 2px surface ring and a singular label for one item. The pressed add button darkens without scaling. Storybook has a 390×700 viewport for open sheets. The add sheet follows mockup 04, with the three capture rows disabled until that path exists. Install follows 17a and 17b: a pinned action, the app icon, and Safari steps with the icons inline. Android without `beforeinstallprompt` shows the manual steps. A non-Safari iPhone copies the link. An iPad points at the top share button. The change sheet is a summary and an in-sheet picker: no "עוד…", the suggestion is a tint tag, and a different project takes one extra tap. Review still passes `p_remember`. The transaction sheet saves through `reassign_transaction` and omits that toggle. This amends [0064](decisions/0064-review-round4.md) points 2, 8, 13, 14, and 16, [0060](decisions/0060-library-review-calls.md), [0048](decisions/0048-sumit-key-envelope.md), and the native `title` sentence in [0062](decisions/0062-audit-layout-calls.md).

Decision [0064](decisions/0064-review-round4.md), Accepted. Screens use the library rows, banner action, section heads, and figure lines. The overhead switch is saved per company and per project; with no owner weights the share is 0 and the hint says so. Income takes the default income category and stays out of Review. `p_remember` controls the supplier rule, and undo restores it. Projects match a mapped SUMIT section first. An empty or suspicious sync does not sweep the ledger. "טרם נגבה" is the gross 134,520 on Home and Unpaid. The drain is scheduled when `pg_cron` and `pg_net` are both installed. The design pass caps sheets, draws the project loading band, and matches the transaction screen to mockup 10. Settings rows, the empty states, and the reference stories for install, processing, and the lock screen are in the same decision. This amends [0063](decisions/0063-owner-ledger.md) points 2, 8, 9, and 17, and [0022](decisions/0022-after-overhead-starts-off.md).

Decision [0063](decisions/0063-owner-ledger.md) now also records the design-review calls. Toggle is back in the library. The tab bar stays on Project, Unpaid, Settings, and Categories. PeriodPicker Open is a modal sheet. Open invoices count in invoiced profit, so the unpaid hint is "טרם נגבה". The change-sheet suggestion says "הצעה" and never AI. Settings Connected shows the connected state in Hebrew. This amends [0061](decisions/0061-review-undo.md) and [0060](decisions/0060-library-review-calls.md).

Decision [0063](decisions/0063-owner-ledger.md), Accepted. It amends [0059](decisions/0059-live-sumit-only.md) and the undo sentence in [0061](decisions/0061-review-undo.md). Sync no longer writes Flow Test weights, categories, or VAT exemptions. Shared costs stay unallocated until the owner enters a split. Ledger writes go through security-definer RPCs. The deferred share-sum lock is security definer too, so an owner split still commits. A re-sync updates only the columns SUMIT owns. Undo restores the assignment from before approval.

Decision [0062](decisions/0062-audit-layout-calls.md), Accepted. Fixed-height controls stay one line and ellipsize, with the full text in `title` and `aria-label`. Empty states use a `title-3` title, a muted 15px body, and the 36px pill. A sheet title is one line. ChangePill shows a neutral `0%`, and a change that rounds to zero shows `<1%` in the real direction. The preview loading band keeps `מצב תצוגה`. Enabled controls use `cursor: pointer`.

A period pill, chip, or status pill stays on one line. Long text ellipsizes and the chevron stays visible, clear of the wordmark. The closed period story is the band and the white on-band pill. A budget title clamps to two lines, the amounts sit on the next line without breaking a number, and the used percent is floored so 99.9% is not shown as 100%.

Disabled controls use one shared `cursor: not-allowed` rule. A busy control uses `cursor: progress`. The disabled element keeps pointer events so the cursor stays visible. Decision [0061](decisions/0061-review-undo.md).

Storybook amounts stay out of story args. A bigint in args is sent to the manager with `JSON.stringify`, which blanks the manager on Components / BigNumber / Summary. The amount is a decimal string in args and becomes a bigint inside render. `pnpm test` rejects a bigint anywhere in story args, and `pnpm test:storybook:smoke` opens every story in the built static Storybook. A screen that is given sample rows does not also call the ledger. A returned Google error is the notice on the sign-in screen.

The second design review's should-fix list is in the same pass. Home's greeting is label size, with the example tag on the sample row only. The pending card sits a section below the band, and project rows have no extra gap. An over-budget line states the real percent while the bar stays at 100%. Checkbox focus draws on the box. Sign-in legal links stay in the hint line.

The code review of `0cedefa` and the second design review land together. `pnpm check:bundle` reads the Rollup module graph and rejects the golden totals `37700`, `134520`, and `2389917160` in `dist`, with a negative test. Demo parsers live on `@flow/shared/testing`. Every books screen goes loading, then error with retry, then empty, then data. Writes check the PostgREST `{ error }`, stay busy, toast "ניסיון חוזר", and navigate only after success. Hit areas that draw at 32 or 36 extend to 44. Period identity is the kind. Money fields group thousands as the digits are typed and still submit raw digits. The review card follows 03-review, with VAT and a suggestion only when one exists. Decision [0061](decisions/0061-review-undo.md): undo reopens the queue item and leaves the assignment.

Decision [0060](decisions/0060-library-review-calls.md), Accepted. The component-library review (r1) is applied before more screen work. Avatar and the generic Card are gone. A supplier line is a `ListRow` hint. An over-budget bar fills to 100% in the danger colour, and the overage is a text line. Home, Projects, and Unpaid stay on the invoiced basis, so the cash/invoiced control is gone. Hover is only inside `@media (hover: hover)`. The library adds a toast, search field, change pill, checkbox, radio row, and `ReviewCard`. The Add sheet is the title and hint from [0045](decisions/0045-phase-0-design-gaps.md). Home matches `01-home` and Review shows one card at a time. Screen stories render those route components. The live SUMIT rule in [0059](decisions/0059-live-sumit-only.md) is unchanged.

Decision [0059](decisions/0059-live-sumit-only.md), Accepted. Folder lookup uses `crm/schema/listfolders`. `crm/data/listfolders` now redirects to the SUMIT help site. The running app reads the ledger only. `sumit-sync` fills that ledger from the SUMIT API. `expected-pnl.json` stays the Vitest answer key. `pnpm check:bundle` fails if the production bundle imports a fixture. `pnpm seed:demo` refuses to run. `pnpm test:e2e:live` connects the Flow Test company, checks 37,700 and 134,520, and proves a new SUMIT invoice appears after a refresh. It then credits that invoice, links the credit, and checks the totals again. pgTAP lookups stay inside the company the test created, so a local Flow Test import does not collide with them.

The books screens are compositions of the library from [0057](decisions/0057-component-library.md). Route sheets use `Sheet` and `IconButton`. One `ScreenHeader` covers every title. Loading Home is generic `Skeleton` bars inside `TopBand`. The unused `.stat`, `.card`, `.field`, `.seg`, and `.btn` rules are gone, and controls use the `ui-*` classes only. Storybook's screen stories render the real route components. Onboarding, the SUMIT connect call, the import, and the golden P&L check are unchanged.

Decision [0058](decisions/0058-storybook.md), Accepted. Storybook 8 replaces the `/dev/components` gallery. It is a dev dependency (`@storybook/react-vite`), with RTL, Rubik, the token CSS, a light/dark toolbar, and a 390px viewport. `pnpm storybook` and `pnpm build-storybook`. Accessibility runs in CI with `pnpm test:storybook`. The library rule in [0057](decisions/0057-component-library.md) is unchanged.

Decision [0057](decisions/0057-component-library.md), Accepted. Shared UI lives in `app/src/ui`. Home, sign-in, help, and the load errors are compositions of that library. The other books screens move onto it next. Numbers 0051–0056 are reserved on the remainder branch.

Branch `phase-1-slice` replaces the title-only screens with a working books slice. Onboarding calls `create_company`. Settings stores the SUMIT key in an Edge Function under AES-GCM ([0048](decisions/0048-sumit-key-envelope.md)). `sumit-sync` imports documents read-only and writes the ledger. Home, projects, review, add, unpaid, splits, and settings read `get_dashboard` and the other RPCs. Preview queries open empty, loading, and error chrome. They do not load fixture books. Decisions [0047](decisions/0047-onboarding-and-period.md), [0049](decisions/0049-sumit-refresh.md), and [0050](decisions/0050-demo-splits-and-review.md). The hosted project does not have this migration until it is applied by hand. [docs/runbooks/sumit-connect.md](runbooks/sumit-connect.md).

Decision [0046](decisions/0046-public-anon-key.md), Accepted. The hosted flow-pilot URL and the legacy anon JWT are committed in `app/.env.production`. The service-role key stays out of the repo and out of the client.

Decision [0045](decisions/0045-phase-0-design-gaps.md), Accepted. It records the Phase 0 design gaps left after the review of `fd355ad`. `/help` is a plain title, one line, and a mailto to ops@nromomentum.com. A non-offline load failure uses "לא הצלחנו לטעון את הנתונים" and is reachable with `?preview=error-server`. A missing name greets with "שלום". The Phase 0 band has no period pill. The Add sheet is a title and one hint. The tab bar's 8px floor is `--tabbar-min-inset`.

## 2026-09-27

Decision [0044](decisions/0044-phase-0-shell-calls.md), Accepted. It records the Phase 0 shell calls from the UI review: the preview banner is Hebrew only and does not push the band, the first-run empty state asks to connect SUMIT, 17px text uses the type scale, placeholders are a plain title, and Home loading, empty, and error can be opened with `?preview=`.

## 2026-09-27

[DESIGN-RULES.md](design/DESIGN-RULES.md) is the reviewer reference for design and UX. It compiles the design decisions, the token tables, the implementation-guide rules, and a per-screen index of the approved mockups. The mockup files stay in `design/`.

Phase 0 lands the application skeleton on branch `phase-0`: pnpm workspaces (`app/`, `supabase/`, `packages/shared`), schema v1 with owner-scoped RLS, the Rule A P&L checked against the Flow Test demo client, a demo seed script, and a Home latency script. No keys are in the repo. Migrations are applied to the hosted project by hand after review.

Decision [0043](decisions/0043-assumed-vat-on-expenses.md), Accepted. It amends [0041](decisions/0041-amounts-before-vat.md) for expenses.

- SUMIT expenses created via `addexpense` arrive with no VAT split. Showing them gross would overstate every expense by 18%.
- An expense with no split, and a bank-statement line with no supplier match, assumes the standard rate. The rate is a configurable constant, currently 18%. net = gross / 1.18, unless the supplier is VAT-exempt, in which case net = gross.
- The VAT-exempt flag is supplier memory. Toggling it recomputes past amounts. `vat_status='assumed'`. A subtle hint may appear on the detail screen. Home has no warning banner.
- Documents that carry a VAT split keep the source values.
- The demo client's Rule A is the implementation target: net = gross / 1.18 for VAT-registered suppliers, gross for the exempt insurer `ביטוח המגן`.

## 2026-09-26

Google sign-in screens replace the SMS code screens, under [0033](decisions/0033-google-sign-in.md). The design update is byte-for-byte: 120 files checked against the update manifest (9 added, 111 changed), and the eight `er-03-sms-wrong` and `er-04-sms-expired` files are removed. `09a` is "המשך עם Google". `er-03-google-cancelled` and `er-04-google-failed` replace the code errors. Settings shows the connected Google account. The implementation guide keeps the Tailwind note from [0040](decisions/0040-tailwind-v4.md) and adds §7.24.

Decisions [0041](decisions/0041-amounts-before-vat.md) and [0042](decisions/0042-sumit-primary-income-and-expenses.md), both Accepted.

- **0041.** The P&L shows amounts before VAT on Home, projects, and reports. VAT is stored per document and excluded from profit. Where a source has no VAT split, the gross amount is flagged "VAT unknown". That closes the bank-only income question and the unknown-VAT expense question.
- **0042.** Contractors record expenses in SUMIT. SUMIT (the expense module and the documents) is the primary source for income and expenses. The Hapoalim upload stays as a complement for cash matching and for anything not in SUMIT.
- The SUMIT test company "Flow Test" is being set up as Flow's first demo client.

## 2026-09-26

Decision [0040](decisions/0040-tailwind-v4.md), Accepted. Styling is Tailwind CSS v4. This replaces the plain-CSS line in [0038](decisions/0038-stack.md). The design tokens in `design/system/implementation-tokens.css` are mapped into `@theme`. Screen code uses those values. RTL uses logical utilities and `dir="rtl"`. Dark mode uses the same tokens. Vaul stays. No component kit with its own look. [tech-plan.md](tech/tech-plan.md) §1.4.1 and task P0-5 record the setup, including a lint rule against arbitrary values. The implementation guide notes how the tokens are consumed.

## 2026-09-26

Decisions [0037](decisions/0037-supabase-pilot.md), [0038](decisions/0038-stack.md), and [0039](decisions/0039-pilot-defaults.md), all Accepted. The current technical plan is [tech-plan.md](tech/tech-plan.md). The Cloudflare version is [tech-plan.v1-cloudflare.md](tech/tech-plan.v1-cloudflare.md), superseded.

- **0037.** The pilot runs on Supabase Free in Frankfurt: Postgres with row-level security, Auth with Google, Storage, Edge Functions, `pg_cron`, and a `pgmq` queue. Move to Supabase Pro ($25 a month) at the first paying customer or the first technical limit (database 300 MB, storage 750 MB, egress 3 GB a month, a nightly dump of about 100 MB, or about 15–20 active companies), whichever comes first. PWA static files are free on Cloudflare. Nightly encrypted backups go to Cloudflare R2, with a monthly restore test, because Free has no backups. This supersedes the Cloudflare D1 recommendation. It refines [0034](decisions/0034-cost-and-load-limits.md): the $5 a month cap holds for the pilot; Pro is about $27 a month once growing.
- **0038.** Front end: TypeScript, React and Vite with route code-splitting, React Router, TanStack Query with an IndexedDB cache, supabase-js, vite-plugin-pwa, plain CSS on the design tokens, self-hosted Rubik, Vaul, date-fns `he`, `Intl` for shekels, lazy SheetJS, browser-image-compression, and Zod. Back end: Deno Edge Functions, envelope encryption for SUMIT keys, `@google/genai` (Gemini Flash-Lite, paid tier), and `web-push` (still to verify in Deno). Tests: Vitest, Playwright, and pgTAP.
- **0039.** Pilot defaults, revisitable: the Google screen may show `supabase.co` (no $10 a month custom domain for now); invoice photos stay in Supabase Storage; the Pro trigger is the one in 0037.
- Still open from the plan: skipping SUMIT triggers in this phase, an app domain, VAT on bank-only income, unknown-VAT expenses, cheque date, auto-approve thresholds, nudge days, file retention, and backfill history. The accountant's export shape is also open. A single owner is already [0013](decisions/0013-single-user-owner.md). The Pro trigger, photo storage, and the Auth domain are decided.

## 2026-09-26

Decision [0036](decisions/0036-sumit-read-only.md), Accepted. SUMIT integration is read-only for the proof of concept. Flow never writes to the customer's SUMIT, including project tags, even where a write would cost no quota. Project tags chosen in Flow stay in Flow. Revisit after the proof of concept. The open question on writing project tags back is resolved.

Verified SUMIT API research is in [sumit-api-research.md](tech/sumit-api-research.md).

- One CRM documents call returns all income and expense documents, with the before-VAT amount, VAT rate, customer or supplier, creation time, and the linked source document.
- Expenses created via the API have no VAT split.
- SUMIT budget sections map to projects, but they need SUMIT's Advanced plan. Otherwise Flow does its own project tagging.
- Triggers need the Growth plan. They are only a re-sync signal, alongside a daily poll.
- Reads do not consume the customer's action quota.
- Open: VAT split on expenses entered via the SUMIT website or OCR; stability of the undocumented CRM field names; how API calls are metered.

## 2026-09-26

Decisions [0033](decisions/0033-google-sign-in.md), [0034](decisions/0034-cost-and-load-limits.md), and [0035](decisions/0035-sumit-api-first.md), all Accepted. [0017](decisions/0017-sms-sign-in.md) is Superseded by 0033.

- **0033.** Sign-in is a Google account (Gmail). SMS is out because each code had a cost. The onboarding SMS step and the wrong-code and expired-code states (`er-03`, `er-04`) are obsolete. A Google sign-in screen and a Google sign-in error state will replace them later. Those files are not in this change.
- **0034.** The whole system costs at most $5 per month to run. Home is usable within 2 seconds on a mid-range phone on 4G.
- **0035.** The first data integration is the SUMIT API (sumit.co.il). Flow pulls from SUMIT. Endpoints, sync, and the relation to the Hapoalim upload are still for the tech plan. Open: does SUMIT replace that upload in the proof of concept, or sit alongside it?

## 2026-09-26

Decision [0032](decisions/0032-home-hero-stays-company-net-profit.md), Accepted. With the after-overhead switch on, Home's hero number stays company net profit. The band's small figures show profit before overhead and the overhead amount, and each project row shows profit after its share. The project screen shows before, share, then after. Evidence: [18](../design/screens/18-home-overhead-on-light.png) and [19](../design/screens/19-project-overhead-on-light.png). The open question is resolved.

## 2026-09-26

The approved design package and the logo are in [design](../design/README.md), byte for byte, with [MANIFEST.txt](../design/MANIFEST.txt). Decisions [0024](decisions/0024-design-system-approved.md) through [0031](decisions/0031-logo.md), all Accepted.

- **0024.** Light and dark, the same violet top band `#7B3FE4`, tokens in [design-tokens.json](../design/system/design-tokens.json) and [implementation-tokens.css](../design/system/implementation-tokens.css), Rubik 400/500/600/700 (700 for the wordmark only), spacing and radius scales, and WCAG AA text. Boards [ds-1](../design/system/ds-1-colours-light.png) through [ds-8](../design/system/ds-8-pickers-sheets-light.png).
- **0025.** [implementation-guide.md](../design/system/implementation-guide.md) is mandatory for every screen and every PR review, including the [definition of done](../design/system/implementation-guide.md#12-checklists).
- **0026.** Empty, loading, and error states are required on every screen, light and dark (`design/states/es-*`, `ld-*`, `er-*`, board [ds-7](../design/system/ds-7-empty-loading-light.png)).
- **0027.** Date picker: week starts Sunday, dates are dd/mm/yyyy, single and range pickers with shortcuts ([15a](../design/screens/15a-date-field-light.png)–[15c](../design/screens/15c-date-range-light.png)).
- **0028.** Period sheet from the band pill: this month, last month, year to date, plus a custom range ([16](../design/screens/16-period-sheet-light.png)). This supersedes only 0019's "no custom date range" clause. The three named periods stay.
- **0029.** PWA install prompt after the first successful report, never inside the installed app. Android uses `beforeinstallprompt` ([17a](../design/screens/17a-install-android-light.png)). iPhone is three Safari steps ([17b](../design/screens/17b-install-iphone-light.png)). Onboarding's install step in 0015 stays.
- **0030.** Confirmation sheets for delete, archive, hide category, and a two-step merge. Soft bad-tint button, then an undo toast ([20](../design/screens/20-confirm-delete-light.png)–[23](../design/screens/23-confirm-hide-light.png)).
- **0031.** Logo: Flow wordmark in Rubik 700, letter-spacing −0.01em, `#7B3FE4` on light, `#B894FF` on dark, white on the band. The in-app wordmark uses the `logo` token, not `accent-text`. App icon S1. Cursive and calligraphic explorations were rejected. See [LOGO.md](../design/logo/LOGO.md).
- Open, not decided: with the after-overhead switch on, should Home's big number stay company net profit? The current design keeps it ([18 light](../design/screens/18-home-overhead-on-light.png), [18 dark](../design/screens/18-home-overhead-on-dark.png)).

## 2026-09-26

Decision [0023](decisions/0023-violet-coloured-top-band.md), Accepted. Visual direction: violet with a coloured top band.

- Light-mode accent `#7B3FE4`. Home has a solid violet band with rounded bottom corners: wordmark, greeting, hero profit, and the income and expense line. Text on the band is white, with a light-lilac secondary. The page below is `#FFFFFF`.
- The accent is also on the `+` button, the active tab, the tinted pending card, and the period pill. The profit delta is a small white pill, red `▼` or green `▲`.
- Font is Rubik: hero and titles 600, body 500, hints 400, wordmark 700.
- Rejected: styles A, B, and C; Mercury-like P1 Graphite, P2 Cobalt, and P3 Petrol (too busy, IBM Plex too stiff); D1–D3 (Periwinkle too Mercury-like, Assistant and Varela Round too thin); muted palettes Clay, Navy & Sand, Ocean, Indigo, Ink & Lime, and Honey; bright palettes Azure, Coral, Fuchsia, Aqua, Tangerine, and Emerald; faint off-white tinted backgrounds.
- The P1, P2, and P3 boards in [design](module-1-project-pnl/design/README.md) are superseded. The files stay. A light and dark design system, and hi-fi screens, are not in the repo yet.

## 2026-09-26

The UI direction moves to a Mercury-inspired Home. Styles A, B, and C are superseded. Their files stay. The palette is still pending. Every number is example data.

- [ui-mercury-p1.png](module-1-project-pnl/design/ui-mercury-p1.png), [ui-mercury-p2.png](module-1-project-pnl/design/ui-mercury-p2.png), and [ui-mercury-p3.png](module-1-project-pnl/design/ui-mercury-p3.png) are Graphite, Cobalt, and Petrol. [ui-mercury-overview.png](module-1-project-pnl/design/ui-mercury-overview.png) shows all three. [ui-refs.png](module-1-project-pnl/design/ui-refs.png) records the reference fonts.
- Font: IBM Plex Sans Hebrew, plus IBM Plex Sans for tabular numerals and the shekel sign. Alternative: Assistant.
- Type 12/13/15/17/20/40. Spacing 4/8/12/16/20/24/32/40. Radius 4/8/12/16/full, with cards at 12 and buttons at 8.
- Text colors meet WCAG AA on each background and on white.
- Reference fonts from live CSS: Mercury uses Arcadia, Morning uses Ploni and Ping (Assistant as fallback), RiseUp uses Simpler Pro. Flow does not ship those faces.
- Rules from Design Motion's public patterns: no decorative gradients, no emoji, no identical stat cards, one accent about twice per screen, hairline borders, an arrow or sign with the color, positive profit in ink with green only on a good delta, and a takeaway above the list.
- `wireframes/source/hifi.py`, `palettes.py`, and `render.sh` produce this set.

## 2026-09-26

Settings wireframe and the first UI directions. The owner's style choice is pending. Every number is example data.

- [14-settings.png](module-1-project-pnl/wireframes/14-settings.png) is pending owner approval. Company details, phone sign-in, Bank Hapoalim with the last statement date and upload, links to Categories and Projects, recurring split rules with edit and delete, the two notifications as toggles, an auto-approve toggle, the after-overhead default (off, [0022](decisions/0022-after-overhead-starts-off.md)), Excel and CSV export, log out, and a version line.
- The auto-approve toggle and the notification toggles are on the image. They do not change [0011](decisions/0011-auto-approve-high-confidence.md) or [0018](decisions/0018-two-notifications.md) unless the owner approves this screen.
- UI phase, in [design](module-1-project-pnl/design/README.md). Three Homes, choice pending: A calm fintech (IBM Plex Sans Hebrew), B bold dark (Heebo), C warm practical (Rubik). [style-overview.png](module-1-project-pnl/design/style-overview.png) shows all three. The after-overhead switch is off, so the numbers match the default.
- `wireframes/source/gen.py` adds `14-settings`. `hifi.py` writes the style HTML. `render.sh` screenshots both batches.

## 2026-09-26

Decision [0022](decisions/0022-after-overhead-starts-off.md), Accepted. The after-overhead switch starts off.

- Home and the project screen open on stored project profit, so the default numbers match the bank and the accountant. The owner turns `רווח אחרי חלק מהתקורה` on when they want the overhead view.
- Home, Project, and a display option on the Settings draft are one preference. The Settings option starts off. The rest of Settings stays a draft.
- [01-home-v4](module-1-project-pnl/screens.md#01-home-v4) and [02-project-v2](module-1-project-pnl/screens.md#02-project-v2) still draw the switch on. That is the on state under review, not the default. Both images stay pending owner approval.
- The open question "should the after-overhead toggle be on by default?" is closed.

## 2026-09-26

Wireframes for shared costs and the after-overhead view. All pending owner approval. Every number is example data.

- [11-split-v2.png](module-1-project-pnl/wireframes/11-split-v2.png) supersedes `11-split`. Method control: equal, by income (drawn selected), or manual percent or amount. One tap for every active project. The remainder must reach ₪0 and 100%. `פצל ככה כל חודש` is the recurring split rule.
- [01-home-v4.png](module-1-project-pnl/wireframes/01-home-v4.png) supersedes `01-home-v3`. The after-overhead switch is on. Each project row shows profit after its share, plus a before · share subline, and the bars are hidden. The overhead row is grey and struck through as allocated in this view. Company tiles stay ₪1,310,000 / ₪1,110,000 / ₪200,000.
- [02-project-v2.png](module-1-project-pnl/wireframes/02-project-v2.png) supersedes `02-project`. The same switch, plus a before / share / after card. The share is company overhead times this project's share of company income since the project started. The ₪40,000 share is an example for that window, not the September Home share.
- [overview-6.png](module-1-project-pnl/wireframes/overview-6.png) shows those three phones.
- Overhead shares round to ₪100. The rounding difference goes to one project so the shares add up exactly to overhead. In the September example that ₪100 sits on `שיפוץ דירה ת"א`.
- `wireframes/source/gen.py` and `render.sh` include this batch. Older PNGs are kept.

## 2026-09-26

Decision [0021](decisions/0021-shared-costs-and-overhead.md), Accepted. Shared project costs are split. True overhead stays overhead.

- The split sheet can target every active project: equal, by that period's income share, or manual percent or shekels. The owner can save "split like this every month". The next payment from that payee arrives already split. Income-share rules recalculate each month. Equal uses whoever is active when the payment arrives.
- Office rent, the accountant, insurance, and the rest are not split into transactions. Home and the project screen get a view-only toggle, profit after overhead share, by each project's income share in the selected period. Stored lines and company totals stay as they are.
- Shares use largest remainder so they sum exactly. A project with no income gets none. If every project has no income, the allocation is unavailable and the after-overhead view is not shown.
- The Rule entity now includes a split rule, one per payee, replacing a one-project rule and replaced by one.
- Wireframes `11-split-v2`, `01-home-v4`, and `02-project-v2` are marked coming. They have no image.
- Open: should the after-overhead toggle be on by default?

## 2026-09-26

Wireframes for onboarding, transaction detail, split, unpaid invoices, notifications, and Home v3. All of these are **pending owner approval**.

- [01-home-v3.png](module-1-project-pnl/wireframes/01-home-v3.png) supersedes `01-home-v2`. Three periods (`החודש`, `חודש קודם`, `מתחילת השנה`). Comparison arrows where color means good or bad, not the arrow direction. A quiet unpaid line under the review banner (`3 חשבוניות לא שולמו · ₪23,400`).
- [09-onboarding.png](module-1-project-pnl/wireframes/09-onboarding.png): SMS sign-in, then company details (1/4), Hapoalim export and upload (2/4), proposed projects (3/4), install and the two notifications (4/4).
- [10-transaction-detail.png](module-1-project-pnl/wireframes/10-transaction-detail.png), [11-split.png](module-1-project-pnl/wireframes/11-split.png), [12-unpaid.png](module-1-project-pnl/wireframes/12-unpaid.png), [13-notifications.png](module-1-project-pnl/wireframes/13-notifications.png).
- [overview-5.png](module-1-project-pnl/wireframes/overview-5.png) shows detail, split, unpaid, and Home v3.
- `wireframes/source/gen.py` is the generator for this set. `render.sh` also renders the new names, and still writes PNGs into `wireframes/`.
- [screens.md](module-1-project-pnl/screens.md) replaces the placeholders with purpose, elements, interactions, states, edge cases, and acceptance criteria taken from these images. Differences that are not yet decisions: a category on each split line, what `מחק` removes, what Home's `☰` opens, and the business-type list on onboarding (two options on the image, three in the Settings draft).

## 2026-09-26

Decisions [0015](decisions/0015-installable-mobile-web-app.md) through [0020](decisions/0020-capture-from-the-phone.md), all Accepted.

- **0015.** This phase is an installable mobile web app. No desktop version, and no native iOS or Android app. Onboarding explains the Hapoalim export onto the phone and includes an install step, which is what makes iPhone notifications possible.
- **0016.** Hebrew only. No second language at launch.
- **0017.** Sign-in is a mobile number plus an SMS code. Email and password are rejected.
- **0018.** Two notifications: Sunday 08:00 Israel time (last week's profit and one project alert, opens Home) and 18:00 only when review is waiting (count and estimated minutes, opens Review). No per-transaction notification.
- **0019.** Home periods are this month, last month, and year to date. This month and last month show an up or down percent versus the previous month. The project screen stays project to date. No custom range. The year-to-date arrow is not shown until its baseline is decided. [01-home-v2](module-1-project-pnl/wireframes/01-home-v2.png) still draws two segments and is not superseded.
- **0020.** Capture is several photos in a row, or a PDF or image from files on the phone. Android share-to-app works. iPhone share-to-app does not. A WhatsApp or email forwarding address is after the proof of concept.
- [spec.md](module-1-project-pnl/spec.md), [calculations.md](module-1-project-pnl/calculations.md), [Home](module-1-project-pnl/screens/01-home.md), and [Add](module-1-project-pnl/screens/04-add.md) follow these. [screens.md](module-1-project-pnl/screens.md) has placeholder sections for onboarding, transaction detail, the split sheet, unpaid invoices, and notifications. Those five have no image and no field spec.
- Still open, including the leftovers from these six records: Settings contents, pricing, credit-card timing, the Hapoalim column map, confirming every invoice photo, export of a previous project, two phones offline, changing the phone number, which weekly alert wins, the minute estimate, the year-to-date baseline, the forwarding address, and how onboarding proposes projects.

Review and upload wireframes updated to match auto-approve and Bank Hapoalim.

- [03-review-v2.png](module-1-project-pnl/wireframes/03-review-v2.png) supersedes `03-review`. The card has no `אשר הכל` button. A strip at the top reads `12 אושרו אוטומטית`.
- [08-upload-results-v2.png](module-1-project-pnl/wireframes/08-upload-results-v2.png) supersedes `08-upload-results`. The sample file is `הפועלים_ספטמבר.xlsx`. The 33 invoice and rule matches are one collapsed `אושרו אוטומטית` group. The secondary approve button is gone.
- [overview-4.png](module-1-project-pnl/wireframes/overview-4.png) shows those two phones together.
- `wireframes/source/gen.py` is the generator for this set. `render.sh` also renders `03-review-v2`, `08-upload-results-v2`, and `overview-4`, and still writes PNGs into `wireframes/`.

## 2026-09-26

The product is named Flow. Detailed specs replace every `Detailed spec: TODO`.

- [README](../README.md) and [spec.md](module-1-project-pnl/spec.md) titles use Flow.
- [calculations.md](module-1-project-pnl/calculations.md) defines income, expenses, profit, margin, the three period filters, what counts (approved and paid, cash basis, net of VAT), overhead, and rounding in agorot.
- Per-screen specs for the eight product screens: [Home](module-1-project-pnl/screens/01-home.md), [Project](module-1-project-pnl/screens/02-project.md), [Review](module-1-project-pnl/screens/03-review.md), [Add](module-1-project-pnl/screens/04-add.md), [Projects](module-1-project-pnl/screens/05-projects.md), [Change sheet](module-1-project-pnl/screens/06-change-sheet.md), [Categories](module-1-project-pnl/screens/07-categories.md), [Upload results](module-1-project-pnl/screens/08-upload-results.md). Superseded wireframes and overview boards point at those specs and are not built.
- [settings.md](module-1-project-pnl/settings.md) is a Draft proposal (company, VAT, categories, rules, Excel export, Hapoalim account, auto-approve toggle). Settings contents stay open. The toggle is not approved, because [0011](decisions/0011-auto-approve-high-confidence.md) rejected opt-in auto-approve.
- New open items that the spec refused to guess: Hapoalim column map, confirming every invoice photo, export of a previous project after a move, and two phones offline.

## 2026-09-26

Owner answers, recorded as [0011](decisions/0011-auto-approve-high-confidence.md) through [0014](decisions/0014-optional-project-budget.md). All four are Accepted.

- **0011.** High-confidence rows (bank row matched to an existing invoice, or an existing supplier rule) auto-approve, skip the review queue, and show up in a short summary the owner can reopen.
- **0012.** Statement import in the proof of concept is Bank Hapoalim (`בנק הפועלים`) only. Other banks and credit-card companies come later.
- **0013.** Single user: the business owner. No roles or permissions. An office manager is a later option.
- **0014.** Project budget stays optional. Budget versus actual appears on the project screen only when a budget is set.
- [spec.md](module-1-project-pnl/spec.md) follows these four. The one-pager and the screen notes that still described the questions as open now point at the records. [0006](decisions/0006-confirm-not-type.md) and [0007](decisions/0007-bank-statement-is-primary-input.md) stay Accepted and cross-link 0011 and 0012.
- Removed the answered items from [open questions](open-questions.md). Still open: Settings screen contents, the per-screen detailed spec, pricing, and when credit-card statement support starts.

## 2026-09-26

Initial product documentation for Module 1, Project P&L.

- Product one-pager and documentation index in `README.md`.
- Module spec: cash-basis company and project P&L, intake, review and rules, categories, scale, data model, export, out of scope, and success metrics.
- Screen notes for every wireframe, each with a `Detailed spec: TODO` subsection. Approved set: `01-home-v2`, `02-project`, `03-review`, `04-add`, `05-projects`, `06-change-sheet-v2`, `07-categories`, `08-upload-results`, plus the three overview boards. `01-home` and `06-change-sheet` are kept and marked superseded.
- Wireframe PNGs and the HTML generator (`wireframes/source/gen.py`, `wireframes/source/render.sh`). `render.sh` writes PNGs into `wireframes/`. The uploaded script wrote them into `/workspace/wireframes-pnl`.
- Decision records [0001](decisions/0001-management-tool-alongside-accounting.md) through [0010](decisions/0010-docs-are-the-source-of-truth.md), all accepted on this date.
- Open questions and the documentation contributing guide.
