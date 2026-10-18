<a id="flow-924"></a>
# FLOW-924 · The category "נספרת ב" sheet: profit, cash flow and rehab switches (board SettingsCategory, SettingsCategoryCount)
- **Type:** Feature · **Status:** ready · **Depends on:** — · **Source:** PR #703 board coverage: these two frames have no screen in the app. Owner decision 2026-10-18: a follow-up, not part of #703.
- **Files:** `app/src/screens/category-sheet.tsx` (CategoryMenuSheet), `packages/shared` category schema, a migration for `list_categories`, `design/proof/settings-map.json`.
- [ ] `list_categories` returns `categories.in_cash`, and `categoryRowSchema` reads it (one migration).
- [ ] The category sheet leads with a "נספרת ב" row that opens a sheet of three switches with undo toasts: profit (`set_category_excluded_from_pnl`), cash flow (`set_category_cash`) and rehab (as today). It replaces the rehab switch and the "לא לספור ברווח" row; "הצג תנועות" gets a new home.
- [ ] Tests and stories of the category sheet follow; map both frames and prove them under 3% in both themes.
