# Cash lists: a split line names its parts on the row

- PR: #531 (Split on the list row).
- Kind: component
- Changed: a line split by category showed only the sum of the parts a cash list counts, with no category (a rent deposit under יצא read "$354.86 · 07/10"). Its hint now names those parts with their amounts ("מים וביוב $183.10 · חשמל $171.76", wrapping between whole parts), then "מתוך $2,054.86 · 07/10" on a line of its own. More than two parts: the first, then "ועוד N", on one line whose name ellipsizes. One part: its name only, since the row's figure is its amount. The date shares the מתוך line or drops; it never sits alone. Same in נכנס, יצא, לא נספר ברווח and a project's cash lines. New shared `SplitPartsHint` over `HintParts`, which gains `maxLines={1}`.
- Rule: a split row's figure reads as the sum of the parts it names, out of the whole line; plain words, no pills, amounts in tabular figures, the date last.
- Source: the owner, 2026-10-10 ("see the split also in the outside"). Design lead picked option A over indented sub-lines (which break one figure per row). Two parts with cents rarely share a line at 390, so a two-part row's hint takes three lines (the design lead approved this over a two-line cap, which clipped מתוך).
- Shots: mockups/split-in-list/ in the project files (390 light and dark, 320 light).
