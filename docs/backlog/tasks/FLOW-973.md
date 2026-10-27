<a id="flow-973"></a>
# FLOW-973 · One under-the-header toast helper
- **Type:** cleanup · **Status:** in-progress · **Depends on:** FLOW-972 (#832) · **Source:** FLOW-972 added `topToast()` and `useTopToast()` in `app/src/ui/top-toast.ts`. Three screens keep their own copy of the same function and times: `forecastToast()` (`app/src/forecast-toast.ts`), `recurringToast()` (`app/src/recurring-toast.ts`) and `unpaidToast()` (`app/src/screens/unpaid-actions.ts`), about 49 call sites with their tests.
- **Files:** those three files, their callers and tests (forecast, קבועים, the invoice pages), `docs/decisions/` (a line in 0215, 0218 and 0220 pointing at `topToast()`).

- [ ] The three helpers and their `*_UNDO_MS` / `*_NOTE_MS` constants are gone; callers use `topToast()` or `useTopToast()`; tests import `TOP_UNDO_MS`.
- [ ] `forecastScope()` stays (it is not a toast).
- **Acceptance:** no behaviour change; the forecast, קבועים and invoice toast tests pass unchanged apart from imports.
