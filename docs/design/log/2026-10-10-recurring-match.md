# 2026-10-10 · קבועים: "אולי זה" under a late row

- PR: #528 (FLOW-430, Missing-bill match lane), from the owner's real-app screenshot (13:08Z): a water bill sat under לא הגיעו although its October charge came in under a longer name.
- What: a late row whose server suggestion is set gets one more line on the row's surface, "אולי זה: <name> · <amount> · dd/mm", then two 44px pills, "כן, אותו ספק" (or "כן, אותו לקוח" for income) and "לא". Yes takes the row out ("סומן כאותו ספק"), no takes the hint away ("לא נציע שוב"); both toasts have ביטול. The amount and the date never break inside; at 320 the line wraps between its parts.
- Rule: Flow never merges two names by itself (the owner's word); it may suggest, and the user decides.
- Not changed: the row itself (name, place, pace, "כ־" amount, chevron, ✕) and the הגיעו החודש section.
