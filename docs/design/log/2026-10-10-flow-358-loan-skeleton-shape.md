# 2026-10-10 · FLOW-358: loan skeletons take the loaded rows' shape

- PR: UI lane 4
- What: the loan page's loading rows drew a long bar over a short one and an amount bar at the end, while the loaded rows are an icon, a short label over a long value, and a chevron. The loans list's loading rows had no icon slot. `ListRow`'s skeleton now takes `icon` (a 24px rounded square in the icon slot), `eyebrow` (short over long) and `end` (false drops the end bar). The loan page loads as icon, short over long, nothing at the end; the loans list as icon, long over short, and the amount bar. Heights stay as FLOW-115 set them.
- Rule: a skeleton row draws the loaded row's parts in their places: an icon slot where the row has an icon, the eyebrow's short bar on top on an eyebrow row, and an end bar only where the row shows a figure.
- Shots: mockups/flow-358-skeletons/ in the project files.
