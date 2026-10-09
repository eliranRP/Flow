<a id="flow-408"></a>
# FLOW-408 · Currency alignment in project lists
- **Type:** SMALL UI · **Status:** done (#368) · **Depends on:** —
- [x] (UI lane 3, 2026-10-09: `ListRow` `chevronSpace` keeps a hidden chevron on rows that don't open) In mixed-currency projects, the non-tappable USD category rows sit 32px further out than the tappable ILS rows. Reserve the chevron space so the amount column lines up.
- [x] (Backlog bug fixes, 2026-10-09: `list-row.tsx` uses the currency now; project detail and project category passed it; filed today and project waiting dropped it, fixed, the latter with migration `20261013040000`) Verify on main: project rows accept a currency in `list-row.tsx` but never use it, and some list rows (project detail, filed today, project waiting, project category) may drop the currency. Fix any that still do.
