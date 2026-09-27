# Flow Module 1: technical plan (v2, Supabase)

*Version 2.0 · 26 Sep 2026 · English working document for the build team. The product UI is Hebrew-only.*

> **What changed in v2:** the owner decided to build the pilot on **Supabase Free** and move to **Supabase Pro ($25/mo)** as Flow grows. This version redesigns the backend on Supabase (Postgres + RLS, Auth, Storage, Edge Functions, Cron, Queues).
> - It corrects v1's statement about free-project pausing (§1.2).
> - It adds a free off-site backup pipeline (§8).
> - The previous Cloudflare-only plan is kept at [tech-plan.v1-cloudflare.md](tech-plan.v1-cloudflare.md). It is superseded.
> - Appendix B lists every change.
> - Product logic carries over from v1 unchanged: cash-basis ledger, VAT rules, SUMIT read-only sync, bank matching, AI tagging, and Gemini choice and cost.

**What Module 1 is:** a Hebrew-only, RTL, mobile-first installable web app (PWA) with one owner user per company, for Israeli contractors. It shows cash-basis profit and loss for the company and for each project, alongside the accountant's books. Data comes from SUMIT (read-only), Bank Hapoalim Excel statements, invoice photos and manual entry. AI tagging assigns project and category.

**Inputs:**
- Design spec: `design/` in this repo (`design/system/implementation-guide.md`, `design/system/design-system.md`, `design/system/design-tokens.json`, `design/system/implementation-tokens.css`).
- Verified SUMIT research: [sumit-api-research.md](sumit-api-research.md), cited as "SUMIT §x".

**Fixed decisions:**
- Google sign-in.
- Home usable within 2 s.
- SUMIT is read-only (decision 0036).
- Hapoalim upload stays alongside SUMIT.
- High-confidence AI tags are auto-approved; the rest go to a review queue.
- 7 default expense categories (hide/merge, never delete).
- Split rules: equal, income share or manual %, optionally recurring.
- Overhead stays company-level; the "after overhead share" view is off by default and the Home big number stays company net profit.
- Notifications: Sunday 08:00 summary, plus a daily 18:00 nudge only when items are waiting.
- Periods: this month, last month, YTD.
- P&L before VAT.
- **New:** Supabase Free for the pilot, then Supabase Pro ($25/mo) when growing. This supersedes the earlier "whole system ≤ $5/month" cap from the Pro move onwards.

**Price rule:** every price and limit cites its source URL and was checked on 26 Sep 2026. Anything not verified is marked **(unverified)**.

---

## 0. Executive summary

| | |
|---|---|
| **Architecture** | **Supabase** in **Frankfurt (eu-central-1)**: Postgres with RLS by `company_id`, Auth (Google provider, PKCE), Storage (private buckets), Edge Functions (sync, AI, push), Cron (`pg_cron`) + `pg_net`, and Queues (`pgmq`). **The PWA is static files on Cloudflare Workers static assets** (free, unlimited static requests, no non-commercial restriction). **Gemini 3.1 Flash-Lite, paid tier** for tagging and invoice photos (unchanged). **Nightly encrypted `pg_dump` to Cloudflare R2** via GitHub Actions, because Supabase Free has no automatic backups. |
| **Monthly cost, pilot (1–5 companies, Free)** | **≈ $0.05–$0.30**: Supabase $0, Cloudflare $0, R2 $0, GitHub Actions $0, plus a few cents of Gemini. A domain is optional (≈ $0.87–0.93/mo for a `.com`). |
| **Monthly cost, ~50 companies** | **On Pro: ≈ $26.6–27.5** ($25 Supabase Pro + ≈ $1.60 Gemini + optional domain). On Free it would be ≈ $1.6–2.5, but Free is **not viable at 50 companies**: the 500 MB database and the backup egress would both be near or over their limits (§1.5). |
| **When to move to Pro** | At whichever comes first (§1.6): **database > 300 MB**, **egress > 3 GB/month**, the nightly dump reaching **~100 MB** (which alone uses most of the 5 GB egress), the **first paying customer** (automatic backups and support matter once money is involved), or **~15–20 active companies**. |
| **What got smaller** | Auth: Supabase Auth replaces the hand-built OIDC and sessions. File storage: Storage + RLS replaces an upload API. The CPU constraint mostly disappears: Edge Functions allow 2 s CPU and 150 s wall time on Free, vs 10 ms on Workers Free. |
| **What got larger** | RLS policies and isolation tests; the Postgres job plumbing (cron + queues + functions); the backup and restore-test pipeline; a daily health check; and the iOS sign-in spike (Supabase's token storage in the browser). |
| **Build** | 68 tasks (22 S, 38 M, 8 L), roughly **24–30 developer-weeks**, about 1 week **more** than v1. Auth and storage got smaller, but RLS, job plumbing, backups/restore and ops add more than they save (§9). |
| **New risks** | No automatic backups on Free, so the off-site dump is mandatory. The 500 MB DB and 5 GB egress are the binding limits. Auth tokens live in browser storage, not HttpOnly cookies, so XSS protection matters more. The Google consent screen shows `*.supabase.co` unless a custom domain is bought (Pro add-on, $10/mo). Only 2 active Free projects (staging + prod leave no spare). The iOS PWA sign-in redirect (§5). |

---

## 1. Architecture

### 1.1 Sizing assumptions (unchanged from v1)

| Driver | Pilot | ~50 companies |
|---|---|---|
| Users | 1–5 owners | 50 owners |
| App opens | ~10/day per user | ~500/day |
| SUMIT documents per company | ~60/mo new; backfill 1,000–2,000 | same |
| Bank lines per company | ~80/mo; first upload up to ~1,000 | same |
| Invoice photos per company | ~15/mo | ~750/mo in total |
| DB size (Postgres, incl. indexes) | < 30 MB | **≈ 250–500 MB** (≈ 5 MB per company per year of history; 1–2 years) **(estimate; measured in P0-6)** |
| Files (bank Excel + photos) | < 100 MB | ≈ 2–3 GB/year before retention |

### 1.2 Supabase Free vs Pro: verified limits

| Item | Free | Pro | Source |
|---|---|---|---|
| Price | $0 | **from $25/mo**; includes $10/mo compute credit, which covers one Micro instance. Each additional project adds its own compute (e.g. 2 Micro projects = $35/mo) | https://supabase.com/pricing |
| Compute | Shared CPU, 500 MB RAM | Micro: shared, 1 GB RAM, 60 direct / 200 pooler connections | https://supabase.com/pricing |
| Database | **500 MB per project** | 8 GB disk included, then $0.125/GB | https://supabase.com/pricing |
| **Automatic backups** | **Not included** | Daily, kept 7 days; PITR add-on ~$100/mo per 7 days | https://supabase.com/pricing · https://supabase.com/docs/guides/platform/backups |
| Egress | **5 GB** (+ 5 GB cached) | 250 GB, then $0.09/GB | https://supabase.com/pricing |
| File storage | **1 GB**; max upload 50 MB | 100 GB, then $0.0213/GB | https://supabase.com/pricing |
| Projects | **2 active projects** | per-project compute | https://supabase.com/pricing |
| Auth | 50,000 MAU; social OAuth included; Custom Access Token (JWT) hook included; auth audit logs 1 hour; session timeouts not included | 100,000 MAU | https://supabase.com/pricing |
| Edge Functions | **500,000 invocations/mo**; 2 s CPU per request; **150 s wall clock**; 256 MB memory; 100 functions; 100 secrets | 2M invocations, then $2/M; 400 s wall clock | https://supabase.com/pricing · https://supabase.com/docs/guides/functions/limits |
| Log retention | 1 day | 7 days | https://supabase.com/pricing |
| Custom domain | Not included | $10/domain/mo add-on | https://supabase.com/pricing |
| API requests | Unlimited | Unlimited | https://supabase.com/pricing |

**Correction to v1: pausing.**
- v1 said "free projects pause after 1 week of inactivity" as if that ruled Supabase out. That was misleading.
- Supabase pauses a Free project only when it "does not receive sufficient user database activity over the past week", and "typically a few user requests to the database each day over the previous week is enough to keep the project from being paused". A warning email also arrives about a week before any pause (https://supabase.com/docs/guides/platform/free-project-pausing).
- Flow's daily SUMIT sync and users' app opens are real database requests, so **pausing isn't a practical concern**.
- As a harmless safety net, a **daily health check** (GitHub Actions, §8.3) makes a real read through the REST API (`rpc/health`, which does `select 1` plus a row count).
- The real Free-plan gaps are **no automatic backups, 500 MB DB, 1 GB file storage, 5 GB egress and 2 active projects**.

**Other components (verified):**

| Component | What it gives Flow | Source |
|---|---|---|
| Supabase Cron (`pg_cron`) | Recurring jobs in Postgres, from every second to yearly. Can run SQL or make HTTP calls. Recommendation: ≤ 8 concurrent jobs, each ≤ 10 min | https://supabase.com/docs/guides/cron |
| `pg_net` + Cron → Edge Functions | Invoke Edge Functions on a schedule; keep the project URL and key in Vault | https://supabase.com/docs/guides/functions/schedule-functions |
| Supabase Queues (`pgmq`) | Postgres-native durable queue with guaranteed delivery and a visibility timeout; RLS-controllable. The docs state **no plan restriction**; confirm on the Free project in P0-2 **(availability on Free unverified)** | https://supabase.com/docs/guides/queues |
| Regional invocation | Edge Functions run near the caller by default, or pinned with the `x-region` header / `forceFunctionRegion` parameter. `eu-central-1` (Frankfurt) is supported | https://supabase.com/docs/guides/functions/regional-invocation |
| Regions | Closest to Israel: **Central EU (Frankfurt) `eu-central-1`**, also Zurich `eu-central-2`. No Middle East region is listed | https://supabase.com/docs/guides/platform/regions |
| Vault | Encrypted secrets in Postgres (libsodium AEAD). Supabase manages the root key outside the DB; the decrypted view is readable by any role with access | https://supabase.com/docs/guides/database/vault |
| Storage access control | Buckets are private by default; RLS policies on `storage.objects`; helpers like `storage.foldername()`. The service key bypasses RLS | https://supabase.com/docs/guides/storage/security/access-control |

### 1.3 Frontend hosting for the PWA

| Host | Free tier | Commercial use | Verdict | Source |
|---|---|---|---|---|
| **Cloudflare Workers static assets / Pages (chosen)** | Static asset requests **free and unlimited**; no charge for storing assets; 20,000 files, 25 MiB each | The free plan terms have no non-commercial clause. The CDN terms only restrict serving video or a disproportionate share of large media on Free | ✅ Static PWA shell at Cloudflare's edge, near Israel | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ · https://developers.cloudflare.com/pages/functions/pricing/ · https://www.cloudflare.com/service-specific-terms-application-services/ |
| Netlify Free | 300 credits/mo; production deploy = 15 credits, bandwidth 20 credits/GB, 2 credits per 10k requests | Marketed to "Individual" | ❌ Frequent deploys alone would use the credits (20 deploys = 300) | https://www.netlify.com/pricing/ |
| Vercel Hobby | — | **Personal, non-commercial only** | ❌ | https://vercel.com/pricing |

**Setup:**
- The PWA is a **pure static build** (TypeScript + React + Vite + vite-plugin-pwa/Workbox; full stack in §1.4.1), deployed with `wrangler deploy` using assets only.
- No Worker script runs on navigation, so there is no Worker request quota to worry about. Don't enable `run_worker_first`, because on Free those requests return 429 once limits are hit (Cloudflare billing page above).
- The app calls Supabase directly (`https://<ref>.supabase.co`) with the publishable key plus the user JWT, and RLS enforces access.

### 1.4 Recommended architecture

```
 Phone: PWA (React + Vite + TS, React Router, TanStack Query + IndexedDB persist, vite-plugin-pwa SW, supabase-js, SheetJS lazy)
   │  static shell from Cloudflare edge (free, unlimited)          │ JWT (RLS)
   ▼                                                               ▼
 Cloudflare Workers static assets                       Supabase project (Frankfurt, eu-central-1)
                                                          ├─ Auth (Google provider, PKCE; custom access-token hook adds company_id)
                                                          ├─ PostgREST: RPCs get_home(), approve_item(), import_bank_lines()…
                                                          ├─ Postgres: ledger tables + RLS; agg/snapshot tables; triggers mark dirty months
                                                          ├─ pg_cron: every minute → refresh_dirty() (SQL); dispatch due jobs → pgmq
                                                          │           → pg_net POST to Edge Function "worker" only when queue non-empty
                                                          ├─ Queues (pgmq): sumit_sync, ai_tag, bank_match, push_send
                                                          ├─ Edge Functions (Deno, pinned eu-central-1): sumit-connect, worker, photo-extract
                                                          │           secrets: SUMIT_KEK_v1, GEMINI_API_KEY, VAPID keys
                                                          └─ Storage: private buckets bank-files/, invoice-photos/ (RLS by company folder)
 External: SUMIT API (read-only allowlist) · Gemini API (paid) · Web Push (FCM/APNs via VAPID)
 GitHub Actions (private repo): nightly pg_dump → age-encrypt → Cloudflare R2; daily health check; monthly restore test
```

**Region:**
- Create the project in **Frankfurt (`eu-central-1`)** and pin Edge Functions there (`x-region: eu-central-1`, or `forceFunctionRegion` for cron calls), so function-to-DB calls stay in one region.
- **Latency check (P0-6):** measure the round-trip from Israeli mobile networks to Frankfurt vs Zurich (a PostgREST `get_home` call, p50/p95, 100 samples each), and pick the lower one. The expected Israel→Frankfurt RTT is tens of milliseconds **(unverified; to be measured)**.

**Where logic lives:**
- **Postgres (SQL/plpgsql):** everything that's data-local and must be fast: RLS, RPCs for Home and actions, aggregate refresh, dedupe, the call counter.
- **Edge Functions (TypeScript/Deno):** everything that talks to the outside world or needs a secret: SUMIT, Gemini, push, key encryption. Shared TypeScript code (money math, normalisers) is used by both the PWA and the functions.

### 1.4.1 Stack (as shown to the owner)

| Layer | Choice | Notes |
|---|---|---|
| Front-end language / build | **TypeScript, React + Vite**, route-level code splitting (`React.lazy` per route) | Switched from Preact (v1) for ecosystem, hiring and AI-agent familiarity. The **≤ 120 KB gzip Home-route budget stays as a target**; see the note below the table |
| Routing | **React Router** | Routes are lazy except Home |
| Data / cache | **TanStack Query** with its cache **persisted to IndexedDB** | Home renders instantly from the last `get_home` snapshot, then revalidates (stale-while-revalidate). Offline mutations are queued with `client_op_id` |
| Backend client | **supabase-js** | Auth (PKCE), PostgREST RPCs, Storage uploads, function invocation |
| PWA | **vite-plugin-pwa (Workbox)** | Install manifest, precache, offline shell, push handler in the service worker |
| Styling | **Tailwind CSS v4**. Tokens in `design/system/implementation-tokens.css` mapped into `@theme` (colours including light/dark, spacing, radii, type scale, shadows). Only token-based values; no arbitrary values unless justified. RTL via logical utilities (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`) and `dir="rtl"` at the root. Dark mode uses the same token set. **Self-hosted Rubik** (Hebrew subset, woff2). [0040](../decisions/0040-tailwind-v4.md) | **No ready-made component kit** with its own look. Vaul stays for sheets |
| Bottom sheets | **Vaul** | Add/change/split/period/confirm sheets (04, 06, 11, 16, 20–23) |
| Dates / money | **date-fns** with the `he` locale; **`Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })`** for shekels | Money stays integer agorot until display |
| Files on the phone | **SheetJS** (lazy, upload route only) for the Hapoalim Excel; **browser-image-compression** for invoice photos | Both are loaded only on their screens |
| Validation | **Zod**, shared schemas between the PWA and Edge Functions (`shared/`) | Zod 4.x |
| Database | **Supabase Postgres + RLS**; migrations via the **Supabase CLI**; **generated DB types** (`supabase gen types typescript`) used by the PWA and functions | |
| Auth / files | **Supabase Auth (Google)**; **Storage** private buckets with per-company folders | |
| Server code | **Edge Functions (Deno / TypeScript)** for SUMIT sync, AI tagging, bank processing and push | |
| Jobs | **pg_cron + Postgres queue** (`pgmq`, with a `skip locked` job-table fallback) + `pg_net` wake-up | |
| Secrets | **Envelope encryption** for SUMIT keys (KEK as an Edge Function secret) | §7 |
| AI | **`@google/genai` SDK** (Gemini 3.1 Flash-Lite, paid tier) | |
| Push | **`web-push`** npm package for VAPID sending | **To verify in Deno** (it relies on Node crypto APIs); if it doesn't run, use a Deno-native Web Push library (P7-1) |
| Tests | **Vitest** (units, shared logic, functions), **Playwright** (Hebrew RTL mobile flows, Android/iOS viewports), **pgTAP** (RLS isolation, RPC rules) | |
| Hosting | PWA as static files on Cloudflare Workers static assets (§1.3); backend on Supabase | |

**Bundle-budget note:** with React, React DOM, React Router, TanStack Query and supabase-js together on the Home route, 120 KB gzip is tight. Rough published sizes suggest roughly 90–120 KB for these combined **(unverified; measured in P0-5)**. Mitigations:
- Keep Home's own code small.
- Load Vaul, date-fns, SheetJS and browser-image-compression only on the routes that use them.
- Import supabase-js sub-clients where possible.
- Enforce the budget in CI (P7-4).

If it can't be met, the 2 s target still holds, because the service worker precaches the shell and Home paints from the persisted cache. The 120 KB figure is a first-visit target.

### 1.5 Headroom vs Free limits

| Free limit | Pilot use | ~50 companies use | Status at 50 |
|---|---|---|---|
| **DB 500 MB** | < 30 MB | ≈ 250–500 MB | 🔴 at or near the limit → **Pro** |
| **Egress 5 GB/mo** | app ≈ 0.1 GB + nightly dumps ≈ 30 × 30 MB = 0.9 GB → **≈ 1 GB** | app ≈ 1–1.5 GB + nightly dumps ≈ 30 × 250 MB = 7.5 GB → **≈ 9 GB** | 🔴 over (weekly dumps would reduce it, but lose the nightly RPO) → **Pro** |
| **Storage 1 GB** | < 0.1 GB | photos ≈ 225 MB/mo + bank files kept 90 days ≈ 0.1 GB → **> 1 GB within ~4 months** | 🔴 → **Pro**, or move photos to R2 (Q3) |
| Edge Function invocations 500k/mo | < 3k | ≈ 10–20k (daily syncs 1.5k, app-open refresh ~1.5k, AI batches ~1k, push ~2k, uploads/photos ~1k; the cron→function call fires only when a queue has work) | 🟢 25× |
| Edge Function CPU 2 s / wall 150 s | ok | ok (SUMIT page of 1,000 docs ≈ a few MB JSON; batch inserts) | 🟢 (measured in P0-6) |
| Auth 50k MAU | 5 | 50 | 🟢 |
| Projects: 2 active | staging + production | same | 🟡 no spare (restore tests run in a GitHub Actions container instead) |
| Compute: shared, 500 MB RAM | fine | fine for 50 users; watch `refresh_dirty` and backfills | 🟡 |
| Pausing | real daily activity + health check | same | 🟢 |

### 1.6 When to move to Pro (trigger points)

Move when **any one** of these is true. Monitoring (P8-5) emails the operator at the "warn" level.

| Signal | Warn | Move |
|---|---|---|
| Database size (`pg_database_size`) | 250 MB | **300 MB** |
| Egress in the billing month (Usage page) | 2.5 GB | **3 GB** |
| Nightly dump size | 70 MB | **100 MB** (30 × 100 MB = 3 GB of egress for backups alone) |
| Storage used | 600 MB | **750 MB** |
| Business | — | **First paying customer**, or **~15–20 active companies**, whichever comes first |

Expected timing: somewhere around **15–20 companies**, or at paid launch.

**Moving is a plan change on the same project** (Billing → Pro), not a migration: the data, URLs and keys stay the same.
- Afterwards, turn on daily backups (included) and keep the R2 dumps as an independent off-site copy.
- Staging stays on a Free organisation, so the bill stays **$25**. A second project in the Pro org would add Micro compute: the pricing page's example is 2 projects = $35.
- Whether a user's Free org still counts toward the 2-free-projects limit after the Pro upgrade needs checking **(unverified)**.

### 1.7 Monthly cost

| Item | Pilot on Free (1–5 companies) | ~50 companies on Free (not viable, for comparison) | ~50 companies on Pro | Source |
|---|---|---|---|---|
| Supabase | $0 | $0 (limits exceeded, §1.5) | **$25** (one Micro project, covered by the compute credit) | https://supabase.com/pricing |
| Cloudflare static hosting | $0 | $0 | $0 | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| Cloudflare R2 (backups) | $0 (free 10 GB-month, 1M Class A, 10M Class B, free egress) | $0 | $0 (30 daily + 12 monthly encrypted dumps ≈ 3–6 GB) | https://developers.cloudflare.com/r2/pricing/ |
| GitHub Actions (private repo) | $0 (GitHub Free: 2,000 min/mo; backups + health + restore test ≈ 150–300 min/mo) | $0 | $0 | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| Gemini 3.1 Flash-Lite (unchanged from v1) | ≈ $0.03–0.16 | ≈ $1.60 | ≈ $1.60 | https://ai.google.dev/gemini-api/docs/pricing |
| One-time backfill tagging per new company | ≈ $0.30 each | ≈ $0.30 each | ≈ $0.30 each | §4.5 |
| Domain (optional) | $0 on `*.workers.dev` | ≈ $0.87–0.93/mo for a `.com` | ≈ $0.87–0.93/mo | https://tldes.com/pages/com-price-increase-2026 · https://domainoffer.net/tld/com/cloudflare · https://www.cloudflare.com/application-services/products/registrar/buy-com-domains/ |
| Supabase custom domain (optional; shows your domain on Google's consent screen) | not available on Free | not available | $10/mo add-on | https://supabase.com/pricing |
| **Total** | **≈ $0.05–0.30** | ≈ $1.6–2.5 | **≈ $26.6–27.5** (≈ $36.6–37.5 with the Supabase custom domain) | |

The customer's own SUMIT plan is paid by the customer (SUMIT §6). Google sign-in has no fee listed on Supabase's side (social OAuth is included; 50k MAU on Free, 100k on Pro).

---

## 2. Data model (Postgres)

The logical model is unchanged from v1. Only the physical types and access control change.

**Postgres conventions:**

| Concern | v1 (D1/SQLite) | v2 (Postgres) |
|---|---|---|
| IDs | ULID text | `uuid` primary keys, `default gen_random_uuid()`; ordering by `created_at timestamptz` |
| Money | integer agorot | **`bigint` agorot** (never `numeric`/`float` for stored money; `numeric` only inside intermediate VAT-ratio calculations, rounded back to `bigint`) |
| Percentages / confidence | integer basis points | `integer` basis points with `check (x between 0 and 10000)` |
| Dates | text | `date` (Israel business date); `timestamptz` for events |
| Stable enumerations | text | **Postgres enums**: `direction`, `pnl_kind`, `txn_status`, `doc_type`, `vat_status`, `review_status`, `project_status`, `category_kind` |
| Evolving enumerations | text | `text` + `check` constraint (e.g. `review_item.reason`, `bank_line.classification`), which is easier to extend in migrations |
| JSON | text | **`jsonb`** (`settings`, `payload`, `folder_map`, `match_rule`, trimmed `raw`) |
| Identity | `app_user` + `session` tables | **`auth.users`** (Supabase Auth) + `public.profile` (1:1) + `public.company_member(company_id, user_id, role)`. The `session` table is dropped because Supabase manages sessions |
| Tenant scoping | app code | **RLS on every table**: `company_id = (select auth.jwt() ->> 'company_id')::uuid`. The claim is added by the Custom Access Token hook (included on Free, https://supabase.com/pricing) from `company_member` |
| Files | R2 keys | Storage object paths `bank-files/<company_id>/<upload_id>.xlsx`, `invoice-photos/<company_id>/<doc_id>.jpg` |

**RLS pattern (every business table):**
```sql
alter table public.txn enable row level security;
create policy txn_tenant on public.txn
  for all to authenticated
  using (company_id = (select auth.jwt() ->> 'company_id')::uuid)
  with check (company_id = (select auth.jwt() ->> 'company_id')::uuid);
create index on public.txn (company_id, doc_date);
```
- Wrapping `auth.jwt()` in `(select …)` lets Postgres evaluate it once per query.
- Every tenant table leads its indexes with `company_id`.
- **Sensitive tables** are deny-all for the `authenticated` role, and only Edge Functions (service role) and `security definer` RPCs touch them: `sumit_connection` (ciphertext), `sumit_call_log`, `push_subscription` keys, `audit_log` (append via RPC only).
- **Writes from the app** go through RPCs (`security invoker`, so RLS still applies) that enforce business rules (shares sum to 10000, category merge moves allocations, etc.). Direct table writes are limited to simple fields.
- **The service role** (background Edge Functions) bypasses RLS. Every function takes the `company_id` from the queue message and uses a repository helper that adds `company_id = $1` to every query. Automated isolation tests cover both paths (P1-6).

### 2.1 Tables (types adapted; fields as in v1)

| Table | Postgres notes |
|---|---|
| `company` | `id uuid`, `name text`, `tax_id text`, `vat_mode` enum (`osek_murshe`, `osek_patur`, `company`), `vat_rate_bp int`, `tax_year_start_month smallint default 1`, `settings jsonb` (`auto_approve_high_conf`, `overhead_view_default`, `approve_threshold_bp`), `created_at`, `deleted_at` |
| `profile` | `user_id uuid pk references auth.users`, `display_name`, `picture_url`, `last_login_at` |
| `company_member` | `(company_id, user_id)` pk, `role text check (role in ('owner'))`. Single owner in M1; the source of the JWT `company_id` claim |
| `audit_log` | `bigserial id`, `company_id`, `user_id`, `ts timestamptz`, `action text`, `entity text`, `entity_id uuid`, `meta jsonb` (never secrets); insert via RPC only |
| `applied_op` | `(company_id, client_op_id uuid)` pk; idempotency for offline approvals |
| `project` | as v1; `status project_status`, `budget_agorot bigint null`, `created_via text check (...)`; unique `(company_id, lower(name))` |
| `category` | as v1; `kind category_kind`, `hidden bool`, `merged_into_id uuid null references category`; seeded by a trigger on `company` insert (7 expense + 2 income) |
| `counterparty` | as v1; `normalized_name text` with a `pg_trgm` GIN index for fuzzy matching; `bank_aliases text[]` |
| `source_document` | as v1; `doc_type` enum, `gross_agorot/net_agorot/vat_agorot bigint`, `vat_rate_bp int null`, `vat_status` enum, `original_doc_id uuid null`, `content_hash bytea`, `raw jsonb` (trimmed, ≤ 2 KB), `storage_path text` (photos); unique `(company_id, source, external_id)` |
| `bank_upload` | as v1; `storage_path`, `file_sha256 bytea`, the result counters as `int` |
| `bank_line` | as v1; `amount_agorot bigint` signed, `balance_agorot bigint`, `line_hash bytea`; unique `(company_id, line_hash)` so `insert … on conflict do nothing` dedupes |
| `txn` | as v1; enums `direction`, `pnl_kind`, `txn_status`; money `bigint`; `ai_conf_bp int` |
| `payment` | as v1; `pay_date date`, money `bigint`; index `(company_id, pay_date)` |
| `allocation` | as v1; `share_bp int check (share_bp between 1 and 10000)`; a deferred constraint trigger checks Σ `share_bp` = 10000 per `txn_id` |
| `split_rule`, `split_rule_target` | as v1; `method text check (method in ('equal','income_share','manual'))`, `match_rule jsonb` |
| `review_item` | as v1; `status review_status`, `reason text check (...)`; partial index `where status='open'` for the queue and the pending count |
| `supplier_memory` | as v1; `kind text check (kind in ('fixed','learned'))` |
| `daily_stat` | `(company_id, date)` pk |
| `sumit_connection` | as v1 (ciphertext columns `bytea`, `folder_map jsonb`, counter columns). **RLS: no policies for `authenticated`** (deny); the app reads status via an RPC that returns only safe fields |
| `sumit_budget_map` | as v1 |
| `sumit_call_log` | as v1; purged after 90 days by cron |
| `sync_job` | as v1; `cursor jsonb` |
| `dirty_month` | **new**: `(company_id, ym date)` pk; filled by statement-level triggers on `payment`, `allocation` and `txn` (status/delete) |
| `agg_month` | as v1; pk `(company_id, ym, project_key, category_id)`; money `bigint` |
| `home_snapshot` | as v1; `payload jsonb`, `version bigint`, `computed_at` |
| `project_snapshot` | as v1 |
| `push_subscription` | as v1; deny-all RLS for keys; the app registers via RPC |
| `notification_state` | as v1; `weekly_time time`, `nudge_time time` (Israel local) |

**Aggregates in Postgres:**
1. Statement-level triggers on `payment`, `allocation` and `txn` write the affected `(company_id, month)` rows into `dirty_month` (`on conflict do nothing`).
2. User-facing RPCs (approve, change, split, mark-paid, manual entry) call `refresh_company_months(company_id, months[])` **synchronously** at the end, so Home is correct on the next read. It typically sums < 500 rows per month and takes milliseconds **(to be measured)**.
3. A `pg_cron` job every minute runs `refresh_dirty()` for bulk writes (sync pages, uploads). That keeps backfills fast: rows are written first and aggregated once.
4. `refresh_company_months` rebuilds `agg_month` for those months, re-evaluates income-share split allocations for those months, then rebuilds the 3 `home_snapshot` rows and the affected `project_snapshot` rows, incrementing `version`.

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
- **VAT and "before VAT"** ([0041](../decisions/0041-amounts-before-vat.md), amended by [0043](../decisions/0043-assumed-vat-on-expenses.md)):
  - **Invoice-type documents that carry a split:** net = `Accounting_DisplayCompanyValueWithoutVAT`, with `vat_status='source'`.
  - **Receipts** carry no VAT. A payment's net = payment gross × (invoice net ÷ invoice gross), in integer arithmetic with banker's rounding to the agora. A standalone receipt in a VAT-registered company gets net = gross ÷ (1 + rate), with `vat_status='derived'`.
  - **`osek_patur` company, or a supplier marked VAT-exempt:** net = gross. A VAT-exempt supplier (insurance, `עוסק פטור`) is a flag on supplier memory, set once by the owner, toggled later, and past amounts recompute.
  - **Expenses with no VAT split** (SUMIT `addexpense` and any other expense source) **and bank-statement lines with no supplier match:** assume the standard Israeli VAT rate. The rate is a configurable constant, currently 18%, not hard-coded. net = gross / 1.18, stored in agorot with the same banker's rounding as other derived nets. `vat_status='assumed'`. The detail screen may show a subtle hint so the owner can correct it. Home has no warning banner.
  - **`vat_status` values:** `source`, `derived`, `unknown`, `assumed`. `assumed` is the 0043 default. `unknown` is no longer the display for an expense that simply lacks a split.
  - **Home figures** use the net from the rules above, including assumed nets. Do not add a "VAT unknown" banner on Home.
- **Credit notes:** credits are already negative in SUMIT, so sum them directly. A credit linked to an unpaid invoice reduces the open balance. A credit on a paid invoice has no cash effect until the refund (credit receipt or bank debit).
- **Cheques:** the default cash date is the receipt date. With `getdetails`, `Details_Cheque.DueDate` can be used for post-dated cheques (setting off in M1; Q8).
- **Non-P&L money:** transfers between own accounts, VAT payments to מע"מ, income tax / ביטוח לאומי, loans and owner withdrawals become `pnl_kind='non_pnl'`. They're excluded from profit and counted in the upload results ("2 transfers between your own accounts removed").
- **Credit-card settlement lines** (one monthly bank debit covering many card purchases) are classified as `card_settlement`. Exclude them when SUMIT already holds card-paid expense documents for that month; otherwise send them to review as an expense to categorise (risk R14).

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


## 3. Sync and background work

### 3.0 Job plumbing on Supabase

| Piece | Implementation |
|---|---|
| **Scheduler** | **`pg_cron`**, with schedules in UTC. Israel local time is computed in SQL (`now() at time zone 'Asia/Jerusalem'`), which is DST-safe. Jobs: `dispatch_due()` every minute; `refresh_dirty()` every minute; `purge_logs()` daily; `usage_check()` daily (§1.6) |
| **Queue** | **Supabase Queues (`pgmq`)**. Queues: `sumit_sync`, `ai_tag`, `bank_match`, `photo_extract`, `push_send`. Messages carry `{company_id, kind, cursor}`. The visibility timeout (e.g. 180 s) gives retries; after 3 reads a message moves to a `dead` table and the operator is alerted. If `pgmq` turns out to be unavailable on Free (P0-2 check), the fallback is a plain `job` table claimed with `select … for update skip locked` (same semantics) |
| **Wake-up** | `dispatch_due()` enqueues due work (daily polls in each company's slot, weekly re-scans, notification times). If any queue has visible messages, it calls the Edge Function **`worker`** through **`pg_net`** (`net.http_post`, with `forceFunctionRegion=eu-central-1` and the auth key read from Vault, as Supabase's scheduling guide recommends). **No messages means no invocation**, which saves the 500k/month allowance |
| **Worker** | The `worker` Edge Function reads up to N messages (`pgmq.read`), processes them within a ~120 s budget (under the Free 150 s wall clock; CPU ≤ 2 s per request, https://supabase.com/docs/guides/functions/limits), deletes (`pgmq.delete`) or archives what's done, and re-invokes itself once if work remains (the nesting limit is 30 calls per trace in 60 s). User-triggered work (app-open refresh, upload finished, photo taken) calls the worker directly after enqueueing, for low latency |
| **Idempotency** | Each unit (SUMIT page, AI batch, match chunk) is idempotent: upserts on natural keys, and `content_hash` comparison. A redelivered message is harmless |

### 3.1 SUMIT (read-only)

The logic is unchanged from v1. Only the mechanics are Supabase-specific now.

**3.1.1 Read-only guarantee (decision 0036)**
- **Allowlist:** the `sumitClient` module (used only in Edge Functions) allows `crm/data/listentities`, `crm/schema/listfolders`, `crm/schema/getfolder`, `website/companies/getdetails`, `accounting/documents/list`, `accounting/documents/getdetails`, `listquotas` and `getvatrate`. Any other path throws before any network call.
- **CI guard:** a check fails the build if a non-allowlisted SUMIT path string appears in the repo.
- Flow never calls `updateentity`, creates documents or subscribes triggers.

**3.1.2 Connect**
1. The PWA posts CompanyID + key to the Edge Function **`sumit-connect`** over HTTPS with the user JWT. It never writes to a table directly.
2. The function validates the key (`getdetails`, which also reads `CompanyType`, i.e. the VAT mode), resolves folders (`listfolders`, `getfolder` on "מסמכים") and reads the `listquotas` baseline: about 4 calls.
3. It encrypts the key (§7) and upserts `sumit_connection` with the service role.
4. It enqueues the backfill.
5. The response contains only `{connected, sumit_company_id, status}`.

**3.1.3 Backfill**
- CRM `listentities` on "מסמכים" with `IncludeInheritedFolders:true`, `LoadProperties:true`, ordered by `Accounting_InsertDate`, **PageSize 1000**. The 2 s CPU and 256 MB memory on Edge Functions allow it; v1 needed 200 because of Workers' 10 ms. Page with `StartIndex` while `HasNextPage`.
- **1–3 calls** for a typical company, one page per queue message.
- Each page upserts `source_document` (skip when `content_hash` is unchanged), derives `txn`/`payment` rows, and enqueues AI batches.
- `refresh_dirty()` aggregates afterwards.
- The range is the current and previous tax year (Q12).

**3.1.4 Cadence and call budget**

| Trigger | What | Calls | When |
|---|---|---|---|
| Daily poll | CRM query with `Accounting_InsertDate ≥ last_insert_ts − 1 day`; dedupe by `external_id` | 1 | Once a day per company, staggered 02:00–05:00 IL |
| App-open refresh | Same query; the PWA calls RPC `request_refresh()`, which enqueues only if ≥ 6 h since the last one and the counter allows | 1 | ≤ 4/day, typically ~1 |
| Pull-to-refresh | Same, with a 30-min floor | 1 | rare |
| Weekly re-scan | Whole current tax year (plus the previous year in January–April), diff by `content_hash`, because there's no modified field (verified) | 1–2 | Saturday night, staggered |
| On-demand details | `getdetails` for line items or cheque due date; cached forever | 1/doc | rare |

**Budget per company per month:** ~4 (connect) + 1–3 (backfill), one time. Then ≈ 30 daily + 4–8 weekly + ~20–30 app-open = **~55–70**, under the self-imposed cap of 100 and well inside SUMIT Start's 250 (SUMIT §6).

**3.1.5 Own call counter**
- The SQL function `reserve_sumit_call(company_id, purpose)` does an atomic `update … set calls_count = case when calls_month <> $m then 1 else calls_count + 1 end, calls_month = $m where company_id = $1 and (calls_month <> $m or calls_count < calls_cap) returning calls_count`. If no row comes back, the call is refused.
- Degradation ladder:
  - above 70 calls: no app-open refresh;
  - above 90: weekly re-scan only;
  - at 100: paused until the 1st.
- Each call is logged to `sumit_call_log`, metadata only.

**3.1.6 Errors:** as in v1.
- HTTP non-200 or `Status:2` → retry via the queue visibility timeout (max 3 reads).
- `Status:1` → no retry. Map to `invalid_key` / `plan_no_api`, show a Hebrew message in Settings, and send one push after 3 failed days.

**3.1.7 Triggers vs decision 0036:** unchanged. Registering a SUMIT trigger is a write, so it's **skipped in M1**. An optional receiving endpoint exists as an Edge Function `sumit-hook` behind a feature flag, for a customer who creates the trigger themselves. It takes a per-company random token, ignores the body, enqueues a debounced re-sync and always goes through the call counter.

**3.1.8 Mapping:** unchanged.
- **Project:** SUMIT budget section → `sumit_budget_map` → project (100%). Otherwise supplier memory, rules or AI (§4). Linked documents inherit the allocation.
- **Fallback:** if the undocumented `Accounting_*` fields break, use `documents/list`. A nightly drift check on one page alerts the operator.

### 3.2 Bank Hapoalim Excel upload

1. **Parse on the phone** (unchanged): SheetJS, lazy-loaded. Header detection by Hebrew column names; running-balance check; **er-01** for non-Poalim files; integer agorot. Parsing on the phone gives instant validation feedback and keeps the upload small.
2. **Upload the original file** to Storage: `bank-files/<company_id>/<upload_id>.xlsx`, a private bucket. The RLS insert policy requires `(storage.foldername(name))[1] = auth.jwt()->>'company_id'`. The 50 MB Free upload limit is far above a statement's size (https://supabase.com/pricing).
3. **Insert the rows** with RPC `import_bank_lines(upload_id, rows jsonb)` (`security invoker`, so RLS applies). It validates types and ranges, computes `line_hash` in SQL (`digest()` from pgcrypto), and does `insert … on conflict (company_id, line_hash) do nothing`. It returns new / duplicate counts, then enqueues `bank_match`.
4. **Classify and match** in the `worker` Edge Function (TypeScript, shared tests), same rules as v1:
   - internal transfers, card settlements and tax payments → `non_pnl`;
   - matching to SUMIT, photo and manual items by exact amount + date window + name similarity (`pg_trgm` candidates fetched in one query) + reference;
   - one-to-one assignment; ambiguity → `possible_duplicate` review;
   - unmatched lines → bank-only `txn` + tagging;
   - recurring payer → auto-open a project.
5. **Finish:** `refresh_company_months` for the affected months; write the counters to `bank_upload` (screen 08); send a push if the user has left the screen (ld-05 "continue in background").
6. **Retention:** a daily cron deletes bank files older than 90 days from Storage via the Storage API (in an Edge Function). The parsed lines stay.

### 3.3 Notifications

- **Scheduling:** `dispatch_due()` checks each company's `notification_state` against Israel local time:
  - **Sunday 08:00 summary**, from `home_snapshot`;
  - **daily 18:00 nudge**, only if open review items or new unpaid items exist since the last nudge;
  - Saturday skipped by default (Q10).
- **Delivery:** it enqueues `push_send`. The worker sends Web Push with VAPID keys held as Edge Function secrets. It uses the `web-push` npm package **(to verify in Deno; fallback: a Deno-native Web Push library, P7-1)**. Subscriptions that return 404/410 are deleted.
- **iOS:** push works only for a Home Screen web app on iOS/iPadOS 16.4+, with permission requested from a user gesture (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). So onboarding 09e asks after install (17b).
- **No Apple Developer Program** membership is needed (https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

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


## 5. Google sign-in (Supabase Auth)

**Setup** (from https://supabase.com/docs/guides/auth/social-login/auth-google):
- In the Google Auth Platform console, create a *Web application* OAuth client.
  - Authorised JavaScript origins: the PWA origin.
  - Authorised redirect URI: the project's `https://<ref>.supabase.co/auth/v1/callback`.
- Paste the client ID and secret into the Supabase Google provider.
- Scopes: only `openid`, `userinfo.email` and `userinfo.profile`. **No Gmail scopes**, because the docs warn that sensitive or restricted scopes trigger a long verification.
- Set up consent-screen branding (brand verification takes a few business days).
- Without a Supabase custom domain (Pro add-on, $10/mo, not on Free), **the consent screen shows `<ref>.supabase.co`**. Supabase itself recommends a custom domain against phishing. See Q4.

**Client flow:**
- `createClient(url, publishableKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })`.
- The "Sign in with Google" button calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<app>/auth/callback' } })`.
- The callback route exchanges the code (`exchangeCodeForSession`). The redirect URL must be in Supabase's allow list.
- Errors: cancelled consent → **er-03**; exchange or network failure → **er-04**.

**Tenant claim:**
- A **Custom Access Token hook** (a Postgres function, included on Free) adds `company_id` from `company_member` to the JWT.
- On first sign-in there's no company yet, so there's no claim. Onboarding 09b calls RPC `create_company(invite_code, …)`, which creates the company and membership, seeds categories and consumes the invite. The client then calls `supabase.auth.refreshSession()` to get a JWT with the claim.

**Pilot gating:**
- Free-plan Auth hooks are limited to Custom Access Token and custom email/SMS (https://supabase.com/pricing), so there's no "before user created" hook.
- Anyone can create an *auth user* with Google, but without a valid invite code `create_company` fails, and **RLS gives that user access to nothing**.
- Orphan auth users with no membership are purged weekly.

**Sessions** (https://supabase.com/docs/guides/auth/sessions):
- The access token is a JWT with a default 1 h expiry. The refresh token never expires but is single-use. By default, sessions last until sign-out.
- Session time-boxes and inactivity timeouts are Pro-only features. Flow doesn't need them in M1.
- supabase-js keeps the session in **browser storage** (localStorage by default). The docs say HttpOnly-cookie storage isn't feasible for client-side-JS apps. That makes **XSS protection critical** (§7).
- **Logout** (screen 14): `supabase.auth.signOut()` removes the session server-side; the app also clears IndexedDB caches and the offline queue.
- **Offline:** token refresh fails silently. The app keeps showing cached data, and queued actions replay after the next successful refresh.

**iOS installed-PWA quirks** (risk R8; spike P1-7 on real iPhones, current and previous iOS):
1. **Separate storage:** a Home Screen web app doesn't share storage with Safari, so after "Add to Home Screen" the user signs in once more inside the app. Onboarding 17b/09e presents this as one friendly tap, not an error.
2. **Redirect leaving the app:** in standalone mode, the OAuth round-trip through Google can come back in Safari instead of the installed app. The PKCE code verifier sits in the app's storage, so the exchange then fails **(behaviour varies by iOS version; unverified until tested)**. Options to test:
   - (a) the plain redirect flow inside the standalone window;
   - (b) Google's pre-built button with an ID token passed to `supabase.auth.signInWithIdToken({ provider: 'google', token, nonce })`, which avoids the redirect (documented by Supabase; its behaviour in iOS standalone mode is unverified);
   - (c) a fallback callback page in Safari saying "חזרו לאפליקציה Flow והתחברו שם".
   Ship whichever passes on the test devices, with (c) always present.

---

## 6. Performance plan: Home usable in under 2 s

**Targets** (mid-range Android on 4G, from tapping the icon):

| Scenario | Target |
|---|---|
| Returning user, installed | Shell < 0.5 s · cached numbers < 1.0 s · fresh numbers < 1.5 s |
| Offline | Shell + last data < 1.0 s, with "אין חיבור · נתונים מ-09:12" |
| First visit | Usable < 2.0 s |

**How:**
1. **Static shell from Cloudflare's edge**, precached by the service worker (vite-plugin-pwa / Workbox): Home route ≤ 120 KB gzip JS/CSS as a target (§1.4.1), Rubik woff2 Hebrew subset preloaded, other routes lazy-loaded (SheetJS, pickers, upload, split). A repeat open touches no network before first paint.
2. **Paint cached data first.** The last `home_snapshot` payloads (3 periods) live in the TanStack Query cache persisted to IndexedDB, and render immediately. The skeleton shows only if nothing is cached after 300 ms (design rule).
3. **One network call for fresh data:**
   - `supabase.rpc('get_home', { known_versions })` makes a single PostgREST request to Frankfurt. It reads 3 rows from `home_snapshot` by primary key, returns `{unchanged:true}` per period when the version matches (a tiny response that also saves egress), and includes the pending count and last-sync time.
   - No Edge Function is in the Home path, so there's no function cold start.
   - Postgres is always on (no scale-to-zero on Supabase; pausing is covered in §1.2).
4. **Token refresh** on a cold open (access token older than 1 h) costs one extra round-trip before `get_home`. The cached paint hides it. Both calls are started right after the service worker serves the shell.
5. **Precomputed totals** (§2): user actions refresh the affected months synchronously; bulk sync is aggregated by the minute cron. Home never aggregates at read time.
6. **Sync never blocks the UI.** App-open refresh is an RPC that enqueues and returns at once. While the app is visible, it polls `get_home` with `known_versions` every 60 s. Realtime isn't used, which keeps connections and egress low.
7. **Region and latency gate (P0-6):** measure `get_home` p50/p95 from Israeli 4G to Frankfurt vs Zurich. Target **p95 < 400 ms**. If it's missed, investigate before building further (e.g. a pooler setting, or moving to Pro's dedicated Micro compute).
8. **Offline approvals** are queued in IndexedDB with `client_op_id` and replayed; the server dedupes through `applied_op`. The toast says "יישלח כשהחיבור יחזור".
9. **Measurement:** Lighthouse CI (mobile, throttled) with LCP < 2.0 s; sampled real-user metrics posted via RPC `log_rum()` into a small table, aggregated daily.

---

## 7. Security and privacy

A SUMIT key is **full access** (no scopes; SUMIT §7.9). Supabase adds new surfaces: the publishable key is public by design, tokens sit in browser storage, and the service role bypasses RLS.

| Control | Implementation |
|---|---|
| **SUMIT key encryption (chosen: envelope, KEK outside the DB)** | The Edge Function `sumit-connect` encrypts the key with a per-company random 256-bit DEK (WebCrypto AES-256-GCM, 96-bit IV, AAD = `company_id‖'sumit'‖kek_version`). The DEK is wrapped with the **KEK, stored as an Edge Function secret** (`SUMIT_KEK_v1`; secrets up to 48 KiB, 100 per project, https://supabase.com/docs/guides/functions/limits). The DB (and every backup dump) holds only ciphertext. A copy of the KEK is kept offline in the operator's password manager, so a restore to a new project works |
| **Why not Vault for the key** | Vault encrypts at rest, but its `decrypted_secrets` view gives plaintext to any DB role granted access, and its root key is managed by Supabase. Also, a `pg_dump` restore into a *new* project can't decrypt Vault secrets unless the old project's root key is copied over (https://supabase.com/docs/guides/database/vault). Envelope encryption keeps decryption possible only inside Flow's Edge Functions. **Vault is used only** for the key that `pg_cron`/`pg_net` needs to call the worker function, as Supabase's scheduling guide recommends |
| **Read-only by construction** | `sumitClient` allowlist + CI guard (§3.1.1). Only Edge Functions can reach SUMIT; the PWA never talks to SUMIT |
| **Key never to the client** | `sumit_connection` has deny-all RLS for `authenticated`. Status comes through an RPC returning only safe fields. The input field is write-only |
| **Short plaintext lifetime** | Decrypted inside the worker for the call only; never logged. A redaction helper strips `APIKey` from errors. Supabase logs are kept 1 day on Free and 7 on Pro (https://supabase.com/pricing) |
| **Disconnect / rotation** | "נתק SUMIT" deletes the ciphertext and wrapped DEK, stops jobs and writes an audit entry; the user is reminded to revoke the key in SUMIT. `kek_version` allows re-wrapping all DEKs with a new KEK in one job |
| **RLS everywhere** | RLS is enabled on every `public` table, and a CI check fails if any table has `rowsecurity = false`. Policy tests run as `authenticated` with two companies' JWTs (**pgTAP** in CI). Storage policies restrict each company to its own folder |
| **Service role discipline** | The service role key exists only in Edge Function environments. Background code must use the `company_id`-scoped repository helper. It's never in the PWA or GitHub, except the backup job's own **read-only DB role** (below) |
| **XSS (tokens in browser storage)** | Strict CSP (`script-src 'self'`; `connect-src` limited to the Supabase URL and Google), no third-party scripts or analytics, no `innerHTML` with data, dependency audit in CI. The Cloudflare `_headers` file sets CSP, HSTS, `X-Content-Type-Options` and `Referrer-Policy` |
| **Files** | Private buckets with RLS by company folder. Photos are viewed via short-lived signed URLs (60 s). Retention: bank files 90 days (cron deletes them); invoice photos until the user deletes them, or 7 years (Q11) |
| **Backups** | Dumps are compressed and **encrypted with `age`** before leaving the runner. Only the public key is in the backup workflow; the private key is kept offline, with a separate copy for the restore-test workflow. The R2 API tokens are scoped to the backup bucket only (§8) |
| **Backup DB credentials** | A dedicated Postgres role `backup_reader` with read-only privileges on Flow's schemas, connecting through the Supabase pooler. Whether Supabase allows granting `pg_read_all_data` needs checking **(unverified)**; otherwise use explicit `grant select` |
| **Account deletion** | A job deletes tenant rows and Storage objects and records the company id in a `deleted_company` tombstone table. Encrypted backups age out (30 daily / 12 monthly). **Any restore re-applies the tombstones** before going live. The privacy policy states the backup retention |
| **Operator access** | Supabase, Cloudflare, GitHub and Google Cloud accounts use 2FA (hardware keys where possible), with at most 2 admins. Production data never goes to laptops. The dashboard SQL editor is used read-only, and any emergency access is noted in the audit log |
| **AI data** | Gemini paid tier only (no training use), minimum fields sent (unchanged) |
| **Privacy law** | Israel's Privacy Protection Law, including Amendment 13: Hebrew privacy policy and terms, data inventory, sub-processor list (Supabase/AWS Frankfurt, Cloudflare, Google, GitHub), breach procedure, lawyer review before paid launch **(legal review needed)** |

---

## 8. Backups, restore test and health check (new)

Supabase Free has **no automatic backups**. Supabase itself recommends that free projects export regularly with `supabase db dump` and keep off-site copies (https://supabase.com/docs/guides/platform/backups). Database backups also **don't include Storage objects** (same page).

### 8.1 Nightly database dump (GitHub Actions → Cloudflare R2)

| Step | Detail |
|---|---|
| Schedule | GitHub Actions `schedule: cron '30 23 * * *'` (UTC ≈ 01:30–02:30 IL), plus `workflow_dispatch`; private repo |
| Dump | Supabase CLI `supabase db dump` three times: roles (`--role-only`), schema, and data (`--data-only`), against the project's **session pooler** connection string as `backup_reader`. GitHub-hosted runners may lack IPv6, so use the pooler rather than a direct connection **(connectivity detail unverified; confirm in P8-1)** |
| Manifest | Row counts per table plus a per-company P&L checksum (Σ `agg_month` income/expense), written next to the dump |
| Compress + encrypt | `zstd`, then `age -r <public key>`. Plaintext never leaves the runner |
| Upload | S3-compatible upload to an R2 bucket `flow-backups` with a bucket-scoped token. Keys: `db/daily/YYYY-MM-DD.tar.zst.age`; on the 1st of each month also `db/monthly/YYYY-MM.tar.zst.age` |
| Retention | R2 lifecycle rules: daily deleted after 30 days, monthly after 12 months. Size: pilot < 1 GB; at 50 companies ≈ 3–6 GB, inside the free 10 GB-month (https://developers.cloudflare.com/r2/pricing/) |
| Cost | R2 $0 (free tier; 1 write/night ≪ 1M Class A). GitHub Actions ≈ 3–5 min/run ≈ 90–150 min/mo, of 2,000 free (https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Egress | Each dump reads the whole DB out of Supabase. It counts against the 5 GB egress, which is **why dump size is a Pro trigger** (§1.6) |
| Alerting | A failed job, or a dump > 20% smaller than yesterday's, emails the operator |

### 8.2 Storage objects

- A **weekly** workflow copies new or changed objects in `invoice-photos/` (and `bank-files/` still within 90 days) to R2 `files/…`, `age`-encrypted per file. It uses the Storage API list and download, incrementally since the last run's cursor.
- Egress is small: only new files (≈ 225 MB/month at 50 companies).

### 8.3 Daily health check (anti-pause safety net)

- A GitHub Actions job daily at 09:00 IL calls `POST /rest/v1/rpc/health` with the publishable key. `health()` is `security definer` and returns only `now()`, the newest `cron.job_run_details` end time, queue depths and the DB size.
- It's a genuine database request, which keeps the project clearly "active" in the sense of the pausing rules, even in a quiet week.
- It alerts if the call fails, cron hasn't run for 10 minutes, a queue is stuck, or the DB passes 250 MB.

### 8.4 Restore test

- **Monthly (automatic):** a workflow downloads the latest daily dump, decrypts it with the restore key (a secret only this workflow uses), and restores roles, schema and data into a `postgres` service container of the same major version. It then checks the manifest row counts and recomputes the P&L checksums. Pass/fail is emailed.
- **Quarterly (manual drill):** restore into the staging project, re-link the KEK (secret), re-create the Vault cron key, re-apply tombstones, and run the smoke tests. Record the time taken as the measured **RTO**.
- **Targets:** RPO ≤ 24 h on Free (nightly dump); RTO ≤ 4 h (to be confirmed by the drill). On Pro, Supabase daily backups (7 days) add a second, faster restore path, and the R2 dumps continue as an independent copy.

---

## 9. Phased build plan (ClickUp-ready)

**Sizes:** **S** ≈ ½–1 day · **M** ≈ 2–3 days · **L** ≈ 4–5 days (one developer). "Δ vs v1" marks tasks that got **smaller (↓)**, **larger (↑)**, are **new (+)**, or are unchanged (=). Each row can become one ClickUp task, with its acceptance criterion as the checklist.

### Phase 0: Foundations and gates

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P0-1 | Repo (`app/`, `supabase/` migrations + functions, `shared/` Zod schemas), TypeScript, lint, Vitest, Playwright, pgTAP runner, generated DB types step, CI | S | = | — | CI green on a PR |
| P0-2 | Supabase staging + production projects in Frankfurt; CLI migrations from CI; **confirm `pg_cron`, `pg_net`, `pgmq` and Vault on Free**; Cloudflare static-assets deploy of the PWA | M | = | P0-1 | `supabase db push` + `wrangler deploy` from CI; extension check recorded |
| P0-3 | Schema v1 migrations: enums, tables, indexes, category-seed trigger, `dirty_month` | M | = | P0-2 | Migrations apply to a clean DB; seed per new company |
| P0-4 | Shared money/date library (agorot, banker's rounding, VAT net/gross, Israel time, `share_bp` splitter), used by the PWA and Edge Functions | S | = | P0-1 | Property tests; sums exact |
| P0-5 | PWA skeleton: React + Vite, React Router with lazy routes, TanStack Query + IndexedDB persister, vite-plugin-pwa, set up Tailwind v4 with tokens mapped to `@theme`, lint rule against arbitrary values, RTL (`dir="rtl"`, logical utilities), Rubik subset, Vaul, tab bar, CSP `_headers` | M | = | P0-1 | Installs on Android/iOS; offline shell loads; Home-route bundle size measured against 120 KB gzip; arbitrary values fail lint unless justified |
| P0-6 | **Gates:** `get_home` latency from Israeli 4G to Frankfurt vs Zurich; Edge Function CPU/wall with a 1,000-document CRM page; DB-size projection from 1 synthetic company-year | S | ↓ (replaces the Workers CPU gate) | P0-2, P0-3 | Report: p50/p95 latency, MB per company-year, region chosen |
| P0-7 | Job plumbing: `pgmq` queues, `dispatch_due()`, wake-up via `pg_net` only when a queue has work, `worker` Edge Function skeleton, dead-letter + alert; fallback `job` table if `pgmq` is missing | M | ↑ (new plumbing) | P0-2 | Test message processed once; redelivery idempotent |

### Phase 1: Auth and tenancy

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P1-1 | Google OAuth client (Web), Supabase Google provider, consent branding, redirect allow-list | S | = | P0-2 | Sign-in works on staging |
| P1-2 | supabase-js PKCE sign-in, `/auth/callback`, er-03/er-04 | S | ↓ (was a hand-built OIDC flow, M) | P1-1, P0-5 | Tests for cancel and failure paths |
| P1-3 | Custom Access Token hook (`company_id` claim), `company_member`, RPC `create_company(invite)`, `refreshSession` after onboarding, orphan purge | M | ↑ (new) | P0-3, P1-2 | JWT carries the claim; no invite = no company |
| P1-4 | Session handling: logout clears caches, offline refresh behaviour | S | ↓ (was sessions + signed claims, M) | P1-2 | Logout removes the session; offline keeps cached data |
| P1-5 | Onboarding 09a–09b (sign-in, company details incl. VAT mode) | M | = | P1-3 | Matches the design, RTL |
| P1-6 | **RLS on all tables** + Storage policies + CI "RLS enabled" check + two-tenant isolation tests in **pgTAP** (as `authenticated`) and Vitest (service-role helpers) | L | ↑ (was middleware + tests, M) | P0-3, P1-3 | Every table and bucket denies another company's rows |
| P1-7 | iOS installed-PWA sign-in spike: redirect vs Google ID-token button vs Safari fallback page | S | + | P1-2 | Chosen method passes on 2 iOS versions |

### Phase 2: Core ledger, manual entry, totals and Home

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P2-1 | Projects: create/edit, archive, search (05, 21, es-04) | M | = | P1-6 | Archive, never delete |
| P2-2 | Categories: hide, 2-step merge RPC (07, 22a/b, 23) | M | = | P1-6 | Merge moves allocations; nothing deleted |
| P2-3 | Manual entry (04) + transaction detail (10) + delete confirm (20) | M | = | P2-1, P2-2, P2-4 | Exact agorot; VAT fields |
| P2-4 | Ledger RPCs: `txn` / `payment` / `allocation`, unpaid logic, "mark as paid" (12), Σ share constraint trigger | L | = | P0-4, P1-6 | Tests for partial payments and credits |
| P2-5 | Aggregation in SQL: dirty-month triggers, `refresh_company_months`, `refresh_dirty` cron, snapshots with `version` | L | = | P2-4 | Incremental equals a full recompute on fixtures |
| P2-6 | Home (01) + period sheet (16) + `get_home(known_versions)` + change-pill and partial-data rules | M | = | P2-5 | Whole ₪ add up; unchanged → tiny response |
| P2-7 | Project screen (02) with budget block + categories | M | = | P2-5 | Budget hidden when not set |
| P2-8 | Client cache: TanStack Query persisted to IndexedDB (stale-while-revalidate), skeleton after 300 ms, offline notice (ld-01/08/09) | M | = | P2-6 | Airplane mode shows cached Home |

### Phase 3: SUMIT integration, read-only

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P3-1 | `sumitClient` (Edge Functions only): allowlist, Status 0/1/2 mapping, redaction, call log, CI guard | M | = | P0-7 | Non-allowlisted path throws |
| P3-2 | Envelope encryption (KEK secret, DEK, AES-GCM, `kek_version` re-wrap job); offline KEK copy procedure | M | = | P0-2 | No plaintext in DB or dumps |
| P3-3 | `reserve_sumit_call` SQL + degradation ladder | S | = | P0-3 | Concurrency test never exceeds the cap |
| P3-4 | `sumit-connect` function + UI; deny-all RLS on `sumit_connection`; status RPC; disconnect | M | = | P3-1..3 | Works on "Flow Test"; the key never returns |
| P3-5 | Backfill via queue (PageSize 1000) | S | ↓ (simpler paging, M before) | P3-4 | Test company fully imported; resumable |
| P3-6 | Document normaliser: folder → `doc_type`, counterparties, links, VAT status, `content_hash` | L | = | P3-5, P2-4 | Fixture tests per document type |
| P3-7 | Ledger derivation (invoices, receipts via net ratio, credits, 15/16/17, unpaid) | L | = | P3-6 | Test-company P&L matches a hand calculation |
| P3-8 | Daily poll, `request_refresh` (6 h), pull-to-refresh floor, weekly re-scan | M | = | P3-7 | Simulated month within the call budget |
| P3-9 | Budget-section → project mapping UI | S | = | P3-7 | Mapped docs auto-assigned at 100% |
| P3-10 | Schema-drift check + `documents/list` fallback | M | = | P3-6 | Simulated missing field → alert + fallback |
| P3-11 | `sumit-hook` function behind a flag, debounced | S | = | P3-8 | Flag off = 404; on = one debounced sync |

### Phase 4: Bank Hapoalim upload

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P4-1 | Collect 2–3 anonymised Poalim exports; format spec | S | = | — | Column map + samples in the repo |
| P4-2 | Phone parser (SheetJS lazy), header detection, balance check, er-01 | M | = | P4-1, P0-5 | Parses all samples; rejects others |
| P4-3 | Storage upload (private bucket, folder RLS) + RPC `import_bank_lines` with `on conflict` dedupe | S | ↓ (Storage + SQL replace an upload API, M) | P4-2, P1-6 | Same file twice → 0 new rows |
| P4-4 | Classification (transfers, cards, tax, own accounts) | M | = | P4-3 | 100% on the samples |
| P4-5 | Matching engine in `worker` (`pg_trgm` candidates, one-to-one, ambiguity → review) | L | = | P4-3, P3-7 | No double income on the test set |
| P4-6 | Recurring-customer project auto-open | S | = | P4-5 | Project + review item created |
| P4-7 | Processing screen (ld-05) + results (08) + onboarding 09c | M | = | P4-5 | Counters match the data |
| P4-8 | Retention cron: delete bank files after 90 days | S | + | P4-3 | Old files removed; lines kept |

### Phase 5: AI tagging, review queue, supplier memory, invoice photos

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P5-1 | Rules engine (steps 1–7) + Hebrew normaliser + category dictionary | M | = | P2-4 | Unit tests per rule |
| P5-2 | Evaluation set (150 items + 30 photos) + model bake-off | M | = | P4-1 | Report; model chosen |
| P5-3 | LLM tagging in `worker` via `@google/genai` (batches of 20, JSON schema, token budget, spend alarms) | M | = | P5-1, P5-2, P0-7 | Budgets enforced |
| P5-4 | Calibration + auto-approve policy + daily stats | M | = | P5-3 | No LLM auto-approve before 50 reviews |
| P5-5 | Review queue (03) + change sheet (06) with "remember" + es-03 | M | = | P5-4 | Approve/change/skip; counts update |
| P5-6 | Supplier memory (fixed / learned / demote) | M | = | P5-5 | 3 approvals → learned rule applies |
| P5-7 | Invoice photo: compress on the phone (browser-image-compression), Storage upload, `photo_extract` queue, Gemini vision, er-02, ld-06, match | L | = | P5-3, P4-5 | 95% field accuracy on the evaluation photos |

### Phase 6: Splits, overhead, unpaid, settings, export

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P6-1 | Split screen (11) + RPC | M | = | P2-4 | Shares total 100% |
| P6-2 | Recurring split rules + monthly income-share recompute in `refresh_company_months` | M | = | P6-1, P2-5 | Applies to new matching items |
| P6-3 | Overhead share view (18/19), default off | S | = | P2-5 | Home big number unchanged |
| P6-4 | Unpaid screen (12) + es-05 | S | = | P2-4 | Shows "לא נכלל ברווח" |
| P6-5 | Settings (14): company, Google account, bank, SUMIT, categories, projects, rules, notification times, auto-approve, overhead default, logout | M | = | P3-4, P5-4 | All settings persist |
| P6-6 | Export for the accountant (Excel/CSV, Hebrew headers, net + VAT columns) | M | = | P2-4 | Opens correctly in Excel |
| P6-7 | Date pickers (15a–c), confirm sheets (20–23) polish | S | = | P0-5 | Matches the design |

### Phase 7: Notifications, offline, performance, security, pilot

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P7-1 | Web Push: VAPID secrets, verify `web-push` in Deno (fallback: Deno-native library), subscribe after install (09e, 17a/b), cleanup | M | = | P0-5, P0-7 | Push on Android + installed iOS |
| P7-2 | Notification dispatch in SQL (Israel time, DST), Sunday summary, conditional nudge (13, es-08) | M | = | P7-1, P2-5 | No nudge when the queue is empty; DST test |
| P7-3 | Offline action queue + replay with `client_op_id` | M | = | P2-8 | Applied exactly once |
| P7-4 | Performance pass: bundle budget (Home ≤ 120 KB gzip target, CI check), Lighthouse CI, RUM, Playwright Hebrew mobile flows | M | = | P2-6 | LCP < 2 s (throttled) |
| P7-5 | Security review: CSP/XSS audit, RLS/Storage policy review, service-role usage audit, redaction, KEK rotation drill | M | = | P3-2, P1-6 | Checklist signed off |
| P7-6 | Privacy policy + terms (Hebrew), deletion flow with tombstones | M | = | P8-4 | Lawyer-reviewed text live |
| P7-7 | Pilot with 2–3 contractors | L | = | all | 2 weeks of daily use, no data errors |

### Phase 8: Backups and operations (new)

| ID | Task | Size | Δ vs v1 | Dep | Acceptance |
|---|---|---|---|---|---|
| P8-1 | Nightly dump workflow: `backup_reader` role, pooler connection, CLI dump (roles/schema/data) + manifest, zstd + age, R2 upload, lifecycle rules, failure alerts | M | + | P0-3 | 7 consecutive nightly dumps in R2; alert fires on a forced failure |
| P8-2 | Weekly Storage → R2 encrypted sync | S | + | P8-1, P4-3 | New photos appear in R2 within a week |
| P8-3 | `health()` RPC + daily health-check workflow | S | + | P0-7 | Alert on a simulated stuck queue |
| P8-4 | Monthly restore-test workflow + quarterly drill runbook (KEK, Vault key, tombstones) | M | + | P8-1 | Restore passes row counts + P&L checksums; RTO recorded |
| P8-5 | Usage monitoring + Pro-trigger alerts (DB size, egress, dump size, storage, Edge invocations) | S | ↓ (was D1/Queues monitoring, S) | P8-3 | Warn email at the §1.6 thresholds |
| P8-6 | Move-to-Pro runbook (plan change, enable daily backups, keep R2 dumps, staging on a Free org) + execute when triggered | S | + | P8-5 | Runbook tested on paper; executed at the trigger |

### Totals and what changed in size

| | v1 (Cloudflare) | v2 (Supabase) |
|---|---|---|
| Tasks | 61 (15 S, 39 M, 7 L) | **68 (22 S, 38 M, 8 L)** |
| Effort | ≈ 114–140 dev-days (23–28 dev-weeks) | **≈ 119–148 dev-days (24–30 dev-weeks)**: about 3.5–4 calendar months with two developers |

**Smaller:**
- Auth: P1-2 and P1-4, from M to S each.
- Bank file storage: P4-3, M to S.
- SUMIT paging: P3-5, M to S.
- The CPU gate: P0-6 now measures latency and size rather than working around a 10 ms limit.
- Design-wide: the "stay under 10 ms" constraints are gone.

**Larger:**
- RLS: P1-6, M to L.
- Job plumbing: P0-7, new.
- Tenant claim: P1-3, new.
- iOS sign-in spike: P1-7, new.
- Backups and restore: P8-1, P8-2, P8-4.
- Health check: P8-3.
- Pro runbook: P8-6.
- Retention cron: P4-8.

**Net:** roughly 1 week **more** than v1. Built-in auth and storage save about 1 week; RLS, job plumbing, the backup/restore pipeline and ops tasks add about 2.

**If a faster first pilot is needed:** defer P5-7 (invoice photos), P6-2, P6-3, P3-10, P3-11 and P8-2. Keep P8-1, P8-3 and P8-4: backups aren't optional on Free.

**Suggested ClickUp structure:** one List per phase; tags `backend` / `frontend` / `infra` / `ai` / `security` / `ops`; custom fields "Size" (S/M/L) and "Δ vs v1"; dependencies from "Dep".

---

## 10. Risks and open questions

### 10.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Free limits hit before the Pro move:** 500 MB DB, 5 GB egress (nightly dumps!), 1 GB storage | Medium / outage or throttling | §1.6 thresholds with early warnings (P8-5); move at the first paying customer or ~15–20 companies |
| R2 | **No automatic backups on Free:** a backup job fails silently, or a restore doesn't work | Medium / severe data loss | Nightly encrypted dumps + failure and size alerts (P8-1); monthly automatic restore test + quarterly drill (P8-4); Pro adds daily backups |
| R3 | **Tokens in browser storage (XSS):** supabase-js keeps the session in localStorage | Low–medium / account takeover | Strict CSP, no third-party scripts, no raw HTML, dependency audit, short JWT expiry (1 h default) |
| R4 | **Service role bypasses RLS:** a background-code bug leaks across tenants | Low / severe | Scoped repository helper, isolation tests, code review rule "no raw service-role queries" |
| R5 | **Consent screen shows `*.supabase.co`:** users distrust it | Medium / conversion | Brand verification (name/logo); Supabase custom domain on Pro ($10/mo) (Q4) |
| R6 | **Only 2 active Free projects:** staging + prod leave no spare | Certain / minor | Restore tests in CI containers; local Supabase CLI for development |
| R7 | **`pgmq` / Supabase Queues not available on Free** (not stated either way) | Low / rework | P0-2 check; `skip locked` job-table fallback with the same interface |
| R8 | **iOS PWA sign-in:** separate storage (re-sign-in after install); OAuth redirect may return to Safari | Medium / onboarding friction | Spike P1-7; ID-token alternative; Safari fallback page; onboarding copy |
| R9 | **Shared Free compute** (500 MB RAM) slows Home or backfills under load | Low / performance | Snapshot reads by primary key; the minute cron spreads bulk work; P0-6 gate; Pro Micro has 1 GB |
| R10 | **Cost jump to $25/mo at Pro** vs the original $5 cap | Certain / budget | Owner decision; trigger tied to revenue (first paying customer) |
| R11 | **Undocumented SUMIT CRM fields** change | Medium / sync breaks | Nightly drift check + `documents/list` fallback |
| R12 | **Customer's SUMIT plan** (Free has no API; triggers need Growth; budgets need Advanced) | High / reach | Bank + photo + manual work without SUMIT |
| R13 | **Assumed VAT on expenses** that arrive with no split | Medium / accuracy | `vat_status='assumed'` at the configurable 18% rate, VAT-exempt supplier memory, a subtle hint on the detail screen, no Home banner ([0043](../decisions/0043-assumed-vat-on-expenses.md)) |
| R14 | **Card settlement lines** double count | Medium / accuracy | `card_settlement` classification |
| R15 | **Hapoalim format variance** | Medium / upload fails | Header detection, sample library |
| R16 | **Storing full-access SUMIT keys** | Low / severe | Envelope encryption with the KEK outside the DB, dedicated key, no plaintext in dumps |
| R17 | **LLM misclassification** auto-approved | Medium / trust | Calibration, no LLM auto-approve in the first days |
| R18 | **Cash-basis semantics** differ from the accountant's expectations | Medium / trust | Accountant review before the pilot |
| R19 | **Privacy law** (Amendment 13) | Medium / launch | Lawyer review (P7-6); backup retention stated |
| R20 | **Vendor coupling** to Supabase-specific features | Low / exit cost | Plain Postgres schema + SQL functions; Auth users exportable; R2 dumps are standard `pg_dump` |

### 10.2 Open questions for the owner

1. **Q1: Pro trigger.** Move to Pro at the **first paying customer**, or only when a technical threshold (§1.6) is hit? The recommendation is whichever comes first.
2. **Q2: Triggers.** Confirm SUMIT triggers are skipped in M1 (decision 0036 forbids Flow registering them).
3. **Q3: Photo storage.** Keep invoice photos in Supabase Storage (1 GB on Free fills in ~4 months at 50 companies; not an issue on Pro's 100 GB), or put them in Cloudflare R2 (10 GB free) to delay the Pro move?
4. **Q4: Custom domain for Supabase Auth.** Pay $10/mo on Pro so the Google consent screen shows Flow's domain instead of `*.supabase.co`?
5. **Q5: App domain.** `workers.dev` for the pilot; buy a domain (`.com` ≈ $10.46–11.17/yr, or `.co.il`) before inviting customers?
6. **Q6: VAT on bank-only lines.** Decided by [0043](../decisions/0043-assumed-vat-on-expenses.md): a bank-statement line with no supplier match uses the same 18% default (net = gross / 1.18), unless the supplier is later marked VAT-exempt.
7. **Q7: Expenses with no VAT split.** Decided by [0043](../decisions/0043-assumed-vat-on-expenses.md). Do not show them gross with a "VAT unknown" marker, and do not ask in review. Assume 18% (`vat_status='assumed'`), or net = gross when the supplier is VAT-exempt. The demo client's Rule A is the target: net = gross / 1.18 for VAT-registered suppliers, gross for the exempt insurer `ביטוח המגן`.
8. **Q8: Cheques.** Receipt date (default) or cheque due date?
9. **Q9: Auto-approve.** 90% thresholds and a ₪5,000 new-supplier limit? Off in the first week?
10. **Q10: Nudge days.** Skip Saturdays and Jewish holidays?
11. **Q11: Retention.** Invoice photos and bank files: 7 years or until deleted? Backup retention of 30 days / 12 months OK?
12. **Q12: History.** Backfill current + previous tax year, or the current year only?
13. **Q13: Accountant export.** A specific import format, or generic Excel/CSV?
14. **Q14: Multi-user.** Confirm a single owner in M1.

---

## Appendix A: sources (checked 26 Sep 2026)

| Item | URL |
|---|---|
| Supabase pricing (plans, limits, compute, add-ons) | https://supabase.com/pricing |
| Supabase free-project pausing | https://supabase.com/docs/guides/platform/free-project-pausing |
| Supabase backups | https://supabase.com/docs/guides/platform/backups |
| Supabase Edge Functions limits | https://supabase.com/docs/guides/functions/limits |
| Supabase regional invocation | https://supabase.com/docs/guides/functions/regional-invocation |
| Supabase scheduling Edge Functions (pg_cron + pg_net) | https://supabase.com/docs/guides/functions/schedule-functions |
| Supabase Cron | https://supabase.com/docs/guides/cron |
| Supabase Queues (pgmq) | https://supabase.com/docs/guides/queues |
| Supabase Vault | https://supabase.com/docs/guides/database/vault |
| Supabase Storage access control | https://supabase.com/docs/guides/storage/security/access-control |
| Supabase Sign in with Google | https://supabase.com/docs/guides/auth/social-login/auth-google |
| Supabase user sessions | https://supabase.com/docs/guides/auth/sessions |
| Supabase regions | https://supabase.com/docs/guides/platform/regions |
| Cloudflare static assets billing | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| Cloudflare Pages pricing (static requests free) | https://developers.cloudflare.com/pages/functions/pricing/ |
| Cloudflare service-specific terms (CDN) | https://www.cloudflare.com/service-specific-terms-application-services/ |
| Cloudflare R2 pricing | https://developers.cloudflare.com/r2/pricing/ |
| Netlify pricing | https://www.netlify.com/pricing/ |
| Vercel pricing | https://vercel.com/pricing |
| GitHub Actions billing / free minutes | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| Gemini API pricing | https://ai.google.dev/gemini-api/docs/pricing |
| Gemini media resolution | https://ai.google.dev/gemini-api/docs/media-resolution |
| OpenAI API pricing (comparison) | https://developers.openai.com/api/docs/pricing |
| .com price (Cloudflare Registrar at cost) | https://www.cloudflare.com/application-services/products/registrar/buy-com-domains/ · https://tldes.com/pages/com-price-increase-2026 · https://domainoffer.net/tld/com/cloudflare |
| Web Push on iOS | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| Apple web push | https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers |
| SUMIT plans (customer side) | `/workspace/flow-tech/sumit-api-research.md` §6 |

## Appendix B: changes from v1 (Cloudflare) to v2 (Supabase)

| Area | v1 | v2 |
|---|---|---|
| Platform decision | Cloudflare Workers + D1 + Queues + R2, ≤ $5/mo | **Supabase Free → Pro ($25/mo)**; PWA on Cloudflare static assets; R2 only for backups |
| Pausing claim | "Supabase Free pauses after 1 week of inactivity" (a reason to reject it) | **Corrected:** pauses only with insufficient DB activity over 7 days; a few real requests a day prevent it; daily sync + health check make it a non-issue |
| Binding limits | Workers 10 ms CPU, D1 daily rows | DB 500 MB, egress 5 GB, storage 1 GB, 2 projects, no backups |
| Database | SQLite (D1), ULIDs, integer agorot | Postgres, `uuid`, `bigint` agorot, enums, `jsonb`, RLS by `company_id` |
| Aggregates | queue-driven rebuild | dirty-month triggers + synchronous refresh in RPCs + minute `pg_cron` |
| Auth | hand-built OIDC + PKCE + HttpOnly cookie sessions | Supabase Auth Google provider + PKCE; JWT with `company_id` claim; tokens in browser storage (stronger CSP needed) |
| Files | R2 via Worker API | Supabase Storage private buckets with folder RLS; retention unchanged |
| Background work | Cron Trigger + Cloudflare Queues | `pg_cron` + `pgmq` + `pg_net` → Edge Functions (2 s CPU, 150 s wall on Free) |
| SUMIT paging | 200 per page (CPU limit) | 1000 per page; ~55–70 calls/month per company |
| Front end | Vite + Preact + Workbox, Hono on Workers | React + Vite, React Router, TanStack Query (IndexedDB persist), vite-plugin-pwa, Vaul, date-fns (he), Zod; tests Vitest + Playwright + pgTAP (§1.4.1) |
| Key encryption | KEK as Worker secret | KEK as Edge Function secret (Vault only for the cron key) |
| Backups | D1 Time Travel (7 days on Free) | Nightly encrypted `pg_dump` to R2 via GitHub Actions, weekly Storage sync, monthly restore test |
| Cost at 50 companies | ≈ $1.6–2.5 | ≈ $26.6–27.5 on Pro |
| Build effort | 61 tasks, 23–28 dev-weeks | 68 tasks, 24–30 dev-weeks |
