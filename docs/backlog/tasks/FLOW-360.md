<a id="flow-360"></a>
# FLOW-360 · Put a project in a group from the app
- **Type:** PLAN FIRST · **Status:** in progress (UI lane 3) · **Depends on:** FLOW-406 · **Source:** cycle 14 (Projects tab and group page)
- **What:** Groups show on the Projects tab (#418), but only the assistant (MCP) can start one, rename one or move a project in or out. In the app, that flow ends at a group the user can't change.
- **Options:** A, one "קבוצה" row in the project's ⋯ sheet that opens a picker of groups plus "קבוצה חדשה" (a one-field sheet, like the category rename); it saves on tap with an undo toast, and nothing new appears on the Projects tab. B, keep groups assistant-only. Mockups at 390, one option per frame.
- **Acceptance:** owner's pick on a card; real-app shots before merge.
- **Decision:** the owner OK'd A on 2026-10-10 (06:38Z, in the design lead's thread): "בלי קבוצה" takes a project out, another group moves it; both get the undo toast.
- [x] (UI lane 3) The ⋯ sheet's "קבוצה" row with the project's group (or "בלי קבוצה"), opening the picker: "בלי קבוצה", the company's groups, "+ קבוצה חדשה". A tap saves; the toast says "הפרויקט עבר לקבוצה …" or "הפרויקט הוצא מהקבוצה …" with ביטול.
- [x] (UI lane 3) "קבוצה חדשה": one field "שם הקבוצה" and שמירה; it makes the group and puts the project in it.
- [ ] (UI lane 3) Real-app shots at 390 and 375x667, light and dark, to the owner before merge.
