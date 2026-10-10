# FLOW-357: open invoices as rows, the mark in a sheet

- PR: #458
- Kind: screen
- Changed: each open invoice is one row: the name, the amount and "לפני N ימים", with a chevron; a marked one says "סומן כשולם · ממתין לסנכרון", muted. The tinted "סימון כשולם" under every row is gone. A tap opens the invoice's sheet: the name as its title, the amount as the one figure, "date · project · age", "פתיחת החשבונית" (SUMIT's page, new tab) when there is one, and "סימון כשולם" pinned at the bottom ("ביטול הסימון" on a marked one). A mark closes the sheet, and its toast offers ביטול. With one invoice the head is the title alone, since the row carries the amount.
- Rule: a repeated action on every row moves into the row's sheet; the list keeps one line per item (§2.1, §3.7).
- Shared: `ListRow` project rows take `onClick` (a button row with an amount); `TextLink` takes `external`; `ExternalIcon`.
- Source: FLOW-357, the owner's pick A "Rows only" (2026-10-10 05:34Z). Mockups: /mnt/project-files/mockups/flow-357/.
