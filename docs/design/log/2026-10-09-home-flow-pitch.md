# FLOW-334: Home income and expense rows on a 52px pitch

- PR: pending
- Kind: component
- Changed: on Home, the gap between the הכנסות and הוצאות rows (`.ui-flow`) goes from `--space-8` (32px) to `--space-2` (8px). Each row keeps its 44px target, so the pitch is 52px, down from 76px. At 375x667 the waiting-review card now starts above the tab bar, and the "פרויקטים" head moves up 24px (y≈759 to 735). It is still below the fold, so a project row above the tab bar needs a band or layout call (open item in FLOW-334). Shots: /mnt/project-files/reviews/flow-347-334/home-375-period-before.png and -after.png.
- Rule: Rows that read as a pair (income and expenses) sit on the list pitch, not a section gap.
- Source: FLOW-334 (cycle 5 leftovers).
