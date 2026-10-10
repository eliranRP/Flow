# FLOW-360 A: put a project in a group from its ⋯ sheet

- PR: UI lane 3.
- What changed:
  - The project's ⋯ sheet has a "קבוצה" row with the project's group, or "בלי קבוצה", and a chevron. It shows once the Projects tab's read has the groups.
  - The row opens the "קבוצה" picker: "בלי קבוצה", the company's groups, then "+ קבוצה חדשה". Back returns to the ⋯ sheet. A tap saves at once.
  - "קבוצה חדשה" is a one-field sheet like the category rename: "שם הקבוצה" and שמירה. It makes the group and puts the project in it.
  - Every move toasts with ביטול: "הפרויקט עבר לקבוצה …", or "הפרויקט הוצא מהקבוצה …" for בלי קבוצה. ביטול puts the project back.
- Rule: a project's group is changed from the project, never from the Projects tab; the tab only shows groups.
- Shots: mockups/flow-360-build/ in the project files.
