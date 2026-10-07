# Closing the Home setup card opts out of setup

**Date:** 2026-10-07
**Status:** Accepted

## Context

The Home setup card ([0089](0089-setup-runner.md) §3) could only be hidden with a small quiet הסתרה link, and the toast did not say the card was gone for good. Hiding the card also left the one automatic resume in place, so the next launch could still open a setup step. The owner found the card sticky (FLOW-511).

## Decision

1. The card head ends with a 44 px ✕ icon button, `aria-label` "סגירת ההגדרה", in the secondary text colour. It replaces הסתרה. One tap closes the card.
2. Closing sets `card_dismissed_at`, as before, and now also stops the one automatic resume: `decideEntry` stays when `card_dismissed_at` is set. No new stored field.
3. The toast says "ההגדרה לא תופיע שוב. אפשר לחזור אליה מההגדרות." with ביטול, above the tab bar. ביטול clears `card_dismissed_at`, which brings back both the card and the resume.
4. The way back stays Settings › עוד › הגדרה ראשונה, unchanged. Opening a step from there does not bring the card back.
5. No MCP tool. The setup flags live only in the device's `localStorage` (0089 §5), so there is no server state for a tool to change.

The design session compared a footer button (rejected: a second full-width button competes with Home's one tinted block and makes the card taller; a quiet one repeats the old link) and a ⋯ menu (rejected: two taps and a new reminder state).

## Consequences

This replaces 0089 §3's הסתרה wording and toast. A user who closes the card before the next launch is not sent into setup again.
