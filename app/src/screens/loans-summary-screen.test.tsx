import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { sampleLoanStore, sampleLoans } from "../dev/loan-detail-sample";
import { renderWithProviders } from "../test-render";
import { memoryLoanStore, type MemoryLoanStore } from "./loan-detail-store";
import { LoansSummaryScreen } from "./loans-summary-screen";

// FLOW-142. The loans summary on a memory store: the period switch, the debt and paid cards, a row
// opening its loan, and the closed loans left out of the sums.

function renderSummary(store: MemoryLoanStore, phase?: "loading" | "error") {
  return renderWithProviders(
    <Routes>
      <Route path="/loans/summary" element={<LoansSummaryScreen store={store} currency="USD" today="2026-10-17" phase={phase} />} />
      <Route path="/loans/:loanId" element={<p>עמוד ההלוואה</p>} />
      <Route path="/loans" element={<p>רשימת ההלוואות</p>} />
    </Routes>,
    { route: "/loans/summary" },
  );
}

describe("loans summary (FLOW-142)", () => {
  it("leads with the debt since the loans started, what was paid by part, and each open loan", () => {
    renderSummary(sampleLoanStore());
    expect(screen.getByRole("heading", { level: 1, name: "סיכום הלוואות" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "מתחילת ההלוואות" })).toHaveAttribute("aria-checked", "true");
    const debt = screen.getByRole("region", { name: "החוב" });
    expect(within(debt).getByText("החוב בהתחלה")).toBeInTheDocument();
    expect(within(debt).getByText("נשאר לשלם היום")).toBeInTheDocument();
    const paid = screen.getByRole("region", { name: "שולם" });
    expect(within(paid).getByText("שולם מתחילת ההלוואות")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לפי הלוואה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^משכנתא דוגמה, / })).toHaveAccessibleName(/נפרע 26%/);
  });

  it("switches every figure to this year, and keeps the choice while the page is open", () => {
    renderSummary(sampleLoanStore());
    fireEvent.click(screen.getByRole("radio", { name: "2026" }));
    expect(screen.getByText("החוב ב־01/01/2026")).toBeInTheDocument();
    expect(screen.getByText("שולם ב־2026")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2026" })).toHaveAttribute("aria-checked", "true");
  });

  it("leaves the loans that ended out of the sums and names them in one line", () => {
    renderSummary(sampleLoanStore());
    expect(screen.queryByRole("button", { name: /^שטר ישן, / })).not.toBeInTheDocument();
    expect(screen.getByText("2 הלוואות נסגרו")).toBeInTheDocument();
  });

  it("opens a loan's page from its row", () => {
    renderSummary(sampleLoanStore());
    fireEvent.click(screen.getByRole("button", { name: /^משכנתא דוגמה, / }));
    expect(screen.getByText("עמוד ההלוואה")).toBeInTheDocument();
  });

  it("with no open loan, says so and leads back to the list", () => {
    renderSummary(memoryLoanStore(sampleLoans().filter((sample) => sample.loan.status !== "open")));
    expect(screen.getByText("אין הלוואות פעילות")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לרשימת ההלוואות" })).toHaveAttribute("href", "/loans");
  });

  it("offers a retry when the read fails", () => {
    renderSummary(sampleLoanStore(), "error");
    expect(screen.getByText("לא הצלחנו לטעון את הסיכום")).toBeInTheDocument();
  });
});
