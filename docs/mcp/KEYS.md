# AI (MCP) keys

Decision [0202](../decisions/0202-several-mcp-keys.md) (several keys), [0080](../decisions/0080-mcp-connector.md) (the connector). The tools are in [TOOLS.md](TOOLS.md).

## Connecting an assistant

Settings › חיבורים › חיבור ל־AI. With no key the page is the setup; once there is a key it lists them and "+ מפתח חדש" runs the setup again.

1. **שם למפתח** (optional, at most 60 characters). Empty gives "<assistant> · מפתח N".
2. **Access:** קריאה בלבד (scope `read`) or קריאה וכתיבה (`read`, `write`). A read-only key lists only the read tools.
3. **Assistant:** Claude Code, Claude.ai, ChatGPT or אחר. It picks the steps and fields; it is stored with the key.
4. **יצירת קוד** mints the key and shows its secret once:
   - Claude Code: `claude mcp add --scope user --transport http flow "<server address>" --header "Authorization: Bearer <secret>"`.
   - Claude.ai, ChatGPT, other: the server address and the header `Authorization: Bearer <secret>`.
5. The assistant's first call (or סיום) adds the key to the list.

The server address is `VITE_FLOW_MCP_URL`, or `<Supabase URL>/functions/v1/flow-mcp`. Never paste a real secret into an issue, a commit or a screenshot.

## Keys

- One key per assistant and device. Each is bound to the business the app showed when it was made, and to the owner who made it. Only the owner of a business can make keys for it.
- A key is valid for 90 days. At most 20 keys can be active for one owner and business.
- Only an HMAC-SHA256 of the secret is stored (with the pepper's kid). The secret is returned once, by mint, and is never logged.
- Every write a key makes is in the undo log with that key's id, so it can be undone like any change.
- **ביטול המפתח** on a key's page stops that key at once; the others keep working. The toast's ביטול brings it back within 10 minutes.
- Keys are managed only in the app. No MCP tool makes, lists or revokes keys.

## Routes (flow-mcp, app origin and the user's session only)

| Route | Body | Answer |
| --- | --- | --- |
| `POST /mint` | `scope` (`read` or `read_write`), optional `name`, optional `client` (`claude-code`, `claude-ai`, `chatgpt`, `other`) | `id`, `secret` (once), `scope`, `expires_at`, `name`, `client`; 409 `too_many` at the cap |
| `POST /status` | none | `state` (`empty`, `connected`, `expired`) and `keys` (`id`, `name`, `client`, `scope`, `created_at`, `last_used_at`, `expires_at`, `expired`) for the business in `x-flow-company` |
| `POST /revoke` | `id` | `ok`; 404 for a key that is not the caller's |
| `POST /restore` | `id` | `ok`; 404 past 10 minutes or for a key that is not the caller's; 409 `too_many` |
