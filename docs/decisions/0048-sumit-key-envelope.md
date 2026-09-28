# The SUMIT API key is sealed in an Edge Function

**Date:** 2026-09-28
**Status:** Accepted

## Context

[0036](0036-sumit-read-only.md) says the key stays server-side. The browser must be able to connect and disconnect, and to see whether a sync worked, without ever receiving the key.

## Decision

`sumit-connect` seals the key with AES-GCM. A fresh DEK encrypts the key. `SUMIT_KEK`, a 32-byte secret, encrypts the DEK. Both ciphertexts and their nonces live in `sumit_connections`. The function returns only `{ connected, sumit_company_id }`.

Generate the secret with `openssl rand -base64 32` and set it in the function secrets. It is not a file in the repo.

`disconnect_sumit` deletes that row. Imported transactions stay. Authenticated clients can read status columns only.

## Alternatives rejected

Storing the key in the browser, or in a tracked env file. Using the service-role key in the client to write the ciphertext.

## Consequences

Rotating the KEK means re-wrapping every connection. A lost KEK makes the stored keys unreadable; the owner pastes the SUMIT key again.

Sync opens every row with the one `SUMIT_KEK`. `kek_version` is stored on the seal and is not read when the key is opened. Rotation is recorded and is not supported until a later decision re-wraps each row. [0065](0065-review-round5.md).
