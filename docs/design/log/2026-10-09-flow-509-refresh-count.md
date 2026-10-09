# FLOW-509: The Mercury refresh toast says how many lines came in

- PR: #331
- Kind: copy
- Changed: the toast after "רענון עכשיו" in the Mercury sheet. It said only "הרענון הסתיים.", so the owner couldn't tell whether anything came in. After a run that read everything it now says only the count, with no period like the other one-line toasts: "N תנועות חדשות", "תנועה חדשה אחת" for one and "אין תנועות חדשות" for none. The count alone says the refresh finished. A run that stops early, and a background run this tab did not start, keep "הרענון הסתיים.", since their count would be partial.
- Rule: a toast after a sync says what changed, not only that it ended.
- Source: FLOW-509 (Mercury connector hardening).
