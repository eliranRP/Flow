import { describe, expect, it, vi } from "vitest";
import { runPaceChange } from "./pace-write";
import type { RpcClient } from "./recurring-actions";

/** A client whose set_payment_recurring answers `cleared` as prior_ends_on (the end date the write cleared). */
function fakeClient(cleared: string | null = null) {
  const rpc = vi.fn((name: string) => Promise.resolve({
    data: name === "set_payment_recurring" ? { prior_ends_on: cleared } : null,
    error: null,
  }));
  return { client: { rpc } as unknown as RpcClient, rpc };
}

// FLOW-415, FLOW-865: the RPCs of one pace pick, and the end date its ביטול puts back.
describe("runPaceChange", () => {
  it("marks a charge recurring, sets its pace and returns the end date the switch cleared", async () => {
    const { client, rpc } = fakeClient("2026-09-30");
    const cleared = await runPaceChange(client, { id: "tx-1", next: "month", before: { recurring: false, pace: "month" }, projectId: "p-elm" });
    expect(cleared).toBe("2026-09-30");
    expect(rpc.mock.calls).toEqual([
      ["set_payment_recurring", { p_id: "tx-1", p_recurring: true, p_project_id: "p-elm" }],
      ["set_payment_pace", { p_id: "tx-1", p_pace: "month", p_project_id: "p-elm" }],
    ]);
  });

  it("returns null when the switch cleared no end date, and when it was not written", async () => {
    expect(await runPaceChange(fakeClient().client, { id: "tx-1", next: "month", before: { recurring: false, pace: "month" } })).toBeNull();
    const { client, rpc } = fakeClient("2026-09-30");
    expect(await runPaceChange(client, { id: "tx-1", next: "quarter", before: { recurring: true, pace: "month" } })).toBeNull();
    expect(rpc.mock.calls).toEqual([["set_payment_pace", { p_id: "tx-1", p_pace: "quarter" }]]);
  });

  it("the ביטול of a mark-recurring sets the switch back, then puts back the end date it cleared", async () => {
    const { client, rpc } = fakeClient();
    await runPaceChange(client, {
      id: "tx-1",
      next: "never",
      before: { recurring: true, pace: "month" },
      projectId: "p-elm",
      undo: true,
      clearedEnd: "2026-09-30",
    });
    expect(rpc.mock.calls).toEqual([
      ["set_payment_recurring", { p_id: "tx-1", p_recurring: false, p_project_id: "p-elm" }],
      ["set_payment_end", { p_id: "tx-1", p_ends_on: "2026-09-30", p_project_id: "p-elm" }],
    ]);
  });

  it("a ביטול with no cleared end date writes only the switch", async () => {
    const { client, rpc } = fakeClient();
    await runPaceChange(client, { id: "tx-1", next: "never", before: { recurring: true, pace: "month" }, undo: true, clearedEnd: null });
    expect(rpc.mock.calls).toEqual([["set_payment_recurring", { p_id: "tx-1", p_recurring: false }]]);
  });

  it("a ביטול that marks the charge recurring again keeps the end date its own switch clears", async () => {
    const { client, rpc } = fakeClient("2026-09-30");
    expect(await runPaceChange(client, { id: "tx-1", next: "month", before: { recurring: false, pace: "month" }, undo: true })).toBeNull();
    expect(rpc.mock.calls).toEqual([
      ["set_payment_recurring", { p_id: "tx-1", p_recurring: true }],
      ["set_payment_end", { p_id: "tx-1", p_ends_on: "2026-09-30" }],
      ["set_payment_pace", { p_id: "tx-1", p_pace: "month" }],
    ]);
  });

  it("a refused write throws", async () => {
    const client = { rpc: () => Promise.resolve({ data: null, error: { message: "forbidden" } }) } as unknown as RpcClient;
    await expect(runPaceChange(client, { id: "tx-1", next: "never", before: { recurring: true, pace: "month" } })).rejects.toThrow();
  });
});
