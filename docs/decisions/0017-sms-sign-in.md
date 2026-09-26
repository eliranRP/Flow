# Sign in with phone number and SMS code

**Date:** 2026-09-26
**Status:** Superseded
**Superseded by:** [0033](0033-google-sign-in.md)

## Context

The proof of concept has one user, the owner ([0013](0013-single-user-owner.md)). They are on site. An email and a password is another account to remember, and another form to type.

## Decision

Sign-in is the owner's mobile phone number plus a one-time code sent by SMS. That number is the account.

## Alternatives rejected

Email and password.

## Consequences

Onboarding starts with the phone number and the code. There is no password to reset. The same number signs in on a new phone. There is still one owner and no roles. What happens when the owner changes phone numbers is not specified yet; see [open questions](../open-questions.md#changing-the-phone-number).
