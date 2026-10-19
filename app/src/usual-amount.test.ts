import { describe, expect, it, vi } from "vitest";
import type { RpcClient } from "./recurring-actions";
import { ownerBefore, runUsualAmount, usualOf, usualToast } from "./usual-amount";

describe("the usual amount (decision 0189)", () => {
  it("shows the amount unsigned and says whether the owner set it", () => {
    expect(usualOf({ typical_amount_minor: -170000, typical_amount_source: "owner" })).toEqual({ minor: 170000n, owner: true });
    expect(usualOf({ typical_amount_minor: 175740, typical_amount_source: "computed" })).toEqual({ minor: 175740n, owner: false });
    expect(usualOf({ typical_amount_minor: 175740 })).toEqual({ minor: 175740n, owner: false });
  });

  it("the amount before a write is the owner's, or none", () => {
    expect(ownerBefore({ typical_amount_minor: -170000, typical_amount_source: "owner" })).toBe(170000);
    expect(ownerBefore({ typical_amount_minor: 175740, typical_amount_source: "computed" })).toBeNull();
  });

  it("toasts a new amount and a return to Flow's own", () => {
    expect(usualToast(170000, "Example Rent Platform")).toBe("הסכום הרגיל עודכן: Example Rent Platform");
    expect(usualToast(null, "Example Rent Platform")).toBe("הסכום הרגיל חזר לחישוב: Example Rent Platform");
  });

  it("writes through the charge's line, naming its project, and null clears", async () => {
    const rpc = vi.fn(() => Promise.resolve({ error: null }));
    const client = { rpc } as unknown as RpcClient;
    expect(await runUsualAmount(client, { lineId: "tx-1", projectId: "p-hazel", next: 170000 })).toBeNull();
    await runUsualAmount(client, { lineId: "tx-1", projectId: null, next: null });
    expect(rpc.mock.calls).toEqual([
      ["set_payment_amount", { p_id: "tx-1", p_amount_minor: 170000, p_project_id: "p-hazel" }],
      ["set_payment_amount", { p_id: "tx-1", p_amount_minor: null }],
    ]);
  });

  it("a refused write throws", async () => {
    const client = { rpc: () => Promise.resolve({ error: { message: "forbidden" } }) } as unknown as RpcClient;
    await expect(runUsualAmount(client, { lineId: "tx-1", projectId: null, next: 100 })).rejects.toThrow();
  });
});
