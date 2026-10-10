# FLOW-362: the locked line on a loan's own category

- PR: UI lane 3.
- What changed: the ⋯ sheet of a category a loan uses for interest, escrow or principal shows its locked line on two lines: "קטגוריה של הלוואה", then "<loan> · <part>". Before, the one line wrapped inside the loan's name from 320 to 393.
- Rule: a locked line that names something puts the kind on line 1 and the name on line 2, so the wrap never splits the name.
- The built-in loan categories (by `loan_part`) keep their one line.
- Shots: mockups/flow-362-lane-3/ in the project files.
