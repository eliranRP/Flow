<a id="flow-706"></a>
# FLOW-706 · Jev fills can't be undone from the app while Jev is off
- **Type:** BUG · **Status:** done (#270) · **Depends on:** — · **Source:** #231 code review
- **What:** Decision 0145 says fills already made stay undoable after the owner turns Jev off. The app reads `jev_prefills` only inside the Jev suggestion read, which runs only while the connector is on, so with Jev off a filled line shows no "✦ מולא ע״י Jev" and no בטל (MCP `undo_jev_prefill` still works). App only, no server change: read the newest standing fill per open line even when the connector is off, show the label with בטל, and keep the stored values (no visual fill).
- **Acceptance:** a queue test with the connector off and a standing fill shows the label and בטל calls `undo_jev_prefill`; design review.
