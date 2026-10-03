# Jev is an optional connector and the key stays on the server

**Date:** 2026-10-03
**Status:** Accepted

## Context

Jev, TypeSafe's decision model, can suggest a project, a category, whether a line is overhead, and an anomaly score for a SUMIT bank line. The suggestion is optional. With the connector off, or with Jev down, slow, or out of credit, a line still waits in לאישור for a person. Amounts, VAT, and dates stay in Flow's own code. [0011](0011-auto-approve-high-confidence.md) still means an invoice match or a supplier rule, not a Jev score. [0048](0048-sumit-key-envelope.md) keeps the SUMIT key in its own seal. This record does not move that key.

## Decision

The connector is off unless a member of that company turns it on. A company with no `company_integrations` row is off. The stored default is `enabled` false, `mode` `shadow`, and `threshold` 0.90.

`mode` `shadow` means a later job may store a suggestion and must leave the line in לאישור. `mode` `auto` is stored for that job. This record does not apply a suggestion and does not approve a line.

`tag_suggestions` stores one labelling per bank line and model version. The answers are a JSON object of per-question answers and probabilities. Members of the company can read the row. Insert, update, and delete are the service role, for the tagging job. A suggestion cannot point at another company's transaction.

`set_company_integration(p_enabled, p_mode, p_threshold, p_provider)` is the member write. The company is the session's company. `p_provider` must be `jev`. A null mode or threshold keeps the stored value. Anon cannot call it. A user with no company is refused.

The API is `POST https://api.typesafe.ai/v1/systemone`. The body is `model`, `state`, and `questions`. The model is pinned to `jev-1.13.0`. `question` is not a field. 429 and 529 retry with backoff, honouring `Retry-After` up to 8 seconds, at most four attempts. A timeout, a 4xx other than those two, and a 5xx other than 529 do not retry. A missing key does not call the network.

The key is the Vault secret `jev_api_key`. Scope: the TypeSafe Jev API bearer key, one project-wide server secret. It is not a per-company key and it is not the SUMIT key. `public.read_jev_api_key()` reads it. Execute is `service_role` only, and the function also requires that role, so a later grant to a member still returns forbidden. A missing or blank secret fails closed. Anon and authenticated cannot read `vault.decrypted_secrets` or `vault.secrets`. The Edge Function helper calls that RPC. It does not read an environment variable. The PWA bundle must not contain the secret name, `JEV_API_KEY`, `vault.decrypted_secrets`, or `read_jev_api_key`.

Tests use a mock. CI does not call TypeSafe. The bundle scan is [the Jev runbook](../runbooks/jev.md).

## Alternatives rejected

An Edge Function env var `JEV_API_KEY` as a second copy of the Vault secret. Putting the bearer token in the PWA. Letting a member insert `tag_suggestions` or update `company_integrations` directly. Sending `{ model, state, question }`. Calling `jev-latest`, which can move.

## Consequences

The tagging job and the Settings control are later changes. They call `read_jev_api_key` and `set_company_integration`. They do not add a new place to store the key. A lost Vault secret stops labelling until the secret is put back under the same name. Rotating it is a Vault change, not a client release.

## Decisions needed

What `auto` does to לאישור, and whether the threshold gates that, belongs to the tagging job. This record only stores the columns.
