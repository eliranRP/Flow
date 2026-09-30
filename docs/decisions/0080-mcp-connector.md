# An MCP connector tags one expense at a time

**Date:** 2026-09-30
**Status:** Accepted

Accepted for the first release below. The deferred section is an outline, not a commitment. [0006](0006-confirm-not-type.md), [0011](0011-auto-approve-high-confidence.md), and [0069](0069-back-and-one-tap-review.md) keep their own rules. Each points here, and this record extends them.

## Context

The owner wants an assistant to read the ledger and assign a project and a category. The app stays the display. The first release is 18 hours, inside the 22-hour target, so each cycle stays at or under 6 hours and can ship on its own. Later tools wait until they are needed.

Tool names and payloads are in [MCP tools](../mcp/TOOLS.md). `tools/list` returns only the handlers that cycle has shipped. A token whose scope is read only lists the read tools.

## Decision

### Owner decisions

1. **Scope.** The first release includes the read and search tools, `assign_expense`, `set_expense_category`, minting, the Settings עוזר row, a refetch on focus and when the document becomes visible, the visit counter, שויכו היום for an assistant approval, and the security model in this record.
2. **Approval.** Flow accepts an assistant write. It does not ask the owner to confirm again, including when the item is in לאישור. `assign_expense` and `set_expense_category` on an open review call `public.approve_review_item`, which calls `resolve_review` with `approved`, and the card leaves the queue. The annotations on a tool (`readOnlyHint`, `destructiveHint`, `idempotentHint`) are hints for the client. Flow cannot require them and does not read them. A client may show its own permission prompt. That prompt is not a Flow control. The safety nets Flow does enforce are a write scope, the rate limits, an audit row whose token id is the JWT claim `mcp_tid`, undo, and revoke.
3. **Remember.** MCP writes default `remember` to false. The tool accepts `remember: true`. The change sheet in the app is unchanged. A rule the owner never saw is a wrong default, as in [0006](0006-confirm-not-type.md).
4. **Token scope.** The connect sheet's first step is a `RadioRow`. The default is "קריאה וכתיבה" (`read` and `write`). "קריאה בלבד" is `read` only. A tap selects. It does not mint. "יצירת קוד" mints. Once minted, the scope is locked. Changing it is ניתוק, then a new connect. A read-only token's `tools/list` contains only the read tools.

### First release

The function is `flow-mcp`. Protocol `2025-06-18`. A tool result carries `structuredContent`. One JSON-RPC message per POST. `verify_jwt` is false. The bearer is the MCP secret.

There is no `access-control-allow-origin: *`. The MCP route allows a missing `Origin` and rejects any other. The mint, revoke, and status routes allow only the app origins. Anything else is 403. GET is 405.

#### Signing spike

Cycle 1 starts with a spike. The builder owns it. Pass means all of these:

1. The project has an additional asymmetric JWT signing key. It is not the key Auth uses to sign session tokens.
2. The function signs a 60-second JWT with that key: `role` `authenticated`, a known user's `sub`, `iss`, `jti`, and `mcp_tid`. The header carries `kid`.
3. PostgREST accepts it. An RPC runs as that user and returns that user's company. The same call does not return another company's rows.
4. The function request includes `cf-connecting-ip`. If it does not, criterion 4 fails and the spike stops. A missing header is not a pass.

If the only key PostgREST will accept is the in-use Auth signing key, the spike stops. The function does not hold Auth's own private key. The fallback is the legacy HS256 secret, set as the function secret `FLOW_JWT_LEGACY` in the Supabase dashboard. That name is never a GitHub secret. The signer still sets only `role` `authenticated`. The legacy shared secret is deprecated by the end of 2026. This record does not treat that date as the day it is deleted. The fallback is a dependency to retire before that deprecation leaves the secret unusable. It can mint any role, which is why it is not the normal path. Supabase rejects secret names that start with `SUPABASE_`.

On a pass, the function secret is `FLOW_MCP_SIGNING_KEY` and `FLOW_JWT_LEGACY` is not created.

#### Secrets and deploy

The production deploy job deploys `flow-mcp` and then sets function secrets from the GitHub environment `production`:

| GitHub environment `production` | Function secret | First release |
| --- | --- | --- |
| `FLOW_MCP_SIGNING_KEY` | same | yes, after the spike passes |
| `FLOW_MCP_PEPPER` | same, with its `kid` | yes |
| `FLOW_MCP_CONFIRM_KEY` | same, its own `kid` | no, deferred with bulk |

`FLOW_JWT_LEGACY` is not in that environment and is not in the workflow. There is no service_role-equivalent key in GitHub. Hosted functions already receive `SUPABASE_SECRET_KEYS`. The function uses that injected key only to call the wrappers below, then drops that client. Ledger calls use the publishable key and the 60-second JWT.

#### Credential wrappers

`private` is not on PostgREST, so these are `public` `security definer` functions. Each sets `search_path` to `''`. `EXECUTE` is granted to `service_role` only and revoked from `public`, `anon`, and `authenticated`. The app calls the function routes. The routes call these wrappers. The signed-in user never calls them.

| Function | Used by |
| --- | --- |
| `public.store_mcp_credential(p_user uuid, p_token_hash text, p_scope text[], p_expires_at timestamptz) returns uuid` | Mint. `company_id` is the company owned by `p_user`. One active token: revoke the current row, then insert |
| `public.revoke_mcp_credential(p_user uuid, p_id uuid)` | ניתוק and a reconnect. Sets `revoked_at` only when that row's user is `p_user`. Otherwise `not_found` |
| `public.mcp_credential_status(p_user uuid)` | That user's row only: empty, connected, or expired, plus `last_used_at` and scope |
| `public.lookup_mcp_credential(text)` | Resolve the HMAC |
| `public.touch_mcp_credential(uuid)` | Set `last_used_at` |
| `public.bump_mcp_rate(uuid, uuid, text)` | One atomic increment for the token and the user |
| `public.note_auth_failure(text)` | Count a failed secret for the throttle address |

`p_user` is the id from the verified `getUser` call in the function. Mint, revoke, and status never read a user id from the request body. Mint verifies the app's user JWT by calling GoTrue `getUser` (`GET /auth/v1/user`). GoTrue validates that JWT. The function does not call `getClaims`, and it does not validate the JWT against JWKS itself. A payload decoded in the function, with no `getUser` call, is rejected. The pepper never leaves the function. The secret is `flow_mcp_` plus 43 base64url characters. At rest it is HMAC-SHA256 with `FLOW_MCP_PEPPER`. It is returned once. `expires_at` is 90 days.

Write functions in this release are granted to `authenticated` only, not to `service_role`.

#### Limits and audit

Scopes are checked before the JWT is signed. A read tool needs `read`. A write tool needs `write`, and a miss returns `forbidden`. Unknown, revoked, expired, and bad secrets are HTTP 401. Over the limit, and the failure throttle, are HTTP 429 with `retry_after_seconds`. One token: 60 reads and 20 writes a minute. One user: 120 reads and 40 writes a minute. The throttle counts only a request whose secret check failed, keyed by `cf-connecting-ip`, the client IP Cloudflare sets and the client cannot choose. One address is limited to 30 failed secrets a minute. The signing spike confirms that header reaches the function. There is no `unknown` bucket. A missing header skips the IP throttle for that request. A bad secret is still 401. A request with a valid token is not counted and is not rejected by that throttle, so failures from the same address cannot lock the owner out. `x-forwarded-for` is not the throttle key.

A write wrapper reads `mcp_tid` from `request.jwt.claims`. That claim is not an argument. The audit row stores it. `channel` is `mcp` only when the claim is present. The same wrapper stores the idempotency key in `private.mcp_idempotency`, written from the definer, not from PostgREST. The same key and hash return the stored response. A different hash is `conflict`.

#### Writes and undo

An assistant write sets `user_assigned` true. `upsert_sumit_documents` keeps project, category, and `pnl_role` when that flag is true. `private.fill_suggested_category` sets `category_suggested` false when `user_assigned` is true. A pgTAP test assigns through the wrapper, runs the sync upsert, and asserts `project_id`, `category_id`, `category_suggested`, `pnl_role`, and the allocation rows did not change.

`resolve_review` with `approved` does not insert `reassign_undo`. `undo_reassign` reopens a review only when its status is `changed`. Undo is therefore typed.

| `undo.kind` | When | Call |
| --- | --- | --- |
| `review` | The write closed an open review | `reopen_review` on that review id |
| `reassign` | The write did not close a review | `undo_reassign` on the undo id |

`reopen_review` puts the card back in לאישור, restores the prior project, category, role, and shares, and restores `remembered_category_id` when this approval wrote it. That is the same restore as ביטול in the app.

`transactions_touch` sets `updated_at` on every update, and the sync's `ON CONFLICT DO UPDATE` has no `WHERE`, so a later sync changes `updated_at` even when the assignment columns stay. Undo does not compare `updated_at`.

The write wrapper inserts `private.mcp_writes` in the same transaction. RLS is on, there are no policies, and `authenticated` has no grant. The row stores the token id, the user, the transaction id and the review id, `kind` (`review` or `reassign`), the post-write snapshot of `project_id`, `category_id`, `pnl_role`, and the shares (`project_id`, `share_bp`), and `undone_at`. Undo sets `undone_at`. A row that already has `undone_at` is single-use and is `not_found`.

Undo accepts only an id recorded there for this user. Any other id is `not_found`, including an approval the owner made in the app, so the tool cannot reopen it. When the id is recorded, the wrapper compares the current project, category, `pnl_role`, and shares with that snapshot. Equal means proceed, including after a SUMIT sync that only bumped `updated_at`. Any difference is `conflict` and the later edit stays. pgTAP covers both undo kinds, and these three cases: a sync then undo succeeds; a real owner edit then undo is `conflict`; an unknown id is `not_found`.

`approve_review_item` is the shared close. The assistant passes the new project and category and omits the shown ids, so `assign_expense` and `set_expense_category` do not return `stale`. `stale` is app-only. אישור passes the project and category the card showed. If those shown ids differ from the stored row, the app path returns `stale` and writes nothing. The app reloads the card and shows one info toast for 4 seconds: "השיוך עודכן. בדקו את הכרטיס." If the item is already closed and it belongs to this company, the function returns `already_closed` and does not call `resolve_review`. The app shows one info toast for 4 seconds: "הפריט כבר טופל." A missing id, or another company's id, is `not_found`. `resolve_review` stays `void`. `skip_review` is not in this release.

`resolve_review` refusals, mapped to `refused` with that exact message, are: `no company`, `unknown review action`, `review item not found`, `shared costs are split, not assigned to one project`, `category is required`, `project or category not found`, `category kind must match the direction`, `project and category are required`. Any other exception is `refused` with `The write was refused.` The wrapper's own `not_found` and `already_closed` are decided before that call, so `review item not found` is not used to mean another company.

#### Visit counter

[0069](0069-back-and-one-tap-review.md) point 8 still means that a local skip or approve advances the counter for this visit and does not shrink the visit's `n`. `h` is how many cards this visit has handled. `h` only increases. `n` is `h` plus the open cards. `i` is `h + 1`. `i` never decreases and never exceeds `n`. A remote close or a new open card (a reopen, or a SUMIT sync during the visit) changes the open count, so `n` changes and `i` stays. An undo returns that card to the open set and does not decrease `h`, so `n` grows by one. That growth is intended. When the open count is 0 the counter is not shown. The empty state stays title "הכל מאושר" and body "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."

#### Refresh and hold

A refetch on focus, or when the document becomes visible, updates `review`, `dashboard`, `unpaid`, `project`, `project-category`, `project-waiting`, `filed-today`, and `txn`. This ships in cycle 3 with the writes. While a sheet for a row is open, a pointer or mouse button is down on it, or keyboard focus is inside that row or its sheet, the refetch does not move that row. Lists take a new order only when none of those holds are active and scrolling has settled.

#### שויכו היום

Cycle 3 extends the list. It is still today's auto-assigned SUMIT rows that are not in an open review, plus rows this assistant approved today that are not in an open review. A row in both sets is one row. The count is the number of rows. When every row is from the old set, the banner stays "N תנועות שויכו היום בלי להמתין בתור". When any row is an assistant approval, the banner is "N תנועות שויכו היום". The count of 1 uses the singular: "תנועה אחת שויכה היום" and, for the old set only, "תנועה אחת שויכה היום בלי להמתין בתור". The empty state keeps the title "אין תנועות ששויכו היום". Its body covers a SUMIT filing and an assistant filing: "כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן." This is specified here. Point 11 of [0069](0069-back-and-one-tap-review.md) is not edited, and neither is the empty-copy sentence in [0072](0072-design-review-rulings.md).

#### Settings

Section עוזר, directly under the SUMIT block, uses the same list row and the same destructive `ConfirmSheet` as ניתוק on SUMIT.

The connect sheet has two steps. [0075](0075-save-on-tap-and-on-leave.md) does not apply: this sheet creates a secret, so a tap on a choice does not mint.

1. A `RadioRow` offers "קריאה וכתיבה" (selected) and "קריאה בלבד". A tap only selects. One primary button, "יצירת קוד", mints. The button is busy while minting and does not mint twice. A failure shows an error line, and the same button retries.
2. The secret is shown once, with "העתקה". The chosen scope is a read-only line. The scope is locked once minted. Changing it is ניתוק, then a new connect.

| State | What the owner sees |
| --- | --- |
| Empty | Title "עוזר", hint "לא מחובר", action "חיבור עוזר" |
| Loading | The row is busy and does not look connected |
| Error | The SUMIT error line under the row. The last state stays |
| No company | The row is disabled. The hint says why |
| Connect | Step 1 title "חיבור עוזר", the `RadioRow`, and "יצירת קוד", as above. Step 2 body "הקוד מוצג פעם אחת. העתיקו אותו לחלון העוזר." The secret is a read-only field, `<bdi dir="ltr">`, monospace, and the scope is a read-only line. "העתקה" writes the clipboard and shows an info toast for 4 seconds: "הועתק". If the clipboard refuses, the field selects all of the secret, the hint "העתיקו ידנית" shows, and no success toast shows |
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
| 3 | `assign_expense`, `set_expense_category`, typed undo, `private.mcp_writes`, and its pgTAP, the SUMIT overwrite test, אישור's shown-values check and the two toasts, the focus refetch, the hold, the visit counter, and שויכו היום. If the cycle runs long it splits into 3a (the writes, undo, pgTAP, and the SUMIT test) and 3b (the אישור check, the toasts, the refetch, the hold, the counter, and שויכו היום). Together they stay about 6 hours | 6 |

### Later, if needed

Those tools add no schema in this record. `private.mcp_writes` is part of the first release, above. `tools/list` does not include these.

- `bulk_assign`, a signed preview, `undo_batch`, and one toast. The preview runs the real writes in a subtransaction and rolls it back. Apply takes `FOR UPDATE` and re-checks `updated_at`. The confirmation is bound to the token, the user, the tool, and a nonce, and it is single-use. A bad signature is `validation`. `conflict` is a changed `updated_at` only. `apply_batch` is granted to `authenticated` only. The confirmation key is `FLOW_MCP_CONFIRM_KEY`, not the pepper. A count of 1 on that toast is "תנועה אחת שויכה בעוזר". Any larger count is "N תנועות שויכו בעוזר".
- The ` · בעוזר` marker, and a 15-second poll while the document is visible. Realtime stays off.
- `split_expense`, `collapse_expense`, `create_project`, `rename_project`, and `finish_project`.

Code nits N19–N28 are backlog, apart from the items this record already states: `stale` (app-only) and `forbidden`, the `resolve_review` refusal list, `cf-connecting-ip` confirmed by the spike, the deprecation wording, the wider SUMIT test, and GoTrue `getUser` for the app JWT (`getClaims` is not that check, and the function does not validate against JWKS itself).

### Noted for the first release

A review id passed to a transaction tool is `validation` with message `id is not a transaction; list_review.id is the review id`. Error text is a fixed string. No tool performs outbound HTTP.

## Alternatives rejected

Treating tool annotations as a confirmation Flow can rely on. Flow never sees them.

Calling `undo_reassign` after `resolve_review` with `approved`. That function does not write `reassign_undo`, and `undo_reassign` does not reopen an `approved` row.

Letting undo overwrite a transaction the owner edited later.

Putting the credential functions in `private` and expecting PostgREST to call them.

Holding Auth's signing key inside the function when the spike shows no other key works.

Putting `FLOW_JWT_LEGACY`, `FLOW_SECRET_KEY`, or any service_role-equivalent key in GitHub. Hosted functions already receive `SUPABASE_SECRET_KEYS`.

Taking the credential user id from the request body.

Comparing `updated_at` to decide an undo. `transactions_touch` and the sync's `ON CONFLICT DO UPDATE` change it when the assignment did not.

Minting a secret on the scope tap. [0075](0075-save-on-tap-and-on-leave.md) saves a field. This sheet creates a secret, so the tap only selects and "יצירת קוד" mints.

## Consequences

No application code ships with this record. After cycle 2 the owner can connect an assistant that can read. After cycle 3 a write leaves לאישור, can be undone without covering a later edit, and the visit counter and שויכו היום follow this record.

## Open questions

These do not block the first release.

1. Which client connects first? OAuth waits unless that client cannot store the secret.
2. Should a later write also remember the project? Nothing writes `remembered_project_id`.
3. May a later release create a category? This release only assigns categories that already exist ([0008](0008-flat-categories-hide-or-merge.md)).
