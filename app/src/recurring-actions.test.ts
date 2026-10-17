import { describe, expect, it, vi } from "vitest";
import { answerRecurringMatch, dismissRecurringAlert, restoreRecurringAlert, type RpcClient } from "./recurring-actions";

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

describe("recurring change alert and match writes (FLOW-447c)", () => {
  it("dismisses and restores a change alert by the arrival's line id", async () => {
    const { client, rpc } = fakeClient();
    await dismissRecurringAlert(client, "tx-1", "change");
    await restoreRecurringAlert(client, "tx-1", "change");
    expect(rpc).toHaveBeenNthCalledWith(1, "dismiss_recurring_alert", { p_kind: "change", p_key: "tx-1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "undismiss_recurring_alert", { p_kind: "change", p_key: "tx-1" });
  });

  it("answers a suggested match: same, not, and taken back", async () => {
    const { client, rpc } = fakeClient();
    const base = { direction: "expense" as const, partyId: "power", matchPartyId: "power-alt" };
    await answerRecurringMatch(client, { ...base, same: true });
    await answerRecurringMatch(client, { ...base, same: false });
    await answerRecurringMatch(client, { ...base, same: null });
    expect(rpc).toHaveBeenNthCalledWith(1, "answer_recurring_match", { p_direction: "expense", p_party_id: "power", p_match_party_id: "power-alt", p_same: true });
    expect(rpc).toHaveBeenNthCalledWith(2, "answer_recurring_match", { p_direction: "expense", p_party_id: "power", p_match_party_id: "power-alt", p_same: false });
    expect(rpc).toHaveBeenNthCalledWith(3, "answer_recurring_match", { p_direction: "expense", p_party_id: "power", p_match_party_id: "power-alt", p_same: null });
  });

  it("throws when the match answer is refused", async () => {
    const { client } = fakeClient({ message: "validation" });
    await expect(answerRecurringMatch(client, { direction: "income", partyId: "a", matchPartyId: "b", same: true })).rejects.toThrow("validation");
  });
});
