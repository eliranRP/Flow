# List row: a kept-out line's name uses the row's width

- PR: (this PR, FLOW-436).
- Kind: component
- Changed: a row marked "לא נספר ברווח" cut a short name ("City Of Pri…") although the row had room, because its text column shrank to the hint's width. The column now takes the row's free width, so the name is cut only when the row is really too narrow. The kept-out words are still never cut (FLOW-352), and the faded look is unchanged.
- Rule: a set-aside row lays out like a counted row; only its colors change.
- Source: the owner's phone screenshot, 2026-10-10.
- Shots: Storybook "Components/ListRow › Set Aside Short Name".
