# A hint part wider than its line wraps instead of clipping

- PR: FLOW-429 (cycle 21, C21-2).
- Kind: component
- Changed: `HintParts` no longer cuts a part that is wider than the whole line. At 320 with ביטול, the viewer toast's line is about 184px and "שינויים נעשים על ידי בעל העסק" about 210px; it read "בעל העס". Now that part wraps at its own spaces onto a second line, and its later lines start at the hint's edge. A part that fits a line still moves to the next line whole, and a wrapped line still never starts with "·". At 393 the toast is unchanged. The split-line hint keeps its own rule: a part's name ends in "…" and its amount is never cut (FLOW-425).
- Rule: a part breaks only at its "·" while it fits its line; a part wider than the whole line wraps at its own spaces; a toast never clips or ellipsizes a part.
- Source: cycle 21 phone review of production at a6b0b35 (design lead).
- Shots: Storybook Components/Toast ViewerNoteWidePart320 and ViewerNote320.
