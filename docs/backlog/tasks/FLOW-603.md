<a id="flow-603"></a>
# FLOW-603 · Per-user cache isolation on a shared device
- **Type:** BUG · **Status:** done (#79) · **Depends on:** —
- **What:** Query cache keys are shared across users and the cache isn't cleared on sign-out; saved roles stay in localStorage after sign-out; the dashboard cache isn't user-scoped, so a user switch without a reload could show the wrong company's flag. Scope keys by user and company and clear on sign-out (including an expired session or another tab).
- **Acceptance:** tests for sign-out, a user switch without reload, and an expired session.
