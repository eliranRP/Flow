# Deploys stay automatic, with no required reviewer

**Date:** 2026-09-30
**Status:** Accepted

## Context

Decision [0077](0077-deploy-after-ci.md) deploys on a push to `main` after `lint`, `check`, and `e2e` on that commit. The GitHub environment `production` has no required reviewer. The `protect-main` ruleset requires those three checks, requires 0 approving reviews, and does not require a code-owner review.

`.github/CODEOWNERS` lists `@eliranRP` on the migration, preflight, workflow, package, and config paths. That file notifies the owner. It does not block a merge.

Eliran decided not to add a human gate.

## Decision

1. A push to `main` still deploys on its own after `lint`, `check`, and `e2e` succeed on that commit. Nothing in this record waits for a person.
2. The practice before merge is that both reviewer bots have approved and CI on the pull request is green. Those bot approvals are not a GitHub required review.
3. Required approving reviews stay at 0. Code-owner review stays off. The `production` environment has no required reviewer.
4. `.github/CODEOWNERS` stays ownership and notification only. It does not enforce review.
5. Eliran accepts the owner risk: a merge can reach `main`, and that push can deploy, without a human approval and without the bots if someone merges before they approve.

## Alternatives rejected

A required reviewer on the `production` environment. Every deploy would wait for a person after CI.

A required approving review, or required code-owner review. Either one would turn CODEOWNERS or a person into a merge gate. That is the control this record declines.

## Consequences

Deploys stay automatic. `protect-main` still requires `lint`, `check`, and `e2e`. It does not require a pull request approval. CODEOWNERS notifies `@eliranRP` and does not block. Decision [0078](0078-schema-v1-rename.md) keeps the same CODEOWNERS list.
