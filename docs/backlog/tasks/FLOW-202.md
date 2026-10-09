<a id="flow-202"></a>
# FLOW-202 · sync_bank returns before slow MCP clients time out
- **Type:** MCP · **Status:** done (#75) · **Depends on:** —
- **What:** A bank pull through `sync_bank` can take about 45 seconds, and clients with a 30-second timeout cut it off. The MCP token also lives 60 seconds while a pull can take 120, so the finish step can fail silently. Start the sync and return a job id, plus a read tool for the job status (or stream progress).
- **Acceptance:** tool returns within a few seconds; status tool reports added, skipped and newest date; the finish step validates the response shape before storing.
