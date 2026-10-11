# A tap shows its result at once, and a failure comes back as a toast

**Date:** 2026-10-11
**Status:** Accepted

## Context

The owner, 2026-10-11: users see a lag between a tap and its result. They should see the action take effect at once, and hear later if it failed.

Every app write goes through `useWrite` (`app/src/use-write.ts`, 78 writes in 39 files). It waits for the server to accept the write, then waits again while it refetches every query the write touches, and only then runs the screen's success step and toast. Until both round trips finish, the control is busy and its neighbours are disabled ([0075](0075-save-on-tap-and-on-leave.md) points 1 and 5). On a phone on 4G that is commonly a second or more per tap.

## Decision

1. **Instant by default.** When the screen can draw a write's result from what the user tapped, the result is drawn in the same frame as the tap. A switch flips, a pick is checked, a row marked paid moves, an approved card leaves the queue. The write runs in the background. Neighbouring controls stay usable, so several taps in a row each take effect at once.
2. **The server's answer only corrects.** On success the app refreshes the affected queries in the background. Totals the app cannot work out itself (Home's profit, a project's figures) update when that refresh lands, and the tapped row does not wait for them.
3. **A failure is undone and said.** The screen goes back to what the server holds: the switch flips back, the card returns. A toast names what failed, even if the user has moved to another screen; toasts and the query cache belong to the session, not the screen. A dropped connection or a server error offers ניסיון חוזר, which sends the same write again. A refusal (a role, a stale card, an item already handled) says so with no retry, as today.
4. **Some writes stay busy.** A write whose result only the server can produce keeps the busy state of 0075: it creates something with a server id (a loan, a project, an invite), returns figures the screen shows next (a split save, a schedule), calls another service (connecting SUMIT or Mercury, minting an MCP code), or cannot be undone (deleting a company, a merge). Decision 0108's rename sheet is one of these.
5. **Leaving with a write still saving.** A write in flight finishes even when its screen closes. Its failure toast still shows.

This amends [0075](0075-save-on-tap-and-on-leave.md) points 1 and 5 for writes under point 1 here. The chosen row no longer shows a spinner and the other rows are not disabled while it saves. The rollback, the toast placement and the retry of 0075 stay.

## How

- `useWrite` takes an `optimistic` option: the query keys the write changes and how each cached value looks after it. It cancels those queries, updates the cache, and keeps a copy to restore on failure. It no longer waits for the background refresh before the success step and toast.
- A failure toast and its retry work after the screen unmounts.
- `app/perf/tap-response.spec.ts` (FLOW-830) is the gate. With the stub backend answering writes after 1 second, the tapped control must show its result within 200 ms. A write the stub fails must roll back and toast.
