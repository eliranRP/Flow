# FLOW-503 · Mercury in the setup flow

- **Lane:** Backlog bug fixes · **Date:** 2026-10-09 · **Approval:** SMALL UI, design lead sign-off. PR: #342
- **Rule:** a setup step with two ways in keeps one primary button and puts the other as a full-width secondary button under it, never a second primary.
- **What:** step 1 is "חיבור ספרים ובנק". "חיבור SUMIT" stays primary; "חיבור Mercury" (secondary) opens the shared `MercuryConnectSheet` with "ייבוא מ", the same sheet Settings uses, untouched. Connecting either connector marks the step done, so the Home card drops it too.
- **Stories:** Screens/Setup → Connect step, SUMIT or Mercury (390, 320).
