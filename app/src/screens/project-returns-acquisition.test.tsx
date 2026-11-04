import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { birchLaneReturns, mapleCourtAcquisitionLines, mapleCourtClosingPaidReturns, mapleCourtSub2Returns } from "../dev/returns-sample";
import { ToastProvider } from "../ui/toast";
import { toPropertyReturns, type PropertyReturns } from "./project-returns-data";
import { TAKEN_OVER_LABEL, acquisitionFormula, appreciationFormula, purchaseRows } from "./project-returns-info";
import { PropertyReturnLineScreen } from "./project-returns-screen";
import { toReturnsJson } from "./project-returns-test-support";

// FLOW-466 (decision 0250): the acquisition page adds the bank lines and each loan paid out at
// closing up to the purchase price, and a loan counts what it paid at closing.

function renderLine(returns: PropertyReturns, line = "acquisition") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/projects/p1/investment/returns/${line}`]}>
          <Routes>
            <Route
              path="/projects/:projectId/investment/returns/:line"
              element={<PropertyReturnLineScreen sample={{ returns, projectName: "Maple Court", lines: mapleCourtAcquisitionLines }} />}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const sum = (rows: ReturnType<typeof purchaseRows>) => rows.reduce((total, row) => total + (row.value.kind === "money" ? row.value.minor : 0n), 0n);

describe("the acquisition page's calculation (FLOW-466)", () => {
  it("adds the bank lines and each loan at its closing amount up to the purchase row", () => {
    const formula = acquisitionFormula(mapleCourtClosingPaidReturns);
    if (formula == null) throw new Error("no formula");
    expect(formula.rows.map((row) => `${row.op}${row.label}`)).toEqual(["רכישה וסגירה (מהתנועות)", `+${TAKEN_OVER_LABEL}`, `+${TAKEN_OVER_LABEL}`]);
    expect(formula.rows.map((row) => row.hint)).toEqual([undefined, "Maple Street Mortgage", "Oak Bridge Lending"]);
    expect(formula.rows.map((row) => row.value)).toEqual([4_160_000n, 25_000_000n, 4_000_000n].map((minor) => ({ kind: "money", minor, income: false })));
    expect(formula.rows.map((row) => row.target)).toEqual([
      { kind: "line", line: "acquisition" },
      { kind: "loans", loanId: "loan-maple" },
      { kind: "loans", loanId: "loan-oak" },
    ]);
    expect(formula.result).toMatchObject({ op: "=", label: "מחיר רכישה", value: { kind: "money", minor: 33_160_000n } });
    // The rows add up to "=", and "=" is the purchase row's own figure.
    expect(sum(formula.rows)).toBe(33_160_000n);
    expect(sum(purchaseRows(mapleCourtClosingPaidReturns, "", false))).toBe(33_160_000n);
  });

  it("has no calculation without a loan in the price", () => {
    expect(acquisitionFormula(birchLaneReturns)).toBeNull();
    expect(acquisitionFormula({ ...mapleCourtSub2Returns, inputs: { ...mapleCourtSub2Returns.inputs, purchaseSource: "typed" } })).toBeNull();
  });

  it("leads with the purchase price, its calculation, then the transactions; a loan opens its page", () => {
    renderLine(mapleCourtClosingPaidReturns);
    expect(screen.getByRole("heading", { name: "רכישה וסגירה" })).toBeInTheDocument();
    expect(document.querySelector(".ui-ret-hero-figure")).toHaveTextContent("$331,600");
    const calc = screen.getByRole("list", { name: "רכישה וסגירה" });
    const links = within(calc).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/loans/loan-maple", "/loans/loan-oak"]);
    expect(within(calc).getByText("מחיר רכישה")).toBeInTheDocument();
    // FLOW-471: the count is of the rows that add up (the bank lines and two loans), not the "=" row.
    expect(screen.getByRole("button", { name: /^החישוב/ })).toHaveTextContent(/^החישוב3$/);
    // The bank lines are the transactions below: the row moves focus to their section.
    fireEvent.click(within(calc).getByRole("button", { name: /רכישה וסגירה \(מהתנועות\)/ }));
    const lines = screen.getByRole("region", { name: "תנועות" });
    expect(document.activeElement).toBe(lines.querySelector(".ui-rep-head"));
  });

  it("stays the lines alone with no loan in the price", () => {
    renderLine(birchLaneReturns);
    expect(screen.queryByRole("button", { name: /החישוב/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "תנועות" })).toBeInTheDocument();
  });

  it("reads each loan's closing amount and what the price counts", () => {
    const parsed = toPropertyReturns(toReturnsJson(mapleCourtClosingPaidReturns));
    expect(parsed.inputs.takenOverLoans[1]).toEqual({ id: "loan-oak", name: "Oak Bridge Lending", minor: 6_000_000n, closingPaidMinor: 4_000_000n, countedMinor: 4_000_000n });
    // An older server sends no counted_minor: the closing amount, else the principal.
    const json = toReturnsJson(mapleCourtClosingPaidReturns) as { inputs: { taken_over_loans: Array<Record<string, unknown>> } };
    const old = { ...json, inputs: { ...json.inputs, taken_over_loans: json.inputs.taken_over_loans.map(({ loan_id, name, principal_minor }) => ({ loan_id, name, principal_minor })) } };
    expect(toPropertyReturns(old).inputs.takenOverLoans.map((loan) => loan.countedMinor)).toEqual([25_000_000n, 6_000_000n]);
  });
});

describe("appreciation from the first value in the period (FLOW-466)", () => {
  it("calls the missing value שווי קודם, and names a start that is the first value in the period", () => {
    const one = appreciationFormula({ ...birchLaneReturns, inputs: { ...birchLaneReturns.inputs, valueStart: null } });
    expect(one.rows[1]).toMatchObject({ label: "שווי קודם", value: { kind: "missing", add: null, note: "חסר · עדכון שווי נוסף" } });
    const inPeriod = appreciationFormula({ ...birchLaneReturns, inputs: { ...birchLaneReturns.inputs, valueStart: { minor: 20_000_000n, date: "2026-03-01" } } });
    expect(inPeriod.rows[1]).toMatchObject({ label: "שווי ב־01/03/2026", hint: "השווי הראשון בתקופה" });
  });
});
