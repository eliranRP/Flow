<a id="flow-502"></a>
# FLOW-502 · Web push notifications
- **Type:** PLAN FIRST · **Status:** done (#335, #343 server; #340, #358, #377 app) · **Depends on:** —
- **What:** A pre-permission card after a user gesture (iOS needs the app on the Home Screen first), service-worker push, server send from an edge function, per-user opt-in. Start with the evening review nudge, then the Sunday summary. Add it to setup step 5 once it ships. About 2–3 PRs.
- **Acceptance:** mockup approved; push received on Android and an installed iOS app; opt-out works.
- [x] Option A approved by the owner (#324): one quiet card on the review empty state, Settings → התראות with three switches (תנועה חדשה, off by default; תזכורת ערב; סיכום שבועי, ראשון בבוקר).
- [x] Server part 1 (#335): `push_subscriptions` and per-user `notification_prefs`; `push_subscribe`, `push_unsubscribe`, `get_notification_prefs`, `set_notification_prefs`, `answer_push_prompt`; the `push-send` function (Web Push with VAPID, no library) and the `flow-push-evening` cron at 20:00 Israel time for owners with open review lines. Runbook [push.md](../../runbooks/push.md).
- [x] Owner step (2026-10-09): the VAPID key pair is made and kept; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` are function secrets and `VITE_VAPID_PUBLIC_KEY` is in `app/.env.production`. Never make a new pair: it drops every saved device.
- [x] App (UI lane 4, #340): the push worker (`public/push-sw.js`, imported by the generated worker), the review card asked once, the Settings row, and `/settings/notifications`.
- [x] App follow-up (Production QA, 2026-10-09; UI lane 4, #358): the "הוספה למסך הבית" screen showed Safari's steps in every iPhone browser. Chrome (CriOS) now shows its share button in the address bar, Firefox (FxiOS) its ☰ menu, any other iPhone browser its share button; Safari and iPad keep •••. Read from the user agent (`iosBrowser`).
- [x] Server part 2 (PR #343): תנועה חדשה within 5 minutes of a sync bringing bank or SUMIT lines (`flow-push-new`), and סיכום שבועי on Sunday at 08:00 Israel time (`flow-push-weekly`), with counts only and no amounts (the owner's pick, 2026-10-09).
- [x] Setup step 5 offers it once it ships. (Backlog bug fixes: the same card under the install steps, sharing the review card's asked-once answer; an iPhone tab is not asked there, since the step already teaches the Home Screen.)
