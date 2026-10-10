# Transaction: earlier charges inline under the switches

- PR: FLOW-431 layout A ("Related charges" lane).
- Kind: component
- Changed: the "לעומת הרגיל" chip under the status pills is gone. Under the switches the screen now shows "חיובים קודמים" ("תקבולים קודמים" for income): "בדרך כלל $11.99 · עלה ב־92%", 6 quiet month bars, the 3 latest earlier charges and "לכל החיובים", which opens the existing sheet with all of them. Shown only with a party and at least 2 earlier charges. Shared `PartyChargesSection` (ui/related-charges.tsx) with stories; `ChargeChangeChip` removed.
- Rule: a change percent is red only when it is bad news (an expense up or income down), green the other way, and always names the usual amount.
- Source: the owner, 2026-10-10 16:07Z, choosing layout A (frame a-inline-dark-390) over the chip.
- Shots: mockups/built/flow-431-a/ in the project files (390, 320, dark, income, the sheet).
