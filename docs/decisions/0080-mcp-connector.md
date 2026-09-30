# An MCP connector tags one expense at a time

**Date:** 2026-09-30
**Status:** Accepted

Accepted for the first release below. The deferred section is an outline, not a commitment. [0006](0006-confirm-not-type.md), [0011](0011-auto-approve-high-confidence.md), and [0069](0069-back-and-one-tap-review.md) are not amended. The connector behavior lives here.

## Context

The owner wants an assistant to read the ledger and assign a project and a category. The app stays the display. The first release is about 22 hours. Later tools wait until they are needed.

Tool names, annotations, and payloads are in [MCP tools](../mcp/TOOLS.md). `tools/list` returns only the first-release handlers.

## Decision

### Owner decisions

1. **Scope.** The first release includes the read and search tools, `assign_expense`, `set_expense_category`, minting, the Settings עוזר row, a refetch on focus and when the document becomes visible, and the security model in this record. Each cycle is at most 6 hours.
2. **Approval.** An assistant write applies immediately and counts as the owner's אישור, including while the item is in לאישור. `assign_expense` and `set_expense_category` on an open review call `public.approve_review_item`, and the card leaves the queue. The app does not ask for a second tap. The person approves in the assistant client's own prompt, so every write tool sets `readOnlyHint: false`, `destructiveHint: true`, and `idempotentHint: true`. Every read tool sets `readOnlyHint: true`. Undo stays.
3. **Remember.** MCP writes default `remember` to false, so a supplier rule is not saved unless the owner asked. The tool accepts `remember: true`. The change sheet in the app is unchanged and still defaults to on. This follows [0006](0006-confirm-not-type.md): a rule the owner never saw is a wrong default.

### First release

The function is `flow-mcp`. Protocol `2025-06-18`. A tool result carries `structuredContent`. The server handles one JSON-RPC message per POST. `verify_jwt` is false. The bearer is the MCP secret.

Cycle 1 starts with a spike: sign a 60-second JWT with a dedicated asymmetric key in the project's JWT signing keys, and prove PostgREST accepts it as that user. The private key is the function secret `FLOW_MCP_SIGNING_KEY`. Its header carries `kid`. Claims are `iss` (the project auth URL), `sub`, `role` `authenticated`, `aud` `authenticated`, `iat`, `exp`, `jti`, and `mcp_tid` (the credential id). If the spike fails, the fallback is the legacy HS256 secret under the name `FLOW_JWT_LEGACY`. That secret can mint any role and Supabase retires it at the end of 2026, so the signer still sets only `role` `authenticated`, and the fallback is a recorded dependency to remove before then. The legacy secret is not stored under a `SUPABASE_` name. Supabase rejects those names.

Ledger calls use the publishable key and the 60-second JWT. Private lookup uses the project's secret key, stored as `FLOW_SECRET_KEY` in the function's secrets. `service_role` is never copied into GitHub. The function drops the secret-key client before any ledger call.

Minting is a route on the function, because the pepper never leaves the function environment. The signed-in app sends its user JWT. The function checks that JWT, generates `flow_mcp_` plus 43 base64url characters (256 bits), stores HMAC-SHA256 under pepper `FLOW_MCP_PEPPER` and that pepper's `kid`, and returns the secret once. One active token per user. A new mint revokes the previous row first. `expires_at` is 90 days. `last_used_at` updates when a call is accepted.

`private` is not on PostgREST. These functions are `security definer`, revoked from `public`, `anon`, and `authenticated`, and granted to `service_role` only, which is the role the secret key uses:

| Function | Role |
| --- | --- |
| `private.lookup_mcp_credential(text)` | Resolve the HMAC to the user, company, scopes, expiry, and revocation |
| `private.touch_mcp_credential(uuid)` | Set `last_used_at` |
| `private.bump_mcp_rate(uuid, uuid, text)` | Add one read or one write, for the token and for the user, in one update |
| `private.note_auth_failure(text)` | Count a failed secret check for the throttle address |

Write functions in this release (`approve_review_item`, and the idempotent wrappers around `reassign_transaction` and `set_transaction_category`) are granted to `authenticated` only. They are not granted to `service_role`.

Scopes `read` and `write` are checked before the JWT is signed. The first token has both. A read tool needs `read`. A write tool needs `write`. A miss is `forbidden`. Unknown, revoked, expired, and bad secrets are HTTP 401. Over the limit, and the failure throttle, are HTTP 429 with `retry_after_seconds`. One token: 60 reads and 20 writes a minute. One user: 120 reads and 40 writes a minute. The throttle address is the first hop in `x-forwarded-for` as the Supabase gateway sets it. A missing header uses the bucket `unknown` and still counts. The function does not trust any other header.

There is no `access-control-allow-origin: *`. The MCP route allows a missing `Origin` (a non-browser client) and rejects any other `Origin`. The mint route allows only the app origins. Any other `Origin` is 403. GET is 405.

A write wrapper reads `mcp_tid` from `request.jwt.claims` inside the database. That claim is not an argument and not a setting the caller can set. The audit row stores it, and `channel` is `mcp` only when the claim is present. The app's own JWT has no `mcp_tid`, so its rows stay `app`. The same wrapper stores the idempotency key in `private.mcp_idempotency`. The same key and hash return the stored response. A different hash is `conflict`.

An assistant write sets `user_assigned` true. It is the owner's decision. `upsert_sumit_documents` keeps the existing project and category when that flag is true (`20260928230000_review_round4.sql` around the `user_assigned` cases). `private.fill_suggested_category` sets `category_suggested` false when `user_assigned` is true, and can change the flag on a row that is not assigned. A pgTAP test assigns through the MCP wrapper, runs the sync upsert, and asserts the project, the category, and `category_suggested` did not change.

`approve_review_item(p_id, p_project_id, p_category_id, p_remember, p_shown_project_id, p_shown_category_id)` is the only close path the assistant and אישור share. The assistant omits the shown ids and passes the new project and category. `p_remember` defaults to false. An open item is resolved with `p_action` `approved` (a split whose reason is not `unallocated_shared` still calls `approve_split_review` after the category write). The card leaves לאישור.

אישור sends the project and category the card showed, as the shown ids. If the stored row differs, the function writes nothing and returns `stale`. The app reloads the card and shows one toast: "השיוך עודכן. בדקו את הכרטיס." If the item is already closed and it belongs to this company, the function returns `already_closed` and does not call `resolve_review`. The app shows "הפריט כבר אושר." and moves off that card. A missing id, or another company's id, is `not_found` either way. `resolve_review` stays `void`. The wrapper decides among open, `already_closed`, and `not_found` before it calls that function. `skip_review` is not in this release.

`{i} מתוך {n}` never shows `i` greater than `n`. After a refetch, `n` is the new queue length. If the current card is still there, `i` is its new 1-based place. If it is gone and `n` is at least 1, `i` is the minimum of the previous `i` and `n`, and that card is shown. If `n` is 0, the counter is not shown and the empty state is the existing one: title "הכל מאושר", body "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש." Growth, from a reopened item or a SUMIT sync during the visit, uses the same rule.

A refetch on focus, or when the document becomes visible, updates `review`, `dashboard`, `unpaid`, `project`, `project-category`, `project-waiting`, `filed-today`, and `txn`. While a sheet for a row is open, a pointer or mouse button is down on it, or keyboard focus is inside that row or its sheet, the refetch does not move that row. Lists take a new order only when none of those holds are active and scrolling has settled.

Settings, section עוזר, directly under the SUMIT block:

| State | What the owner sees |
| --- | --- |
| Empty | Title "עוזר", hint "לא מחובר", action "חיבור עוזר" |
| Loading | The row is busy. It does not look connected |
| Error | The SUMIT error line under the row. The last state stays |
| No company | The row is disabled. The hint says why |
| Connect sheet | Title "חיבור עוזר". Body "הקוד מוצג פעם אחת. שמרו אותו אצל העוזר." The secret is `<bdi dir="ltr">` in monospace. Action "העתקה" |
| Connected | "מחובר · שימוש אחרון …", or "מחובר · עדיין אין שימוש" |
| Expired | Hint "התוקף פג". Action "חיבור מחדש" |
| Disconnect | Title "לנתק את העוזר?" Consequence "הקוד יפסיק לעבוד. הספרים נשארים." Confirm "ניתוק" |

ניתוק sets `revoked_at` on that user's current token, whether it is active or expired. It does not delete ledger rows and it does not sign the owner out. חיבור מחדש revokes that same row and then mints one new secret. There is one active token.

A counted sentence uses the singular at 1. This release adds none. The deferred batch toast would be "תנועה אחת שויכה בעוזר" or "N תנועות שויכו בעוזר".

### Cycles

| Cycle | What ships | Hours |
| --- | --- | --- |
| 1 | Signing-key spike, then the function, mint, pepper, private lookup and rate-limit functions, 401 and 429 | 6 |
| 2 | The six read and search tools, annotations, Deno tests, `tools/list` from those handlers | 6 |
| 3 | `assign_expense`, `set_expense_category`, `approve_review_item`, undo, idempotency, the SUMIT overwrite test, `already_closed` versus `not_found` | 6 |
| 4 | The עוזר row, focus refetch, the hold, the two toasts, and the visit counter | 4 |

### Later, if needed

No schemas for these until a later record. `tools/list` does not include them.

- `bulk_assign`, a signed preview, `undo_batch`, and one toast per batch. The preview runs the real writes in a subtransaction and rolls it back. Apply takes `FOR UPDATE` and re-checks `updated_at`. The confirmation is bound to the token, the user, the tool, and a nonce, and it is single-use. A bad signature is `validation`, not `conflict`. `conflict` is a changed `updated_at` only. `apply_batch` is granted to `authenticated` only, and only the edge function calls it after the signature check. The confirmation key is `FLOW_MCP_CONFIRM_KEY`, a different secret from the pepper, with its own `kid`.
- The ` · בעוזר` marker, and a 15-second poll while the document is visible. Realtime stays off.
- `split_expense`, `collapse_expense`, `create_project`, `rename_project`, and `finish_project`.

### Noted for the first release

A review id passed to a transaction tool is `validation` with message `id is not a transaction; list_review.id is the review id`. The server does not guess the other id. Error text is a fixed string, never a description or a supplier name. No tool performs outbound HTTP.

## Alternatives rejected

Storing the app's refresh token. The 60-second JWT does not share the app session.

Signing with the legacy HS256 secret as the normal path. It can mint any role, and it is deprecated at the end of 2026.

Putting `service_role` in GitHub so the deploy job can push it.

Leaving an assistant write at `user_assigned` false. The next SUMIT sync would replace the project and the category.

Defaulting `remember` to true on an MCP write. The owner did not see the rule.

A second אישור in the app after the assistant wrote. The client's permission prompt is the confirmation.

## Consequences

No application code ships with this record. The app's אישור, once this release is built, sends the values on the card and toasts instead of approving when the server row has moved or the item is already closed.

## Open questions

These do not block the first release.

1. Which client connects first? OAuth waits unless that client cannot store the secret.
2. Should a later write also remember the project? Nothing writes `remembered_project_id`.
3. May a later release create a category? This release only assigns categories that already exist ([0008](0008-flat-categories-hide-or-merge.md)).
