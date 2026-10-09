<a id="flow-705"></a>
# FLOW-705 · Jev anomalies follow-ups (#160 review)
- **Type:** BACKLOG NIT · **Status:** done · **Depends on:** —
- [x] A voided credit note still suppresses a duplicate flag. (#168)
- [x] An income receipt that pays several invoices can be flagged as a spike. (#168)
- [x] pgTAP cases for a pending line, two loans and an uneven median. (`jev_anomaly_cases.test.sql`.)
- [x] `mcp_review_anomalies` scans many rows when few lines are open. (#168)
