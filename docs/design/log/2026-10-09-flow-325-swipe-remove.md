# FLOW-325 §10 and FLOW-309: Swipe a split part away; the filed-today banner counts the list

- PR: #391
- Kind: component
- Changed: In both split editors (between projects, and by category), a part swiped toward the start side (right) is removed, the same as its ✕. The row follows the finger over a red "מחיקה" on the end side. It goes past 30% of its width or on a flick, and short of that it settles back. Toward the end side it only gives a little. The ✕ stays for a keyboard, a screen reader and a mouse. The gesture follows FLOW-314's rules: touch only, nothing within 24px of a screen edge, nothing from inside a field or while a sheet is open, a 10px decision, and no motion with reduced motion. The click a drag ends in opens nothing. The dev preview's "שויכו היום" banner counts the rows its list shows, as live does (`list_review.auto_approved_today` and `list_auto_assigned_today()` both read `private.filed_today_rows()`; pgTAP pins it). No "N חלקים" on the transaction lists: the project list already leads with the part and says "מתוך" the whole line, and Search line 2 stays status only (FLOW-339 C); the design lead agreed.
- Rule: A row that can be removed can also be swiped toward the start side to remove it, over a red "מחיקה"; its ✕ stays as the named control.
- Source: FLOW-325 plan §10, FLOW-309 open item.
