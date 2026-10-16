<a id="flow-515"></a>
# FLOW-515 · MCP: the AI connection page shows the assistant's name, its request count and the code's expiry from the server
- **Type:** MCP · **Status:** ready · **Depends on:** [FLOW-512](FLOW-512.md) (the חיבור ל־AI page) · **Source:** FLOW-512 brief, the MCP connected board. The page there shows the assistant's name, the request count and the expiry; `mcp_credential_status` returns only state, id, scope, last use and expiry, so FLOW-512 shows those and leaves the rest out.
- **Files:** `supabase/migrations/` (a new migration extending `mcp_credential_status`, or a status view), `supabase/functions/flow-mcp/` (the status and mint paths that record the assistant name and count), `app/src/screens/assistant-settings.tsx` (the connected facts), `app/src/screens/assistant-settings.test.tsx`, `app/src/screens/assistant-settings.stories.tsx`.
- [ ] The status read returns the assistant's name (the client the code was made for, as the board words it: Claude Code, Claude.ai, ChatGPT, or the name the person typed for אחר) and the number of requests made with the code.
- [ ] The connected page shows "מחובר · <assistant>", and in שימוש אחרון the time and "N בקשות", as the board's MCP connected frame does. Until the read carries them, the page keeps showing only what it shows now.
- [ ] The expiry line keeps the date from the server; a code that has no expiry set omits the line.
- [ ] Tests cover a status with the new fields, and a status without them (the old server), which must still render.
- [ ] Mint and revoke keep their current behaviour; no secret is stored or logged by this change.
