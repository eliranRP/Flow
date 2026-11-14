import { afterEach, describe, expect, it, vi } from "vitest";
import { liveLoanWrites } from "./loan-detail-store";

// FLOW-854: the loan page writes loans and loan_rates only through RPCs, never the tables.
const rpc = vi.fn();
const from = vi.fn((table: string) => { throw new Error(`no table write: ${table}`); });
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ rpc, from }) }));

afterEach(() => { rpc.mockReset(); from.mockClear(); });

describe("the loan page's live writes", () => {
  it("patches the loan through update_loan, with the patch's columns only", async () => {
    rpc.mockResolvedValueOnce({ data: "loan-1", error: null });
    await liveLoanWrites.update("loan-1", { status: "paid_off", closedOn: "2026-10-01", categoryIds: { fees: "cat-bank" } });
    expect(rpc).toHaveBeenLastCalledWith("update_loan", {
      p_loan_id: "loan-1",
      p_patch: { status: "paid_off", closed_on: "2026-10-01", fees_category_id: "cat-bank" },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps a refusal's code, and reads no id back as a refusal", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden", code: "42501" } });
    await expect(liveLoanWrites.update("loan-1", { escrowMinor: 0n })).rejects.toMatchObject({ code: "42501" });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(liveLoanWrites.update("loan-1", { escrowMinor: 0n })).rejects.toMatchObject({ code: "42501" });
  });

  it("adds a rate, or changes one by its id, through save_loan_rate", async () => {
    rpc.mockResolvedValueOnce({ data: "rate-1", error: null });
    await expect(liveLoanWrites.saveRate({ id: "loan-1" }, { effectiveDate: "2026-06-01", annualRatePpm: 65_000 })).resolves.toBe("rate-1");
    expect(rpc).toHaveBeenLastCalledWith("save_loan_rate", { p_loan_id: "loan-1", p_effective_date: "2026-06-01", p_annual_rate_ppm: 65_000 });
    rpc.mockResolvedValueOnce({ data: "rate-1", error: null });
    await expect(liveLoanWrites.saveRate({ id: "loan-1" }, { id: "rate-1", effectiveDate: "2026-07-01", annualRatePpm: 66_000 })).resolves.toBe("rate-1");
    expect(rpc).toHaveBeenLastCalledWith("save_loan_rate", {
      p_loan_id: "loan-1", p_effective_date: "2026-07-01", p_annual_rate_ppm: 66_000, p_loan_rate_id: "rate-1",
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "rate before the loan start", code: "23514" } });
    await expect(liveLoanWrites.saveRate({ id: "loan-1" }, { effectiveDate: "2025-01-01", annualRatePpm: 1 }))
      .rejects.toMatchObject({ message: "rate before the loan start", code: "23514" });
  });

  it("removes a rate through delete_loan_rate", async () => {
    rpc.mockResolvedValueOnce({ data: "rate-1", error: null });
    await liveLoanWrites.deleteRate("rate-1");
    expect(rpc).toHaveBeenLastCalledWith("delete_loan_rate", { p_loan_rate_id: "rate-1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden", code: "42501" } });
    await expect(liveLoanWrites.deleteRate("rate-2")).rejects.toMatchObject({ code: "42501" });
    expect(from).not.toHaveBeenCalled();
  });
});
