# Several AI (MCP) keys: one per assistant and device

**Date:** 2026-10-21
**Status:** Accepted
**Amends:** [0080](0080-mcp-connector.md) (one active token per user), [0095](0095-mcp-first.md) (no MCP tool for managing keys)

## Context

Until now an owner had one assistant key. Minting a new code revoked the old one (`store_mcp_credential` revoked every open row of the user before inserting), so connecting Claude Code on a second computer, or Claude.ai on the phone, cut off the first. The board's approved note spec-mcp ("SEVERAL AI (MCP) KEYS") turns the חיבור ל־AI page into a list of keys: a key per assistant and device, each with its own page, revoked on its own with a toast that has undo, and a new key made through today's setup with a name on top.

## Decision

- **Several keys per owner and company.** A key stays bound to the company the app showed when it was made (0167, FLOW-601). Minting no longer revokes the user's other keys. At most 20 keys may be active (not revoked, not expired) for one user and company; the 21st mint is refused (`too many keys`, HTTP 409 `too_many`) and the page says to revoke one. Two mints at once take a per-company advisory lock, so the cap holds.
- **A name and an assistant on each key.** `private.mcp_credentials` gains `name` (1–60 characters, trimmed) and `client` (`claude-code`, `claude-ai`, `chatgpt`, `other`). Mint takes both, optional; the app sends the name the owner typed, or "<assistant> · מפתח N" when the field is empty. Keys made before have neither and show as "מפתח AI" with no assistant row. The audit rows already carry the key's id (`mcp_tid`), so "every action is logged with the key's name" is that id joined to the name.
- **The list is the status route.** `flow-mcp/status` calls `mcp_credential_status(p_user, p_hint)` with the app's `x-flow-company` header: the user's open keys for the company a new key would be made for, active ones oldest first, then expired ones (each with `name`, `client`, `scope`, `created_at`, `last_used_at`, `expires_at`, `expired`; never the hash). `state` is connected when any key is active and expired when only expired keys are left, so the Settings and חיבורים rows read as before. The newest active key's `id`, `scope`, `last_used_at` and `expires_at` stay at the top level for an app version that is still open during the rollout. A company the user does not own lists nothing.
- **Revoke one key; undo for 10 minutes.** "ביטול המפתח" revokes that key only, at once (the next MCP call is 401). The toast's ביטול calls the new `flow-mcp/restore` route (`restore_mcp_credential(p_user, p_id)`), which clears `revoked_at` only for the caller's own key, within 10 minutes of the revoke, while the key has not expired and the company has room under the cap. After that a revoke is final. The old ניתוק confirm sheet and "יצירת קוד חדש" go: the list and "+ מפתח חדש" replace them.
- **A code replaced in the same setup is revoked.** When the owner changes the access after a code is shown, that code is revoked and a new one is minted, so a shown-and-dropped code does not stay open as a key nobody uses (what the single-key mint did implicitly).
- **Secrets as before.** The secret is `flow_mcp_` plus 43 base64url characters, returned once by mint (`cache-control: no-store`), held only in the setup's memory and never logged; the row stores HMAC-SHA256 with the pepper and its kid. Every wrapper is `security definer` with an empty `search_path`, executable by `service_role` only.
- **No MCP tool.** Making, listing and revoking keys is an owner action in the app, authenticated by the app session through `getUser`. A key cannot make or revoke keys: an assistant must not be able to give itself more access or lock the owner's other assistants out. This amends 0095 for key management.

## Migration and existing clients

One migration, `20261021012400_mcp_keys.sql`. It adds two nullable columns and replaces three wrappers (the six-argument `store_mcp_credential` and the one-argument `mcp_credential_status` are dropped so a call cannot be ambiguous; the new arguments have defaults, so the flow-mcp still deployed while the migration runs keeps minting and reading). No key changes: its hash, pepper kid, scope, expiry and company stay, `lookup_mcp_credential` and `touch_mcp_credential` are unchanged, and every connected client keeps working.

## Alternatives rejected

**Keep one key and show the assistants that used it.** The note asks for a key per assistant and device so that revoking one leaves the others; one shared secret cannot do that.

**Delay the revoke until the toast closes.** The key would keep working for the toast's seconds and after a closed tab; revoking at once and restoring on undo is safer.

**A rename.** The note has none. A key's name is set when it is made.

## Consequences

pgTAP `mcp_keys.test.sql`; `mcp_cycle1.test.sql` now expects a second key to leave the first open. flow-mcp gains the `restore` route. The app's AI page has three views under `/settings/connections/ai` (the list, `/key/<id>`, `/new`), lazy like before.
