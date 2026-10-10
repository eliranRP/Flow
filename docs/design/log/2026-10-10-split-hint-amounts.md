# Cash lists: a split row's amounts are never cut

- PR: FLOW-425 (Split rows keep their amounts whole).
- Kind: component
- Changed: at 320 to 375, a split row's hint cut its amounts mid-glyph ("חשמל ומים משותפים $1,000" lost "$1,000"; next to a $12,345.67 figure "מתוך $98,765.43" lost "$9"). Now each amount keeps its width and only the name ellipsizes. With "ועוד N", the first name keeps about 3em; below that its amount drops, so the line reads "שיפוץ והשבחה… · ועוד 2". The מתוך line drops its date first; in a column too narrow even for "מתוך" and its total, the total wraps whole onto the next line (design lead: never cut a hint word down to one letter). Rows at 393 and wider render as before. The first sheet on a screen no longer waits for the sheet code: it loads on idle with the other screens and on the first tap.
- Rule: in a row hint, a figure is never cut; words give way first.
- Source: cycle 19 phone review (C19-1, C19-2), design lead.
- Shots: reviews/flow-425/ in the project files (320, 375, 393).
