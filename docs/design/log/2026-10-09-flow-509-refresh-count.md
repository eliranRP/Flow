# FLOW-509: The Mercury refresh toast says how many lines came in

- PR: #PR
- Kind: copy
- Changed: the toast after "רענון עכשיו" in the Mercury sheet. It said only "הרענון הסתיים.", so the owner couldn't tell whether anything came in. After a run that read everything it now says "הרענון הסתיים. N תנועות חדשות.", "תנועה חדשה אחת." for one and "אין תנועות חדשות." for none. A run that stops early, and a background run this tab did not start, keep "הרענון הסתיים.", since their count would be partial.
- Rule: a toast after a sync says what changed, not only that it ended.
- Source: FLOW-509 (Mercury connector hardening).
