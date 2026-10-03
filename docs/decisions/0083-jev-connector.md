# Jev is an optional connector and the key stays on the server

**Date:** 2026-10-03
**Status:** Accepted

## Context

Jev, TypeSafe's decision model, can suggest a project, a category, whether a line is overhead, and an anomaly score for a SUMIT bank line. The suggestion is optional. With the connector off, or with Jev down, slow, or out of credit, a line still waits in לאישור for a person. Amounts, VAT, and dates stay in Flow's own code. [0011](0011-auto-approve-high-confidence.md) still means an invoice match or a supplier rule, not a Jev score. [0048](0048-sumit-key-envelope.md) keeps the SUMIT key in its own seal. This record does not move that key.

## Decision

The connector is off unless a member of that company turns it on. A company with no `company_integrations` row is off. The stored default is `enabled` false, `mode` `shadow`, and `threshold` 0.90. Until the tagging job ships, `mode` is only `off` or `shadow`, and `threshold` is from 0.50 to 1.00. `auto` is refused.

`mode` `shadow` means a later job may store a suggestion and must leave the line in לאישור. This record does not apply a suggestion and does not approve a line.

`tag_suggestions` stores one labelling per bank line and pinned model. The answers are a JSON object of per-question answers and probabilities. `model_version` is the pin the client sent. `response_model` is the model string the API returned, and it may differ. The client does not refuse that difference. Members of the company can read the row. Insert, update, and delete are the service role, for the tagging job. A suggestion cannot point at another company's transaction.

`set_company_integration(p_enabled, p_mode, p_threshold, p_provider)` is the member write. The company is the session's company. `p_provider` must be `jev`. `p_mode` must be `off` or `shadow`. `p_threshold` must be from 0.50 to 1.00. A null mode or threshold keeps the stored value. Anon cannot call it. A user with no company is refused.

The API is `POST https://api.typesafe.ai/v1/systemone`. The body is `model`, `state`, and `questions`. The model sent is pinned to `jev-1.13.0`. `question` is not a field. 429 and 529 retry with backoff, honouring `Retry-After` up to 8 seconds, at most four attempts. The 8 second limit covers the response body, not only the headers. A timeout, a 4xx other than those two, and a 5xx other than 529 do not retry. A missing key does not call the network.

The key is the Vault secret `jev_api_key`. Scope: the TypeSafe Jev API bearer key, one project-wide server secret. It is not a per-company key and it is not the SUMIT key. `public.read_jev_api_key()` reads it. Execute is `service_role` only, because the tagging job runs as an Edge Function, and the function also requires `auth.jwt()->>'role'` to be `service_role`, so a later grant to a member still returns forbidden. A missing or blank secret fails closed. Anon and authenticated cannot read `vault.decrypted_secrets` or `vault.secrets`. The Edge Function helper calls that RPC. It does not read an environment variable. The PWA bundle must not contain the secret name, `JEV_API_KEY`, `vault.decrypted_secrets`, `read_jev_api_key`, or `api.typesafe.ai`.

Tests use a mock. CI does not call TypeSafe. The bundle scan is [the Jev runbook](../runbooks/jev.md).

## Alternatives rejected

An Edge Function env var `JEV_API_KEY` as a second copy of the Vault secret. Putting the bearer token in the PWA. Letting a member insert `tag_suggestions` or update `company_integrations` directly. Sending `{ model, state, question }`. Calling `jev-latest`, which can move.

## Consequences

The tagging job calls `read_jev_api_key`. The Settings card calls `set_company_integration` only. It does not read the Vault secret, and the bundle does not name it. A lost Vault secret stops labelling until the secret is put back under the same name. Rotating it is a Vault change, not a client release. The card can show אין מפתח, but the live screen cannot tell a missing secret from a present one until a later status function exists. That function is not in this change.

## Decisions needed

The tagging job will allow `mode` `auto`. What that mode does is [0084](0084-jev-auto-prefill.md): a suggestion never approves a line, and at or above the threshold it pre-fills a project and category the user has not set and leaves the item in לאישור. This record does not accept `auto`. Allowing it is a later migration.
