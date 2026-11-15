# FLOW-1162: the Settings חיבורים row says דורש טיפול for a stuck Mercury sync

- PR: FLOW-1162 (the Settings row part)
- Kind: screen, copy
- Changed:
  - `app/src/screens/settings-screen.tsx`: the חיבורים row's value is "דורש טיפול" in the warning tone (`ui-row-value-signal`, the same element SUMIT's "צריך חיבור" uses) while a Mercury connection's last sync ended on the page cap (`mercuryProblem`). With no problem it shows the count as before.
  - `app/src/mercury-copy.ts`: `MERCURY_NEEDS_ATTENTION` holds "דורש טיפול", the words the Home attention section already uses.
  - `app/src/screens/settings-screen.stories.tsx`: "Settings, Mercury sync stuck", beside "Settings, SUMIT needs connecting" (sample data).
- Rule:
  - A row that names a connector's problem uses the warning tone and the attention section's words. When SUMIT and Mercury both need you, the row keeps SUMIT's own words.
- Source: the owner's decision of 2026-11-15 in [FLOW-1162](../../backlog/tasks/FLOW-1162.md) (the approved option "דורש טיפול").
