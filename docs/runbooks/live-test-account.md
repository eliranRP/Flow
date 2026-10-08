# Live test account (read-only): guide for agents

## What it is

- A read-only user on production (Supabase project `sxqpnetmtufkzowutduq`, app https://flow-app-dx5.pages.dev).
- It is a **viewer of the demo company "Flow Test" only**. It is not a member of any real company.
- It cannot write. The app hides write buttons for it, and the server rejects any write anyway.
- The deploy job already signs in with it after every deploy.
- How it was created and its exact permissions: [smoke-user.md](smoke-user.md).

## When to use it

- After a deploy, to confirm the live app works.
- To check a UI change on the live site.
- To reproduce a bug without changing data.

## Get the credentials

- Ask the coordinator. You receive them as the env vars `SMOKE_EMAIL` and `SMOKE_PASSWORD`.
- The coordinator keeps them in the GitHub environment `production` secrets and in the owner's private accounts list.
- Never print, log, commit, screenshot, or paste the password into a PR or chat.

## Steps

1. **Check what's deployed.** Open `https://flow-app-dx5.pages.dev/build.txt`. The last line must be the merge sha you expect.
2. **Run the automated smoke** from the repo root:

   ```bash
   SMOKE_EMAIL=... SMOKE_PASSWORD=... SMOKE_COMPANY_NAME="Flow Test" \
   pnpm --filter @flow/app test:e2e:smoke
   ```

   `SMOKE_BASE_URL` is optional and defaults to the prod URL. Install Chromium first if needed (`pnpm exec playwright install chromium`).
3. **Or test by hand in a browser.** Open the app, sign in with email and password, and confirm the company shown is "Flow Test".
4. **Only open these screens:** `/` (Home), `/projects`, `/review`, `/settings`. Project detail, transaction detail, categories, and search come back empty for a viewer. That is expected, not a bug.
5. **Report** to the coordinator: the deployed sha, pass or fail, and on a failure the failing step plus its log.

## Rules

- Read only. Don't try to approve, edit, create, or delete anything.
- Never point this user at a real company, and never set `is_demo` on a company.
- Don't create new prod users or reset this password without the owner's OK.
- If a check fails, don't fix it on prod. Report it.
- Live write tests need a separate account the owner approves, not this one. That account is the [QA user](qa-user.md), which owns its own sandbox company, Flow QA.
