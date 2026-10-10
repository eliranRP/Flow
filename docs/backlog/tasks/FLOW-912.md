<a id="flow-912"></a>
# FLOW-912 · The speed checks hold the median of 5 opens
- **Type:** TASK · **Status:** done (#546) · **Source:** the lane manager, 2026-10-10: the project-open check failed on main at 735 ms with no change behind it; single opens on the gate's machine range from 360 to 1020 ms.
- [ ] The four tap checks in app/perf (project open, project history, the tab pages, a project opened before) open 5 times and hold the median to the same 0.7 s limit, through one shared rule (app/perf/runs.ts).
- [ ] Each check's line prints every open's time in the order it ran, so a real slowdown (every open up) reads apart from one slow open.
- [ ] The checks poll every 10 ms, so the wait between polls no longer adds up to 350 ms to an open.
- [ ] The project page reads Home's late bills and changed charges once its own read has landed, like its groups, so two reads stay out of its first paint (about 60 ms off an open at CPU ×4).
