# Product docs in this repository are the source of truth

**Date:** 2026-09-26
**Status:** Accepted

## Context

The product is being specified before application code exists. Decisions made in chat, slides, or a side document drift as soon as a wireframe is updated. The proof of concept needs one place that says what is accepted, what was superseded, and what is still open.

## Decision

This repository is the product home for documentation and design artifacts. The Module 1 spec, the screen notes, the wireframe PNGs, and the decision records in `docs/decisions/` are the source of truth. Each decision is its own numbered file. Open questions stay in `docs/open-questions.md` until a record accepts an answer. Documentation changes are logged in `docs/changelog.md`.

There is no application code in this repository yet.

## Alternatives rejected

Keeping the product definition in chat threads, slides, or a separate tool that can diverge from the wireframes.

## Consequences

A behavior change starts as a decision record, then a spec and wireframe update, in this repo. Superseding a decision or a wireframe keeps the previous file and points to the new one, so the history of the proof of concept stays readable. How to do that is in [CONTRIBUTING.md](../../CONTRIBUTING.md). When application code is added later, that belongs in a new decision; this record covers the documentation home.
