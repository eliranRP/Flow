# QA user (writes in its own sandbox company)

The production QA thread checks every deploy end to end, including saves. The [smoke user](smoke-user.md) can't do that: it is a viewer of Flow Test and the server rejects its writes. Flow has no editor role. Write rights belong to the owner of a company (`private.current_company_id()`).

So QA has its own login that owns its own company, **Flow QA**. It is a normal owner of that one company and nothing else. Row-level security keeps it out of every other company, including NRO Momentum and Flow Test. No schema change is involved.

## What QA may do

- Create, edit, split, assign, undo and delete anything inside Flow QA, in the app and through a Flow MCP key minted for Flow QA.
- Leave test data in Flow QA. Prefix names with `QA ` so they are easy to spot.
- Connect the owner's Mercury account to Flow QA, so sync runs against a copy of the real bank lines. Mercury is only read.
- Seed a scenario straight in the database (Supabase SQL) when the app can't create it. Every insert or update names Flow QA's company id, and the statement first checks that the id belongs to the company named `Flow QA` with `is_demo` false.

## What QA must not do

- Use any other login or key for writes. The NRO Momentum MCP key stays read-only (`readOnlyHint` tools only).
- Join, view or invite into any other company. Never set `is_demo` on Flow QA.
- Run SQL that touches a row of any other company, or that has no company filter.
- Write with the NRO Momentum MCP key, or change NRO Momentum's own Mercury connection.

## How it is set up

- Login `ops+qa@nromomentum.com`. It has no password. QA signs in with a one-time magic link.
- It owns one company, `Flow QA`, with `is_demo` false.
- The project's cloud environment holds a network secret, `SUPABASE_SERVICE_ROLE`. The proxy adds it only to calls under `/auth/v1/admin/`, so a QA session can make sign-in links and nothing else with it. The key never appears in the session.
- The "Production QA (sandbox)" thread runs the hourly deploy check as a routine at minute 14. It is the only thread that writes in Flow QA.

## Sign in

The app uses PKCE, so a magic link opened in a test browser does not sign it in. QA builds the session itself:

1. `POST /auth/v1/admin/generate_link` with `{"type":"magiclink","email":"ops+qa@nromomentum.com"}`. Keep `hashed_token` from the answer.
2. `POST /auth/v1/verify` with `{"type":"magiclink","token_hash":"<hashed_token>"}` and the publishable key as `apikey`. The answer is a session.
3. Before the app loads, put that session in local storage under `sb-sxqpnetmtufkzowutduq-auth-token` (Playwright `addInitScript`).

Mint Flow MCP keys for Flow QA in Settings, in the signed-in app. A direct call to `flow-mcp/mint` is refused with `origin`. Keep the key in the QA session only.

## Set it up again (owner)

Only needed if the login or the secret is lost.

1. Supabase dashboard, Authentication, Users, Add user, with the email above and auto-confirm. Do not attach it to a company.
2. Add the service role key as the network secret `SUPABASE_SERVICE_ROLE` in the project's cloud environment, scoped to `/auth/v1/admin/`. Only sessions started after that see it.
3. QA signs in as above and finishes onboarding with the company name `Flow QA`. That calls `create_company`, which makes this user its owner.

## Check

```sql
select c.name, c.is_demo
from public.companies c
join auth.users u on u.id = c.owner_id
where u.email = 'ops+qa@nromomentum.com';
```

One row, `Flow QA`, `is_demo` false. Any other result means stop.
