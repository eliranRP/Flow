# 2026-10-10 · FLOW-415 step C: the קבועים screen

- PR: #514 (UI lane 2), on the server reads from #503 (decision 0175).
- What: the לא הגיעו screen becomes קבועים (frame b-2), with a לא הגיעו section and a הגיעו החודש section that shows ▲/▼ %. It covers income as well as expenses. Each alert row has a muted 44px ✕ "הסתרה" at its end and can be swiped toward the start, with an undo toast "ההתראה הוסתרה". The hide is for this user only. Home's rows open the screen at their section. When exactly one charge changed, its row opens that payment; with two or more it reads "N חיובים קבועים השתנו". Late income reads "N תנועות קבועות לא הגיעו".
- Rule: an alert a user can hide for themselves ends in a muted 44px ✕ labelled "הסתרה, <name>", and the same row swipes toward the start over "הסתרה". The undo toast says "ההתראה הוסתרה". A hidden change leaves its row in place without its percent: the payment still arrived.
- Rule: a change's ▲/▼ % is red when it is bad news for the business (an expense up, income down) and green otherwise, beside the amount.
- Rule (design lead's sign-off fix, FLOW-420 item 3): a recurring row's hint is two lines at most. Line 1 is "project · category", where only the project ends in an ellipsis and "· category" stays whole. Line 2 is the pace, as whole parts, so "אחרון dd/mm" drops first and 320 reads "כל חודש ב־2".
- Departure from b-2: the הגיעו החודש hint is "project · category", not "project · dd/mm", because `recurring_this_month` sends no date.
- Shots: /mnt/project-files/mockups/flow-415-c/ (390 and 320, light and dark). Signed off by the design lead on 2026-10-10.
- Follow-up (UI lane 3's review nits): the shared "N חיובים קבועים השתנו" row draws the down arrow when every change is a drop, and the קבועים screen waits for הגיעו החודש before it shows "הכל הגיע", so the empty state never flashes.
