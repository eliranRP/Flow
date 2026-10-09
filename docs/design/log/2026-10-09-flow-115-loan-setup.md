# FLOW-115 · Loan setup follow-ups

- **Lane:** UI lane 3 · **Date:** 2026-10-09 · **Approval:** BACKLOG NIT, small UI; design lead signed off 2026-10-09.
- **Rule:** a field error says what to type ("כתבו את שם המלווה.", "כתבו בין 1 ל־600 חודשים."), not only what is wrong; a 0 is "too small", not "missing".
- **Rule:** a form's save stays enabled; a tap on it shows what to type under each empty field.
- **Kept preview:** while a field is incomplete or wrong, the last good preview stays in `text-muted` (`.ui-loan-preview-stale`).
- **Saving:** ✕, Escape and Back wait for the save, as the project sheet already did (0075).
- **Loading:** the sheet shows four field skeletons while the company currency loads.
- **Stories:** Screens/Loan setup → New, Incomplete dimmed, Date sheet open (light and dark).
- **Open:** the date sheet's year jump and mockup 15b details are shared `DateSheet` work.
