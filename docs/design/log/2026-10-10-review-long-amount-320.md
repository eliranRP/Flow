# Review card: a long amount stays inside the card at 320

- PR: #443 (Backlog bug fixes).
- Kind: component
- Changed: at 320 a 7-digit amount ("−₪1,234,567") was wider than the review card's content and spilled past its edge, against the rule that an amount is never cut (FLOW-327). The amount now steps its size down to fit the card (about 34px for that figure at 320, from 36px). An amount that fits keeps the 36px display size, and at 390 nothing changes. The spike pill still wraps under the amount.
- Rule: a long amount in a narrow card shrinks to fit; it is never cut or wrapped.
- Source: the Storybook smoke's stricter render wait, which ran the "Flag: amount spike, long amount, 320" story's own check in a real 320 frame.
- Shots: mockups/review-long-amount/ in the project files (320 light and dark, 390, and a short amount at 320 for comparison).
