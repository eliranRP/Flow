<a id="flow-409"></a>
# FLOW-409 · Overhead weights on the cash basis
- **Type:** BACKLOG NIT · **Status:** done (item 1 in 0129, item 2 in #180) · **Depends on:** —
- [x] The overhead split weights by invoiced income even on the cash form of `get_project`. Done in 0129: it weights by the basis' own income.
- [x] No pgTAP for the ILS filter in `get_home` and `get_project`. (`ils_filter_totals.test.sql`: both bases, a range, shared costs and the overhead weights.)
