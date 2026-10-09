# FLOW-507: A viewer's expired connectors read neutral

- PR: #301
- Kind: screen
- Changed: Settings → Connections for a viewer. An expired SUMIT or Mercury key read "צריך לחבר מחדש" in the warning tone, an ask a viewer can't act on. The rows now say "לא מחובר כרגע" in the normal tone, matching the AI row (V29); while writes are held for other reasons the word is "לא מחובר". The owner's rows are unchanged. New stories: Screens/Routes Connections, viewer, reconnect (+ dark).
- Rule: a read-only view never shows a warning that asks for a write.
- Source: FLOW-507 (viewer mode follow-ups).
