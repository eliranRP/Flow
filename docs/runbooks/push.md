# Web push

FLOW-502, option A (the owner's pick, 2026-10-09). The server is in migrations `20261013080000_push_notifications.sql` (part 1) and `20261013090000_push_new_and_weekly.sql` (part 2), and the `push-send` Edge Function. The app part (the service worker, the review-screen card and Settings → התראות) is a separate UI PR.

## Secrets

| Name | Where | Scope |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Edge Function secret | Uncompressed P-256 public key, base64url. Not secret; the app needs the same value. |
| `VAPID_PRIVATE_KEY` | Edge Function secret | The matching private scalar, base64url. Never in the repo, chat or logs. |
| `VAPID_SUBJECT` | Edge Function secret | `mailto:` or `https:` contact the push services can reach. |
| `VITE_VAPID_PUBLIC_KEY` | `app/.env.production` | The same value as `VAPID_PUBLIC_KEY`. Public. |

The keys are made once and kept: a new key pair invalidates every saved subscription. The owner makes them on their own machine, for example with `npx web-push generate-vapid-keys`, and sets them with `supabase secrets set --project-ref sxqpnetmtufkzowutduq VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...`. Until they are set, `push-send` answers `missing_vapid` and sends nothing.

## What runs

- `flow-push-evening` (pg_cron, hourly at :00) posts to `push-send` with the `x-flow-cron` header only when `private.push_evening_due()` is true: it is 20:00-20:59 in Israel and an owner who turned on תזכורת ערב has open review lines, a saved device, and no reminder yet today. The hourly check keeps 20:00 right across daylight saving.
- `push-send` reads `push_evening_targets()` with the service key and sends "N תנועות מחכות לאישור" to each device. The count comes from SQL. A user who got it on one device is stamped for the day by `note_push_results()`. A device the push service answers 404 or 410 for is deleted.
- `flow-push-new` (every 5 minutes) posts `{"kind":"new"}` when `private.push_new_due()` is true: an owner who turned on תנועה חדשה has a saved device and bank or SUMIT lines that came in after their mark. Void and removed lines don't count, and nothing older than a day is sent, so the first push after a long gap is not a backlog. Turning the switch on sets the mark to now.
- `flow-push-weekly` (hourly at :00) posts `{"kind":"weekly"}` on Sunday between 08:00 and 08:59 Israel time (decision 0018) when an owner who turned on סיכום שבועי has a device and either new lines in the last 7 days or open review lines. The message is "N תנועות נכנסו השבוע · M מחכות לאישור".
- For `new` and `weekly`, `push-send` calls `push_claim_targets(kind)`, which moves the user's mark (or stamps today) before anything is sent. Two runs never send the same lines, and a push that fails is not sent again. The claim does not check the day or hour; the cron gates do, so a manual `{"kind":"weekly"}` call sends the summary on any day.
- No message names an amount, so a locked phone shows no money. The owner chose counts only for the Sunday summary (2026-10-09), in place of the profit that decision 0018 put there.
- It posts only to the browsers' push services (FCM, Mozilla, Apple, Windows). A subscription for any other host is refused when it is saved.

The crons are scheduled by the migrations when Vault holds `cron_secret` and `flow_sync_url`, like `flow-jev-tag`. To reschedule after changing either, run `select private.schedule_push_evening(); select private.schedule_push_kind('new'); select private.schedule_push_kind('weekly');` as `service_role`.

## RPCs for the app

All need a signed-in user (42501 otherwise). Preferences are per user, not per company.

- `push_subscribe(p_endpoint, p_p256dh, p_auth, p_user_agent)` saves this device. An endpoint saved by another user moves to the caller.
- `push_unsubscribe(p_endpoint)` removes this device.
- `get_notification_prefs()` returns `new_transaction`, `evening_reminder`, `weekly_summary`, `prompt_answered` and `has_subscription`. All three switches are off until the user turns one on.
- `set_notification_prefs(p_new_transaction, p_evening_reminder, p_weekly_summary)`. A null leaves that switch as it is. Returns the same object.
- `answer_push_prompt(p_yes)` records that the review-screen card was answered; yes also turns on תזכורת ערב, and on the first answer תנועה חדשה.

All three switches send. Each starts off; a first yes on the card turns on תזכורת ערב and תנועה חדשה.
