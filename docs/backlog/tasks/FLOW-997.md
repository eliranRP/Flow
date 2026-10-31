<a id="flow-997"></a>
# FLOW-997 · The report PDF puts a project's number last: "1219 Clifton" reads "Clifton 1219"
- **Type:** BUG · **Status:** in-progress · **Source:** the prod check of FLOW-996, 2026-10-30, on the owner's company: by-project column heads with a street number came out reordered. **Approved:** the owner, 2026-10-31 ("Yes do it").
- **Files:** `supabase/functions/_shared/report_text.ts` (`bidiRuns`), `report_text_test.ts`, a changelog fragment.

Cause: the PDF lays every line out in the page's right-to-left direction, so in a line with no Hebrew the number and the words became separate runs and swapped.

- [x] A line with no Hebrew letter is one left-to-right run, as the app shows a name in its own `<bdi>`.
