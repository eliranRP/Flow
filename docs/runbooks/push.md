# Web push

FLOW-502, option A (the owner's pick, 2026-10-09). Server part 1 is in migration `20261013080000_push_notifications.sql` and the `push-send` Edge Function. The app part (the service worker, the review-screen card and Settings → התראות) is a separate UI PR.

## Secrets

| Name | Where | Scope |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Edge Function secret | Uncompressed P-256 public key, base64url. Not secret; the app needs the same value. |
| `VAPID_PRIVATE_KEY` | Edge Function secret | The matching private scalar, base64url. Never in the repo, chat or logs. |
| `VAPID_SUBJECT` | Edge Function secret | `mailto:` or `https:` contact the push services can reach. |
| `VITE_VAPID_PUBLIC_KEY` | App build env (Cloudflare Pages) | The same value as `VAPID_PUBLIC_KEY`. |

The keys are made once and kept: a new key pair invalidates every saved subscription. The owner makes them on their own machine, for example with `npx web-push generate-vapid-keys`, and sets them with `supabase secrets set --project-ref sxqpnetmtufkzowutduq VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...`. Until they are set, `push-send` answers `missing_vapid` and sends nothing.

## What runs

- `flow-push-evening` (pg_cron, hourly at :00) posts to `push-send` with the `x-flow-cron` header only when `private.push_evening_due()` is true: it is 20:00-20:59 in Israel and an owner who turned on תזכורת ערב has open review lines, a saved device, and no reminder yet today. The hourly check keeps 20:00 right across daylight saving.
- `push-send` reads `push_evening_targets()` with the service key and sends "N תנועות מחכות לאישור" to each device. The count comes from SQL. A user who got it on one device is stamped for the day by `note_push_results()`. A device the push service answers 404 or 410 for is deleted.
- It posts only to the browsers' push services (FCM, Mozilla, Apple, Windows). A subscription for any other host is refused when it is saved.

The cron is scheduled by the migration when Vault holds `cron_secret` and `flow_sync_url`, like `flow-jev-tag`. To reschedule after changing either, run `select private.schedule_push_evening();` as `service_role`.

## RPCs for the app

All need a signed-in user (42501 otherwise). Preferences are per user, not per company.

- `push_subscribe(p_endpoint, p_p256dh, p_auth, p_user_agent)` saves this device. An endpoint saved by another user moves to the caller.
- `push_unsubscribe(p_endpoint)` removes this device.
- `get_notification_prefs()` returns `new_transaction`, `evening_reminder`, `weekly_summary`, `prompt_answered` and `has_subscription`. All three switches are off until the user turns one on.
- `set_notification_prefs(p_new_transaction, p_evening_reminder, p_weekly_summary)`. A null leaves that switch as it is. Returns the same object.
- `answer_push_prompt(p_yes)` records that the review-screen card was answered; yes also turns on תזכורת ערב.

Only the evening reminder sends in this part. תנועה חדשה and סיכום שבועי are saved but not sent yet (FLOW-502 part 2).
