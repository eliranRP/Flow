<a id="flow-474"></a>
# FLOW-474 · A property's utility months cover a bounded range
- **Type:** SMALL CYCLE (projects) · **Status:** claimed (security, 2026-11-10, flow-474-utility-months-range) · **Source:** the daily security scan, 2026-11-10.
- **Files:** a new migration (`list_utility_months`), `supabase/tests/database/flow_1144_utility_months.test.sql`, `supabase/migrations.lock`, a changelog fragment.

- [ ] `list_utility_months` takes an as-of date up to a year after today, and lists at most the 600 months (50 years) up to it.
- [ ] pgTAP: an as-of date more than a year ahead is refused; a property's months stop 600 months back; the owner's own months read as before.

**Acceptance:** the tests pass; a property's real months read the same.
