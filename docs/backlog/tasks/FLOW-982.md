<a id="flow-982"></a>
# FLOW-982 · A screen reader reaches a toast shown over an open sheet
- **Type:** BUG (a11y) · **Status:** in-progress · **Depends on:** — · **Source:** the coordinator's queue on 2026-10-27: a toast shown while a modal sheet is open sits outside the sheet's accessibility tree, so its ביטול cannot be reached with a screen reader.
- **Files:** `app/src/ui/toast.tsx` and its test, the sheet that hides the page.

- [ ] A toast and its action are in the accessibility tree while a modal sheet is open.
- **Acceptance:** a unit test opens a sheet, shows a toast with ביטול and finds the button by role; the sheet still hides the rest of the page.
