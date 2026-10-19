# Reads stay fresh for 30 minutes; writes, syncs and focus refresh them

**Date:** 2026-10-19
**Status:** Accepted

Amends [0080](0080-mcp-connector.md): its refetch on every focus.

## Context

[0080](0080-mcp-connector.md) refetched the review, dashboard, unpaid, project and transaction reads on every focus, and every other read refetched each time a screen opened it (TanStack Query's `staleTime` was 0). A measurement found 15 reads on each return to Home, most of them answering what the screen already showed. The books change rarely: a bank sync, a write in the app, or an agent through MCP.

## Decision

The owner chose 30 minutes.

- **Freshness.** A read stays fresh for 30 minutes and stays cached for 60 (`app/src/query-client.ts`). A screen opened again inside that window draws from the cache with no read.
- **Stale after any write.** Every write marks every cached read stale, without reading now: `useWrite` through the client's mutation hook, and every other write path through `useInvalidateBooks`. The write's own keys refetch on screen; the next screen opened reads again. A project page that starts from the Projects list's row reads again when a write marked the list stale.
- **Sync.** A finished bank or SUMIT sync, here or in another tab, refetches every ledger read (`app/src/ledger-keys.ts`, `LEDGER_KEYS`). `ledger-keys.test.ts` fails when a read's key is in neither that list nor the short list of account reads (companies, team, settings, the setup run).
- **Focus, throttled.** Focus or the document becoming visible refetches the same `LEDGER_KEYS` on screen, at most once every 5 minutes, counted from load. Inside the 5 minutes it marks them stale instead, so an outside change (an agent, the server's sync every 5 minutes) shows on the next screen opened. The holds of 0080 (an open sheet, a pressed row, keyboard focus) are unchanged.
- **Sync status, always.** The SUMIT and Mercury status reads refetch on every focus, fresh or not (`refetchOnWindowFocus: "always"`), so a sync another tab started still shows at once.

## Alternatives rejected

**30 seconds.** Most returns to a screen happen within minutes, so it would have saved little; the owner preferred the longer window with the refresh rules above.

**Refetch every ledger read on every focus.** With every screen's reads in the list, a tab switch would refetch all of them; the throttle and the stale mark keep outside changes visible without that.

## Consequences

A change made outside the app (an agent, another device) shows on the next screen opened after a focus, or on screen within 5 minutes of the last focus refetch. A new read's key must join `LEDGER_KEYS` or the account list, or its test fails.
