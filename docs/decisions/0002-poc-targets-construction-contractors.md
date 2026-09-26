# Proof of concept targets construction contractors

**Date:** 2026-09-26
**Status:** Accepted

## Context

The product is for Israeli businesses that make money by project. A first version that tries to speak to every industry at once will ship vague categories, vague examples, and a picker that fits nobody. Construction contractors are a concrete first user: they run named jobs, pay suppliers and subcontractors from the site, and already think in projects.

## Decision

The proof of concept is designed for owners of small and mid-size construction contractors. Copy, examples, and the preloaded categories use contractor language (`חומרים`, `קבלני משנה`, site names).

The data model stays generic: company, project, category, transaction, rule, document. "Project" is the proof-of-concept name for a segment of work with its own P&L. The next step after the proof of concept is any other project-based business, using the same model with different default categories and copy.

## Alternatives rejected

A generic product for every project-based industry on day one.

## Consequences

Wireframes and default categories look like construction. Schema and screen structure do not hard-code construction. Adding a vertical later means new defaults, labels, and examples, not a new model. A project code (such as `P-12`) is part of the model so a long list of jobs can be searched without relying on the name alone.
