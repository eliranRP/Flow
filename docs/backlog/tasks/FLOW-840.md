<a id="flow-840"></a>
# FLOW-840 · The edge functions use zod 4.6.7, as the app does
- **Type:** SMALL CYCLE · **Status:** in-progress (flow-840-edge-zod) · **Source:** the app and `packages/shared` use zod 4.6.7 and the root pnpm override already lifts zod below 4.6.6, while the Deno edge functions still pin `npm:zod@4.6.5`.
- **Files:** `supabase/functions/{flow-mcp,mercury-sync,mercury-connect,_shared/connectors}/deno.json`, the `import_map.json` of `mercury-sync` and `mercury-connect`, the four `deno.lock` files next to them, a changelog fragment.

- [ ] Pin `npm:zod@4.6.7` in each edge-function config and import map, and update the zod entries in the lock files (zod only).
- [ ] The edge-function type-check, the flow-mcp tests, the connectors tests and `pnpm test:jev` pass.

**Acceptance:** `rg "zod@4" supabase` shows only 4.6.7.
