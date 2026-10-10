# 2026-10-10 · FLOW-415: recurring charges, layout A

- PR: draft (UI lane 2); server part by dev lane 3.
- What: layout A, approved by the owner on 2026-10-10. The לא הגיעו rows trade "עד dd/mm" for two hint lines, where the bill files ("project · category") and when it usually comes ("כל חודש ב־N · אחרון dd/mm"). Home's attention card gets one row per payment well off its usual amount ("חשמל עלה ב־38%", hint "₪2,550 · בדרך כלל ₪1,850"), last, opening the payment. The payment page gets two switches under נספר ברווח in the same list: נספר בתזרים and חיוב קבוע (hint "כל חודש ב־N · זוהה לבד"), each with an undo toast. New icons: RepeatIcon and TrendUpIcon.
- Rule: a recurring charge names its pace and day in one hint line, "כל חודש ב־N", followed by "· אחרון dd/mm" or "· זוהה לבד" when known. Hint parts wrap whole, and the "·" ends a line, never starts one.
- Folds into: DESIGN-RULES, the attention card and Toggle rows in the component table.
- Shots: to follow with the wired screens (390 and 320, light and dark).
