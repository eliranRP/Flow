# Installable mobile web app

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0005](0005-mobile-first.md) already makes the phone the layout. The remaining choice is how that phone app is shipped: a native store app, a desktop site, or a page the owner installs.

Owners export a Bank Hapoalim statement on a computer and need it on the phone, because that file is the proof-of-concept import ([0012](0012-bank-hapoalim-first.md)). iPhone will not deliver web push unless the site has been added to the Home Screen.

## Decision

This phase is an installable mobile web app (a PWA). There is no desktop version in this phase.

Onboarding explains how to export the Hapoalim statement onto the phone. Onboarding also includes an install step, and on iPhone that step is what makes notifications possible.

## Alternatives rejected

Native iOS and Android apps. A desktop web version in this phase.

## Consequences

Layout, navigation, and tap targets stay the phone screens already specified. There is no desktop layout to design. A statement that lives only on a PC is not imported until the owner has the file on the phone; the product does not fetch it from the bank. Push on iPhone depends on the Home Screen install. Android can notify from an installed PWA without that extra iPhone step. [0018](0018-two-notifications.md) is the notification set those installs deliver.
