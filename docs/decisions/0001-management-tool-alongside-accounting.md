# Management tool alongside the accountant's books

**Date:** 2026-09-26
**Status:** Accepted

## Context

Owners of Israeli contractor businesses already have an accountant. The accountant keeps the official books, usually in software such as Hashavshevet, and produces the statutory reports. What the owner does not have during the job is a simple answer to "is this project making money?" Waiting for year-end accounts is too late to fix a losing site.

## Decision

This product is a management tool that sits beside the accountant's books. It shows project and company profit and loss so the owner can run the work. The accountant keeps the official double-entry books and the balance sheet.

The bridge is an export. The proof of concept exports approved transactions to Excel. A Hashavshevet-compatible file can come later. Israel invoice allocation numbers (`חשבונית ישראל`) are kept on the document so the export can be reconciled with the invoice the accountant already has.

## Alternatives rejected

Replacing accounting software: full double-entry, a balance sheet, and statutory reporting inside this product.

## Consequences

VAT filing, payroll, and official books are out of scope. Success is whether the owner can see project profit while the job is running, and can hand the accountant a clean export. The data model stores management facts (project, category, net, VAT, document), not journal entries.
