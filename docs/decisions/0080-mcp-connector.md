# An MCP connector tags one expense at a time

**Date:** 2026-09-30
**Status:** Accepted

Accepted for the first release below. The deferred section is an outline, not a commitment. [0006](0006-confirm-not-type.md), [0011](0011-auto-approve-high-confidence.md), and [0069](0069-back-and-one-tap-review.md) are not amended. Each of those records only points here.

## Context

The owner wants an assistant to read the ledger and assign a project and a category. The app stays the display. The first release is 18 hours, inside the 22-hour target, so each cycle stays at or under 6 hours and can ship on its own. Later tools wait until they are needed.

Tool names and payloads are in [MCP tools](../mcp/TOOLS.md). `tools/list` returns only the handlers that cycle has shipped.

## Decision

### Owner decisions

1. **Scope.** The first release includes the read and search tools, `assign_expense`, `set_expense_category`, minting, the Settings עוזר row, a refetch on focus and when the document becomes visible, the visit counter, שויכו היום for an assistant approval, and the security model in this record.
2. **Approval.** Flow accepts an assistant write. It does not ask the owner to confirm again, including when the item is in לאישור. `assign_expense` and `set_expense_category` on an open review call `public.approve_review_item`, which calls `resolve_review` with `approved`, and the card leaves the queue. The annotations on a tool (`readOnlyHint`, `destructiveHint`, `idempotentHint`) are hints for the client. Flow cannot require them and does not read them. A client may show its own permission prompt. That prompt is not a Flow control. The safety nets Flow does enforce are a write scope, the rate limits, an audit row whose token id is the JWT claim `mcp_tid`, undo, and revoke.
3. **Remember.** MCP writes default `remember` to false. The tool accepts `remember: true`. The change sheet in the app is unchanged. A rule the owner never saw is a wrong default, as in [0006](0006-confirm-not-type.md).
4. **Token scope.** The connect sheet chooses the scope. The default is read and write. "קריאה בלבד" mints `read` only. Both choices mint a token.

### First release

The function is `flow-mcp`. Protocol `2025-06-18`. A tool result carries `structuredContent`. One JSON-RPC message per POST. `verify_jwt` is false. The bearer is the MCP secret.

There is no `access-control-allow-origin: *`. The MCP route allows a missing `Origin` and rejects any other. The mint, revoke, and status routes allow only the app origins. Anything else is 403. GET is 405.

#### Signing spike

Cycle 1 starts with a spike. The builder owns it. Pass means all of these:

1. The project has an additional asymmetric JWT signing key. It is not the key Auth uses to sign session tokens.
2. The function signs a 60-second JWT with that key: `role` `authenticated`, a known user's `sub`, `iss`, `jti`, and `mcp_tid`. The header carries `kid`.
3. PostgREST accepts it. An RPC runs as that user and returns that user's company. The same call does not return another company's rows.

If the only key PostgREST will accept is the in-use Auth signing key, the spike stops. The function does not hold Auth's own private key. The fallback is the legacy HS256 secret, set as the function secret `FLOW_JWT_LEGACY` in the Supabase dashboard. That name is never a GitHub secret. The signer still sets only `role` `authenticated`. The legacy shared secret is deprecated by the end of 2026. This record does not treat that date as the day it is deleted. The fallback is a dependency to retire before that deprecation leaves the secret unusable. It can mint any role, which is why it is not the normal path. Supabase rejects secret names that start with `SUPABASE_`.

On a pass, the function secret is `FLOW_MCP_SIGNING_KEY` and `FLOW_JWT_LEGACY` is not created.

#### Secrets and deploy

The production deploy job deploys `flow-mcp` and then sets function secrets from the GitHub environment `production`:

| GitHub environment `production` | Function secret | First release |
| --- | --- | --- |
| `FLOW_MCP_SIGNING_KEY` | same | yes, after the spike passes |
| `FLOW_MCP_PEPPER` | same, with its `kid` | yes |
| `FLOW_SECRET_KEY` | the project's secret key (`sb_secret_`) | yes |
| `FLOW_MCP_CONFIRM_KEY` | same, its own `kid` | no, deferred with bulk |

`FLOW_JWT_LEGACY` is not in that environment and is not in the workflow. `service_role` is never copied into GitHub. Ledger calls use the publishable key and the 60-second JWT. The function uses `FLOW_SECRET_KEY` only to call the wrappers below, then drops that client.

#### Credential wrappers

`private` is not on PostgREST, so these are `public` `security definer` functions. `EXECUTE` is granted to `service_role` only and revoked from `public`, `anon`, and `authenticated`. The app calls the function routes. The routes call these wrappers. The signed-in user never calls them.

| Function | Used by |
| --- | --- |
| `public.store_mcp_credential(...)` | Mint. One active token: revoke the current row, then insert |
| `public.revoke_mcp_credential(uuid)` | ניתוק and a reconnect. Sets `revoked_at` |
| `public.mcp_credential_status()` | The Settings row: empty, connected, or expired, plus `last_used_at` and scope |
| `public.lookup_mcp_credential(text)` | Resolve the HMAC |
| `public.touch_mcp_credential(uuid)` | Set `last_used_at` |
| `public.bump_mcp_rate(uuid, uuid, text)` | One atomic increment for the token and the user |
| `public.note_auth_failure(text)` | Count a failed secret for the throttle address |

Mint verifies the app's user JWT by calling GoTrue `getUser` (`GET /auth/v1/user`). That check uses the project's JWKS. A payload decoded in the function, with no `getUser` call, is rejected. The pepper never leaves the function. The secret is `flow_mcp_` plus 43 base64url characters. At rest it is HMAC-SHA256 with `FLOW_MCP_PEPPER`. It is returned once. `expires_at` is 90 days.

Write functions in this release are granted to `authenticated` only, not to `service_role`.

#### Limits and audit

Scopes are checked before the JWT is signed. A read tool needs `read`. A write tool needs `write`, and a miss returns `forbidden`. Unknown, revoked, expired, and bad secrets are HTTP 401. Over the limit, and the failure throttle, are HTTP 429 with `retry_after_seconds`. One token: 60 reads and 20 writes a minute. One user: 120 reads and 40 writes a minute. The throttle address is `cf-connecting-ip`, the client IP Cloudflare sets and the client cannot choose. A missing header uses the bucket `unknown` and still counts. `x-forwarded-for` is not the throttle key.

A write wrapper reads `mcp_tid` from `request.jwt.claims`. That claim is not an argument. The audit row stores it. `channel` is `mcp` only when the claim is present. The same wrapper stores the idempotency key in `private.mcp_idempotency`, written from the definer, not from PostgREST. The same key and hash return the stored response. A different hash is `conflict`.

#### Writes and undo

An assistant write sets `user_assigned` true. `upsert_sumit_documents` keeps project, category, and `pnl_role` when that flag is true. `private.fill_suggested_category` sets `category_suggested` false when `user_assigned` is true. A pgTAP test assigns through the wrapper, runs the sync upsert, and asserts `project_id`, `category_id`, `category_suggested`, `pnl_role`, and the allocation rows did not change.

`resolve_review` with `approved` does not insert `reassign_undo`. `undo_reassign` reopens a review only when its status is `changed`. Undo is therefore typed.

| `undo.kind` | When | Call |
| --- | --- | --- |
| `review` | The write closed an open review | `reopen_review` on that review id |
| `reassign` | The write did not close a review | `undo_reassign` on the undo id |

`reopen_review` puts the card back in לאישור, restores the prior project, category, role, and shares, and restores `remembered_category_id` when this approval wrote it. That is the same restore as ביטול in the app. Before either call, the wrapper compares the transaction's `updated_at` with the value stored at the assistant's write. If it differs, the tool returns `conflict` and does not write. A later owner edit is left in place. pgTAP covers both kinds, and covers `conflict` for each when the row was updated after the assistant's write.

`approve_review_item` is the shared close. The assistant passes the new project and category and omits the shown ids. אישור passes the project and category the card showed. If those shown ids differ from the stored row, the function returns `stale` and writes nothing. The app reloads the card and shows one info toast for 4 seconds: "השיוך עודכן. בדקו את הכרטיס." If the item is already closed and it belongs to this company, the function returns `already_closed` and does not call `resolve_review`. The app shows one info toast for 4 seconds: "הפריט כבר טופל." A missing id, or another company's id, is `not_found`. `resolve_review` stays `void`. `skip_review` is not in this release.

`resolve_review` refusals, mapped to `refused` with that exact message, are: `no company`, `unknown review action`, `review item not found`, `shared costs are split, not assigned to one project`, `category is required`, `project or category not found`, `category kind must match the direction`, `project and category are required`. Any other exception is `refused` with `The write was refused.` The wrapper's own `not_found` and `already_closed` are decided before that call, so `review item not found` is not used to mean another company.

#### Visit counter

[0069](0069-back-and-one-tap-review.md) point 8 still means that a local skip or approve advances the counter for this visit and does not shrink the visit's `n`. `h` is how many cards this visit has handled. `h` only increases. `n` is `h` plus the open cards. `i` is `h + 1`. `i` never decreases and never exceeds `n`. A remote close or a new open card (a reopen, or a SUMIT sync during the visit) changes the open count, so `n` changes and `i` stays. When the open count is 0 the counter is not shown. The empty state stays title "הכל מאושר" and body "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."

#### Refresh and hold

A refetch on focus, or when the document becomes visible, updates `review`, `dashboard`, `unpaid`, `project`, `project-category`, `project-waiting`, `filed-today`, and `txn`. This ships in cycle 3 with the writes. While a sheet for a row is open, a pointer or mouse button is down on it, or keyboard focus is inside that row or its sheet, the refetch does not move that row. Lists take a new order only when none of those holds are active and scrolling has settled.

#### שויכו היום

Cycle 3 extends the list. It is still today's auto-assigned SUMIT rows that are not in an open review, plus rows this assistant approved today that are not in an open review. A row in both sets is one row. The count is the number of rows. When every row is from the old set, the banner stays "N תנועות שויכו היום בלי להמתין בתור". When any row is an assistant approval, the banner is "N תנועות שויכו היום". The count of 1 uses the singular: "תנועה אחת שויכה היום" and, for the old set only, "תנועה אחת שויכה היום בלי להמתין בתור". This is specified here. Point 11 of [0069](0069-back-and-one-tap-review.md) is not edited.

#### Settings

Section עוזר, directly under the SUMIT block, uses the same list row and the same destructive `ConfirmSheet` as ניתוק on SUMIT. The connect sheet's scope control is the two options above, with read and write selected.

| State | What the owner sees |
| --- | --- |
| Empty | Title "עוזר", hint "לא מחובר", action "חיבור עוזר" |
| Loading | The row is busy and does not look connected |
| Error | The SUMIT error line under the row. The last state stays |
| No company | The row is disabled. The hint says why |
| Connect | Title "חיבור עוזר". Body "הקוד מוצג פעם אחת. העתיקו אותו לחלון העוזר." The secret is a read-only field, `<bdi dir="ltr">`, monospace. "העתקה" writes the clipboard and shows an info toast for 4 seconds: "הועתק". If the clipboard refuses, the field selects all of the secret and no success toast shows |
| Connected | "מחובר · קריאה וכתיבה · שימוש אחרון " plus `<bdi dir="ltr">30/09/2026, 14:05</bdi>` in Asia/Jerusalem, `dd/mm/yyyy, HH:mm`. No use yet: "מחובר · קריאה וכתיבה · עדיין אין שימוש". A read-only token says "קריאה בלבד" in that place |
| Expired | Hint "התוקף פג". Action "חיבור מחדש" |
| ניתוק | A danger row under the status row, shown when connected or expired. It opens the confirm sheet. Title "לנתק את העוזר?" Consequence "הקוד יפסיק לעבוד. הספרים נשארים." Confirm "ניתוק". Then an info toast for 4 seconds: "העוזר נותק." |

ניתוק sets `revoked_at` on that user's current token, active or expired. It does not delete ledger rows and it does not sign the owner out. חיבור מחדש revokes that row and mints one new secret. There is one active token.

### Cycles

Each cycle is usable without the later ones.

| Cycle | What ships | Hours |
| --- | --- | --- |
| 1 | The signing spike, the function, the public wrappers, mint, revoke, and status routes, the pepper, and the rate limit. A test mints a token without the screen | 6 |
| 2 | The עוזר row, including scope, ניתוק, and the copy above, and the six read and search tools. The owner can connect. The assistant can read | 6 |
| 3 | `assign_expense`, `set_expense_category`, typed undo and its pgTAP, the SUMIT overwrite test, אישור's shown-values check and the two toasts, the focus refetch, the hold, the visit counter, and שויכו היום | 6 |

### Later, if needed

No schemas until a later record. `tools/list` does not include these.

- `bulk_assign`, a signed preview, `undo_batch`, and one toast. The preview runs the real writes in a subtransaction and rolls it back. Apply takes `FOR UPDATE` and re-checks `updated_at`. The confirmation is bound to the token, the user, the tool, and a nonce, and it is single-use. A bad signature is `validation`. `conflict` is a changed `updated_at` only. `apply_batch` is granted to `authenticated` only. The confirmation key is `FLOW_MCP_CONFIRM_KEY`, not the pepper. A count of 1 on that toast is "תנועה אחת שויכה בעוזר". Any larger count is "N תנועות שויכו בעוזר".
- The ` · בעוזר` marker, and a 15-second poll while the document is visible. Realtime stays off.
- `split_expense`, `collapse_expense`, `create_project`, `rename_project`, and `finish_project`.

Code nits N19–N28 are backlog, apart from the items this record already states: `stale` and `forbidden`, the `resolve_review` refusal list, `cf-connecting-ip`, the deprecation wording, the wider SUMIT test, and `getUser` for the app JWT.

### Noted for the first release

A review id passed to a transaction tool is `validation` with message `id is not a transaction; list_review.id is the review id`. Error text is a fixed string. No tool performs outbound HTTP.

## Alternatives rejected

Treating tool annotations as a confirmation Flow can rely on. Flow never sees them.

Calling `undo_reassign` after `resolve_review` with `approved`. That function does not write `reassign_undo`, and `undo_reassign` does not reopen an `approved` row.

Letting undo overwrite a transaction the owner edited later.

Putting the credential functions in `private` and expecting PostgREST to call them.

Holding Auth's signing key inside the function when the spike shows no other key works.

Putting `FLOW_JWT_LEGACY` or `service_role` in GitHub.

## Consequences

No application code ships with this record. After cycle 2 the owner can connect an assistant that can read. After cycle 3 a write leaves לאישור, can be undone without covering a later edit, and the visit counter and שויכו היום follow this record.

## Open questions

These do not block the first release.

1. Which client connects first? OAuth waits unless that client cannot store the secret.
2. Should a later write also remember the project? Nothing writes `remembered_project_id`.
3. May a later release create a category? This release only assigns categories that already exist ([0008](0008-flat-categories-hide-or-merge.md)).
