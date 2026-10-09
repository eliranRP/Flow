# FLOW-310: The money field's prefix keeps one gap

- PR: #297
- Kind: component
- Changed: MoneyField (every amount input: loans, budgets, splits, investment). The ₪ / $ prefix sat at "characters × 1ch" from the edge, and a comma or dot is narrower than a digit, so the gap grew with the number: 6.6px for "5", 16.6 for "1,500", 35.6 for "1,234,567.89". The prefix is now laid out beside a hidden copy of the digits (`.ui-money-mirror`, same size and tabular digits as the input), so the gap is 0.35em (5.6px) at any length. No other change to the field. New stories: Components/MoneyField Prefix Gap and Prefix Gap 320 Dark.
- Rule: position text against text by laying it out, not by counting characters.
- Source: FLOW-310 (sheets, focus, keyboard and shared controls).
