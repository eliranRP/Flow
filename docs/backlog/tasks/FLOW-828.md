<a id="flow-828"></a>
# FLOW-828 · useWrite draws a tap's result at once and rolls back on failure
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** — · **Source:** owner, 2026-10-11: users see a lag between a tap and its result ([0180](../../decisions/0180-instant-tap-notify-on-failure.md)).
- [ ] `useWrite` takes an `optimistic` option (the query keys and each one's cached value after the write): cancel, update, snapshot, restore on failure. The success step and toast no longer wait for the refetch, which runs in the background. A failure toast and its retry work after the screen unmounts. Writes without the option behave as today.
