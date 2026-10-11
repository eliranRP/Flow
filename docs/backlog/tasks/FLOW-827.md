<a id="flow-827"></a>
# FLOW-827 · Keep what Home doesn't need out of its first load
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** FLOW-826 · **Source:** owner, 2026-10-11.
- [ ] `auth.tsx` imports the Jev review module and the push module only for what runs on a user change and on sign-out, so both sit in Home's first script. `App.tsx` imports the setup screens and the sign-in screen up front. Load each where it is used, keep behaviour the same, and show the change with `node scripts/load-report.mjs`.
