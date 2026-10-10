# FLOW-413: Home shows the month's cash

- PR: (this PR)
- Kind: screen
- Changed: Home ("/") is frame b. The band reads "תזרים <month>" over the month's net cash, with search; no period pill. Under it נכנס (green), יצא and a quiet "רווח החודש", each opening what is behind it: the month's lines (newest first, the shared transaction row, no minus under יצא) or the profit view on that month. The attention box (review, open invoices, late bills) follows when it has rows, then "חודשים קודמים": the three earlier months by their net, a loss in red with its minus, each opening the month's page (its figure, נכנס, יצא, רווח החודש). The profit Home of #403 moves to /profit unchanged, with "‹ תזרים" on the band's start as frame b-2 draws it.
- Rule: Home shows money that needs a hand (review, open invoices, missing bills) whatever its main figure.
- Source: FLOW-413, owner picked "Cash first" (frames b and b-2), 2026-10-09; the design lead kept the attention box on the cash Home, 2026-10-10.
