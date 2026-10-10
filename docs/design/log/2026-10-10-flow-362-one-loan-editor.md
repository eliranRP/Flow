# 2026-10-10 · FLOW-362: one loan-parts editor, and a split editor that fits 375x667

- PR: UI lane 4
- What: a matched loan payment's parts sheet no longer has its own amount fields and שמירה next to the split editor. It reads the parts and סה״כ as static amounts, and "עריכת הפיצול" is its one action, the 44px tint button over the quiet ביטול השיוך. The button waits while the stored parts or the loan are read again. A flagged split keeps its editable correction sheet. In "פיצול התשלום", the line's amount and date share one line, the part rows lose their extra padding and the gaps go from 12px to 8px. At 375x667 the fees category and "לשמור להלוואה הזו" now show above the pinned שמירה (the switch's bottom was 26px below the visible area, now it is inside it).
- Rule: one set of numbers has one editor (§3.7 FLOW-357, the action lives in one place).
- Shots: mockups/flow-362-loan-editor/ in the project files.
