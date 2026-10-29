<a id="flow-169"></a>
# FLOW-169 · Search's report rows: Hebrew prefix letters and punctuation, the project chip, uuid test ids
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** [FLOW-163](FLOW-163.md) · **Source:** reviewer of #864, round 1 (nits).

- [ ] The report words match with Hebrew prefix letters and punctuation around them: "המאזן", "מאזן?", "רווח והפסד, Cedar" and "מאזן לשיפוץ" (the ל on the project's name) each give their row, on the project where one is named (`app/src/search-reports.ts`).
- [ ] With a project chip on in the search, the report rows open on that project, as a typed project name does (`app/src/screens/search.tsx`, where `reportShortcuts` is called).
- [ ] The project-page tests and stories use uuid project ids, so the link they check is one the reports screen reads as a project (`reportStateOf` drops a non-uuid id): `app/src/screens/project-band-and-unpaid.test.tsx` (the FLOW-163 tests) and `app/src/screens/project-detail-screen.stories.tsx` (`ProjectReportsButton`).
