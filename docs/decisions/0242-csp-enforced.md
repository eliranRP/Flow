# The Content-Security-Policy is enforced

**Date:** 2026-11-01
**Status:** Accepted

## Context

[0192](0192-security-headers.md) shipped the CSP as `Content-Security-Policy-Report-Only` and planned a follow-up that renames the header once normal use shows no violation. The owner approved enforcing it on 2026-11-01. 0192 was dated 2026-10-19, so its two-week window ends 2026-11-02: this lands a day early, on the owner's approval, after the checks below.

## Decision

`app/public/_headers` sends `Content-Security-Policy: __FLOW_CSP__`. The policy is unchanged (still built by `scripts/security-headers.mjs`): scripts only from `'self'` and the inline theme script's hash, no `'unsafe-inline'` or `'unsafe-eval'` for scripts, `data:` and `blob:` allowed nowhere.

**Checked before the change**

- The built `app/dist` CSS and JS have no `eval(` or `new Function`. Fonts are files under `/assets` (no inlined `data:` font or image). The only `data:` and `blob:` strings are a Supabase MFA QR helper the app does not call, a React Router protocol list, and minified variable names. The only other origin is the Supabase project, which `connect-src` lists; `pay.sumit.co.il` is a link target (a navigation), not a load.
- The built app served with the built policy as an enforced header, every route in `_headers` loaded in Chromium: no `securitypolicyviolation` event and no CSP console message. With no backend the app shows its sign-in screen on most routes, so this covers the shell, scripts, styles, fonts and manifest, not signed-in screens.
- The live app (sign-in, terms, privacy, help), plain page loads only: its report-only policy reported no violation.
- `node --test scripts/security-headers.test.mjs scripts/pages-spa.test.mjs` passes with the new header name.

**Roll back:** rename the header in `app/public/_headers` back to `Content-Security-Policy-Report-Only` and update the two tests. A new third-party origin must still be added to the policy in the PR that adds it, or it is now blocked.
