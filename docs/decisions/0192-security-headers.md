# Security headers, with the CSP report-only first

**Date:** 2026-10-19
**Status:** Accepted

## Context

A security review found that the app on Cloudflare Pages sent no security headers. `app/public/_headers` only set the Content-Type of the extensionless routes. Any site could frame the owner screens (clickjacking), and there was no Content-Security-Policy to limit where scripts load from or where data can go.

What the app loads, checked in the source and the built `dist`:

- **Scripts.** The bundle, `registerSW.js`, and one inline script in `app/index.html` that applies the saved theme before first paint. Nothing from a third party. Web push goes through the browser's push service, which CSP does not govern. SUMIT documents open in a new tab as plain links.
- **Network.** The Supabase project only: REST, RPC, auth and `/functions/v1` share its origin. Realtime is not in the build (`vite.config.ts` aliases `@supabase/realtime-js` away), so there is no `wss:`.
- **Styles.** The app's CSS files, plus `<style>` elements that vaul and react-remove-scroll insert at runtime with computed values when a sheet opens. React `style` props go through the CSSOM and need nothing.
- **Fonts and images.** Rubik is self-hosted (`@fontsource/rubik`). Icons are local. No `data:` or `blob:` URIs.
- **Device features.** None. The receipt picker is `<input type="file" accept="image/*">`, which opens the camera through the OS picker with no permission. Notifications and vibration are not policy-controlled features.

## Decision

Every path (`/*`) gets these headers. The build writes the CSP into `dist/_headers` (`app/public/_headers` holds the placeholder `__FLOW_CSP__`); `scripts/security-headers.mjs` builds it, and a Vite plugin fills it from the built `index.html` and `VITE_SUPABASE_URL`, so the hash and the origin always match what ships. A missing or repeated placeholder fails the build.

- **`Content-Security-Policy-Report-Only`:** `default-src 'self'; script-src 'self' 'sha256-<inline theme script>'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self' https://<project>.supabase.co; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. A build with no Supabase URL (the reviewers-only build) connects only to itself. The URL must be https, except a loopback, private-network or `.local` host for a local build.
- **`X-Frame-Options: DENY`.** Enforced now, so the clickjacking fix does not wait for the CSP.
- **`X-Content-Type-Options: nosniff`.** The extensionless routes already carry their own Content-Type.
- **`Referrer-Policy: strict-origin-when-cross-origin`.**
- **`Permissions-Policy`:** camera, microphone, geolocation, payment, usb, serial, hid, bluetooth, midi, display-capture, magnetometer, gyroscope, accelerometer and browsing-topics are off.
- **`Strict-Transport-Security: max-age=31536000; includeSubDomains`,** without `preload`. `pages.dev` is already HTTPS-only (the `.dev` zone is on the browsers' preload list), so on the current host it changes nothing; it protects a custom domain from its first visit on. Its subdomains on `pages.dev` are the preview deployments, which are HTTPS too.
- **Zod without its eval probe.** Zod 4 calls `new Function("")` when it builds the first object schema, to decide whether to compile a faster parser. With no `'unsafe-eval'` that is a violation on every load, so `vite.config.ts` aliases `zod` to `app/src/lib/zod-jitless.ts`, which sets `jitless`. Parsing is the same, only interpreted. Server code imports zod directly and keeps the compiled parser.

**Why `'unsafe-inline'` for styles.** The inserted `<style>` elements hold values computed at runtime (the scrollbar gap), so hashes cannot list them, and the libraries take no nonce. Injected CSS cannot run script; script-src stays strict, which is what stops XSS.

**Enforcing.** The CSP stays report-only for two weeks of normal use after this deploys. There is no report endpoint; violations show in the browser console, and the check is to open each tab, a sheet, sign-in and the auth callback on the hosted app with the console open. With none found, a follow-up PR renames the header to `Content-Security-Policy`, with the same value. A new third-party origin (a font, analytics, an embed) must be added to the policy in the same PR that adds it.

## Alternatives rejected

**Enforce the CSP now.** A missed source would blank a screen in production; report-only finds it first. X-Frame-Options already enforces the framing fix.

**Move the inline theme script to a file.** A blocking external script in `<head>` adds a request before first paint. The build-time hash costs nothing at runtime.

**A hash written by hand in `_headers`, checked by a test.** Every edit to the script would need a manual update; filling it at build time removes the step.

**`'unsafe-eval'` for zod.** It would let any injected string run as code; jitless removes the need.

## Consequences

`scripts/security-headers.test.mjs` (in `pnpm test:unit`) checks the headers in `app/public/_headers`, the policy's directives, and, when `app/dist` exists, that the built policy names every inline script in `index.html`, `404.html` and `app-shell`. `scripts/pages-spa.test.mjs` serves `_headers` with `wrangler pages dev` and checks a deep link and an asset carry them, and that the `/*` rule sets no Content-Type. The Storybook build leaves the app's public folder out (`publicDir: false` in `app/.storybook/main.ts`, with only the favicon in `staticDirs`), so the Storybook Pages preview gets neither `_headers` nor `_redirects`: X-Frame-Options DENY there would blank every canvas, which the manager loads in an iframe. `scripts/storybook-preview-keys.mjs`, which the preview workflow runs on the build before deploying, fails on either file. A new inline script is allowed by the build automatically; a new origin needs a change to `buildCsp`. Cache headers are unchanged: Pages revalidates HTML and `sw.js` on every request by default, so updates still reach installed apps.
