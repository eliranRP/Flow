import { describe, expect, it, vi } from "vitest";
import { dismissRecurringAlert, restoreRecurringAlert, type RpcClient } from "./recurring-actions";

function fakeClient(error: { message: string } | null = null) {
  const rpc = vi.fn(() => Promise.resolve({ error }));
  return { client: { rpc } as unknown as RpcClient, rpc };
}

describe("recurring alert writes (FLOW-447b)", () => {
  it("dismisses and restores a missing-bill alert by its key", async () => {
    const { client, rpc } = fakeClient();
    await dismissRecurringAlert(client, "expense:power:USD:2026-10");
    await restoreRecurringAlert(client, "expense:power:USD:2026-10");
    expect(rpc).toHaveBeenNthCalledWith(1, "dismiss_recurring_alert", { p_kind: "missing", p_key: "expense:power:USD:2026-10" });
    expect(rpc).toHaveBeenNthCalledWith(2, "undismiss_recurring_alert", { p_kind: "missing", p_key: "expense:power:USD:2026-10" });
  });

  it("throws when the database refuses the write", async () => {
    const { client } = fakeClient({ message: "forbidden" });
    await expect(dismissRecurringAlert(client, "k")).rejects.toThrow("forbidden");
  });
});
