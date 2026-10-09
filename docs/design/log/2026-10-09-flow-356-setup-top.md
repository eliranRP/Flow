# FLOW-356: setup step 0's title sits where the other steps put theirs

- PR: UI lane 3 (after #420).
- What changed:
  - Setup step 0 ("פרטי העסק" and "קטגוריות לפתיחה") keeps the top bar's 44px and the step meter's height, both empty. Its title now starts at 79px, like steps 1 to 5, so it no longer jumps when step 1 opens.
  - Onboarding opened from Connections drops the "שלב 1 מתוך 1" meter over its one form. Setup step 0 shows the same form with no counter.
- Rule: every setup step's title starts at the same height; a step without a back, a דלג or a count keeps their space empty.
- Shots: mockups/flow-356-setup/ in the project files.
