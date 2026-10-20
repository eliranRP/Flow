<a id="flow-939"></a>
# FLOW-939 · Several AI (MCP) keys: the key list, one key, a new named key
- **Type:** UI (design approved) · **Status:** in-progress (lane, 2026-10-21, feat/mcp-keys) · **Depends on:** [FLOW-512](FLOW-512.md) (the חיבור ל־AI page), [FLOW-601](FLOW-601.md) (a key is for the company the app shows) · **Source:** the board's canvas note spec-mcp ("SEVERAL AI (MCP) KEYS", approved), Settings and SettingsLight boards (`mc`, `keys`, presets `mcpkeys`, `mcpkey`, `mcpnewkey`), the SettingsMcpKeys, SettingsMcpKey and SettingsMcpNewKey frames and the changed SettingsMcpConnected frame, 2026-10-20; decision [0202](../../decisions/0202-several-mcp-keys.md)
- **Files:** `supabase/migrations/20261021012400_mcp_keys.sql` (new: `name` and `client` on `private.mcp_credentials`; `store_mcp_credential` stops revoking the user's other keys and caps 20 active keys a company; `mcp_credential_status(p_user, p_hint)` lists the keys; `restore_mcp_credential` new), `supabase/tests/database/mcp_keys.test.sql` (new), `supabase/tests/database/mcp_cycle1.test.sql` (a second key no longer revokes the first), `supabase/functions/flow-mcp/handler.ts` (mint takes `name` and `client`, status passes the company hint, `restore` route), `supabase/functions/flow-mcp/handler_keys_test.ts` (new), `packages/shared/src/database.types.ts`, `app/src/screens/assistant-settings.tsx` (the page: list, key, setup), `app/src/screens/assistant-keys.ts` (new: types, the status read, mint, revoke, restore), `app/src/screens/assistant-key-views.tsx` (new: the list, a key's page, "כל המפתחות"), `app/src/screens/assistant-setup.tsx` (new: today's setup with the name field), `app/src/screens/settings-screen.tsx` and `app/src/screens/connections-screen.tsx` (import the read from the new module), `app/src/routes/settings.tsx` (`settings/connections/ai/*`), `app/src/ui/icons.tsx` (`KeyIcon`), `app/src/ui/css/10-settings-connect.css` (`.ui-ai-all-keys`), `app/src/assistant-sample.ts` (the board's keys), `app/src/dev/routes/settings.tsx`, the stories, unit tests, `app/e2e/ai-keys.spec.ts` (new; replaces `sheet-stack.spec.ts`, whose disconnect confirm is gone), `app/e2e/controls-settings.spec.ts`, `app/e2e/storybook-layout.spec.ts`, `app/e2e/spec-sources.json`, `scripts/e2e-specs.test.mjs`, `docs/mcp/KEYS.md` (new), `docs/decisions/0080-mcp-connector.md` (amended), `docs/qa/CONTROLS.md`.

**The list (חיבור ל־AI once there is a key)**
- [x] "מפתחות פעילים · N", then a card with a row per key: key icon, its name, its last use ("שימוש אחרון …", or "עוד לא בשימוש"), the access at the end in accent for קריאה וכתיבה or grey for קריאה בלבד, a chevron.
- [x] "+ מפתח חדש", then one line: a key per assistant and device; revoking one leaves the others; every action is logged with the key's name and can be undone.
- [x] With no key the page is today's setup.

**One key**
- [x] "‹ כל המפתחות", a card with the name and the access, then עוזר, שימוש אחרון, נוצר, בתוקף עד, and the logged-with-the-key's-name line.
- [x] "ביטול המפתח" in the signal colour: the key stops working at once, the page returns to the list, and a toast "המפתח בוטל · <name>" has ביטול (the key works again; the server allows it for 10 minutes).

**A new key**
- [x] "+ מפתח חדש" runs today's setup with "שם למפתח" on top (placeholder "למשל: Claude במחשב העבודה"; empty gives "<assistant> · מפתח N") and "‹ כל המפתחות" to leave.
- [x] סיום, or the assistant's first call, returns to the list with "המפתח נוסף · N מפתחות פעילים".

**The logic**
- [x] Several keys per owner and company; a new key no longer revokes the others. Existing keys keep their hash, scope, expiry and company, so every connected client keeps working; they show as "מפתח AI" with no assistant row.
- [x] Only the hash is stored; the secret is returned once by mint and kept only in the setup's memory; nothing logs it.
- [x] At most 20 active keys a company (the 21st is refused with a message); expired keys stay listed, marked פג תוקף, until revoked.
- [x] No MCP tool: a key cannot mint, list or revoke keys.

**Acceptance:** pgTAP for the key model (several keys, name and assistant, the per-company list, the cap, revoke and its undo window, grants); Deno tests for mint, restore and status; unit tests for the three screens and the live revoke and undo; stories for the list, one key and a new key in dark and light; the AI keys e2e.
