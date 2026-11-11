# Stage 2: zero-day patterns to hunt

Stage 1 ([known attacks](known-attacks.md)) checks for bugs that already have a name. Stage 2 looks for the ones that don't. Most famous zero-days were not new kinds of bug. They were an old idea found in a place nobody had looked. Each entry below boils a real incident down to its **pattern**, then says where that pattern could live in Flow and how to look for it.

How the agent uses this file ([runbook](../runbooks/security-scan.md#stage-2-creative-hunt)):

1. Pick the patterns that fit what changed (daily) or all of them in turn (weekly; at least six a week, the ones not tried for longest first).
2. For each, write one hypothesis: "if an attacker does X at Y, then Z".
3. Try to prove it wrong by reading the code and, where it can be done locally, with a test. A hypothesis is a finding only once a test or a precise trace shows it.
4. Weekly: read about two or three new advisories from the last month for the stack (Postgres, PostgREST, Supabase Auth and Storage, Deno, React, Vite, Cloudflare Pages, web-push, zod, the Mercury and SUMIT APIs). Add each one's pattern below if it's new.

## Patterns

### P1. Data that turns into code
- **Seen in:** Log4Shell (CVE-2021-44228): a logged string was parsed as a lookup and loaded remote code. MOVEit Transfer (CVE-2023-34362): SQL injection in a file transfer product led to mass data theft.
- **Pattern:** a value that passes through one layer as plain text is read as instructions by a later one.
- **In Flow:** a payee name, memo or category that later reaches `format('%s')` in plpgsql, a spreadsheet cell (formula), an email body, a push notification, a regex, or an LLM through an MCP read (P12). Look hardest at second-order paths: stored today, interpreted by a job tomorrow (Jev tagging, reports, the evening push).
- **Hunt:** list every sink that interprets text. For each, trace back whether a user can reach it, even through a stored row or a connector import.

### P2. An internal flag that the outside can set
- **Seen in:** Next.js middleware bypass (CVE-2025-29927): a header meant for internal subrequests skipped authorization when a client sent it. Fortinet (CVE-2022-40684): a request that looked like it came from an internal component was trusted.
- **Pattern:** a header, parameter or column means "this is trusted" and nothing stops a client from sending it.
- **In Flow:** the `x-flow-cron` header and service-key paths in functions with `verify_jwt = false`; any `is_internal`, `source = 'connector'` or `skip_*` argument on an RPC; columns that relax a check.
- **Hunt:** for every trust signal, ask who can set it. Call the path with it and without the secret. It must fail closed when the env var is empty or missing.

### P3. The setup path that stays open
- **Seen in:** Confluence (CVE-2023-22515): the setup endpoint could be reached again after setup and created an admin.
- **Pattern:** a step meant to run once (onboarding, first owner, connect, reseal) can be run again, or by the wrong person, later.
- **In Flow:** company creation and first owner, `/setup/*`, connector connect and reconnect, `sumit-reseal`, invite acceptance.
- **Hunt:** run each one-time action a second time, as a member rather than the owner, and after the company is already set up.

### P4. setuid code that trusts its environment
- **Seen in:** PostgreSQL (CVE-2018-1058): a function that resolved names through `search_path` could be hijacked by an object a user created.
- **Pattern:** code with raised privileges looks up names, settings or callers from somewhere the user controls.
- **In Flow:** `SECURITY DEFINER` functions (B3), and edge functions that use the service key (D6).
- **Hunt:** for a definer function changed today, check `search_path`, schema-qualified names, and that it reads the caller from `auth.uid()`, not from an argument.

### P5. Two parsers disagree
- **Seen in:** Orange Tsai's "A New Era of SSRF" (2017): URL parsers that disagree on what the host is. HTTP request smuggling. PostgreSQL quoting with invalid UTF-8 (CVE-2025-1094), used in a real attack chain.
- **Pattern:** the check reads the input one way and the code that acts on it reads it another way.
- **In Flow:** the origin allow-list against `new URL()`; a push endpoint URL that's checked and then fetched; an email checked in the app and then compared in SQL; JSON with duplicate keys checked by zod and then read raw.
- **Hunt:** feed the same input to both sides: `https://allowed.example@evil.example`, `https://allowed.example.evil.example`, mixed case, a trailing dot, `%2e`, duplicate keys, invalid UTF-8.

### P6. Text that looks like something else
- **Seen in:** Trojan Source (CVE-2021-42574): bidirectional control characters made code read differently from how it runs. GitHub (2019, write-up "Hacking GitHub with Unicode's dotless 'i'" by John Gracey): the dotless `ı` mapped to `i` when an email was case-folded, so a password reset went to the wrong address.
- **Pattern:** Unicode normalization, case mapping, or direction marks make two different values look, or compare, the same.
- **In Flow:** this is a Hebrew, right-to-left app, so text direction and normalization matter more than usual: user-entered names, email matching and de-duplication.
- **Hunt:** names with bidi controls, zero-width characters and homoglyphs. Check that the code compares normalized values, and that the screen shows a name exactly as it's stored, inside `<bdi>`.

### P7. An argument shape nobody expected
- **Seen in:** GitLab (CVE-2023-7028): a reset request that took an array of emails sent the reset link to the attacker's address too. GitHub (2012) mass assignment through Rails. Spring4Shell (CVE-2022-22965): data binding reached internal properties.
- **Pattern:** an API binds more of the request than it meant to, or a different type than it checked.
- **In Flow:** MCP tool args and RPC JSON args: an array where a string is expected, extra keys, `__proto__`, a `company_id` inside a nested object.
- **Hunt:** check that each new tool's zod schema is `strict()` and typed exactly. Send arrays, nulls, extra keys and nested ids.

### P8. A race in the state machine
- **Seen in:** James Kettle's "Smashing the state machine" (2023): requests sent in a single packet beat limits and one-time checks.
- **Pattern:** check-then-act with no lock, so two parallel requests both pass the check.
- **In Flow:** idempotency keys, rate limits, invite accept, undo, connector connect, "only one owner".
- **Hunt:** find `select ... then insert/update` without a unique constraint or `for update`. Prove a race with two concurrent calls in a pgTAP or Deno test.

### P9. Trusting where a request goes
- **Seen in:** Capital One (2019): an SSRF reached the cloud metadata service and its credentials.
- **Pattern:** the server fetches a URL that a user influences.
- **In Flow:** web push subscription endpoints (the user's browser supplies them), connector base URLs, any `import-from` URL.
- **Hunt:** D1 in Stage 1, plus redirects, DNS names that resolve to private addresses, IPv6 and decimal IP forms.

### P10. An id that isn't checked
- **Seen in:** the Optus breach (2022, Australia): an internet-facing API returned customer records with no authentication, as the Australian Information Commissioner's 2024 court case against Optus describes.
- **Pattern:** a resource is fetched by id, and the id is taken as proof of access.
- **In Flow:** every route param (`invoiceId`, `itemKey`, `partyId`, project ids) and every MCP id argument. The risk is highest on new screens, which add new RPCs.
- **Hunt:** B1. For each new RPC, call it as a member of company B with an id from company A, in a test.

### P11. A cache serves one person's page to another
- **Seen in:** Omer Gil's web cache deception (2017): a private page was cached because the URL looked like a static file.
- **Pattern:** a cache decides what's public by the path, not by the response.
- **In Flow:** the Pages SPA fallback in `_redirects`, the service worker's cache, CDN caching of function responses.
- **Hunt:** check `Cache-Control` on responses that carry data, and that the service worker caches only static build files.

### P12. Instructions hidden in data that an agent reads
- **Seen in:** prompt injection through MCP (public research, 2025): text in an issue or a document told an AI agent to use its tools against its user. Tool poisoning: instructions hidden in tool descriptions.
- **Pattern:** an LLM with write tools reads text that an outsider wrote.
- **In Flow:** memos, payee names, invoice text and file names from connectors (Mercury, SUMIT), returned by `flow-mcp` read tools to the data agent, which holds a write token.
- **Hunt:** G1 to G3. Check that writes still need idempotency keys and undo, and that bulk writes need the owner's approval (the data agent's rule). Never test this against real data.

### P13. A trusted dependency turns hostile
- **Seen in:** the xz-utils backdoor (CVE-2024-3094); event-stream (2018); tj-actions/changed-files (CVE-2025-30066), whose tags were moved to a commit that leaked CI secrets; the Shai-Hulud npm worm (2025).
- **Pattern:** code you didn't write runs with your secrets.
- **In Flow:** CI actions (pinned by SHA: keep it), `esm.sh` and `npm:` imports in edge functions, install scripts, `patches/`.
- **Hunt:** F1 to F5. On the weekly scan, list every dependency added since last week and whether it has install scripts.

### P14. A crypto detail goes wrong
- **Seen in:** padding oracles; AES-GCM nonce reuse (it reveals the key stream and allows forgeries).
- **Pattern:** the primitive is fine, but the way it's used is not.
- **In Flow:** `_shared/envelope.ts`, KEK resealing, MCP token hashing, push VAPID keys.
- **Hunt:** D3 and D4. Check that the IV is random every time and never derived, that errors are uniform, and that comparisons are constant time.

### P15. A size or length that's trusted
- **Seen in:** Heartbleed (CVE-2014-0160): the server trusted a length field the client sent and returned memory past the buffer.
- **Pattern:** a client sets a count, a limit or a range, and the server uses it as is.
- **In Flow:** page sizes, date ranges in reports, `limit` in MCP list tools, import row counts, upload sizes.
- **Hunt:** E4. Send huge, negative and zero values, and check that the server caps them.

### P16. Many addresses share one cache entry
- **Seen in:** web cache poisoning and web cache deception (PortSwigger research, 2018; Omer Gil, 2017): a cache keyed on less than the full request stored one response and served it for others.
- **Pattern:** a cache stores many URLs under one key, so the least trusted URL can replace what the most trusted one shows.
- **In Flow:** the service worker's navigation cache, the offline page, any runtime cache with a fixed `cacheKeyWillBeUsed`, CDN rules in `_headers`.
- **Hunt:** for each shared key, list every request that can write it. Check that only the expected kind of response (content type, status) is stored.

### P17. A gate that anyone can write to
- **Seen in:** GitHub Actions "pwn requests" (GitHub Security Lab, 2021): workflows that trusted a comment command or a label without checking who posted it.
- **Pattern:** a gate is a text convention in a channel that outsiders can also write to, and nothing checks who wrote it.
- **In Flow:** review verdicts and other agent signals carried in PR comments, labels or commit messages; branch rules and required checks.
- **Hunt:** for each signal an agent acts on, ask who can write it. Check that the agent checks the author and the exact head sha, and that a server-side rule backs the gate.

### P18. A check that passes on the wrong type
- **Seen in:** PHP "magic hashes" (Robert Hansen, WhiteHat Security, 2015; the PHP manual's "Comparison Operators" page): with loose `==`, two hash strings that start with `0e` compare as the number zero, so different hashes compare equal.
- **Pattern:** a comparison with `NaN`, `null` or a string is false, and the code reads false as "allowed".
- **In Flow:** date and expiry checks, numeric limits read from JSON, flags read as strings in edge functions.
- **Hunt:** for each allow/deny check, feed it a value of the wrong type and check that it fails closed.

### P19. A decision that outlives its revocation
- **Seen in:** sessions and tokens that stay valid after a password reset or a role removal, a recurring bug bounty finding (OWASP ASVS V3.3, session termination).
- **Pattern:** access is decided once, cached or signed, and nothing re-checks it when the grant is withdrawn.
- **In Flow:** MCP tokens, invite links, membership-derived helpers, push subscriptions.
- **Hunt:** revoke mid-flow in a local test (remove the member, revoke the token) and check what the next step still allows, and for how long.

## Adding a pattern

Add a new entry when a Stage 2 hunt or a new advisory teaches one. Keep the same shape: what happened (with a public reference), the pattern in one line, where in Flow, how to hunt. Write it in general terms. Never describe how to exploit Flow code that isn't fixed yet.
