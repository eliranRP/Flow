# Installed iOS sign-in keeps the redirect, with a Safari fallback

**Date:** 2026-09-28
**Status:** Accepted

## Context

A Home Screen web app does not share Safari's storage. The Google redirect can also return in Safari, where the PKCE verifier is missing. This environment cannot install the app on two iPhone versions.

## Decision

The button stays `signInWithOAuth`. Sign-in says that after install you sign in once from the icon. `/auth/opened-in-safari` says to go back to the Flow icon. The Google ID-token button is not shipped: it needs a browser client id, and standalone behaviour is unverified here.

## Consequences

If a later iPhone test shows the redirect never returns to the icon, the ID-token path can be added without changing the company model.
