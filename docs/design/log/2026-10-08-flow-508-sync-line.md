# FLOW-508: The sync time gets its own line in the connector sheets

- PR: #TBD
- Kind: screen
- Changed: the SUMIT and Mercury status sheets in Settings → חיבורים. "מחובר · מספר חברה N · עודכן …" wrapped at 320, and the second line started with "·". The sync time ("עודכן ב-3.10") now always sits on its own line under "מחובר · מספר חברה N", with no separator.
- Rule: A status line that can wrap at 320 puts its time phrase on its own line; no wrapped line starts with a "·" separator.
- Source: FLOW-508 (settings copy at 320); screenshots of Connections stories at 320.
