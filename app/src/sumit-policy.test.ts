import { describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  readSumitBody,
  rejectionPlan,
} from "../../supabase/functions/_shared/sumit-policy";

describe("SUMIT backoff", () => {
  it("waits 5 minutes at the first attempts and a day after that", () => {
    expect(backoffDelay(0)).toBe(5 * 60_000);
    expect(backoffDelay(1)).toBe(5 * 60_000);
    expect(backoffDelay(5)).toBe(24 * 60 * 60_000);
    expect(backoffDelay(9)).toBe(24 * 60 * 60_000);
  });
});

describe("SUMIT status classification", () => {
  it("treats Status 1 as a rejection, writes no ledger, and waits five minutes", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ Status: 1 }), { status: 200 }));
    const body = await readSumitBody(fetchImpl, "https://api.sumit.co.il/crm/schema/listfolders/");
    expect(rejectionPlan(body)).toEqual({
      wroteLedger: false,
      code: "sumit_rejected",
      attempts: 1,
      delayMs: 5 * 60_000,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps an obligo block on the backoff clock and a bad key off it", () => {
    expect(rejectionPlan({
      Status: 1,
      UserErrorMessage: "API is restricted due to exceeding the ActionsBilling obligo",
    }).code).toBe("sumit_rejected");
    const auth = rejectionPlan({ Status: 1, UserErrorMessage: "invalid api key" });
    expect(auth).toEqual({ wroteLedger: false, code: "sumit_auth", attempts: null, delayMs: null });
  });
});
