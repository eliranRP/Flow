# The public anon key is committed

**Date:** 2026-09-28
**Status:** Accepted

## Context

The hosted project flow-pilot (`sxqpnetmtufkzowutduq`, eu-central-1) has schema v1 applied. RLS is on, and Google sign-in is enabled for `https://flow-app-dx5.pages.dev`. A production build, including a later Cloudflare Pages build from this git repo, should talk to that project without someone pasting keys into the host's dashboard.

The anon key is a public client credential. Row level security is what keeps one owner's rows from another. The service-role key bypasses that, and it is a different secret.

## Decision

`app/.env.production` commits `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for flow-pilot. The anon value is the legacy JWT whose role is `anon`. Production builds read that file.

The service-role key is never committed, never pasted into a tracked env file, and never built into the client. `pnpm seed:demo` and `pnpm latency` may receive `SUPABASE_SERVICE_ROLE_KEY` in the environment of that one command. It stays in the Supabase dashboard otherwise.

## Alternatives rejected

Leaving the anon key only in the host dashboard. A git build of this repo would then ship a client with no project to talk to.

Committing the service-role key next to the anon key so seeding is one step. That key bypasses RLS, so it does not belong in git or in the PWA.

## Consequences

Anyone can call the hosted API as `anon`. RLS and the grants are the boundary. Replacing the anon key means editing `app/.env.production`. How the first company and the demo data get onto the hosted project is in the README. The app does not create that company during sign-in.
