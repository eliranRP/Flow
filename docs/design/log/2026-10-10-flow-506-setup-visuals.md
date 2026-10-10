# FLOW-506: setup demo visual follow-ups

- PR: #448
- Kind: component
- Changed:
  - Every setup demo's phone keeps a 24px status-bar space (screen pixels, about 15px on a 390 stage) above its content; the scrim and full-screen layers still cover it.
  - A note in a setup step that has a demo, such as the failed SUMIT connect, lines up with the demo frame (`--space-card-inset`) instead of the text gutter, so the two tinted blocks share one edge. The bad tone keeps the red info icon of er-04.
  - During a replay שוב keeps focus, and it stays visible while it has keyboard focus; it is no longer hidden from screen readers while focused.
  - The demo card was already the shared ReviewCard (#356): border, radius, padding, divider and the הצעה or ✦ pills are the app's own.
- Rule: a tinted note under a demo frame shares the frame's inset; a focused control never hides.
- Spec: the storyboard the demos were built from is not in the repo, so today's demo timings (`SUMIT_DEMO_MS` 4120 and the other `*_DEMO_MS` in `ui/setup-demos.tsx`) and the SUMIT sheet at 320 (fields 48px, inside the 200px stage) are the spec from here on, as is step 3's length.
- Shots: /mnt/project-files/mockups/flow-506-setup-visuals/ (before and after, 320 and 390).
- Source: FLOW-506 (backlog), lane manager order.
