import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LoanDetail } from "./loan-detail-data";
import { LoanKindSheet } from "./loan-kind-sheet";

// A regular 30-year loan: the board's kind sheet opens on its list alone.
const regular: LoanDetail = {
  id: "loan-1",
  companyId: "co-1",
  name: "Pinecrest Lending",
  currency: "USD",
  principalMinor: 24_000_000n,
  annualRatePpm: 62_500,
  termMonths: 360,
  startDate: "2026-11-01",
  paymentMinor: 183_772n,
  escrowMinor: 36_000n,
  kind: "amortizing",
  interestOnlyMonths: null,
  amortizationMonths: null,
  status: "open",
  closedOn: null,
  projectId: null,
  categoryIds: { interest: null, escrow: null, principal: null, fees: null },
  rates: [],
  balanceMinor: 24_000_000n,
  flaggedParts: 0,
};

function renderSheet(loan: LoanDetail, onSave: Parameters<typeof LoanKindSheet>[0]["onSave"] = vi.fn(() => Promise.resolve(null))) {
  const onOpenChange = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return <LoanKindSheet loan={loan} open={open} onOpenChange={(next) => { setOpen(next); onOpenChange(next); }} onSave={onSave} />;
  }
  render(<Host />);
  return { onSave, onOpenChange };
}

describe("LoanKindSheet, the board's pick list (FLOW-139d)", () => {
  it("draws the list alone, with no months step and no save button", async () => {
    renderSheet(regular);
    const dialog = await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    expect(screen.getByRole("radio", { name: /פריסה רגילה/ })).toBeChecked();
    expect(dialog.querySelector(".ui-loan-kind-step")).toBeNull();
    expect(screen.queryByRole("button", { name: "שמירה" })).toBeNull();
  });

  it("saves a regular pick on the tap, with the same patch as before", async () => {
    const { onSave } = renderSheet({ ...regular, kind: "interest_only", interestOnlyMonths: 12 });
    await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    fireEvent.click(screen.getByRole("radio", { name: /פריסה רגילה/ }));
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    expect(onSave).toHaveBeenCalledWith({
      kind: "amortizing",
      interestOnlyMonths: null,
      amortizationMonths: null,
      termMonths: 360,
      paymentMinor: 183_772n,
      escrowMinor: 36_000n,
    });
  });

  it("saves a demand pick on the tap, with the term, payment and escrow cleared", async () => {
    const { onSave } = renderSheet(regular);
    await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    fireEvent.click(screen.getByRole("radio", { name: /לפי דרישה/ }));
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    expect(onSave).toHaveBeenCalledWith({
      kind: "demand",
      interestOnlyMonths: null,
      amortizationMonths: null,
      termMonths: null,
      paymentMinor: null,
      escrowMinor: 0n,
    });
  });

  it("opens the months step for interest-only, and saves only on שמירה", async () => {
    const { onSave } = renderSheet(regular);
    await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    fireEvent.click(screen.getByRole("radio", { name: /ריבית בלבד/ }));
    expect(onSave).not.toHaveBeenCalled();
    const months = screen.getByLabelText("חודשי ריבית בלבד");
    expect(months).toHaveValue("12");
    expect(screen.getByText("אחריהם הקרן נפרסת על שאר התקופה")).toBeInTheDocument();
    expect(screen.getByText("תשלומים שכבר שויכו לא משתנים.")).toBeInTheDocument();
    fireEvent.change(months, { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "interest_only", interestOnlyMonths: 24, escrowMinor: 36_000n }));
  });

  it("checks the interest-only range and keeps the sheet open", async () => {
    const { onSave } = renderSheet(regular);
    await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    fireEvent.click(screen.getByRole("radio", { name: /ריבית בלבד/ }));
    fireEvent.change(screen.getByLabelText("חודשי ריבית בלבד"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("בין 1 ל־360")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("asks the balloon's amortization months within the term's range", async () => {
    renderSheet(regular);
    await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    fireEvent.click(screen.getByRole("radio", { name: /בלון/ }));
    expect(screen.getByLabelText("פריסה לחישוב התשלום (חודשים)")).toHaveValue("360");
    expect(screen.getByText("היתרה בסוף התקופה תשולם בתשלום אחד")).toBeInTheDocument();
  });

  it("closes on the stored kind's tap, with nothing to save", async () => {
    const { onSave, onOpenChange } = renderSheet(regular);
    await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    fireEvent.click(screen.getByRole("radio", { name: /פריסה רגילה/ }));
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false); });
  });

  it("keeps the other kinds off for a demand loan", async () => {
    renderSheet({ ...regular, kind: "demand", termMonths: null, paymentMinor: null, startDate: "2026-11-01" });
    await screen.findByRole("dialog", { name: "סוג ההלוואה" });
    expect(screen.getByRole("radio", { name: /פריסה רגילה/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /לפי דרישה/ })).toBeChecked();
  });
});
