# FLOW-310: smaller sheet gap with the keyboard up at 320

- PR: #450
- Kind: token
- Changed: under 360px, while the keyboard is open (`data-kb="open"`), `--sheet-gap` is `--space-4` (16px) instead of 56px. With a 300px visual viewport, the SUMIT connect sheet grows from 244px to 284px and shows its first field above the keyboard. The שינוי sheet's summary rows keep their own 56px minimum, which used to borrow `--sheet-gap`.
- Rule: With the keyboard open on a short screen, a sheet gives up its top gap before it hides its first field.
- Shots: /mnt/project-files/mockups/flow-310-sheet-gap/ (simulated keyboard; real-device QA stays open for Production QA).
- Source: FLOW-310 (backlog), lane manager order.
