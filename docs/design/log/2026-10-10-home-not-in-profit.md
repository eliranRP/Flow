# Cash Home: what profit leaves out of the month

- PR: FLOW-418 (Home profit line).
- Kind: screen + component
- Changed: under "רווח החודש" on cash Home and on an earlier month's page, a quiet "לא נספר ברווח" row shows the month's net less its profit, with a one-line hint naming its two largest categories. Profit and the new row add up to the month's figure. A tap opens the month's lines page for those lines: money in green, money out with its minus, and one line under the figure ("כסף שזז בבנק, אבל אינו הכנסה או הוצאה."). `CashRows` takes an optional `hint`.
- Rule: a figure that doesn't match the rows above it says what makes up the difference, on a row that opens its lines.
- Source: the owner's plan-first card (option A, 2026-10-10), then his ask that the tap open the transactions like the נכנס/יצא pages.
- Shots: mockups/plan-first/home-profit-line/ in the project files (a, a2).
