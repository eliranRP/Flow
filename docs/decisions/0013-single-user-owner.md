# Proof of concept is single-user

**Date:** 2026-09-26
**Status:** Accepted

## Context

The wireframes show one person, the owner. An office manager who might clear the review queue during the day was raised and not specified. Sharing a login, or hiding screens from a second person, is a product of its own.

## Decision

The proof of concept has one user: the business owner. There are no roles and no permissions.

An office-manager role is a later option. It is not in the proof of concept.

## Alternatives rejected

Owner and office-manager roles, or any other permission model, in the proof of concept.

## Consequences

No invite flow, no second seat, and no screen that changes based on who is signed in. The owner photographs invoices, uploads the Hapoalim statement, and clears the review queue. Pricing is a separate question and is still [open](../open-questions.md).
