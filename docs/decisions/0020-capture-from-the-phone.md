# Capture several photos, or a file already on the phone

**Date:** 2026-09-26
**Status:** Accepted

## Context

Invoices arrive as a stack of paper, or as a PDF already saved in Files, WhatsApp, or Mail. The add sheet today is one camera or one PDF. Share-to-app is how Android can hand a file to an installed PWA. iPhone does not offer that for a web app.

## Decision

In this phase the owner can:

- Take several photos in a row.
- Pick a PDF or an image from files already on the phone.

Share-to-app is supported on Android through the PWA share target. It is not supported on iPhone, because web apps cannot register as a share target there. Flow does not pretend the iPhone share sheet can open it.

A WhatsApp or email forwarding address is after the proof of concept.

## Alternatives rejected

Relying on a forwarding inbox in this phase. Offering share-to-app on iPhone.

## Consequences

Each photo or file is its own document. A duplicate in the batch does not create a second document. The Android share target accepts an image or a PDF and lands in the same capture path as the add sheet. Onboarding and the add sheet do not promise an iPhone share action. The forwarding address is on the [backlog](../open-questions.md#forwarding-address).
