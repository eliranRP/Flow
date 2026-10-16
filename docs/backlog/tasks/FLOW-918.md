<a id="flow-918"></a>
# FLOW-918 · FLOW-369 follow-up: AddProject and AddSheet proofs under 3%
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-369](FLOW-369.md) · **Related:** the shared sheet panel (top edge and header rule), logged for the shared-components lane · **Source:** the proof gate of FLOW-369 (text-masked diff under 3% per frame, `scripts/mask-proof.mjs`). Moved out of #683 on 2026-10-16 to keep that PR to what passes.
- **Files:** `app/src/screens/add-sheet.tsx`, `app/src/screens/add-entry-view.tsx`, `app/src/ui/css/44-add-entry.css`, `app/src/ui/sheet.tsx`, the add-form stories and tests.
- [ ] AddProject (entry from a project, "הוספה ל־<project>"): text-masked diff under 3%. Measured 10.8% on 07b5d9b; the residual is the project chips and their row layout.
- [ ] AddSheet (the + sheet over Home): text-masked diff under 3%. Measured 21.2% on 479b54f; the largest block is the sheet panel's position (about 80px higher than the board frame) and the bank row the board does not show. Fix the panel position first, then the rows.
- [ ] Shared sheet panel: top edge about 2px low and header rule 1px off, per the 18:04Z note in the shared-followups plan. Shared component: coordinate with the shared-components lane before changing `app/src/ui/sheet.tsx`.
- **Acceptance:** `node /mnt/project-files/plans/tools/mask-proof.mjs` on AddProject and AddSheet under 3% text-masked, with the full-frame number and the mask list in the PR body; the Home backdrop data differences listed as named exceptions if they stay.
