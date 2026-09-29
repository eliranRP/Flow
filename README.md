# Flow

Flow is a mobile-first way for Israeli project-based businesses to see project profit and loss: income, expenses, and the bottom line. The proof of concept is for owners of small and mid-size construction contractors. The same model is meant to fit any project-based business after that.

This repository is the product home: the Hebrew PWA (`app/`), the Supabase schema (`supabase/`), and the shared P&L module (`packages/shared`). Product decisions and the approved design stay under `docs/` and `design/`.

Amounts are in shekels (₪), shown net of VAT, with VAT tracked beside them. This phase is Hebrew only, right to left. The owner signs in with a Google account (Gmail), on an installable phone web app. There is no desktop version in this phase. The owner confirms what the product suggests instead of typing a classification for every shekel.

## What the owner gets

Two levels, and they always add up:

- **Company.** Every project, plus company overhead (`הוצאות כלליות`).
- **Project.** One job (one segment of the business), with its own income, expenses, and profit.

Every shekel sits on exactly one project, or on overhead. Projects plus overhead equal the company total.

Money is counted on a cash basis. A bank row, or a cash or cheque payment the owner records, is what enters the P&L. An invoice is the supporting document. An invoice with no matching payment stays unpaid and out of the P&L until a statement row matches it, or the owner marks it paid.

The owner is on site most of the day, so the product is a phone UI: bottom navigation in the thumb zone, large tap targets, and a review queue that can be cleared in a few taps.

## How data gets in

1. Photos or a PDF of an expense invoice, taken in a row or picked from files on the phone. Android can also share an image or PDF into the installed app. iPhone cannot. The product reads supplier, amount, VAT, date, and invoice number, and checks for a duplicate.
2. The SUMIT sync. Bank transactions come only through that sync. There is no Bank Hapoalim statement upload ([0065](docs/decisions/0065-review-round5.md) point 40).
3. Manual entry, for cash and cheques.

The first data integration is the SUMIT API (sumit.co.il). Flow pulls data from SUMIT ([0035](docs/decisions/0035-sumit-api-first.md)) and does not write back ([0036](docs/decisions/0036-sumit-read-only.md)). SUMIT is the source for income and expenses, including bank lines ([0042](docs/decisions/0042-sumit-primary-income-and-expenses.md), amended by [0065](docs/decisions/0065-review-round5.md) point 40). Amounts are before VAT ([0041](docs/decisions/0041-amounts-before-vat.md)). An expense with no VAT split assumes 18% unless the supplier is VAT-exempt ([0043](docs/decisions/0043-assumed-vat-on-expenses.md)). The verified notes are in [SUMIT API research](docs/tech/sumit-api-research.md).

Suggestions follow a fixed order: link a bank row to an existing invoice (amount, date, supplier), then apply a learned supplier rule, then an AI guess. A deposit from a client is suggested onto that client's project. A high-confidence match (an invoice or a learned rule) is auto-approved, skips the review queue, and appears in a short summary the owner can reopen and change. Everything else waits in the review queue. Only approved transactions appear in reports. A pending-count banner stays visible while the numbers can still move.

Correcting a suggestion can become a rule ("remember for this supplier" is on by default): supplier X goes to project Y and category materials, and the next invoice from that supplier is classified the same way.

## Proof of concept

In scope: company and project P&L for a single user (the owner) on an installable mobile web app, Hebrew only, sign-in with a Google account (Gmail), invoice photos, manual entry, and a read-only pull from the SUMIT API as the source of income, expenses, and bank lines, review and rules, auto-approve for high-confidence rows, two notifications (a Sunday summary and an end-of-day review nudge), Home periods of this month, last month, and year to date, a flat category list, optional project budgets, project and category pickers that still work with many jobs, and an Excel export for the accountant. AI tagging stays off until a Gemini key is configured, under a $3 hard cap. Running cost of the whole system is at most $5 per month for the pilot. Supabase Pro is about $27 per month once the pilot is growing. Home is usable within 2 seconds on a mid-range phone on 4G ([0033](docs/decisions/0033-google-sign-in.md), [0034](docs/decisions/0034-cost-and-load-limits.md), [0037](docs/decisions/0037-supabase-pilot.md), [0035](docs/decisions/0035-sumit-api-first.md), [0036](docs/decisions/0036-sumit-read-only.md)).

Out of scope: a desktop site, native iOS or Android apps, another language at launch, email and password, a notification per transaction, a WhatsApp or email forwarding address, replacing the accountant's books, VAT filing, payroll, invoicing, Morning or iCount, open banking, a Bank Hapoalim statement import and any other bank or credit-card statement file, roles and permissions, multi-currency, progress billing and retention, and category sub-groups. A Hashavshevet-compatible export can follow the Excel export. Official double-entry books and the balance sheet stay with the accountant. A custom range is in scope from the period sheet ([0028](docs/decisions/0028-period-sheet-with-custom-range.md)).

Default expense categories, preloaded: `חומרים` (materials), `קבלני משנה` (subcontractors), `עבודה` (labor), `ציוד והשכרה` (equipment and rental), `הובלה` (transport), `ביטוח` (insurance), `אחר` (other). Income categories: `תקבול מלקוח` (payment from a client), `הכנסה אחרת` (other income).

Success, for the proof of concept: a first project P&L within 15 minutes of signup; at least 80% of AI suggestions accepted unchanged after the first month; a daily review under 5 minutes; no transaction left untagged.

## Run locally

Requirements: Node.js 22, pnpm 10, and the [Supabase CLI](https://supabase.com/docs/guides/cli) when you want to apply migrations. Docker is required for `supabase start`. The pgTAP suite can also run without Docker.

```bash
pnpm install
cp .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the Supabase dashboard.
# Do not commit .env. Do not put the service-role key in the PWA.
pnpm dev
```

The dev server listens on port 43123. `/reviewer` is sample data for a design or PR review: a queue with a shared cost, today's filed list, a category drill-down, the queue filtered to one project, and saves that succeed (`?save=ok`), that are refused (`?save=fail`), or that drop the connection (`?save=offline`). Every screen says נתוני דוגמה · Example data. The route is omitted from the hosted build. Decision [0073](docs/decisions/0073-review-handoff.md). Signed-out visitors go to the sign-in screen. Component review is Storybook (`pnpm storybook`, port 6006), not an app route. Decision [0058](docs/decisions/0058-storybook.md). The library rule is [0057](docs/decisions/0057-component-library.md). `/?preview=1` opens Home in demo mode without a session. `?preview=loading`, `?preview=empty`, `?preview=error`, and `?preview=error-server` show those Home states. Sign-in help writes to `HELP_EMAIL` in `app/src/config.ts`. The help page and its test import that constant. Sign-in uses Supabase Auth with the Google provider. Create the OAuth client in Google Cloud and paste the client id and secret into the Supabase dashboard (Authentication → Providers → Google). Until that exists, the sign-in screen renders and the button reports that the provider is not ready. The hosted project is `sxqpnetmtufkzowutduq` in `eu-central-1` (Postgres 17). Migrations are not applied from this repo's automation; review them, then run `supabase link` and `supabase db push` yourself.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm db:test          # pgTAP via the Supabase CLI. Needs Docker. CI pins CLI 2.118.0 and runs supabase db start first.
pnpm db:test:local    # same suite with pg_prove --verbose on local Postgres 17. Migration first, then pgTAP. No Docker.
pnpm check:bundle     # after pnpm build: the client graph and dist import no fixture JSON
pnpm build-storybook && pnpm test:storybook:smoke   # every static story opens with no console error
pnpm test:e2e:live    # local Supabase plus the live SUMIT test company. See the SUMIT runbook.
pnpm --filter @flow/app exec playwright test -c playwright.drain.config.ts   # local drain. Needs CRON_SECRET in supabase/.env.
pnpm latency          # times get_home() against SUPABASE_URL
```

Production builds read `app/.env.production` ([0046](docs/decisions/0046-public-anon-key.md)): the hosted URL and the public anon key. Do not put a service-role key in that file or anywhere else in git.

After the phase-1 migration is applied, the first Google sign-in opens the company form and calls `create_company`. A user who already has a company skips it. Connecting SUMIT and checking the golden numbers is [docs/runbooks/sumit-connect.md](docs/runbooks/sumit-connect.md). The hosted database is not seeded with fixture documents.

`pnpm test` loads `packages/shared/fixtures/demo-data.json` and checks the derivation against `expected-pnl.json`. That JSON is the answer key. The app does not import it, and `pnpm check:bundle` fails the build if `app/dist` contains it.

`packages/shared/src/database.types.ts` is untouched output of Supabase CLI 2.118.0 (`--schema public`). That CLI generates types in-process and does not pass a PostgREST version, so `--local` and `--db-url` both omit `__InternalSupabase`. The PostgREST tag for this CLI is `flow-postgrest-version` in `supabase/config.toml` (16.3). `scripts/check-db-types.sh` passes it as `--postgrest-version` once the CLI accepts the flag, which keeps a local `--db-url` check byte-identical to CI's `--local`. CI runs that diff after `supabase test db`. The app imports `Database` from `@flow/shared`, which omits SUMIT ciphertext columns.

```bash
supabase gen types typescript --db-url "$DATABASE_URL" --schema public > packages/shared/src/database.types.ts
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/flow_pgtap pnpm db:types:check
```

The migration revokes the default `EXECUTE` privilege from `PUBLIC` for every future function, with no schema limit. A function added later is not callable until the migration grants it. Each new function in `public` or `private` needs `grant execute on function ... to authenticated`, and to `service_role` when the server should call it.

## Documentation

| Document | What it is |
| --- | --- |
| [Module 1 spec](docs/module-1-project-pnl/spec.md) | Product behavior, data model, scope, success metrics |
| [Calculations](docs/module-1-project-pnl/calculations.md) | Income, expenses, profit, margin, periods, rounding |
| [Screens](docs/module-1-project-pnl/screens.md) | One section per wireframe, with links to the detailed specs |
| [Settings (Draft)](docs/module-1-project-pnl/settings.md) | Proposed Settings screen, not approved |
| [Wireframes](docs/module-1-project-pnl/wireframes/README.md) | PNG files, version, and approved / superseded status |
| [UI directions](docs/module-1-project-pnl/design/README.md) | Superseded exploration (styles A/B/C, then Mercury). Not the approved system |
| [Approved design](design/README.md) | V1 Violet package: screens, states, system, and logo. [Implementation guide](design/system/implementation-guide.md) is mandatory. [Logo](design/logo/LOGO.md) |
| [Technical plan](docs/tech/tech-plan.md) | Supabase pilot. The Cloudflare version is superseded |
| [Decisions](docs/decisions/README.md) | Decision records 0001–0043 and the record format |
| [Open questions](docs/open-questions.md) | What is not decided yet |
| [Changelog](docs/changelog.md) | Dated log of documentation changes |
| [Contributing](CONTRIBUTING.md) | How to change docs, decisions, and wireframes |

The approved screen set is review, add, the projects list, the v2 change sheet, categories, and upload results. Home v4 (after an overhead share), project v2, and split v2 are in the repo and pending owner approval, as are onboarding, transaction detail, unpaid invoices, and notifications. Earlier Home, project, and split images are kept and marked superseded.
