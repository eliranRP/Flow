# Pilot defaults for sign-in, photos, and Pro

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0037](0037-supabase-pilot.md) leaves three choices that change what the owner sees or what the bill becomes. They are defaults for the pilot. They can be revisited.

## Decision

Accept the `supabase.co` address on the Google sign-in screen. Do not buy the $10 a month custom domain for now.

Invoice photos are stored in Supabase Storage.

The move to Supabase Pro is the trigger in 0037: the first paying customer or the first technical limit, whichever comes first.

## Alternatives rejected

A custom Auth domain during the pilot. Putting invoice photos in Cloudflare R2 to delay Pro.

## Consequences

These are pilot defaults. A later record can change them. The Pro trigger itself stays the one in 0037.
