# Security review checklist

Reviewed against the code on this branch. This is not a penetration test.

| Check | Result |
| --- | --- |
| RLS enabled on every `public` table | pgTAP: "every public table has row level security" |
| Anon has no execute on `public` functions | pgTAP in `rls_isolation.test.sql` |
| Second owner cannot read or refresh the first company | pgTAP in `phase1_slice` and `phase_remainder` |
| SUMIT ciphertext is not granted to `authenticated` | unchanged from schema v1; new columns `calls_count`, `drift_fields`, `hook_token` are not granted |
| `reserve_sumit_call` and `dispatch_notifications` are not granted to the browser | revoked; pgTAP expects 42501 |
| SUMIT URLs in the repo match the read-only allowlist | `packages/shared/src/sumit-paths.test.ts` |
| Service-role key is not in `app/` | `scripts/check-bundle.mjs` rejects `service_role` in the client bundle |
| No `innerHTML` in `app/src` | grep during this review found none |
| CSP, HSTS, nosniff, referrer policy | `app/public/_headers`. `style-src` allows inline styles because the built CSS is injected that way |
| Push keys and the SUMIT key stay in Edge secrets | runbook `phase-remainder.md` |
| Offline replay is idempotent on `client_op_id` | pgTAP applies the same op twice and keeps one row |
| Account deletion of auth orphans | listed in the runbook, not automatic |

Paid items not enabled: Gemini, Apple Developer, Cloudflare R2, a custom Supabase domain.
