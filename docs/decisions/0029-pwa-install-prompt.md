# PWA install prompt

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0015](0015-installable-mobile-web-app.md) makes this phase an installable mobile web app and keeps an install step in onboarding. Owners who skip that step still need a later chance to install, and the two phones do not install the same way.

## Decision

After the first successful report, offer a PWA install prompt. Do not offer it inside the installed app.

Android shows an install button, using `beforeinstallprompt`. iPhone shows three Safari steps. iPhone is not a one-tap install button.

Evidence: [17a light](../../design/screens/17a-install-android-light.png), [17a dark](../../design/screens/17a-install-android-dark.png), [17b light](../../design/screens/17b-install-iphone-light.png), [17b dark](../../design/screens/17b-install-iphone-dark.png).

## Alternatives rejected

The same one-tap install button on iPhone. Showing the prompt on every launch, or inside the installed app. Dropping the onboarding install step in 0015.

## Consequences

0015 still stands, including the install step in onboarding. This prompt is a later offer, after the first successful report, and only while the app is not installed.

**Amended by [0066](0066-review-round7.md).** "סגירה" sits at the inline start. The example tag sits at the inline end. Settings links to `/install` while the app is not standalone.
