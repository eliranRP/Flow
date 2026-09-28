# The build stack

**Date:** 2026-09-26
**Status:** Accepted
**Amended by:** [0065](0065-review-round5.md) point 40. SheetJS is not loaded. There is no bank-file parser.

## Context

[0037](0037-supabase-pilot.md) chooses Supabase Free for the pilot and Cloudflare for the static PWA. The stack is the one in [tech-plan.md](../tech/tech-plan.md) §1.4.1.

## Decision

Front end: TypeScript, React and Vite with route code-splitting, React Router, TanStack Query with an IndexedDB-persisted cache, supabase-js, and vite-plugin-pwa. Styling is Tailwind CSS v4 on the design tokens ([0040](0040-tailwind-v4.md)), which replaces the plain-CSS line. The UI is right to left, Rubik is self-hosted, and there is no component kit. Sheets use Vaul. Dates use date-fns with the `he` locale. Shekels use `Intl`. SheetJS is loaded only for the bank file. Invoice photos use browser-image-compression. Validation is Zod.

Back end: Supabase as in 0037, Deno Edge Functions, and envelope encryption for SUMIT keys with the master key as a function secret. AI uses `@google/genai` (Gemini Flash-Lite, paid tier). Push uses `web-push`, which still has to be verified in Deno.

Tests: Vitest, Playwright, and pgTAP.

## Alternatives rejected

Preact, from the Cloudflare plan. A component kit instead of the design tokens.

## Consequences

Build Module 1 on this stack. The plain-CSS styling line is replaced by [0040](0040-tailwind-v4.md). If `web-push` does not run in Deno, the plan's fallback is a Deno-native Web Push library. That check does not change the rest of this record.
