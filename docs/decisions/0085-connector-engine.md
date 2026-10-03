# One connector engine

**Date:** 2026-10-03
**Status:** Accepted

## Context

SUMIT is the first data source ([0035](0035-sumit-api-first.md), [0042](0042-sumit-primary-income-and-expenses.md)). Mercury is a second source ([0086](0086-mercury.md)). Each new bank cannot grow its own tables, jobs, and `if provider` branches. The books under test are test data. [0059](0059-live-sumit-only.md) still means the signed-in books come from the live import, and the golden JSON stays the test answer key.

## Decision

One engine serves every connector. A provider implements a port: validate, fetch, normalize, capabilities, a GET allowlist, error class, and redact. The server registry is a map from provider to adapter, key-encryption env, and schedule. The client has a descriptor (Hebrew name, icon, copy). The core does not branch on the provider name.

SUMIT moves onto that engine in this stack. Objects named `sumit_*` that are tables, views, or SUMIT-only jobs are dropped. There is no backup and no shadow run. Parity is the existing tests. `upsert_sumit_documents(p_company, p_docs)` stays a wrapper with the same signature, so its pgTAP suites stay. `sumit-sync` and `sumit-connect` stay as aliases. Vault `flow_sync_url` still targets `/sumit-sync`.

`SUMIT_KEK` and `MERCURY_KEK` are different env vars. The envelope still binds the company id ([0048](0048-sumit-key-envelope.md)). Copying a SUMIT row copies the ciphertext bytes unchanged.

Refresh floors stay 60 seconds when the owner asks and 6 hours otherwise ([0049](0049-sumit-refresh.md)), per connection. One daily job and one drain job serve every provider. The sync cursor advances in the same transaction as the lines.

The stack is one migration. No other migration merges while it is open. The coordinator merges it after both code reviewers approve and CI is green.

The names, SQL signatures, grants, and RLS are in [the connector contract](../tech/connector-contract.md). This record does not ship the migration.

## Alternatives rejected

A second SUMIT-shaped stack for Mercury. Keeping `sumit_*` tables beside the new tables. A shadow run of both writers. One shared KEK. Provider branches in the P&L functions.

## Consequences

Later layers build on the names in the contract. L0 is the contract, the types, and the Mercury GET types. It does not migrate and does not change behaviour. Adding a third connector is a registry entry and a folder under `connectors/`, not a change to the engine.
