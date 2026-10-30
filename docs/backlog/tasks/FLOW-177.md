<a id="flow-177"></a>
# FLOW-177 · Hebrew names for the last two built-in accounts
- **Type:** SMALL CYCLE · **Status:** done (#879) · **Source:** the MCP/data agent, 2026-10-30 (the fourth extra of the correction request).

- [x] `app/src/system-accounts.ts` has no Hebrew display name for Bank/Clearing and Accumulated depreciation, so they show in English. Suggested: Bank/Clearing → "בנק", Accumulated depreciation → "פחת שנצבר".

**Acceptance:** a unit test for both names. Reports already had them in its own map; they move into `SYSTEM_NAMES`, so the line's journal and the composer read them too.
