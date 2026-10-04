import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoanBalanceList, LoanSplitPanel } from "./loan-match";

const loan = {
  id: "loan-1",
  name: "הלוואת דוגמה",
  currency: "ILS",
  principalMinor: 10_000_000,
  annualRatePpm: 60_000,
  termMonths: 360,
  startDate: "2026-02-01",
  paymentMinor: 59_955,
  escrowMinor: 0,
};

function panel(props: Partial<ComponentProps<typeof LoanSplitPanel>> = {}) {
  return render(
    <MemoryRouter>
      <LoanSplitPanel
        offerMatch
        currency="ILS"
        parts={null}
        loans={[loan]}
        needsReview={false}
        currencyMismatch={false}
        busy={false}
        onMatch={vi.fn()}
        onCorrect={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("LoanSplitPanel", () => {
  it("offers a loan when the line is not split yet", () => {
    const onMatch = vi.fn();
    panel({ onMatch });
    fireEvent.click(screen.getByRole("button", { name: "שיוך להלוואה" }));
    fireEvent.click(screen.getByRole("button", { name: "הלוואת דוגמה" }));
    expect(onMatch).toHaveBeenCalledWith("loan-1");
  });

  it("shows the three parts and a one-tap correction when review is waiting", () => {
    const onCorrect = vi.fn();
    panel({
      onCorrect,
      needsReview: true,
      parts: [
        { id: "a", part: "interest", amountMinor: 500n, scheduledMinor: 500n, needsReview: true, loanId: "loan-1" },
        { id: "b", part: "escrow", amountMinor: 200n, scheduledMinor: 200n, needsReview: true, loanId: "loan-1" },
        { id: "c", part: "principal", amountMinor: 300n, scheduledMinor: 300n, needsReview: true, loanId: "loan-1" },
      ],
    });
    expect(screen.getByText("ריבית")).toBeInTheDocument();
    expect(screen.getByText("מסים וביטוח")).toBeInTheDocument();
    expect(screen.getByText("קרן")).toBeInTheDocument();
    expect(screen.getByText("₪5.00")).toBeInTheDocument();
    expect(screen.getByText("החלוקה ממתינה לבדיקה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עדכון החלוקה" }));
    expect(onCorrect).toHaveBeenCalled();
  });

  it("does not offer a one-tap correction when the currency does not match", () => {
    panel({
      needsReview: true,
      currencyMismatch: true,
      parts: [
        { id: "a", part: "interest", amountMinor: 500n, scheduledMinor: 500n, needsReview: true, loanId: "loan-1" },
        { id: "b", part: "escrow", amountMinor: 200n, scheduledMinor: 200n, needsReview: true, loanId: "loan-1" },
        { id: "c", part: "principal", amountMinor: 300n, scheduledMinor: 300n, needsReview: true, loanId: "loan-1" },
      ],
    });
    expect(screen.getByText("המטבע של השורה לא מתאים להלוואה.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עדכון החלוקה" })).not.toBeInTheDocument();
  });
});

describe("LoanBalanceList", () => {
  it("shows the balance and a waiting hint", () => {
    render(
      <LoanBalanceList
        rows={[{
          id: "loan-1",
          name: "הלוואת דוגמה",
          currency: "ILS",
          balanceMinor: 11_700_000n,
          flaggedParts: 3,
        }]}
      />,
    );
    expect(screen.getByText("הלוואת דוגמה")).toBeInTheDocument();
    expect(screen.getByText("₪117,000.00")).toBeInTheDocument();
    expect(screen.getByText("ממתין לבדיקה")).toBeInTheDocument();
  });
});
