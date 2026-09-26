> **Superseded.** This is the earlier Cloudflare Workers and D1 plan, kept for history. The current plan is [tech-plan.md](tech-plan.md). [0037](../decisions/0037-supabase-pilot.md) supersedes the D1 recommendation.

# Flow Module 1: technical plan

*Version 1.0 · 26 Sep 2026 · English working document for the build team. The product UI is Hebrew-only.*

**What Module 1 is:** a Hebrew-only, RTL, mobile-first installable web app (PWA) with one owner user per company, for Israeli contractors. It shows cash-basis profit and loss for the company and for each project, alongside the accountant's books (not replacing them). Data comes from SUMIT (read-only), Bank Hapoalim Excel statements, invoice photos and manual entry. AI tagging assigns project and category.

**Inputs this plan builds on:**
- Design spec: `/workspace/wireframes-pnl/final/`, which contains `implementation-guide.md`, `design-system.md`, `design-tokens.json` and `implementation-tokens.css`.
- Verified SUMIT research: `/workspace/flow-tech/sumit-api-research.md`, cited below as "SUMIT §x". It covers 72 live calls on the "Flow Test" company.

**Decisions this plan treats as fixed:**
- Google sign-in.
- The whole system costs at most $5/month.
- Home is usable within 2 s.
- SUMIT is read-only (decision 0036).
- Hapoalim upload stays alongside SUMIT.
- High-confidence AI tags are auto-approved; the rest go to a review queue.
- 7 default expense categories, which can be hidden or merged but never deleted.
- Split rules: equal, income share or manual %, and they can be recurring.
- Overhead stays company-level. The "after overhead share" view is off by default.
- Notifications: a Sunday 08:00 summary, plus a daily 18:00 nudge only when items are waiting.
- Periods: this month, last month and YTD.
- P&L is shown before VAT.

**Price rule:** every price below cites its source URL and was checked on 26 Sep 2026 unless marked otherwise. Anything that couldn't be verified is marked **(unverified)**.

---

## 0. Executive summary

| | |
|---|---|
| **Recommendation** | **Option A: all on Cloudflare.** Workers (API, cron and queue consumers) + static assets for the PWA + D1 (SQLite) + Queues + R2 (files), on the **Workers Free plan**. AI runs on **Gemini 3.1 Flash-Lite, paid tier** (financial data must not be used for training). |
| **Monthly cost, POC (1–5 companies)** | **≈ $0.05–$0.30**: Cloudflare $0 plus a few cents of Gemini. The domain is optional; use the free `*.workers.dev` URL. |
| **Monthly cost, ~50 companies** | **≈ $1.6–$2.5**: Cloudflare $0, Gemini ≈ $1.6, optional `.com` domain ≈ $0.87–0.93/mo. New companies add a one-time backfill of about $0.30 each. |
| **Budget risk** | The Workers Free plan allows **10 ms of CPU per invocation**. If Flow can't stay inside that, the Workers Paid plan is **$5/mo minimum**, and the total would become about $6.6–7.5, over budget. The design is built to stay on Free (heavy parsing happens on the phone, work is split into small queue messages, and totals are precomputed). The CPU use is measured in Phase 0 before anything is locked in (§1.4). |
| **Why not the others** | Supabase Free **pauses projects after 1 week of inactivity** and Pro is **$25/mo**. Vercel Hobby is **non-commercial only** and Pro is **$20/mo per seat**. Both break the $5 cap for a commercial product. |
| **SUMIT** | One CRM `listentities` call returns all income and expense documents, including net, VAT, links and budget section. It is polled daily, refreshed on app open (at most every 6 h), and re-scanned weekly. Flow keeps its own call counter (cap 100 per tenant per month; expected 60–80). The client wrapper allows read endpoints only, which enforces decision 0036 in code. |
| **Build** | 8 phases (0–7), 61 tasks (15 S, 39 M, 7 L), roughly **23–28 developer-weeks** to a pilot-ready Module 1: about 5–6.5 months for one developer, or about 3–3.5 months for two working in parallel (§8). |

---

## 1. Architecture options and recommendation

### 1.1 What the architecture must support (sizing assumptions)

| Driver | POC | ~50 companies | Notes |
|---|---|---|---|
| Users | 1–5 owners | 50 owners | 1 user per company |
| App opens | ~10/day per user | ~500/day | Each open costs 1–3 API requests (Home snapshot, pending count, refresh check) |
| API requests | < 500/day | ~5,000–10,000/day | Includes lists, approvals, uploads and cron |
| SUMIT documents per company | ~60/mo new; backfill ~1,000–2,000 | same per company | SUMIT §9 |
| Bank lines per company | ~80/mo; first upload up to 12 months (~1,000) | same | Hapoalim Excel |
| Invoice photos per company | ~15/mo | ~750/mo in total | AI vision |
| DB size | < 20 MB | ~150–300 MB | ~3–6 MB per company including trimmed raw JSON |
| Files (bank Excel + photos) | < 100 MB | ~2–3 GB/year | Photos ~300 KB each, bank Excel ~100 KB |

### 1.2 Options compared

**Option A: Cloudflare (Workers + static assets + D1 + Queues + R2 + Cron)**

| Component | Free tier | Paid | Source |
|---|---|---|---|
| Workers | 100,000 requests/day; **10 ms CPU per invocation**; static-asset requests are free and unlimited | $5/mo minimum; includes 10M requests/mo (+$0.30/M) and 30M CPU-ms (+$0.02/M CPU-ms) | https://developers.cloudflare.com/workers/platform/pricing/ |
| Worker limits | 5 Cron Triggers per account; 50 subrequests per request; 10 ms CPU per cron run | 250 crons; 10,000 subrequests; CPU up to 5 min | https://developers.cloudflare.com/workers/platform/limits/ |
| D1 (SQLite) | 5M rows read/day; 100k rows written/day; 5 GB in total; **500 MB per DB**; 50 queries per invocation; 7-day Time Travel. Queries **error** when a daily limit is exceeded, until 00:00 UTC | Included with Workers Paid: 25B reads/mo, 50M writes/mo, 5 GB, then $0.75/GB-mo; 10 GB per DB; 30-day Time Travel | https://developers.cloudflare.com/d1/platform/pricing/ · https://developers.cloudflare.com/d1/platform/limits/ |
| Queues | 10,000 operations/day (~3 operations per message) | 1M/mo included, then $0.40/M | https://developers.cloudflare.com/workers/platform/pricing/ |
| R2 | 10 GB-month; 1M Class A and 10M Class B operations; free egress | usage-based | https://developers.cloudflare.com/workers/platform/pricing/ (R2 section as summarised there) |
| KV (optional) | 100k reads/day; 1k writes/day; 1 GB | — | https://developers.cloudflare.com/workers/platform/pricing/ |
| Workers Logs | 200k log lines/day; 3-day retention | — | https://developers.cloudflare.com/workers/platform/pricing/ |

- **Pros:** it fits the POC and ~50 companies at **$0**. One vendor and one deploy. Edge latency for Israel. Static PWA assets are free and unlimited. Cron, queues and object storage are built in, and there are no cold-start pauses.
- **Cons:** the 10 ms CPU limit on Free shapes the design. D1 is SQLite, not Postgres. When a free limit is exceeded, D1 returns hard errors rather than billing. The only step up is the **$5 minimum**, which on its own takes the whole budget.

**Option B: Supabase (Postgres + Auth + Edge Functions + Storage) with a static host**

| Component | Free | Paid | Source |
|---|---|---|---|
| Supabase | $0: 500 MB DB, 50k MAU, 5 GB egress, 1 GB storage, 500k Edge Function invocations; **free projects pause after 1 week of inactivity**; max 2 projects | **Pro from $25/mo** | https://supabase.com/pricing |

- **Pros:** real Postgres with Row-Level Security and built-in Google auth. Fast to build.
- **Cons:** pausing after inactivity is unacceptable for a production system with a daily sync. Keeping it alive with pings is fragile and against the spirit of the tier. Pro at $25 is 5× the whole budget. **Rejected for production**; acceptable only for a throwaway prototype.

**Option C: Vercel (Next.js hosting) + Neon (serverless Postgres)**

| Component | Free | Paid | Source |
|---|---|---|---|
| Vercel | Hobby $0: **personal, non-commercial use only**; 1M edge requests, 1M function invocations, 4 h active CPU, cron included | **Pro $20/mo per seat** | https://vercel.com/pricing |
| Neon | Free $0: 100 CU-hours per project, 0.5 GB storage, **scale-to-zero after 5 min (cold starts)**, 5 GB egress | Launch pay-as-you-go: $0.106/CU-hour, $0.35/GB-month; invoices under $0.50 aren't collected | https://neon.com/pricing |

- **Pros:** Postgres. A mainstream stack.
- **Cons:** the Vercel Hobby terms forbid commercial use, so production needs Pro at $20. Neon's scale-to-zero adds a cold start to the first request after 5 idle minutes, which works against Home in 2 s. **Rejected on cost and terms.**

### 1.3 Recommendation: Option A (Cloudflare), on Workers Free

```
 Phone (PWA: Vite + Preact + TypeScript, Workbox service worker, IndexedDB cache, SheetJS lazy-loaded)
   │ HTTPS (same origin: app.<domain> or flow-app.<acct>.workers.dev)
   ▼
 Worker "flow-api" (Hono router) ─── static assets (PWA shell, fonts, icons): free, unlimited
   │   ├─ /api/*      JSON API (session cookie)
   │   ├─ /auth/*     Google OIDC code flow
   │   └─ /hooks/*    optional SUMIT trigger signal (disabled in M1, §3.1.7)
   ├── D1 "flow-db"   single multi-tenant DB, every row has company_id; location hint EU
   ├── R2 "flow-files" bank Excel originals and invoice photos (private)
   ├── Queue "flow-jobs" sync pages, AI batches, aggregate refresh, push sends
   └── Cron (1 trigger, every 15 min) → dispatcher → enqueues due jobs
 External: SUMIT API (read-only allowlist) · Gemini API (paid tier) · Web Push services (FCM / APNs via VAPID)
```

**Stack choices:**
- **Frontend:** Vite + Preact + TypeScript. Preact is small, which matters for the 2 s budget. Workbox for the service worker. Tokens come from `implementation-tokens.css`, with self-hosted Rubik (the design's font) subset to Hebrew + Latin digits.
- **Backend:** Hono on Workers. SQL through Drizzle or Kysely against D1. Zod 4.5+ for validation (the Workers limits page warns that older Zod uses much more memory).
- **Tests:** Vitest with `@cloudflare/vitest-pool-workers`, and Playwright for mobile flows in RTL.

**D1 region:** create the DB with a location hint in Europe (Israel has no D1 region), e.g. `eeur` or `weur`. Measure the round-trip from Israel in Phase 0 and pick the lower one.

**One DB or one per tenant:** use one DB at this scale. The free per-DB cap is 500 MB, and 50 companies ≈ 150–300 MB. Put a per-tenant split (D1 supports many small DBs) on the list for when the DB passes about 350 MB or on moving to Workers Paid.

### 1.4 Staying inside Workers Free: the 10 ms CPU rule

The limit counts CPU only; time waiting on `fetch`, D1, R2 or the Queue is free (limits page). Note that D1 result serialisation does count against Worker CPU (D1 limits page), so queries must return small result sets. Design rules:

1. **Parse the Hapoalim Excel on the phone**, with SheetJS lazy-loaded on the upload screen. The Worker receives normalised JSON rows of about 80 bytes each and only validates them and inserts them in batches.
2. **SUMIT pages of 200 documents per queue message**, not 1,000, so each `JSON.parse` and map stays small. This uses a few more SUMIT calls during backfill (§3.1). On Workers Paid, switch to PageSize 1000.
3. **Precomputed totals** mean Home is a single-row read with no aggregation in the Worker (§6).
4. **Crypto uses WebCrypto:** AES-GCM, HMAC, RS256 verification for Google ID tokens, and ECDH for Web Push. These are native and cheap.
5. **One queue message = one small unit of work:** one SUMIT page, one AI batch of 20 items, one aggregate refresh for one company-month, or one push. This also respects the Free limits of 50 subrequests and 50 D1 queries per invocation.
6. **Phase 0 gate (task P0-6):** run a CPU benchmark with a real CRM response (200 and 1,000 documents), a 1,000-line bank import and a push send. The `cpu_ms` fields in Workers Logs decide whether Free holds. If p99 is over 10 ms on hot paths that can't be split, the fallback is Workers Paid at $5. The owner has to decide that trade-off (§9, Q1).

### 1.5 Monthly cost estimate

| Item | POC (1–5 companies) | ~50 companies | Source / basis |
|---|---|---|---|
| Cloudflare Workers, static assets, D1, Queues, R2, Cron | $0 | $0 (see the headroom table) | pricing pages above |
| Gemini 3.1 Flash-Lite (tagging + invoice photos) | ~$0.03–0.16 | **~$1.60** steady state | §4.5; https://ai.google.dev/gemini-api/docs/pricing |
| One-time backfill tagging per new company | ~$0.30 each | ~$0.30 each (one-off) | §4.5 |
| Domain (optional) | $0 on `workers.dev` | `.com` via Cloudflare Registrar at cost: $10.46/yr (~$0.87/mo) until 31 Oct 2026, expected $11.17/yr (~$0.93/mo) from 1 Nov 2026 | at-cost policy: https://www.cloudflare.com/application-services/products/registrar/buy-com-domains/ ; figures: https://tldes.com/pages/com-price-increase-2026 and https://domainoffer.net/tld/com/cloudflare. `.co.il` price **(unverified)** |
| Google sign-in | $0 | $0 | Flow uses Google's OAuth 2.0/OIDC directly, and Google publishes no fee for basic OAuth sign-in **(no price page; "free" is unverified)**. For comparison, Google Identity Platform bills $0 for the first 50,000 MAU: https://cloud.google.com/identity-platform/pricing |
| Web Push | $0 | $0 | Standard VAPID Web Push through browser push services; Apple says no Apple Developer Program membership is needed: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers |
| **Total** | **≈ $0.05–0.30** | **≈ $1.60 (no domain) to $2.50 (with domain)** | |
| Worst case (Workers Paid needed) | $5.05–5.30 | ≈ $6.6–7.5 | $5 minimum: https://developers.cloudflare.com/workers/platform/pricing/ |

*The customer's own SUMIT plan (API needs Start, 19 ₪/mo annual) is paid by the customer, not Flow (SUMIT §6).*

**Free-tier headroom at ~50 companies:**

| Limit (Free) | Estimated use | Headroom |
|---|---|---|
| Workers: 100k requests/day | ≤ 10k/day | 10× |
| D1: 5M rows read/day | ~0.2–0.6M/day (Home ≈ 1–30 rows; lists 50 rows/page; weekly re-scan compares ~700 rows per company) | ≥ 8× |
| D1: 100k rows written/day | Typical ~5k/day. The worst day has two onboardings (~2 × 10k, including index writes) plus one weekly re-scan batch | ≥ 3× (stagger onboardings and re-scans) |
| D1: 500 MB per DB | 150–300 MB | ~2× (plan the per-tenant split) |
| Queues: 10k operations/day | ~50 companies × ~10 messages × 3 = 1.5k/day; onboarding day ~+1k | ~5× |
| R2: 10 GB-month | ~2–3 GB after a year | 3× (photo retention policy, §7) |
| Crons: 5 per account | 1 (dispatcher every 15 min) | 4 spare |

Monitoring: a daily job reads Cloudflare usage analytics and alerts the operator at 50% of any D1 or Queues daily limit. When a daily D1 limit is exceeded, queries fail until 00:00 UTC (03:00 IL in summer, 02:00 in winter), so the alert must come early.

---

## 2. Data model

**Conventions:**
- **Money** is always integer **agorot** (`INTEGER`), never floats. Percentages and confidences are integer **basis points** (0–10000).
- **Dates** are `TEXT 'YYYY-MM-DD'` in Israel local time. Timestamps are UTC ISO strings.
- **IDs** are ULIDs (sortable text).
- Every business table has `company_id`, and every query is scoped by the `company_id` taken from the session, never from the client.
- Soft states (`hidden`, `archived`, `merged_into`) are used instead of deletes wherever the design says hide/merge/archive.
- Hard deletes happen only for user-requested transaction deletion (screen 20) and account deletion.

### 2.1 Tables

**Identity and tenant**

| Table | Key fields | Notes |
|---|---|---|
| `company` | `id`, `name`, `tax_id` (ח.פ/ע.מ, optional), `vat_mode` (`osek_murshe`, `osek_patur`, `company`), `vat_rate_bp` (current standard rate, from SUMIT `getvatrate` or config), `tax_year_start_month` (1), `settings_json` (`auto_approve_high_conf`: true, `overhead_view_default`: false, `approve_threshold_bp`), `created_at`, `deleted_at` | One per customer |
| `app_user` | `id`, `company_id`, `google_sub` (unique), `email`, `name`, `picture_url`, `role` ('owner'), `created_at`, `last_login_at` | Single owner in M1; the table allows more later |
| `session` | `id_hash` (SHA-256 of the cookie token), `user_id`, `company_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `ua_hint` | See §5 |
| `audit_log` | `id`, `company_id`, `user_id`, `ts`, `action`, `entity`, `entity_id`, `meta_json` (never secrets) | Key connect/disconnect, deletes, merges, exports, rule changes |
| `applied_op` | `company_id`, `client_op_id` (PK pair), `applied_at` | Idempotency for offline-queued approvals |

**Master data**

| Table | Key fields | Notes |
|---|---|---|
| `project` | `id`, `company_id`, `name`, `status` (`active`, `archived`), `counterparty_id` (main customer, nullable), `site_address`, `budget_agorot` (nullable, which hides the budget block), `created_via` (`manual`, `onboarding`, `auto_bank_recurring`, `sumit_budget`), `created_at`, `archived_at` | Auto-opened projects (recurring customer detected) also create a review item "פרויקט חדש נפתח" |
| `category` | `id`, `company_id`, `kind` (`income`, `expense`), `name`, `sort`, `is_default`, `hidden`, `merged_into_id`, `created_at` | Seeded per company: expense חומרים, קבלני משנה, עבודה, ציוד והשכרה, הובלה, ביטוח, אחר; and **2 income** categories (names as on screen 07). A merge moves allocations in one batch and sets `merged_into_id`. Nothing is deleted |
| `counterparty` | `id`, `company_id`, `kind` (`customer`, `supplier`, `both`, `own_account`, `authority`), `name`, `normalized_name` (Hebrew normalisation: strip בע"מ, quotes and extra spaces; fold final letters), `sumit_entity_id`, `tax_id`, `bank_aliases_json` (strings seen in bank descriptions) | `own_account` marks the owner's other accounts, used for transfer detection. `authority` covers מע"מ, מס הכנסה and ביטוח לאומי |

**Sources**

| Table | Key fields | Notes |
|---|---|---|
| `source_document` | `id`, `company_id`, `source` (`sumit`, `photo`, `manual`), `external_id` (SUMIT entity id), `doc_type` (normalised, §2.2), `doc_number`, `doc_date`, `source_insert_ts` (SUMIT `Accounting_InsertDate`), `counterparty_id`, `gross_agorot` (signed), `net_agorot` (signed, nullable), `vat_agorot`, `vat_rate_bp` (nullable), `vat_status` (`known`, `derived`, `unknown`, `exempt`), `original_doc_id` (FK to `source_document`: receipt→invoice, credit→invoice), `description`, `external_ref` (supplier invoice number), `payment_method`, `cheque_due_date`, `is_cancelled`, `budget_item_ext_id`, `content_hash`, `raw_json` (trimmed to used fields), `r2_key` (photo), `first_seen_at`, `updated_at` | Unique on (`company_id`, `source`, `external_id`). This is Flow's copy; nothing is ever changed in SUMIT |
| `bank_upload` | `id`, `company_id`, `bank` ('hapoalim'), `account_masked` (last 4 digits), `r2_key`, `file_sha256`, `period_from`, `period_to`, `rows_total`, `rows_new`, `rows_duplicate`, `internal_transfers`, `matched_to_docs`, `by_learned_rules`, `auto_approved`, `pending`, `unpaid_invoices_flagged`, `status` (`parsing`, `processing`, `done`, `failed`), `error_code`, `created_at` | Feeds screen 08's result counters |
| `bank_line` | `id`, `company_id`, `upload_id`, `account_masked`, `op_date`, `value_date`, `description`, `details`, `reference`, `amount_agorot` (signed: + credit / − debit), `balance_agorot`, `line_hash` (unique per company), `classification` (`normal`, `internal_transfer`, `card_settlement`, `tax_payment`, `loan`, `owner`) | Dedupes overlapping statements |

**P&L core.** A "transaction" is modelled as an economic item plus its cash events.

| Table | Key fields | Notes |
|---|---|---|
| `txn` | `id`, `company_id`, `direction` (`in`, `out`), `pnl_kind` (`income`, `expense`, `non_pnl`), `status` (`pending`, `approved`, `excluded`), `counterparty_id`, `title` (display name), `doc_date`, `gross_agorot`, `net_agorot`, `vat_agorot`, `vat_status`, `primary_doc_id` (invoice or expense doc, nullable), `origin` (`sumit`, `bank`, `photo`, `manual`), `assigned_by` (`sumit_budget`, `supplier_memory`, `rule`, `ai`, `user`, `split_rule`), `ai_conf_bp`, `note`, `created_at`, `updated_at`, `deleted_at` | One economic item: an invoice, an expense document, or a standalone payment (e.g. a bank line with no document) |
| `payment` | `id`, `company_id`, `txn_id`, `pay_date` (**cash date**), `gross_agorot` (signed), `net_agorot` (signed), `evidence_doc_id` (receipt / invoice-receipt / paid-expense doc), `bank_line_id`, `method`, `source` (`sumit`, `bank`, `manual_mark_paid`) | Cash-basis P&L sums **payments by pay_date**. Partial payments are several rows. `txn.gross − Σ payment.gross` = unpaid |
| `allocation` | `id`, `company_id`, `txn_id`, `project_id` (NULL = company-level / overhead), `category_id`, `share_bp` (rows sum to 10000), `split_rule_id` (nullable), `computed_for_ym` (income-share rules) | One row when unsplit. Several rows come from screen 11 or a split rule |
| `split_rule` | `id`, `company_id`, `name`, `method` (`equal`, `income_share`, `manual`), `recurring` (bool), `match_json` (counterparty_id / category_id / keyword), `active`, `created_at` | Recurring rules apply to future matching items automatically |
| `split_rule_target` | `rule_id`, `project_id`, `share_bp` (manual only) | For `equal` and `income_share`, shares are computed per period (§2.3) |

**Workflow and learning**

| Table | Key fields | Notes |
|---|---|---|
| `review_item` | `id`, `company_id`, `txn_id`, `reason` (`low_confidence`, `new_counterparty`, `conflict`, `vat_unknown_large`, `new_project_opened`, `possible_duplicate`), `sugg_project_id`, `project_conf_bp`, `sugg_category_id`, `category_conf_bp`, `model`, `reason_he` (short Hebrew explanation), `status` (`open`, `approved`, `changed`, `skipped`), `created_at`, `resolved_at` | Screen 03. Pending txns are excluded from figures. Skipped items move to the end of the queue |
| `supplier_memory` | `id`, `company_id`, `counterparty_id` (nullable), `match_key` (normalised description token for bank-only suppliers), `project_id` (nullable = company-level), `category_id`, `split_rule_id`, `vat_rate_bp` (learned from invoices), `kind` (`fixed`: user switched "remember" on; `learned`: 3 consistent approvals), `hits`, `last_hit_at`, `created_at` | Source of "שויך אוטומטית לפי ספק קבוע" and "15 by learned rules" |
| `daily_stat` | `company_id`, `date`, `auto_approved`, `reviewed`, `imported` | "12 אושרו אוטומטית היום" |

**Integration**

| Table | Key fields | Notes |
|---|---|---|
| `sumit_connection` | `company_id` (PK), `sumit_company_id`, `key_ct` (ciphertext), `key_iv`, `dek_wrapped`, `kek_version`, `key_fingerprint` (HMAC, for "same key?" checks), `status` (`active`, `invalid_key`, `plan_no_api`, `paused_cap`, `disconnected`), `company_type`, `folder_map_json` (name → per-company folder id), `property_map_json` (e.g. budget property present), `has_budget_module`, `last_insert_ts`, `last_incremental_at`, `last_rescan_at`, `last_app_refresh_at`, `next_due_at`, `calls_month` ('YYYY-MM'), `calls_count`, `calls_cap` (100), `last_error_code`, `connected_at` | §3.1 and §7 |
| `sumit_budget_map` | `company_id`, `budget_item_ext_id`, `project_id` | SUMIT budget section → Flow project (tenants with the Budget module only) |
| `sumit_call_log` | `id`, `company_id`, `ts`, `endpoint`, `http_status`, `sumit_status`, `latency_ms`, `items`, `purpose` (`onboard`, `incremental`, `rescan`, `app_open`, `details`) | Never stores request or response bodies. Retained for 90 days |
| `sync_job` | `id`, `company_id`, `kind`, `state`, `cursor_json`, `attempts`, `created_at`, `finished_at` | Backfill and re-scan progress across queue messages |

**Aggregates**

| Table | Key fields | Notes |
|---|---|---|
| `agg_month` | PK (`company_id`, `ym`, `project_key` ('' = company-level), `category_id`), `income_net`, `expense_net`, `income_gross`, `expense_gross`, `vat_unknown_gross`, `n` | Cash basis, approved only, after allocation. Rebuilt per company-month on change |
| `home_snapshot` | PK (`company_id`, `period` (`this_month`, `last_month`, `ytd`)), `payload_json` (profit / income / expenses in agorot, change vs the previous comparable period, pending count, unpaid total, top 3 projects, `data_basis` e.g. "bank only"), `computed_at`, `version` | **Home = 1 row** (§6) |
| `project_snapshot` | PK (`company_id`, `project_id`, `period`), `payload_json` | Project screen 02 and the projects list |

**Notifications**

| Table | Key fields | Notes |
|---|---|---|
| `push_subscription` | `id`, `user_id`, `endpoint`, `p256dh`, `auth`, `platform`, `created_at`, `last_ok_at`, `fail_count` | Removed on 404/410 from the push service |
| `notification_state` | `company_id` (PK), `weekly_enabled` (true), `weekly_dow` (0 = Sunday), `weekly_time` ('08:00'), `nudge_enabled` (true), `nudge_time` ('18:00'), `last_weekly_sent_on`, `last_nudge_sent_on`, `last_nudge_pending` | Times are Israel local; the dispatcher handles DST (§3.3) |

### 2.2 Document types and how they become P&L

SUMIT child folder names are resolved per company (SUMIT §9) and mapped to Flow's normalised `doc_type`:

| SUMIT document | Flow `doc_type` | Creates / affects | Counts in profit? |
|---|---|---|---|
| חשבונית מס (tax invoice) | `tax_invoice` | `txn` (in), no payment → **Unpaid** list | Not until paid |
| קבלה (receipt) linked via `Accounting_OriginalDocument` | `receipt` | `payment` on the linked invoice's txn | Yes, on the receipt date |
| קבלה with no link | `receipt` | New standalone `txn` plus a `payment` | Yes |
| חשבונית מס/קבלה (invoice-receipt) | `invoice_receipt` | `txn` plus a `payment` on the same date | Yes |
| חשבונית זיכוי (credit invoice) | `credit_invoice` | Reduces the linked txn's gross/net. If the invoice was already paid, the refund arrives as a credit receipt or bank debit | Via the refund payment |
| קבלת זיכוי / refund | `credit_receipt` | Negative `payment` | Yes (negative) |
| חשבונית ותשלום לספק (expense + payment, type 15) | `expense_paid` | `txn` (out) plus a `payment` | Yes |
| תיעוד תשלום (payment record, type 17) | `expense_payment` | `payment` on a linked supplier invoice, or a standalone txn | Yes |
| חשבונית ספק (supplier invoice, type 16) | `supplier_invoice` | `txn` (out), unpaid (payable) | Not until paid |
| Invoice photo (Flow OCR) | `photo_invoice` | `txn` (out) with known VAT. Payment comes from a matched bank line or "סמן כשולם" | When paid |
| Bank line | — | Matches an existing open item (becomes its `payment`), or creates a bank-only `txn` | Yes, unless `non_pnl` |

**Rules:**
- **Income vs expense:** `txn.direction` comes from the document family (sales vs supplier folder) or the bank sign. SUMIT returns expenses as **negative** amounts (verified), so Flow stores the absolute value on `txn` with `direction='out'` and keeps signs only for credits.
- **Cash basis:** profit for a period = Σ `payment.net` (approved txns, `pnl_kind` income) − Σ `payment.net` (expense), for `pay_date` in the period, after allocations. Unpaid invoices and payables are shown separately ("לא נכלל ברווח", screens 08 and 12).
- **Linked receipts (no double counting):** a receipt pointing at an invoice is a payment of that invoice, never a second income. Open balance = invoice gross − Σ linked receipts − Σ linked credits. **`IsClosed` isn't used**, because it isn't reliable (verified).
- **VAT and "before VAT":**
  - **Invoice-type documents:** net = `Accounting_DisplayCompanyValueWithoutVAT`, with `vat_status='known'`.
  - **Receipts** carry no VAT. A payment's net = payment gross × (invoice net ÷ invoice gross), in integer arithmetic with banker's rounding to the agora. A standalone receipt in a VAT-registered company gets net = gross ÷ (1 + rate), with `vat_status='derived'`.
  - **`osek_patur`:** net = gross, with `vat_status='exempt'`.
  - **Expenses with no VAT rate** (e.g. API-created expenses, verified) and **bank-only expenses:** show **gross** with `vat_status='unknown'` and a small "מע״מ לא ידוע" marker on the transaction. **Don't guess 18%**, because salaries, insurance and foreign suppliers carry none. Supplier memory can learn a rate from matched invoices or photos, which turns later items to `derived`.
  - **Bank-only income** in a VAT-registered company is derived at the standard rate (domestic sales). This needs owner confirmation (Q5).
  - **Home figures** use net where known and gross where unknown. The snapshot counts unknown-VAT gross so the UI can add an honest hint when it's material (> 5% of expenses).
- **Credit notes:** credits are already negative in SUMIT, so sum them directly. A credit linked to an unpaid invoice reduces the open balance. A credit on a paid invoice has no cash effect until the refund (credit receipt or bank debit).
- **Cheques:** the default cash date is the receipt date. With `getdetails`, `Details_Cheque.DueDate` can be used for post-dated cheques (setting off in M1; Q7).
- **Non-P&L money:** transfers between own accounts, VAT payments to מע"מ, income tax / ביטוח לאומי, loans and owner withdrawals become `pnl_kind='non_pnl'`. They're excluded from profit and counted in the upload results ("2 transfers between your own accounts removed").
- **Credit-card settlement lines** (one monthly bank debit covering many card purchases) are classified as `card_settlement`. Exclude them when SUMIT already holds card-paid expense documents for that month; otherwise send them to review as an expense to categorise (risk R6).

### 2.3 Splits and overhead

- **Manual split (screen 11):** writes N `allocation` rows whose `share_bp` sums to 10000. The last row takes the rounding remainder.
- **Recurring split rule:** on ingest, if `match_json` matches, allocations are created with `split_rule_id` and `assigned_by='split_rule'`, and the item is auto-approved (it's a deterministic rule).
- **Equal:** 10000 ÷ n across the rule's projects that are active on `pay_date`.
- **Income share:** computed per company-month at aggregation time, as each target project's income ÷ total income of the targets that month. If all targets have 0 income that month, fall back to equal. Because it depends on the month's income, each `agg_month` rebuild re-evaluates these allocations (stamped with `computed_for_ym`).
- **Overhead:** expenses with `project_id NULL` stay company-level. Home's big number is always **company net profit** (income − all expenses, including overhead).
- **"After overhead share" view (off by default):** computed on read from `agg_month`:
  - project overhead share = overhead × project income ÷ income of all active projects in the period;
  - if total project income is 0, the share is 0 and the UI shows "—".
  - It is never stored as allocations, so turning it on or off can't change any stored figure.

### 2.4 Rounding (design rule)

- All sums are in agorot.
- Home displays whole shekels, with profit = round(income) − round(expenses), computed on the client from the snapshot agorot so the three numbers always add up.
- Transaction detail shows agorot.

---

## 3. Sync design

### 3.1 SUMIT (read-only)

**3.1.1 Hard read-only guarantee (decision 0036)**
- **Allowlist in the client wrapper:** `sumitClient` exposes only read endpoints: `crm/data/listentities`, `crm/schema/listfolders`, `crm/schema/getfolder`, `website/companies/getdetails`, `accounting/documents/list`, `accounting/documents/getdetails`, `listquotas` and `getvatrate`. Any other path throws before the network call.
- **CI check:** a unit test plus a grep step fail the build if a non-allowlisted SUMIT path string appears anywhere in the code.
- **No write features:** no `updateentity`, no document creation and no trigger subscription from Flow.

**3.1.2 Connect (onboarding step or Settings → "חיבור SUMIT")**
1. The user pastes **CompanyID + API key**. In-app help shows exactly where to generate a **dedicated key named "Flow"** in SUMIT, so it can be revoked on its own.
2. The Worker calls `companies/getdetails`. This validates the key and the plan (the API needs Start or above; a business error maps to a "your plan has no API" message) and reads `CompanyType`, which gives the VAT mode.
3. `listfolders`, then `getfolder` on "מסמכים", resolve the per-company folder IDs and detect the budget property.
4. `listquotas` is read once as a baseline.
5. The key is encrypted and stored (§7). The plaintext exists only in memory for the length of the request.

That's about 4 calls.

**3.1.3 Backfill**
- A `sync_job(kind='backfill')` runs through queue messages. Each message makes **one CRM call**: folder "מסמכים", `IncludeInheritedFolders:true`, `LoadProperties:true`, `Order: Accounting_InsertDate asc`, `PageSize: 200` (Free-plan CPU rule), `StartIndex += 200` while `HasNextPage`.
- The range starts at the beginning of the previous tax year. Filter on `Accounting_Date` if that proves to work (untested); otherwise filter on `InsertDate` and drop older rows in code.
- A typical company with 1,000–2,000 documents needs **5–10 calls** at PageSize 200 (1–2 on Workers Paid at PageSize 1000).
- Each page upserts `source_document` rows (skipped when `content_hash` is unchanged), then derives `txn`/`payment` rows and runs tagging (§4).
- Sort in code, because SUMIT's default order isn't by date.
- The last message triggers an aggregate rebuild and the "ready" state (plus a push if the user has left).

**3.1.4 Incremental cadence**

| Trigger | What | SUMIT calls | Frequency |
|---|---|---|---|
| **Daily poll** | CRM `listentities` with `Accounting_InsertDate >= last_insert_ts − 1 day`, ordered by InsertDate; the overlap is deduped by `external_id` | 1 (2 if > 200 new) | Once a day per company, in a staggered slot between 02:00 and 05:00 IL (hash of company_id) |
| **App-open refresh** | Same query. The client calls `POST /api/sync/refresh` on open; it runs only if `now − last_app_refresh_at ≥ 6 h` and the counter allows. The UI shows cached data immediately | 1 | ≤ 4/day; realistically ~1/day |
| **Pull-to-refresh** | Same as app-open, with a 30-minute floor. If throttled, the UI just re-reads Flow's own data | 1 | rare |
| **Weekly re-scan** | The whole current tax year, compared by `content_hash`, to catch changes (budget-section edits, cancellations, links added later), because SUMIT has **no modified field** (verified). In January–April, also re-scan the previous year (annual report season) | 3–5 at PageSize 200 (≈700–1,000 documents) | Saturday night, staggered |
| **On-demand details** | `getdetails` when the user opens a SUMIT document's line items, or for a cheque due date | 1 per document, cached forever | rare |

**3.1.5 Own call counter (SUMIT exposes none; verified)**
- Every call goes through `reserveCall(company_id, purpose)`. This is one atomic D1 statement, `UPDATE sumit_connection SET calls_count = … WHERE company_id=? AND (calls_month<>? OR calls_count < calls_cap) RETURNING calls_count`, which also rolls the month over. If no row comes back, the call is refused.
- **Budget:** about 4 onboarding calls and ~8 backfill calls, one time. After that, ≈ 30 daily + 12–20 weekly + ~20–30 app-open = **~60–80 calls in a full month**. That's under the cap of 100, and under about a third of SUMIT Start's 250 included calls (SUMIT §6).
- **Degradation ladder:**
  - above 70 calls, app-open refresh stops (daily poll and weekly re-scan only);
  - above 90, weekly re-scan only;
  - at 100, paused until the 1st of the month.
  - Settings shows "עודכן לאחרונה …", never an error, for this.
- Every call writes a `sumit_call_log` row, with no bodies.

**3.1.6 Error handling**
- **HTTP non-200 or `Status:2`:** retry with backoff (queue retry, max 3).
- **`Status:1` (business error):** don't retry. Map it to `invalid_key`, `plan_no_api` or `unknown`, show a Hebrew message in Settings, and send one push if the daily sync keeps failing for 3 days.
- **Invalid key:** stop scheduling. SUMIT auto-deletes keys unused for 120 days; the daily poll prevents that.

**3.1.7 Optional trigger signal: conflicts with decision 0036**
- SUMIT triggers work (verified): about 75 s latency, one POST per document, no signature. They need the customer on **Growth (99 ₪/mo)** with the Triggers and Views modules.
- **Registering** a trigger via `triggers/subscribe` is a **write** to the customer's SUMIT, which decision 0036 forbids. The options are:
  - **(a)** skip triggers in M1, because the daily poll plus app-open refresh are enough for a P&L; or
  - **(b)** let the *customer* create the trigger in SUMIT's own UI, pointing at a per-company URL that Flow shows in Settings.
- **Recommendation: (a) for Module 1.** Build the endpoint behind a feature flag, so (b) can be switched on later without code changes.
- **Endpoint when enabled:** `/hooks/sumit/<128-bit random token>`. The body is ignored apart from a size check (≤ 16 KB). The handler enqueues a debounced "re-sync company" (5-minute window) and returns 200 at once. The read that follows still goes through the call counter. The token rotates on reconnect.

**3.1.8 Mapping SUMIT to Flow**
- **Project:**
  - `BudgetManagement_BudgetItem` → `sumit_budget_map` → project (100% confidence), for tenants with the Budget module (Advanced plan).
  - Otherwise supplier memory, rules or AI (§4).
  - Linked documents (receipt → invoice) **inherit** the invoice's allocation.
- **Counterparty:** the `Accounting_Customer` entity id → `counterparty.sumit_entity_id`.
- **Fallback path:** if the undocumented CRM `Accounting_*` fields break, switch the tenant to `documents/list`. That returns gross only, with no links and no budget section, so VAT is derived and links are matched by amount and customer. A nightly schema-drift check on one page alerts the operator.

### 3.2 Bank Hapoalim Excel upload

**Flow:** screen 04 "דוח בנק" → file picker (`.xlsx`/`.xls`) → **parse on the phone** → `POST /api/bank/uploads` (normalised rows + the file) → processing screen ld-05, with steps and "continue in background" → results screen 08.

1. **Parse on the phone:**
   - SheetJS, lazy-loaded only on this screen. Install it from the SheetJS CDN build rather than the outdated npm copy **(unverified detail; check at build time)**.
   - Find the header row by Hebrew column names. The expected Poalim columns are תאריך, תיאור הפעולה, פרטים, אסמכתא, חובה, זכות, יתרה, and possibly תאריך ערך. **Confirm the exact format on 2–3 real exports** (task P4-1).
   - Read the account number from the sheet header when present.
2. **Validate:**
   - Reject with **er-01** ("זה לא נראה כמו דוח של בנק הפועלים") when the header isn't found, there are no parsable rows, or the amounts are inconsistent. The balance check requires balanceₙ = balanceₙ₋₁ ± amount on at least 95% of rows.
   - Convert amounts to integer agorot from the strings, never via floats.
3. **Upload:** the original file goes to R2 (private, per-company prefix, retention in §7) and the rows go as JSON. The server re-validates types, ranges and row count (≤ 5,000).
4. **Dedupe:** `line_hash = SHA-256(company, account, op_date, amount, reference, normalised description, balance)`. Lines whose hash already exists count as duplicates, so overlapping statements are safe.
5. **Classify each new line:**
   - **Internal transfer:** the description mentions one of the owner's own account numbers or matches an "העברה לחשבון/מחשבון" pattern to an `own_account`, or there's an opposite-sign pair across the owner's accounts within 1 day. Result: `non_pnl`.
   - **Card settlement:** known issuer names (ישראכרט, כאל, מקס, אמריקן אקספרס, דיינרס) → `card_settlement` (§2.2).
   - **Tax payments:** מע"מ, מס הכנסה, ביטוח לאומי → `non_pnl` (authority).
6. **Match to existing items** (SUMIT documents, photo invoices, manual items) before creating anything new:
   - Score = exact gross amount (required) + date proximity (income: receipt date −2 to +5 days; expense: −3 to +10 days) + name similarity (counterparty aliases vs the description) + cheque or reference number.
   - Assign greedily, one-to-one, by best score above a threshold.
   - A match makes the bank line the **payment evidence**: it attaches to an existing payment, or creates the payment for an unpaid invoice. This is "18 matched to invoices", and it never creates a second income.
   - If two candidates score within a small gap of each other, create a `possible_duplicate` review item instead.
7. **Unmatched lines** become bank-only `txn`s and go through tagging (§4), with supplier memory checked first ("15 by learned rules"). Aliases learned from matches are saved on the counterparty.
8. **Recurring customer:** income from the same payer 2 or more times with no active project → auto-open a project and add a review item (per the design).
9. **Invoices still unpaid** after matching are counted as "3 invoices unpaid, not counted in profit".
10. **Finish:** rebuild the aggregates for the affected months, write the result counters to `bank_upload`, and send a push if the user left the screen.

**CPU:** server work is inserts in batches of up to 100 rows plus matching queries. Matching runs in queue messages of about 200 lines each.

### 3.3 Scheduler and notifications (shared)

**Scheduler:**
- One Cron Trigger, `*/15 * * * *` (UTC).
- The dispatcher converts to `Asia/Jerusalem` in code (DST-safe) and enqueues due work: daily polls in each company's slot, weekly re-scans, Sunday 08:00 summaries, 18:00 nudges and the daily usage check.

**Sunday 08:00 summary (screen 13):**
- Built from `home_snapshot`: last week's profit, income and expenses, plus the pending count.
- Sent once, guarded by `last_weekly_sent_on`.

**Daily 18:00 nudge:**
- Sent **only if** there are open review items, or new unpaid items since the last nudge.
- Not sent if the user already cleared the queue that day.
- Whether to skip Saturdays and Jewish holidays is **Q9**; the default is to skip Saturday.

**Push delivery:**
- Web Push with VAPID keys stored as Worker secrets. Payload encryption (aes128gcm) uses WebCrypto.
- Subscriptions that return 404/410 are deleted.
- **iOS** allows push only for a PWA added to the Home Screen, and the permission request must come from a user gesture (iOS/iPadOS 16.4+): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/. That's why onboarding 09e asks after install (17b).

---

## 4. AI tagging

### 4.1 Pipeline: rules first, then the LLM

| Step | Source | Project conf | Category conf | Result |
|---|---|---|---|---|
| 1 | Linked document inherits the parent's allocation (receipt → invoice) | 100% | 100% | auto |
| 2 | SUMIT budget section → mapped project | 100% | from step 3 or later | auto for the project |
| 3 | `supplier_memory` **fixed** ("remember" switch on screen 06) | 99% | 99% | auto; shows "שויך אוטומטית לפי ספק קבוע" |
| 4 | Recurring split rule match | 99% | 99% | auto, with split allocations |
| 5 | `supplier_memory` **learned** (3 or more consistent approvals, no contradiction in the last 5) | 95% | 95% | auto |
| 6 | Customer has exactly one active project (income) | 93% | income default | auto |
| 7 | Keyword rules: project name, site address or customer name in the description; category dictionary (e.g. insurers → ביטוח; fuel/transport → הובלה; equipment rental companies → ציוד והשכרה) | 85–92% | 80–92% | auto if at or above the threshold |
| 8 | **LLM** for everything left, in batches | model score (calibrated) | model score (calibrated) | threshold |
| — | Invoice photos: vision extraction first (§4.3), then steps 3–8 on the extracted supplier | | | |

### 4.2 Confidence thresholds and auto-approve

- **Auto-approve** when the Settings switch "אישור אוטומטי בביטחון גבוה" is on (default on) **and** project confidence ≥ **90%** **and** category confidence ≥ **90%** **and** none of these apply:
  - a new counterparty with an amount over ₪5,000;
  - unknown VAT with an amount over ₪5,000;
  - a possible duplicate;
  - a conflict between signals (e.g. a rule and the LLM disagree).
- **Otherwise** create a review item with the suggestion, showing both percentages as on screen 03.
- **Calibration:**
  - LLM self-reported confidence isn't trusted as is. The stored score is `min(model_score, band_cap)`, where band caps are learned from each tenant's review outcomes (accuracy per 10-point band, updated weekly).
  - Until a company has 50 reviewed items, LLM scores are capped at 89%, so **nothing from the LLM is auto-approved in a company's first days**. Rules and memory carry the early load.
- **Every correction feeds back:**
  - "Change" with "remember" on creates or updates a **fixed** memory.
  - Three consistent approvals create a **learned** memory.
  - A correction that contradicts a learned memory demotes it.
- Auto-approved items stay visible and editable, and their count shows as "12 אושרו אוטומטית היום".

### 4.3 LLM calls

**Tagging batch:**
- Up to 20 items per request, with JSON-schema structured output.
- Context per request:
  - the company's active projects (id, name, customer, site address, top counterparties);
  - categories (id and name; hidden ones excluded, merges resolved);
  - the 5–10 most relevant supplier-memory hints.
- Per item: counterparty name, bank description/details, amount, direction, date, SUMIT document type and description.
- Output: `project_id | null` (company-level), `project_conf`, `category_id`, `category_conf`, `reason_he` (≤ 60 characters).
- Hebrew system prompt, temperature 0.

**Invoice photo (vision):**
- `media_resolution` medium (560 tokens) by default, retrying at high (1,120 tokens) when fields are missing. Token counts per setting: https://ai.google.dev/gemini-api/docs/media-resolution
- Extract: supplier name, ח.פ/ע.מ, invoice number, date, gross, VAT, net, document kind, readability score.
- A missing total or date, or a low readability score, → **er-02** "blurry invoice".
- Resize and compress on the phone before upload (long edge ≤ 1600 px, JPEG quality ~0.7).

**Privacy:**
- **Paid tier only.** Gemini's pricing page says free-tier content is used to improve products and paid-tier content isn't: https://ai.google.dev/gemini-api/docs/pricing
- Send the minimum: no identifiers beyond what's printed on the invoice, and no bank balances.

### 4.4 Model choice

| Model | Input $/1M tokens | Output $/1M tokens | Notes | Source |
|---|---|---|---|---|
| **gemini-3.1-flash-lite (recommended)** | $0.25 | $1.50 | Current Flash-Lite generation; one model for text and images; image token budgets are documented | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-2.5-flash-lite | $0.10 | $0.40 (Batch $0.05 / $0.20) | Cheapest Gemini, older generation. Use it for one-off backfills via Batch if quality is equal | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-3.5-flash-lite | $0.30 | $2.50 | Newer and pricier; the fallback if 3.1 quality falls short | https://ai.google.dev/gemini-api/docs/pricing |
| OpenAI gpt-6-luna (comparison) | $0.10 (cached $0.01) | $0.50 | Cheaper for text; image token cost not checked | https://developers.openai.com/api/docs/pricing |

**How to decide (task P5-2):** build a 150-item Hebrew evaluation set (real anonymised bank lines and SUMIT documents, plus 30 invoice photos). Pick the cheapest model with at least 90% top-1 category accuracy and at least 95% invoice-field accuracy. At this volume the price differences are cents, so quality decides.

### 4.5 AI cost estimate (Gemini 3.1 Flash-Lite, paid)

**Assumptions per company per month:**
- ~140 new items (60 SUMIT + 80 bank). After matching and linking, about 55 need tagging. Rules and memory would handle roughly 60% of those, but the estimate conservatively sends **all 55 to the LLM**.
- Each LLM item: ~800 input tokens (batch context amortised) and ~100 output tokens.
- Invoice photos: 15, each ~1,600 input tokens (1,120-token image + prompt) and ~300 output tokens.

| Workload | Tokens per month (50 companies) | Cost |
|---|---|---|
| Tagging: 2,750 items | 2.2M in × $0.25 + 0.275M out × $1.50 | $0.55 + $0.41 = **$0.96** |
| Invoice photos: 750 | 1.2M in × $0.25 + 0.225M out × $1.50 | $0.30 + $0.34 = **$0.64** |
| **Steady state, 50 companies** | | **≈ $1.60/mo** |
| POC, 1–5 companies | | **≈ $0.03–0.16/mo** |
| One-time backfill per new company (~850 LLM items for 12 months) | 0.68M in + 0.085M out | **≈ $0.30** (≈ $0.05 with 2.5-flash-lite Batch) |

**Guardrails:**
- A per-company monthly token budget (e.g. 3× expected). Past it, items go to review without an LLM suggestion.
- A global daily spend alarm.
- A hard spending cap in Google Cloud billing.

---

## 5. Google sign-in

- **Flow:** server-side OAuth 2.0 / OpenID Connect **authorization-code flow with PKCE**, using redirects rather than popups (popups are unreliable in installed PWAs).
  - Scopes: `openid email profile` only.
  - **No Gmail scopes.** "Gmail sign-in" means signing in with a Google account. Reading mail isn't needed, and restricted scopes would trigger Google's security assessment.
- **Steps:**
  1. `GET /auth/google/start` creates `state`, `nonce` and the PKCE verifier, and stores them in a short-lived signed cookie (10 min).
  2. It redirects to Google.
  3. The callback checks `state` and exchanges the code (the client secret is a Worker secret). It then **verifies the ID token**: RS256 signature against Google's JWKS (cached), `iss` is accounts.google.com or https://accounts.google.com, `aud` is our client id, plus `exp`, `nonce` and `email_verified=true`.
  4. It upserts `app_user` by `google_sub`, not by email.
- **Session:**
  - A random 256-bit token in an `HttpOnly; Secure; SameSite=Lax; Path=/` cookie. Only its hash is stored in `session`, with a 60-day sliding expiry.
  - For speed, the cookie also carries an HMAC-signed claim (`user_id`, `company_id`, `session_id`, `exp` of 15 min), so most reads skip the session lookup. Writes and claim refreshes check the D1 row, which is how revocation works.
- **CSRF:** SameSite=Lax plus an `Origin` header check on every non-GET request.
- **Onboarding order (09a–e):** sign-in → company details → bank report → projects → install + notifications.
- **iOS:** installed PWAs don't share cookies with Safari. After "Add to Home Screen", the user may need to tap "Sign in with Google" once more inside the app. Present this as a quick step, not an error (risk R8).
- **Errors:** cancelled consent → **er-03**; token or network failure → **er-04**.
- **POC access:** an email allowlist or invite code, so strangers can't create tenants.
- **Google Cloud project:** OAuth consent screen "External", in production status, with a Hebrew app name and logo. Non-sensitive scopes shouldn't need a security assessment; brand verification may be requested for the logo **(check at setup)**.
- **Logout (screen 14):** revoke the session row and clear the cookie and the local IndexedDB cache.

---

## 6. Performance plan: Home usable in under 2 s

**Targets** (mid-range Android on 4G, measured from tapping the icon):

| Scenario | Target |
|---|---|
| Returning user, installed PWA | Shell painted < 0.5 s. Home with cached numbers < 1.0 s. Fresh numbers < 1.5 s |
| Offline | Shell + last data < 1.0 s, with "אין חיבור · נתונים מ-09:12" |
| First visit | Usable < 2.0 s |

**How:**
1. **PWA shell precached** by the service worker (Workbox): HTML, JS and CSS (budget **≤ 120 KB gzip** for the Home route), the Rubik woff2 subset (preloaded) and icons. Every screen other than Home is route-split and lazy-loaded (SheetJS, date pickers, upload, split).
2. **Home reads one row.** `GET /api/home?period=this_month` returns `home_snapshot.payload_json` (~2 KB), with ETag / `If-None-Match` → 304 when nothing changed. The first load fetches all three periods together.
3. **Precomputed totals:**
   - Any write (approval, sync page, upload, split, rule change) marks the affected (company, month) as dirty, in the same D1 batch as the write.
   - A queue message then rebuilds `agg_month` for those months (an indexed `SUM` over the month's payments and allocations, typically under 500 rows), then the 3 `home_snapshot` rows and the affected `project_snapshot` rows.
   - The UI updates optimistically in the meantime.
4. **Stale-while-revalidate on the client:**
   - The last snapshot for each period is kept in IndexedDB and painted immediately.
   - The network response replaces it if it differs.
   - A skeleton appears only when nothing is cached and 300 ms have passed (design rule).
5. **Sync never blocks the UI.** App-open refresh is fire-and-forget (§3.1.4). While the app is visible, a light `GET /api/home` every 60 s picks up new data. No WebSockets.
6. **Edge and DB placement:** the Worker runs at the nearest Cloudflare location and D1 sits in the chosen EU location; Phase 0 measures the round-trip. If D1 reads from Israel exceed ~150 ms, cache the snapshot in the Workers Cache API keyed by (company, period, version), and invalidate on rebuild.
7. **No cold starts to speak of:** the Workers startup limit is 1 s (limits page). Keep global scope light.
8. **Offline approvals:** actions are queued in IndexedDB with a `client_op_id` and replayed on the `online` event. The server dedupes through `applied_op`, and the toast says "יישלח כשהחיבור יחזור".
9. **Measurement:**
   - Lighthouse CI (mobile profile) in the pipeline, with a budget of LCP < 2.0 s on the throttled profile.
   - Sampled real-user metrics (LCP, time until Home data shows) posted to `/api/rum` at 10% sampling, aggregated daily.

---

## 7. Security and privacy (SUMIT API key and financial data)

A SUMIT key is **full access**: it has no scopes and could issue documents or charge cards (SUMIT §7.9). Treat it as the most sensitive thing Flow holds.

| Control | Implementation |
|---|---|
| **Encryption at rest** | Envelope encryption with WebCrypto. A random 256-bit **DEK** per company encrypts the key (AES-256-GCM, random 96-bit IV, AAD = `company_id‖"sumit"‖kek_version`). The DEK is wrapped by the **KEK**, a Worker secret (`SUMIT_KEK_v1`) that never touches D1 or the code repo. A D1 dump alone reveals nothing |
| **Key rotation** | `kek_version` column. Rotation re-wraps the DEKs in a queue job with no user action. On suspected compromise, rotate the KEK and ask customers to regenerate their SUMIT keys |
| **Never sent to the client** | The API returns only `{connected, sumit_company_id, connected_at, status}`. The key field is write-only, and there's no "show key" |
| **Short plaintext lifetime** | Decrypted only inside the sync consumer or the connect handler, for that call, and never cached globally |
| **Logs** | The SUMIT client never logs request or response bodies. A redaction helper strips `APIKey` from any error object. `sumit_call_log` holds metadata only. Workers Logs are kept 3 days |
| **Read-only by construction** | Endpoint allowlist plus a CI check (§3.1.1). Outbound calls go only to the SUMIT API host, Gemini, Google auth and push services |
| **Dedicated key** | Onboarding tells the customer to create a key named "Flow" in SUMIT, so it can be revoked without breaking their other integrations |
| **Disconnect** | Settings → "נתק SUMIT" deletes `key_ct` and `dek_wrapped` immediately and stops jobs. The user chooses whether to keep or delete the imported data. An audit entry is written, and the UI reminds the user to revoke the key in SUMIT too |
| **Account deletion** | A job deletes all tenant rows and R2 objects. D1 Time Travel keeps earlier states for 7 days on Free or 30 days on Paid (https://developers.cloudflare.com/d1/platform/limits/); the privacy policy must say so |
| **Tenant isolation** | `company_id` comes only from the session. A repository layer requires it on every query. Automated tests try other tenants' IDs on every endpoint |
| **Files** | Private R2 bucket with per-company prefixes. Files are served only through the Worker after an auth check. Retention: bank Excel originals 90 days (the parsed lines stay); invoice photos kept as the user's evidence until deleted, or 7 years **(Q10)** |
| **Web hardening** | Strict CSP (self + Google auth + push), HSTS, `X-Content-Type-Options`, no third-party analytics scripts, and rate limits on `/auth/*`, `/api/sumit/connect` and uploads (per IP and per user) |
| **Operator access** | Cloudflare and Google Cloud accounts use hardware-key 2FA, with at most 2 admins. Secrets are set only via `wrangler secret`. No production data on laptops. Any emergency read of tenant data is logged |
| **AI data** | Gemini paid tier only (no training use). Only the needed fields are sent, and each photo is sent once for extraction |
| **Privacy law** | Israel's Privacy Protection Law, including Amendment 13, applies to a database of business financial data. Needed: a Hebrew privacy policy and terms, a data-processing inventory, a sub-processor list (Cloudflare, Google), a breach procedure, and a lawyer's review before paid launch **(legal review needed; not verified here)** |

---

## 8. Phased build plan (ClickUp-ready)

**Sizes:** **S** ≈ ½–1 day · **M** ≈ 2–3 days · **L** ≈ 4–5 days, for one developer. "Dep" lists prerequisites. Each row can become one ClickUp task, with its acceptance criterion as the checklist.

### Phase 0: Foundations and gates (≈ 8–10 dev-days)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P0-1 | Repo and monorepo layout (`app/`, `api/`, `shared/`), TypeScript, lint, Vitest, CI | S | — | CI green on a PR |
| P0-2 | Cloudflare setup: Worker with static assets, D1 (EU hint), R2, Queue, 1 cron; staging and production environments | M | P0-1 | `wrangler deploy` to staging from CI |
| P0-3 | D1 schema v1 (§2), migrations, seed (7 + 2 categories) | M | P0-2 | Migrations apply cleanly; each new company is seeded |
| P0-4 | Money/date library: agorot math, banker's rounding, VAT net/gross helpers, Israel-time utilities, `share_bp` splitter | S | P0-1 | Property tests; sums are always exact |
| P0-5 | PWA skeleton: Vite + Preact, RTL, tokens CSS, Rubik subset, Workbox precache, manifest, tab bar | M | P0-1 | Installs on Android and iOS; the offline shell loads |
| P0-6 | **CPU gate:** benchmark parsing/mapping a 200- and 1,000-document CRM page, a 1,000-row bank insert and a push send, on Workers Free | S | P0-2 | Report with p50/p99 CPU ms → go/no-go on Free |
| P0-7 | D1 latency check from Israel (eeur vs weur) | S | P0-2 | Round-trip numbers recorded; location chosen |

### Phase 1: Auth and onboarding shell (≈ 9–12 dev-days)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P1-1 | Google Cloud OAuth client, consent screen (Hebrew), secrets | S | — | Client IDs for staging and production |
| P1-2 | OIDC code + PKCE flow, ID-token verification, user upsert | M | P0-3, P1-1 | Tests for bad state, nonce, aud and iss |
| P1-3 | Sessions: cookie, hashed row, signed short claim, logout, revocation | M | P1-2 | Session survives an app restart; logout clears it |
| P1-4 | Invite-code / allowlist gate | S | P1-2 | Unknown email → friendly block |
| P1-5 | Onboarding screens 09a–09b (sign-in, company details incl. VAT mode) + er-03/er-04 | M | P1-3, P0-5 | Matches the design, RTL |
| P1-6 | Tenant-isolation middleware + cross-tenant test suite | M | P1-3 | Every endpoint rejects other tenants' IDs |

### Phase 2: Core ledger, manual entry, totals and Home (≈ 20–24 dev-days)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P2-1 | Projects: create/edit, archive, search (05, 21, es-04) | M | P1-6 | Archive, never delete |
| P2-2 | Categories: list, hide, 2-step merge (07, 22a/b, 23) | M | P1-6 | Merge moves allocations; nothing is deleted |
| P2-3 | Manual transaction entry (04 manual) + transaction detail (10) + delete confirm (20) | M | P2-1, P2-2, P2-4 | Exact agorot; VAT fields |
| P2-4 | `txn` / `payment` / `allocation` services, including unpaid logic and "mark as paid" (12) | L | P0-4 | Unit tests for partial payments and credits |
| P2-5 | Aggregation engine: dirty-month marking, `agg_month` rebuild, home and project snapshots | L | P2-4 | Incremental rebuild equals a full recompute on test fixtures |
| P2-6 | Home screen (01) + period sheet (16) + change-pill and partial-data rules (design §8.4) | M | P2-5 | Numbers add up in whole ₪; pill rules hold |
| P2-7 | Project screen (02) with budget block and categories | M | P2-5 | Budget block hidden when no budget is set |
| P2-8 | Client cache: IndexedDB stale-while-revalidate, ETag, skeleton after 300 ms, offline notice (ld-01/08/09) | M | P2-6 | Airplane mode shows the cached Home |

### Phase 3: SUMIT integration, read-only (≈ 21–26 dev-days)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P3-1 | `sumitClient` with read-only allowlist, error mapping (Status 0/1/2), redaction, call logging + CI guard | M | P0-2 | Non-allowlisted path throws; CI guard test passes |
| P3-2 | Envelope encryption module (KEK/DEK, AES-GCM, rotation job) | M | P0-2 | Round-trip tests; no plaintext in D1 |
| P3-3 | Atomic call counter `reserveCall` + degradation ladder | S | P3-1 | Concurrency test never exceeds the cap |
| P3-4 | Connect flow UI + API (getdetails, listfolders, getfolder, listquotas), folder/property maps, disconnect | M | P3-1, P3-2, P3-3 | Works on "Flow Test"; the key never reaches the client |
| P3-5 | Backfill job (paged CRM `listentities`, queue cursor) | M | P3-4 | Full import of the test company; resumable |
| P3-6 | Document normaliser: folder → `doc_type`, counterparties, links (`OriginalDocument`), VAT status, `content_hash` | L | P3-5, P2-4 | Fixture tests for every document type in §2.2 |
| P3-7 | Ledger derivation: invoices → txn, receipts → payments (net ratio), credits, expense types 15/16/17, unpaid | L | P3-6 | Test-company P&L matches a hand calculation |
| P3-8 | Daily incremental poll, app-open refresh (6 h), pull-to-refresh floor, weekly re-scan with diff | M | P3-7 | Simulated month stays within the call budget |
| P3-9 | Budget-section → project mapping UI (Budget-module tenants) | S | P3-7 | Mapped documents auto-assigned at 100% |
| P3-10 | Schema-drift check + `documents/list` fallback path | M | P3-6 | Simulated missing field → alert + fallback |
| P3-11 | Trigger endpoint behind a feature flag (off), with debounce | S | P3-8 | Flag off = 404; flag on = one debounced sync |

### Phase 4: Bank Hapoalim upload (≈ 13–16 dev-days)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P4-1 | Collect 2–3 real anonymised Poalim exports; write the format spec | S | — | Column map + anonymised samples in the repo |
| P4-2 | Phone-side parser (SheetJS, lazy), header detection, balance check, er-01 | M | P4-1, P0-5 | Rejects non-Poalim files; parses all samples |
| P4-3 | Upload API + R2 storage + dedupe by `line_hash` | M | P4-2 | Re-uploading the same file → 0 new rows |
| P4-4 | Classification: internal transfers, card settlements, tax payments, own accounts | M | P4-3 | 100% correct on the samples |
| P4-5 | Matching engine, bank ↔ documents (score, one-to-one, ambiguity → review) | L | P4-3, P3-7 | No double income on the test set |
| P4-6 | Auto-open project for a recurring customer | S | P4-5 | Creates a project + review item |
| P4-7 | Processing screen (ld-05, continue in background) + results screen (08) + onboarding 09c | M | P4-5 | Counters match the data |

### Phase 5: AI tagging, review queue, supplier memory, invoice photos (≈ 16–20 dev-days)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P5-1 | Rules engine (steps 1–7 in §4.1) + Hebrew name normaliser + category dictionary | M | P2-4 | Unit tests for each rule |
| P5-2 | Evaluation set (150 items + 30 photos) + model bake-off (3.1 Flash-Lite vs 2.5 Flash-Lite vs gpt-6-luna) | M | P4-1 | Report written; model chosen |
| P5-3 | LLM tagging worker: batching, JSON schema, token budget, spend alarms | M | P5-1, P5-2 | 20 items per call; budgets enforced |
| P5-4 | Confidence calibration + auto-approve policy + daily stats | M | P5-3 | No LLM auto-approval before 50 reviewed items |
| P5-5 | Review queue screen (03) + change sheet (06) with "remember" + es-03 | M | P5-4 | Approve/change/skip work; counts update |
| P5-6 | Supplier memory (fixed / learned / demote) | M | P5-5 | After 3 approvals, the learned rule applies to the next item |
| P5-7 | Invoice photo: capture/compress, R2, vision extraction, er-02, ld-06, match to bank/SUMIT | L | P5-3, P4-5 | 95% field accuracy on the evaluation photos |

### Phase 6: Splits, overhead, unpaid, settings, export (≈ 9–12 dev-days)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P6-1 | Split screen (11): equal / income share / manual %, remainder handling | M | P2-4 | Shares always total 100% |
| P6-2 | Recurring split rules (Settings list, apply on ingest, monthly income-share recompute) | M | P6-1, P2-5 | Rule applies to new matching items |
| P6-3 | Overhead share view (18/19), default off | S | P2-5 | Home big number unchanged when on |
| P6-4 | Unpaid screen (12) + es-05 | S | P2-4 | Shows "לא נכלל ברווח" |
| P6-5 | Settings screen (14): company, Google account, bank connection, SUMIT connection, categories, projects, rules, notification times, auto-approve switch, overhead default, logout | M | P3-4, P5-4 | All settings persist |
| P6-6 | Export for the accountant (Excel/CSV, Hebrew headers, before-VAT and VAT columns) | M | P2-4 | Opens correctly in Excel (UTF-8 BOM, RTL) |
| P6-7 | Date pickers (15a–c) and confirm sheets (20–23) polish | S | P0-5 | Matches the design |

### Phase 7: Notifications, offline, performance, security, pilot (≈ 16–20 dev-days, plus 2 calendar weeks of pilot use)

| ID | Task | Size | Dep | Acceptance |
|---|---|---|---|---|
| P7-1 | Web Push: VAPID, subscribe after install (09e, 17a/b), encryption, cleanup | M | P0-5 | Push arrives on Android and on installed iOS |
| P7-2 | Dispatcher cron (Israel time, DST), Sunday 08:00 summary, conditional 18:00 nudge (13, es-08) | M | P7-1, P2-5 | No nudge when the queue is empty; DST test passes |
| P7-3 | Offline action queue with `client_op_id` + replay | M | P2-8 | Offline approvals apply exactly once |
| P7-4 | Performance pass: bundle budget, Lighthouse CI, RUM endpoint | M | P2-6 | LCP < 2 s on the throttled profile |
| P7-5 | Security review: CSP/HSTS, rate limits, redaction audit, isolation tests, KEK rotation drill | M | P3-2 | Checklist signed off |
| P7-6 | Usage monitoring (D1/Queues daily %), error alerts, spend alarms | S | P0-2 | Alert fires in a staging test |
| P7-7 | Privacy policy and terms (Hebrew), data-deletion flow | M | — | Lawyer-reviewed text live |
| P7-8 | Pilot with 2–3 contractors: onboarding script, feedback loop, bug triage | L | all | 2 weeks of daily use with no data errors |

**Total:** 61 tasks (15 S, 39 M, 7 L). The sizes add up to about 114–140 developer-days, or **23–28 developer-weeks**. With two developers, Phases 3–4 can run in parallel with Phases 2 and 5–6 (backend vs frontend), which brings it to about 3–3.5 calendar months.

**If a faster first pilot is needed**, cut scope rather than quality:
- Defer invoice photos (P5-7).
- Defer recurring split rules (P6-2) and the overhead view (P6-3).
- Defer the trigger endpoint (P3-11) and the drift fallback (P3-10).

That saves about 2–2.5 developer-weeks.

**Suggested ClickUp structure:** one List per phase; tags `backend` / `frontend` / `infra` / `ai` / `security`; a custom field "Size" (S/M/L); dependencies from the "Dep" column.

---

## 9. Risks and open questions

### 9.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Workers Free 10 ms CPU limit** is too tight → Workers Paid ($5) needed, total ≈ $6.6–7.5 at 50 companies | Medium / budget | Design rules in §1.4; P0-6 gate early; decide before building further (Q1) |
| R2 | **D1 free daily limits** hit during onboarding bursts or re-scans (errors until 00:00 UTC) | Low / outage | Staggering, write only changed rows, alerts at 50%, cap onboardings per day |
| R3 | **Undocumented SUMIT CRM fields** (`Accounting_*`, `BudgetManagement_*`, internal enums) change | Medium / sync breaks | Nightly drift check, `documents/list` fallback (P3-10), folder resolution by name |
| R4 | **Customer's SUMIT plan:** Free has no API; triggers need Growth; budget sections need Advanced | High / feature reach | Bank upload, photos and manual entry work without SUMIT; state plan needs during onboarding |
| R5 | **Unknown VAT on expenses** (API/UI expenses may lack a VAT split; bank lines have none), so "before VAT" expenses are partly gross | High / accuracy | `vat_status`, learned supplier VAT rates, photo OCR, honest UI marker; accountant review of the rule |
| R6 | **Credit-card settlement lines** double count or hide detail | Medium / accuracy | `card_settlement` classification; exclude when card expenses exist in SUMIT; card statement upload later |
| R7 | **Hapoalim export format** changes or varies (xls vs xlsx, business vs private account) | Medium / upload fails | Header-based detection, sample library, clear er-01, quick fix path |
| R8 | **iOS PWA quirks:** storage separate from Safari (sign in again after install), push only when installed, storage eviction | Medium / UX | Onboarding order already fits; test on real iPhones; re-login is a friendly step |
| R9 | **Storing full-access SUMIT keys:** a breach could let an attacker issue documents or charges | Low / severe | §7 controls, dedicated key, no plaintext at rest, minimal admins, incident runbook |
| R10 | **LLM misclassification** gets auto-approved | Medium / trust | Conservative calibration, no LLM auto-approval in the first days, all auto items editable, weekly accuracy check |
| R11 | **Call quota** on the customer's SUMIT Start plan (250) shared with their other integrations | Low / conflicts | Own cap of 100, degradation ladder, usage shown in Settings |
| R12 | **Cash-basis semantics** (cheques, partial payments, credits) differ from what the accountant expects | Medium / trust | Accountant review of §2.2 before the pilot; export includes document references |
| R13 | **Privacy-law obligations** (Amendment 13) underestimated | Medium / launch | Lawyer review in P7-7 |

### 9.2 Open questions for the owner

1. **Q1: Budget vs. robustness.** If P0-6 shows Workers Free is too tight, is ≈ $6.6–7.5/mo at 50 customers acceptable? Or should features be cut to stay at ≤ $5 (e.g. moving more work onto the phone)?
2. **Q2: Triggers.** Confirm that M1 skips SUMIT triggers, since decision 0036 forbids Flow registering them. Should customers be allowed to register one themselves later?
3. **Q3: Domain.** Use `workers.dev` for the POC and buy a domain for the pilot (`.com` ≈ $10.46–11.17/yr, or `.co.il`)?
4. **Q4: Target SUMIT plans.** What share of target contractors are on Start or above? Is bank + photo + manual without SUMIT an acceptable M1 experience?
5. **Q5: VAT on bank-only income.** Derive it at the standard rate (recommended), or show gross until it's matched to an invoice?
6. **Q6: Expenses with unknown VAT.** Show gross with a marker (recommended), or ask the user for the VAT amount in review for large items?
7. **Q7: Cheques.** Recognise cash on the receipt date (default) or on the cheque due date?
8. **Q8: Auto-approve policy.** Are the 90% thresholds and the ₪5,000 new-supplier limit right? Should auto-approve be off during the first week?
9. **Q9: Nudge days.** Skip Saturdays and Jewish holidays for the 18:00 nudge?
10. **Q10: Retention.** How long to keep invoice photos and bank files: 7 years like accounting records, or until the user deletes them?
11. **Q11: Previous-year data.** Backfill the current and previous tax year, or only the current year?
12. **Q12: Accountant export format.** Is a specific format needed (e.g. an import for the accountant's software), or is a generic Excel/CSV enough for M1?
13. **Q13: Multi-user.** Confirm a single owner in M1 (a bookkeeper or partner login is out of scope).

---

## Appendix A: price sources (checked 26 Sep 2026)

| Item | URL |
|---|---|
| Cloudflare Workers pricing (including Queues, KV, Logs and R2 free allowances), updated Aug 28 2026 | https://developers.cloudflare.com/workers/platform/pricing/ |
| Cloudflare Workers limits (CPU, crons, subrequests), updated Sep 5 2026 | https://developers.cloudflare.com/workers/platform/limits/ |
| Cloudflare D1 pricing | https://developers.cloudflare.com/d1/platform/pricing/ |
| Cloudflare D1 limits, updated Apr 21 2026 | https://developers.cloudflare.com/d1/platform/limits/ |
| Supabase pricing | https://supabase.com/pricing |
| Vercel pricing | https://vercel.com/pricing |
| Neon pricing | https://neon.com/pricing |
| Gemini API pricing, updated 2026-09-24 | https://ai.google.dev/gemini-api/docs/pricing |
| Gemini media resolution / image tokens | https://ai.google.dev/gemini-api/docs/media-resolution |
| OpenAI API pricing | https://developers.openai.com/api/docs/pricing |
| Cloudflare Registrar (at-cost policy) | https://www.cloudflare.com/application-services/products/registrar/buy-com-domains/ |
| .com wholesale price change (1 Nov 2026) | https://tldes.com/pages/com-price-increase-2026 |
| Cloudflare .com price tracker | https://domainoffer.net/tld/com/cloudflare |
| Google Identity Platform pricing (for comparison) | https://cloud.google.com/identity-platform/pricing |
| Web Push on iOS (Home Screen apps, 16.4+) | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| Apple web push (no developer program needed) | https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers |
| SUMIT plan prices (customer side) | `/workspace/flow-tech/sumit-api-research.md` §6 (source [S3]) |
