# A recurring charge's pace: "כל כמה זמן"

- PR: pending (UI lane 1).
- Kind: component and screen
- Changed: on a payment's page, the "חיוב קבוע" row (or "הכנסה קבועה") names its pace first, "כל חודש · בערך ב־4 · זוהה לבד", through HintParts so a "·" never starts or ends a line. While the switch is on, a tap on the row's words opens a "כל כמה זמן" sheet with כל חודש, כל חודשיים, כל רבעון and כל שנה, radio rows that apply on tap like the basis sheet; the switch keeps its own 44px target at the row's end. Each change has an undo toast ("אור חשמל · כל רבעון", ביטול) that puts back the pace from before. Off, the row has no hint and no sheet. New `PaceSheet` and `PACE_LABEL` (exported from `ui/charge-switches.tsx` for the קבועים rows).
- Rule: one control per job; the switch turns it on or off, the row opens its detail (§3.7); a hint's "·" never ends a line.
- Source: FLOW-415 step D (owner, 2026-10-10 08:40Z; decision 0175), mockup a-3.
- Shots: reviews/flow-415-pace-sheet/ in the project files (390 and 320, light and dark).
