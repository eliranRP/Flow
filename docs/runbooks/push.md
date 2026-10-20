# Web push

FLOW-502, option A (the owner's pick, 2026-10-09). The server is in migrations `20261013080000_push_notifications.sql` (part 1) and `20261013090000_push_new_and_weekly.sql` (part 2), and the `push-send` Edge Function. FLOW-516 ([0201](../decisions/0201-push-device-row-and-test-push.md)) added this device's row, the connected devices list and the test push (`20261020192620_push_devices_and_test.sql`).

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
- `{"kind":"test"}` is the app's own call (FLOW-516): the user's JWT, never the cron secret or the service key. push-send calls `claim_push_test()` as the user (anon key plus their JWT), so the database names the user; at most 5 an hour per user (`push_test_limit`, HTTP 429), nothing spent without a device. It then reads that user's devices with `push_test_targets(p_user)` (service role) and sends "התראת בדיקה" to each. It answers `{devices, sent, gone, failed}`.
- A failed send logs `push failed host=<push service host> status=<HTTP status or error name> body=<first 120 characters>`, never the endpoint's path, a key or a token. A failed RPC logs `push-send <kind> error=push_rpc_<name>_<status>`. Apple answers with a reason such as `BadJwtToken` or `ExpiredSubscription`.
- It posts only to the browsers' push services (FCM, Mozilla, Apple, Windows). A subscription for any other host is refused when it is saved.

The crons are scheduled by the migrations when Vault holds `cron_secret` and `flow_sync_url`, like `flow-jev-tag`. To reschedule after changing either, run `select private.schedule_push_evening(); select private.schedule_push_kind('new'); select private.schedule_push_kind('weekly');` as `service_role`.

## RPCs for the app

All need a signed-in user (42501 otherwise). Preferences are per user, not per company.

- `push_subscribe(p_endpoint, p_p256dh, p_auth, p_user_agent)` saves this device. An endpoint saved by another user moves to the caller.
- `push_unsubscribe(p_endpoint)` removes the caller's own row for that endpoint. The app calls it when this device's row is turned off and on an explicit sign-out, before the session ends (FLOW-516; granted to `authenticated` again, amending [0193](../decisions/0193-client-privileges.md)). An expired session keeps the subscription.
- `list_my_push_devices()` returns `{devices: [{id, user_agent, created_at, tag}]}`, the caller's own subscriptions, newest first. `tag` is the first 16 hex digits of the endpoint's SHA-256, so the app can mark this device. No endpoint, no key.
- `claim_push_test()` is push-send's gate for the test push (above); the app calls push-send, not this RPC.
- `get_notification_prefs()` returns `new_transaction`, `evening_reminder`, `weekly_summary`, `prompt_answered` and `has_subscription` (any of the user's devices, not only this one). All three switches are off until the user turns one on.
- `set_notification_prefs(p_new_transaction, p_evening_reminder, p_weekly_summary)`. A null leaves that switch as it is. Returns the same object.
- `answer_push_prompt(p_yes)` records that the review-screen card was answered; yes also turns on תזכורת ערב, and on the first answer תנועה חדשה.

All three switches send. Each starts off; a first yes on the card turns on תזכורת ערב and תנועה חדשה.

## When a device gets nothing

Settings → התראות shows this device's state at the top (on, off, blocked, or the Home Screen and unsupported notes) and the connected devices under the switches.

1. On the device, open the page from the app the person uses (on an iPhone, the Home Screen icon). If the device row is off, turn it on there: iOS asks only from that tap. If the device does not appear in iOS Settings › Notifications, it was never asked.
2. If the row says blocked, allow notifications in iOS Settings › Notifications › Flow (or the browser's site settings) and reopen the app.
3. Tap "שליחת התראת בדיקה". It sends to every connected device; nothing arriving on a device listed as connected points at that device's subscription.
4. A turn-on that stops leaves a muted line under the row, "שלב אחרון: <step> (<reason> · <error name>: <message>)". `worker-timeout` or `not-controlled`: close and reopen the app. `subscribe-threw` with `AbortError` or `InvalidStateError` after a retry: turn the row off and on, or remove and re-add the Home Screen app. `save-failed` or `save-timeout`: check the network and the `push_subscribe` logs.
5. Check the push-send logs for `push failed host=… status=…` lines.
