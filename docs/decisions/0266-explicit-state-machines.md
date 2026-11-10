# 0266 · State machines are written as one table

**Date:** 2026-11-10
**Status:** Accepted

## Context

The owner, 2026-11-10: "Find all the implicit state machine in my app", then "make state machines explicit", in the way that serves the user, the developer and the agent at once, without breaking anything.

A read of the whole repo found about sixty parts with a small set of states and rules for moving between them: saves, sheets, toasts, gestures, the setup wizard, the bank syncs, the tagging job, and the status columns in the database. Nearly all hold their state in several booleans, refs or nullable timestamps, and their rules in `if`s spread over the handlers. Three costs follow. The user meets states nobody meant: the setup's first step stayed busy for good when `create_company` was refused, because one of the ways a save can end never cleared the flag. A developer cannot see which moves are legal without reading every handler. An agent sent to change one flow has no page that says what the flow is, and adds one more boolean.

## Decision

1. A machine is one table: each state, the events it accepts, and the state each leads to. `defineMachine` in `packages/shared/src/machine.ts` builds it, with no dependency, so the app, the edge functions and `flow-mcp` can all use it. An event a state does not list changes nothing.
2. In a component, `useMachine` (`app/src/use-machine.ts`) holds the state. `send` answers from the machine's own state, not the drawn one, so it guards two taps in one tick.
3. Every machine's test asserts `machineProblems` is empty: each state is reached, and each state that is not final has a way out.
4. [docs/tech/state-machines.md](../tech/state-machines.md) lists every machine, explicit or not, with its states, where it lives and its open gaps. A PR that adds or changes a machine updates its row.
5. Nothing is rewritten for its own sake. A machine moves onto the table in the PR that next changes it, or in a task that fixes one of its gaps; its behaviour stays the same except for the states the table makes impossible. A new flow with three or more states, or with a save, starts as a table.
6. The first machine is `saveFlow` (`idle`, `saving`, `failed`), used by the setup's steps 1, 3, 5 and 7. It fixes the stuck first step and refuses a second tap while a save runs (FLOW-1160).
7. In SQL the same rule reads: one `CHECK` ties together the columns that make a state, and each move is made by one function whose `WHERE` names the state it leaves. The gaps found are tasks (FLOW-1166), each its own migration.

## Alternatives rejected

- **A state-chart library (XState).** It would add to Home's first load, bring a second way to hold state beside React Query, and none of the machines found needs nested or parallel states.
- **`useReducer` in each component.** It names the states but not the moves: a reducer accepts any action in any state unless each case checks, which is the `if` in every handler again. It also cannot be used in an edge function or listed for a doc.
- **Rewrite every machine now.** About sixty flows in one change cannot be reviewed or proved unbroken. The map and the helper come first; each flow moves when it is next touched.
- **Only write the map.** A map with no helper leaves the next flow to be written as booleans again.

## Consequences

- A save's button cannot stay busy: every ending of `saving` is an event in the table, and the test fails if one is missing.
- A reviewer checks a changed flow against its row in the map, and asks for the row when a PR changes a flow without it.
- The helper is about 80 lines and ships with the setup's chunk, not with Home.
- The open gaps the read found are FLOW-1161 to FLOW-1168.
