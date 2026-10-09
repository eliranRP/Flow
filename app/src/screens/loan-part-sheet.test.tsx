import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAMPLE_LOAN_CATEGORIES } from "../dev/loan-detail-sample";
import { LoanPartSheet } from "./loan-detail-sheets";

const loan = { categoryIds: { interest: null, escrow: null, principal: null, fees: null } };

describe("LoanPartSheet", () => {
  // FLOW-414 (decision 0166): interest and escrow list kept-out categories, marked as fees mark them.
  it.each(["interest", "escrow", "fees"] as const)("marks a kept-out category for %s", (part) => {
    render(
      <LoanPartSheet part={part} loan={loan} categories={SAMPLE_LOAN_CATEGORIES} open onOpenChange={() => undefined} onSave={() => Promise.resolve(null)} />,
    );
    const row = screen.getByRole("radio", { name: /עלויות סגירה/ });
    expect(row).toHaveAccessibleDescription(/מחוץ לרווח והפסד/);
    expect(screen.getByRole("radio", { name: /הוצאות משרד/ })).not.toHaveAccessibleDescription(/מחוץ לרווח והפסד/);
  });

  it("does not mark principal's categories, which are all kept out", () => {
    render(
      <LoanPartSheet part="principal" loan={loan} categories={SAMPLE_LOAN_CATEGORIES} open onOpenChange={() => undefined} onSave={() => Promise.resolve(null)} />,
    );
    expect(screen.queryByText("מחוץ לרווח והפסד")).not.toBeInTheDocument();
  });
});
