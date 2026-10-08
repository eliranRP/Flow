# Review: slim auto-match banner so the card fits above the action bar

- PR: #204
- Kind: component
- Changed: `banner.tsx` gets a `slim` variant (`.ui-banner-slim`): one line, the hint after the title instead of under it, tighter padding, the close button kept at 44px. לאישור uses it for the auto-filed note, with shorter copy ("12 שויכו אוטומטית היום", "אחת שויכה אוטומטית היום"). At 375x667 the banner drops from about 80px to 44px and the whole card, category row included, sits above the pinned action bar; at 320 the title may take a second line instead of being cut, and the card still fits. Stories: Components/Banner Slim, Slim dark, Slim singular, Slim 320.
- Rule: A note that sits above a pinned action bar is one line (the `slim` banner): title, then its link, then the close button. It may wrap to a second line on a 320 phone, never truncate.
- Source: the owner's iPhone 15 screenshot of לאישור (2026-10-08); owner picked "Slim banner" on a choice card.
