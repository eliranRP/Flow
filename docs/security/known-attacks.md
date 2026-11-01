# Stage 1: known attacks checklist

The security agent ([runbook](../runbooks/security-scan.md)) checks every item below on each run: on the day's diff every day, and on the whole repo once a week. Each item names where it applies in Flow and how to check it. A hint in `code` is a starting search, not the whole check: read the code it finds and follow the data from input to sink.

The protections already in place are listed so that a change that removes one is caught. "Keep" means: flag any diff that weakens it.

Severity guide: **Critical**: one company reads or changes another company's data, an account takeover, or a secret leaks. **High**: the same with a precondition the attacker can usually meet, or code runs in the user's browser. **Medium**: needs an unusual precondition, or exposes only metadata. **Low**: hardening.

## A. Injection

| ID | Attack | Where in Flow | How to check |
| --- | --- | --- | --- |
| A1 | SQL injection in dynamic SQL | plpgsql `EXECUTE` in `supabase/migrations/` | `rg -n -i "execute\s+(format\|'\|\")" supabase/migrations`. Safe: `format()` with `%I` for names and `%L`, or `USING $1`, for values. Unsafe: `%s` with any value that a caller can reach, or `\|\|` string building. |
| A2 | PostgREST filter injection | `.or(...)`, `.filter(...)`, `.textSearch(...)` built from user text in `app/src` and `supabase/functions` | `rg -n "\.or\(\`\|\.filter\(\`" app/src supabase/functions`. A comma, parenthesis or `.` in the user's text changes the filter. Pass values as arguments, or use an RPC. |
| A3 | LIKE / ILIKE wildcard injection | Search RPCs and `search_transactions` | User text in `like` without escaping `%`, `_` and `\`. Low on its own; High if the search then skips the company filter. |
| A4 | Command or code injection | Edge functions and `scripts/` | `rg -n "Deno\.Command\|new Function\|eval\(\|child_process\|execSync" supabase/functions scripts`. Any input that reaches them. |
| A5 | Formula (CSV) injection in exports | `_shared/report_csv.ts`, `_shared/report_xlsx.ts` | A payee, memo or category that starts with `=`, `+`, `-`, `@`, tab or CR must not reach a spreadsheet as a formula. Check that text cells are escaped, and that negative amounts stay number cells. |
| A6 | Email header and HTML injection | `invite-email`, `_shared/invite_email.ts` | CR/LF in a name or email address must not add headers; names are HTML-escaped in the body; the link is built from config, not from a request header. |
| A7 | Stored XSS | `app/src` (React), `app/public/push-sw.js`, file previews | `rg -n "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|insertAdjacentHTML\|document\.write" app`. `href`/`src` from data must refuse `javascript:` and `data:`. Uploaded SVG or HTML must not be served inline from the app's origin. |
| A8 | Prototype pollution | JSON from MCP tool args, connector responses, `Object.assign` / spread / deep merge | `__proto__`, `constructor` and `prototype` keys in parsed input; tool args are validated with zod `strict()` or an allow-list of keys. |
| A9 | ReDoS | Regexes on user text (search, import parsing, Hebrew name matching) | Nested quantifiers like `(a+)+` or `(.*)*` on text a user controls; a `new RegExp(...)` from input without escaping. |
| A10 | Path traversal | Storage object keys, file names in uploads and reports | `..`, `/`, `\` and NUL in a name that becomes a path or a storage key; keys always start with the company's own prefix. |
| A11 | Log injection and secrets in logs | `console.*` in edge functions, error bodies | `rg -n "console\.(log\|error\|warn)" supabase/functions`. No token, key, account or routing number, JWT, or raw provider response with them. Errors returned to clients don't echo internals (SQL text, stack). |

## B. Authentication and access control

| ID | Attack | Where in Flow | How to check |
| --- | --- | --- | --- |
| B1 | Broken object-level authorization (IDOR) between companies | Every RPC and `flow-mcp` tool that takes `company_id`, a row id, `invoiceId`, `itemKey`, a batch id | The function finds the company from the caller (`auth.uid()` membership), never from the argument alone. Each new one has a cross-tenant pgTAP or Deno test with a positive control (the owner still gets their own row). |
| B2 | Missing or weak RLS | New tables, views, materialized views | Every table in an exposed schema has `enable row level security` (and `force` where the repo does). Policies use `auth.uid()` and the membership table. A view has `security_invoker = true` or is not exposed. Check `anon` grants. |
| B3 | `SECURITY DEFINER` abuse | 200+ definer functions in migrations | Each one has `set search_path = ''` (or a fixed list) and schema-qualified names; `revoke execute ... from public, anon` unless meant to be public; it checks the caller itself before it touches data. |
| B4 | Auth bypass in functions with `verify_jwt = false` | `supabase/config.toml` and each function's entry | Each path checks its own credential: the cron header, the service key, the user's JWT, or the MCP bearer. It fails closed when the env var is empty. Keep: `_shared/constant-time.ts` for every secret compare. |
| B5 | JWT validation | `_shared/jwt.ts`, `_shared/owner.ts` | Signature checked with a pinned algorithm (no `none`, no HS/RS confusion); `exp`, `aud`, `iss` checked; the token comes from the `Authorization` header, never from a URL. |
| B6 | MCP token scope and storage | `flow-mcp/handler.ts`, `flow-mcp/sign.ts` | Tokens stored peppered and hashed (`FLOW_MCP_PEPPER`); a read token can't call a write tool; revoked or expired tokens fail; tokens bind to one company. |
| B7 | Privilege escalation and mass assignment | Team roles, owner, invite acceptance; PostgREST `PATCH` on tables; update RPCs that take a JSON row | A member can't change their own role, `company_id`, `owner`, `created_by` or any flag that relaxes a check (see the code checklist). Update RPCs take an allow-list of columns. |
| B8 | Invite token weaknesses | Invites flow, `/invites` route | Tokens are random (from `crypto`, not `Math.random`), single-use, expire, are bound to the invited email, and are compared in constant time. Accepting twice, or racing two accepts, gives one membership. |
| B9 | OAuth and connector connect flaws | `mercury-connect`, `sumit-connect`, `/auth/*` | `state` is checked (CSRF); `redirect_uri` and any `next=` value are on an allow-list (open redirect); a code or token from one company can't attach to another. |
| B10 | Idempotency key and undo misuse | MCP write tools, `undo` / `undo_batch` | Keys are scoped to company and tool (a key reused by another company does not return their result); undo refuses a batch from another company or one changed since. |
| B11 | Missing rate limits | Auth-adjacent endpoints, invite send, push test, MCP writes | Each write path has the shared write limit; email and push senders can't be used to spam. |

## C. Headers, browser, and transport

| ID | Attack | Where in Flow | How to check |
| --- | --- | --- | --- |
| C1 | Content Security Policy gaps | `app/public/_headers`, `scripts/security-headers.mjs` (decision 0192) | The CSP is report-only today: note on the weekly scan whether the plan to enforce it moved. Flag new `unsafe-inline`, `unsafe-eval`, wildcard `connect-src` or `script-src`, and new third-party origins. |
| C2 | Clickjacking and missing headers | `_headers` | Keep: `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`. Every new extensionless route gets its `Content-Type` line. On the weekly scan, `curl -sI` the live Pages site (a read, nothing else) and compare. |
| C3 | CORS misconfiguration | Edge function responses, `_shared/http.ts`, `FLOW_MCP_APP_ORIGINS` | No reflected `Origin`; no `*` with credentials; the origin check is an exact match, not `startsWith`, `includes` or an unanchored regex. |
| C4 | Host and forwarded header trust | Any URL built from `Host`, `X-Forwarded-Host`, `Origin` or `Referer` | Invite, reset and redirect links come from config. A spoofed header must not change a link sent by email (link poisoning). |
| C5 | Service worker abuse | `app/public/push-sw.js` | A notification click opens only same-origin paths; the payload can't set an external URL; the worker caches no authenticated response. |
| C6 | Token theft through XSS | Supabase session in browser storage | Because the session is readable by script, any A7 finding is High or Critical. |
| C7 | Open redirect | `app/public/_redirects`, router `next`/`return` params | Only relative, same-origin paths are followed. |

## D. Server-side requests, secrets, and crypto

| ID | Attack | Where in Flow | How to check |
| --- | --- | --- | --- |
| D1 | SSRF | `fetch(` in edge functions; web push endpoints in `_shared/webpush.ts` and `push_send.ts`; connector base URLs | A URL the user supplies (a push subscription endpoint is one) must be `https`, must not resolve to a private, loopback or link-local address, and must not follow redirects there. |
| D2 | Webhook authenticity and replay | Any incoming provider callback | Signature checked over the raw body, in constant time, with a timestamp window and replay protection. |
| D3 | Envelope encryption misuse | `_shared/envelope.ts`, `SUMIT_KEK`, `MERCURY_KEK`, `sumit-reseal` | AES-GCM with a fresh random IV every time; the key never leaves the function or reaches a log; a decrypt error doesn't reveal which part failed; reseal can't be triggered by a user. |
| D4 | Weak randomness | Tokens, invite codes, idempotency keys | `rg -n "Math\.random" supabase/functions app/src packages`. Anything that guards access uses `crypto.getRandomValues` or `gen_random_uuid()`. |
| D5 | Secrets in the repo or the bundle | Whole repo, built app | Keep: `scripts/check-deny-list.mjs`, `scripts/check-prod-bundle.mjs`. Search for key shapes (`sk_`, `eyJ` JWTs, `-----BEGIN`, `service_role`, 40-character hex) and `.env` files. Use the GitHub `run_secret_scanning` tool when it's available. Never print a value you find; give the file and the type. |
| D6 | Service role reachable from user input | Functions that create a client with the service key | A user-supplied id never reaches a service-role query unless the function checked membership first. |

## E. Business logic (money and state)

| ID | Attack | Where in Flow | How to check |
| --- | --- | --- | --- |
| E1 | Amount tampering | Money in minor units (`packages/shared/src/money.ts`) | No floats; bounds on amounts; a negative or huge amount can't flip a sign check, overflow `int`, or slip past a split total. |
| E2 | Race conditions and TOCTOU | Idempotency check-then-insert, invite accept, undo, rate limits, connect | Uniqueness is enforced by a constraint or a lock, not by a `select` then `insert`. Try two parallel calls in a test. |
| E3 | Excessive data exposure | RPC and MCP return shapes | No tokens, secrets, other users' emails or internal ids in a response the caller doesn't need. |
| E4 | Resource exhaustion | List RPCs, MCP list tools, report generation | Page size has a maximum; a report can't be asked for an unbounded range; an import file has a size limit. |

## F. Supply chain and CI

| ID | Attack | Where in Flow | How to check |
| --- | --- | --- | --- |
| F1 | Vulnerable dependencies | `pnpm-lock.yaml`, Deno imports | `pnpm audit --prod` and `pnpm audit`. Dependabot and the daily Dependabot review handle routine bumps; this agent fixes what they haven't, Critical first. Dependabot doesn't cover the Deno imports (`.github/dependabot.yml`), so check those by hand against their advisories. |
| F2 | Unpinned remote imports | Each function's `deno.json` and `import_map.json` under `supabase/functions/` (`esm.sh`, `npm:`, `jsr:`) | Every import is pinned to an exact version. Flag new unpinned or `@latest` imports. |
| F3 | GitHub Actions injection | `.github/workflows/` | No `pull_request_target` that checks out the head; no `${{ github.event.* }}` text (titles, bodies, branch names) inside `run:`, which must go through `env:`; least `permissions:`; fork PRs get no secrets. Keep: actions pinned by full SHA. |
| F4 | Install-time code | `package.json` scripts, `patches/`, new dependencies | New `postinstall`/`prepare` scripts in dependencies; every file in `patches/` is reviewed when it changes. |
| F5 | Lockfile and override tampering | `pnpm-lock.yaml`, `pnpm.overrides` | A diff that changes a resolved URL or integrity hash without a version bump. |

## G. AI agents and MCP

Flow is MCP-first ([0095](../decisions/0095-mcp-first.md)), so the data an agent reads is an input an attacker controls.

| ID | Attack | Where in Flow | How to check |
| --- | --- | --- | --- |
| G1 | Prompt injection through stored data | Memos, payee names, file names and notes returned by `flow-mcp` read tools | Tool output marks user text as data. A write that a read could have triggered still needs the idempotency key and undo. Note any tool description that tells an agent to trust the data it returns. |
| G2 | Tool scope creep | New `flow-mcp` tools | A new tool registers as read or write correctly; a "read" tool doesn't change anything. |
| G3 | Confused deputy through the agent's token | MCP tools that act for the owner | A tool can't be steered into another company by an argument, even with a token that has access to several. |

## Adding to this list

When a Stage 2 hunt finds a new kind of bug, add it here as a row (with the next ID in its section), so every later run checks it. Write the row in general terms: where the risk lives and how to check it, never a working exploit for code that isn't fixed yet.
