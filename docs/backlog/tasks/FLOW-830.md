<a id="flow-830"></a>
# FLOW-830 · A gate on how fast a tap answers
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** FLOW-828 · **Source:** owner, 2026-10-11 ([0180](../../decisions/0180-instant-tap-notify-on-failure.md)).
- [ ] `app/perf/tap-response.spec.ts`: with the stub backend answering writes after 1 second, each instant write's control shows its result within 200 ms; a write the stub fails rolls back and toasts with ניסיון חוזר. It runs with the page-speed specs when the change reaches those screens.
