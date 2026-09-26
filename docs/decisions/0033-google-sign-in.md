# Sign in with a Google account

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0017](0017-sms-sign-in.md) made the account a mobile number plus an SMS code. Each login had a per-message cost. The proof of concept has a tight budget ([0034](0034-cost-and-load-limits.md)).

## Decision

Sign-in for the proof of concept is a Google account (Gmail).

This supersedes [0017](0017-sms-sign-in.md). The reason is zero per-login cost.

The SMS-code screens are obsolete: the onboarding SMS step, the wrong-code state (`er-03`), and the expired-code state (`er-04`). They will be replaced by a Google sign-in screen and a Google sign-in error state. Those screens are not in this change.

## Alternatives rejected

Phone number plus an SMS code. Email and password, already rejected in 0017, stay rejected.

## Consequences

There is still one owner and no roles ([0013](0013-single-user-owner.md)). The account is the Google account, not a phone number. Changing the phone number is no longer an open sign-in question.

Do not build the SMS sign-in screens. The replacement screens arrive later, as their own package. Until then, this record is what to implement.
