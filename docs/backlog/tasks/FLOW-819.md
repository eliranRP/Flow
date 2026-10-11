<a id="flow-819"></a>
# FLOW-819 · Remove the stories and components the app no longer uses
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** — · **Source:** owner, 2026-10-11: CI is slow, and Storybook keeps stories for parts nobody deletes.
- [ ] Find the components and exports under `app/src` that no screen uses any more, only their own stories or tests. Delete them with their stories, tests and CSS, so the every-story pass on main and in the gate opens fewer stories.
- [ ] A check in `check (core)` and the local gate fails when a story or a component is reachable only from stories and tests, so an orphan can't come back.
