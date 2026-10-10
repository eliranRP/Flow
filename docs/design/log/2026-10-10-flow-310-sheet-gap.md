# FLOW-310: smaller sheet gap with the keyboard up at 320

- PR: #449
- Kind: token
- Changed: under 360px, while the keyboard is open (`data-kb="open"`), `--sheet-gap` is `--space-4` (16px) instead of 56px. With a 300px visual viewport, the SUMIT connect sheet grows from 244px to 284px and shows its first field above the keyboard. The שינוי sheet's summary rows keep their own 56px minimum, which used to borrow `--sheet-gap`.
- Rule: a sheet's gap above it shrinks only when the keyboard leaves a phone-width screen too short; the scrim still shows above it.
- Shots: /mnt/project-files/mockups/flow-310-sheet-gap/ (simulated keyboard; real-device QA stays open for Production QA).
- Source: FLOW-310 (backlog), lane manager order.
