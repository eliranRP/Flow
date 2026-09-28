# Phase remainder on flow-pilot

Apply after the phase-1 slice. No new paid service. VAPID and the SUMIT key stay in Edge Function secrets.

## 1. Migration

1. `supabase/migrations/20260927120000_schema_v1.sql` (already applied)
2. `supabase/migrations/20260928140000_phase1_slice.sql`
3. `supabase/migrations/20260928180000_phase_remainder.sql`

If `pg_cron` is missing, the daily, weekly, and hourly jobs are skipped. The tables and RPCs still exist.

## 2. Auth hook

In Authentication → Hooks → Custom Access Token, select `public.custom_access_token_hook`.

A new Google user still fills the company form. The app refreshes the session afterwards so the JWT carries `company_id`. Someone with no company can sign in and sees nothing else.

Orphan auth users are not deleted by the migration. To list them later, in the SQL editor:

```sql
select u.id, u.email, u.created_at
from auth.users u
left join public.company_member m on m.user_id = u.id
where m.user_id is null
  and u.created_at < now() - interval '7 days';
```

Delete only the rows you mean to drop.

## 3. Functions

Deploy `sumit-connect`, `sumit-sync`, `sumit-hook`, and `push-send` from `supabase/functions/`. Each folder has `index.ts`, `deno.json`, and `import_map.json`. They import `../_shared/`.

| Secret | Required | How |
| --- | --- | --- |
| `SUMIT_KEK` | yes, for connect and sync | `openssl rand -base64 32` |
| `CRON_SECRET` | no | any long random string, for the drain POSTs |
| `SUMIT_HOOK_ENABLED` | no | set to `true` only if a customer creates their own SUMIT trigger. Otherwise the hook is 404 |
| `VAPID_PUBLIC_KEY` | no | from `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | no | the matching private key. Never commit it |
| `VAPID_SUBJECT` | no | `mailto:ops@nromomentum.com` |

The browser build also needs `VITE_VAPID_PUBLIC_KEY` set to the same public key before `pnpm build`. Leave it empty until the keys exist. The app still explains the Sunday and 18:00 schedule.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected. Do not copy the service role into git.

Drain, when cron cannot call the network:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/sumit-sync" \
  -H "x-flow-cron: $CRON_SECRET" -H "Content-Type: application/json" -d '{}'
curl -X POST "$SUPABASE_URL/functions/v1/push-send" \
  -H "x-flow-cron: $CRON_SECRET" -H "Content-Type: application/json" -d '{}'
```

## 4. What to check

Sunday 08:00 Israel (05:00 UTC in summer) queues a weekly row. With an empty review queue, 18:00 queues nothing.

```sql
select kind, local_date, status, left(body, 80)
from public.notification_outbox
where company_id = 'a94bb8a1-fdbb-423d-bca9-ab63a8e6672a'
order by created_at desc;
```

A month aggregate matches the live P&L:

```sql
select basis, income_agorot, expense_agorot, net_profit_agorot
from public.agg_month
where company_id = 'a94bb8a1-fdbb-423d-bca9-ab63a8e6672a'
order by ym, basis;
```

The accountant export is הגדרות → ייצוא לרואה החשבון. The CSV has a BOM and Hebrew headers.

After `pnpm build`, `pnpm exec tsx scripts/check-bundle.ts` fails if the main JavaScript gzip exceeds 260 KB or if `service_role` appears in the client bundle.

iOS: if Google opens in Safari, the page חזרו לאפליקציה Flow is linked from the sign-in screen.
