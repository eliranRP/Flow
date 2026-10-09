<a id="flow-111"></a>
# FLOW-111 · update_loan can store a payment below the interest
- **Type:** BUG · **Status:** done (#72) · **Depends on:** —
- **What:** MCP `update_loan` doesn't re-check the schedule, so a client can store a payment smaller than the interest, after which `get_loan_schedule` and `attach_loan_payment` throw uncaught. Validate in SQL and return a fixed refusal. In the same PR: trim the name and treat explicit nulls correctly, give a specific refusal for bad parts, add a DB balance check for the app split path, make `loan_split` undo refuse (conflict) when the split was corrected in the app afterwards, cap the currency-default read (the app reads at most 1000 lines), and add `set local lock_timeout` to the migration.
- **Acceptance:** tests for each refusal and for undo after an app correction; existing loan tests unchanged.
