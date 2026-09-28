# SUMIT drift stops the import, and the inbound hook stays off

**Date:** 2026-09-28
**Status:** Accepted

## Context

`listentities` is undocumented. A missing amount or date must not be invented. Registering a SUMIT trigger would be a write, which Flow does not do.

## Decision

The allowlist adds `accounting/documents/list` and nothing that creates or updates. If the first CRM page is missing `ID` or the accounting fields the mapper needs, sync tries `documents/list` once. If that page also does not map, the ledger is left as it was, `drift_fields` is stored, and the error is shown in Settings.

`sumit-hook` returns 404 unless the secret `SUMIT_HOOK_ENABLED` is exactly `true`. The body is ignored. The token is the company's `hook_token`, not the API key.

## Consequences

A changed SUMIT payload is visible and does not zero the books. Turning the hook on is an explicit operator step.
