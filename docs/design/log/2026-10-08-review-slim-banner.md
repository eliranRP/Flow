# Review: slim auto-match banner so the card fits above the action bar

- PR: #204
- Kind: component
- Changed: `banner.tsx` gets a `slim` variant (`.ui-banner-slim`): one line, the hint after the title instead of under it, tighter padding, the close button kept at 44px. לאישור uses it for the auto-filed note, with shorter copy ("12 שויכו אוטומטית היום", "אחת שויכה אוטומטית היום"). At 375x667 the banner drops from about 80px to 44px and the whole card, category row included, sits above the pinned action bar; at 320, when the title and לרשימה don't fit on one line, לרשימה wraps under the title rather than cutting it, and the card still fits. Stories: Components/Banner Slim, Slim dark, Slim singular, Slim 320.
- Rule: A note that sits above a pinned action bar is one line (the `slim` banner): title, then its link, then the close button. When they don't fit, the link wraps under the title; the title never truncates.
- Source: the owner's iPhone 15 screenshot of לאישור (2026-10-08); owner picked "Slim banner" on a choice card.
