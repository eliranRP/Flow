# 2026-10-10 · FLOW-415 step C: the קבועים screen

- PR: #514 (UI lane 2), on the server reads from #503 (decision 0175).
- What: the לא הגיעו screen becomes קבועים (frame b-2), with a לא הגיעו section and a הגיעו החודש section that shows ▲/▼ %. It covers income as well as expenses. Each alert row has a muted 44px ✕ "הסתרה" at its end and can be swiped toward the start, with an undo toast "ההתראה הוסתרה". The hide is for this user only. Home's rows open the screen at their section. When exactly one charge changed, its row opens that payment; with two or more it reads "N חיובים קבועים השתנו". Late income reads "N תנועות קבועות לא הגיעו".
- Rule: an alert a user can hide for themselves ends in a muted 44px ✕ labelled "הסתרה, <name>", and the same row swipes toward the start over "הסתרה". The undo toast says "ההתראה הוסתרה". A hidden change leaves its row in place without its percent: the payment still arrived.
- Rule: a change's ▲/▼ % is red when it is bad news for the business (an expense up, income down) and green otherwise, beside the amount.
- Departure from b-2: the הגיעו החודש hint is "project · category", not "project · dd/mm", because `recurring_this_month` sends no date.
- Shots: /mnt/project-files/mockups/flow-415-c/ (390 and 320, light and dark).
