# FLOW-503: Mercury in the setup flow

- PR: #342
- Kind: screen
- Changed: setup step 1 (app/src/setup/steps.tsx, copy.ts). The step is "חיבור ספרים ובנק". "חיבור SUMIT" stays primary; a full-width secondary "חיבור Mercury" under it opens the shared `MercuryConnectSheet` with "ייבוא מ", the same sheet Settings uses, untouched. Connecting either connector marks the step done, so the Home card drops it too. New stories: Screens/Setup → Connect step, SUMIT or Mercury (390, 320).
- Rule: a setup step with two ways in keeps one primary button and puts the other as a full-width secondary button under it, never a second primary.
- Source: FLOW-503 (SMALL UI), approved by the design lead (2026-10-09).
