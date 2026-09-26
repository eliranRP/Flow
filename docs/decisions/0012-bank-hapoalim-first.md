# Bank Hapoalim is the first statement format

**Date:** 2026-09-26
**Status:** Accepted

## Context

Under [0007](0007-bank-statement-is-primary-input.md), a statement row is what makes money count. Israeli banks and credit-card companies each export a different Excel or CSV layout. Parsing several of them before one contractor can import a real file slows the proof of concept. The upload wireframe uses a Leumi file name (`לאומי_ספטמבר.xlsx`) as example art only.

## Decision

The proof of concept imports statements from Bank Hapoalim (`בנק הפועלים`) only. Other banks come after the proof of concept. Credit-card companies come after the proof of concept as well.

The file is still Excel or CSV, uploaded by the owner. Own-account transfers on that file are still removed. Matching, rules, and auto-approve work on the rows that remain.

## Alternatives rejected

Supporting several banks in the proof of concept.

## Consequences

A Hapoalim export is the statement path to design and test. A file from another bank is out of scope for the proof of concept, even though the add-sheet label still reads `העלה דוח בנק/אשראי`. Credit-card statement files are not part of this import. When credit-card support starts, after the proof of concept, is still an [open question](../open-questions.md). [0007](0007-bank-statement-is-primary-input.md) is unchanged: an invoice without a matching payment stays out of P&L.
