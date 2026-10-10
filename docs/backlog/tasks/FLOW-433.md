<a id="flow-433"></a>
# FLOW-433 · Every category on the rehab sheet opens its lines, and Back returns to the sheet
- **Type:** UI · **Status:** in-progress (#535) · **Source:** the owner's asks, 2026-10-10 13:21Z and 13:23Z.
- [x] On a project's שיפוץ sheet (השקעה והלוואות), the rows under "לא נספרות בשיפוץ" open their category's lines like the counted rows: same list, all time on the cash basis. A line with no category opens nothing.
- [x] Back from a category's lines reopens the שיפוץ sheet instead of leaving it closed.
- [ ] Nit (review of #535): the Back test could also close the reopened sheet and check no `flowLayers` remain.
