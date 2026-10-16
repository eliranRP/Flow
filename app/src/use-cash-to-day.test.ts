// FLOW-364: the same-day read Home's change pills use. Invented figures only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  data: null,
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: unknown) => {
      rpc.calls.push({ name, args });
      return Promise.resolve({ data: rpc.data, error: null });
    },
  }),
}));

import { cashToDayQueryOptions } from "./use-cash-to-day";

describe("cashToDayQueryOptions", () => {
  beforeEach(() => {
    rpc.calls = [];
  });

  it("reads the month's first day and the day, and parses the rows", async () => {
    rpc.data = [
      { currency: "ILS", in_minor: "120000", out_minor: 45000 },
      { currency: "USD", in_minor: 9000, out_minor: 0 },
    ];
    const options = cashToDayQueryOptions("off", "2026-06", 11);
    const rows = await options.queryFn();
    expect(rpc.calls).toEqual([{ name: "cash_month_to_day", args: { p_month: "2026-06-01", p_day: 11 } }]);
    expect(rows).toEqual([
      { currency: "ILS", in_minor: 120000n, out_minor: 45000n },
      { currency: "USD", in_minor: 9000n, out_minor: 0n },
    ]);
  });

  it("keys the read by preview, month and day", () => {
    expect(cashToDayQueryOptions("off", "2026-06", 11).queryKey).toEqual(["dashboard", "cash-to-day", "off", "2026-06", 11]);
  });
});
