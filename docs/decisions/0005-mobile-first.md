# Mobile first

**Date:** 2026-09-26
**Status:** Accepted

[0015](0015-installable-mobile-web-app.md) ships this phone UI as an installable web app, with no desktop version in this phase. [0016](0016-hebrew-only.md) keeps the UI Hebrew only.

## Context

The target user owns a small or mid-size contracting business and spends most of the day on site. Invoices show up in the truck and at the supplier's counter. A review queue that requires a desk will not get done the same day.

## Decision

The proof of concept is designed mobile first. Primary navigation sits in a bottom bar the thumb can reach. The add action is the center button. Tap targets are large. Review is one card at a time, with the approve action in the thumb zone. The UI is Hebrew, right to left. Amounts use ₪.

## Alternatives rejected

A desktop-first layout, with a phone version treated as a later shrink of the same screens.

## Consequences

Wireframes are phone screens. Dense tables, multi-column dashboards, and hover actions are not the proof-of-concept UI. Settings and review must be completable with one hand. A later desktop view can exist; it does not drive the first layout.
