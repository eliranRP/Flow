<a id="flow-981"></a>
# FLOW-981 · The delete-company test passes under load
- **Type:** BUG (test) · **Status:** done · **Depends on:** — · **Source:** the coordinator's queue on 2026-10-27: "deletes, clears every cached read and opens the welcome" in `delete-company-sheet.test.tsx` fails now and then on a busy runner.
- **Files:** `app/src/screens/delete-company-sheet.test.tsx`.

- [ ] Find the cause and fix it; the browser-history path does not change.
- **Acceptance:** the test passes 20 of 20 runs, 10 at a time.
