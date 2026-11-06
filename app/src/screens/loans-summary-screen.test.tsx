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
    expect(screen.getByRole("radio", { name: "מההתחלה" })).toHaveAttribute("aria-checked", "true");
    // FLOW-1046: the band holds what was paid, the debt at the start and what is left.
    const band = screen.getByRole("banner");
    expect(within(band).getByText("שולם מתחילת ההלוואות")).toBeInTheDocument();
    expect(within(band).getByText("החוב בהתחלה")).toBeInTheDocument();
    expect(within(band).getByText("נשאר לשלם היום")).toBeInTheDocument();
    const paid = screen.getByRole("region", { name: "שולם" });
    expect(within(paid).getByText("ממה הורכבו התשלומים")).toBeInTheDocument();
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

  // FLOW-1075: the third option, one month, stepped in the band.
  it("shows one month: its total, the change from the month before, its parts and its payments", () => {
    renderSummary(sampleLoanStore());
    fireEvent.click(screen.getByRole("radio", { name: "חודש" }));
    const band = screen.getByRole("banner");
    expect(within(band).getByText("אוקטובר 2026")).toBeInTheDocument();
    expect(within(band).getByText("שולם באוקטובר 2026")).toBeInTheDocument();
    expect(within(band).getByText("לעומת ספטמבר")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "תשלומי אוקטובר 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "לפי הלוואה" })).toBeNull();
    // This month is the last one: the later chevron is off, the earlier one steps back.
    expect(within(band).getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(band).getByRole("button", { name: "חודש קודם" }));
    expect(within(band).getByText("ספטמבר 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "תשלומי ספטמבר 2026" })).toBeInTheDocument();
  });

  it("opens a month's payment as its transaction", () => {
    renderWithProviders(
      <Routes>
        <Route path="/loans/summary" element={<LoansSummaryScreen store={sampleLoanStore()} currency="USD" today="2026-10-17" period="month" month="2026-08" />} />
        <Route path="/transactions/:id" element={<p>עמוד התנועה</p>} />
      </Routes>,
      { route: "/loans/summary" },
    );
    const rows = within(screen.getByRole("region", { name: /תשלומי אוגוסט 2026/ })).getAllByRole("link");
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0] as HTMLElement);
    expect(screen.getByText("עמוד התנועה")).toBeInTheDocument();
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
