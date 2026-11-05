import { formatAmountText } from "@flow/shared";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JUNIPER_NEXT_LOAN } from "../dev/project-next-month-sample";
import { cash as flipCash, investment as flipInvestment, project as flipProject, thisMonth } from "../dev/project-cash-sample";
import { kindNextSample } from "../dev/project-kinds-next-sample";
import { kindSample } from "../dev/project-kinds-sample";
import { devProjectsCash } from "../dev/projects-sample";
import { shiftMonthKey } from "../period";
import type { ForecastLoan } from "../project-next-loans";
import { applyForecastEdits, nextMonthForecast, nextMonthKey } from "../project-next-month";
import { paymentsLeft } from "./loan-outlook";
import { renderWithProviders } from "../test-render";
import { ProjectDetailScreen } from "./flow-screens";

// The project page's next-month row, by kind. The samples' months run from today.


function renderKind(kind: "rental" | "client", loans?: ForecastLoan[]) {
  const data = kindSample(kind, devProjectsCash.projects[0]);
  const sampleNext = data.next == null || loans == null ? data.next : { ...data.next, loans };
  return renderWithProviders(
    <ProjectDetailScreen sample={data.project} sampleCash={data.cash} sampleInvestment={data.investment} sampleMenuRow={data.row} sampleNext={sampleNext} />,
  );
}

function renderFlip() {
  const base = devProjectsCash.projects[0];
  const row = base == null ? undefined : { ...base, id: flipProject.id, first_month: `${shiftMonthKey(thisMonth, -3)}-01`, deletable: false };
  return renderWithProviders(
    <ProjectDetailScreen sample={flipProject} sampleCash={flipCash} sampleInvestment={flipInvestment} sampleMenuRow={row} sampleNext={kindNextSample("flip", flipProject.id)} />,
  );
}

/** FLOW-1044: next month is one row under the kind's card; it opens the צפי page. */
function forecastRow(): HTMLElement {
  return screen.getByRole("link", { name: /^צפוי לחודש הבא/ });
}

describe("the project page's next month (spec-cash2), one row under the card (FLOW-1044)", () => {
  it("a rental: the row shows next month's cash net and opens the צפי page", () => {
    renderKind("rental");
    const row = forecastRow();
    expect(row.getAttribute("href")).toBe("/projects/p-rental/profit/next");
    expect(row).toHaveTextContent("+$2,285");
    // The chart and the card left the page with v3 (the profit page keeps them).
    expect(screen.queryByRole("img", { name: /^נכנס ויצא לפי חודש/ })).not.toBeInTheDocument();
  });

  it("a rental with an amortizing loan: the row takes next month's principal off, as the צפי page's cash", () => {
    const base = JUNIPER_NEXT_LOAN.loans?.[0] as ForecastLoan;
    const data = kindSample("rental", devProjectsCash.projects[0]);
    const today = data.next?.today ?? "";
    const loan: ForecastLoan = { ...base, projectId: data.project.id, startDate: `${shiftMonthKey(thisMonth, -1)}-01` };
    const due = paymentsLeft(loan, today)?.find((row) => row.dueDate.startsWith(nextMonthKey(today)));
    const principal = due?.principalMinor ?? 0n;
    expect(principal).toBeGreaterThan(0n);
    const profit = applyForecastEdits(nextMonthForecast({
      projectId: data.project.id, currency: "USD", today, recurring: data.next?.expected.recurring ?? [], categoryMonths: data.next?.categoryMonths, loans: [loan], categories: data.next?.categories,
    }), data.next?.edits ?? []);
    const net = profit.incomeMinor - profit.expenseMinor - principal;
    renderKind("rental", [loan]);
    expect(forecastRow()).toHaveTextContent(formatAmountText(net, "USD", { plus: net > 0n, direction: net > 0n ? "income" : undefined }));
  });

  it("a flip: the renovation's month ahead", () => {
    renderFlip();
    expect(forecastRow()).toHaveTextContent("−$12,000");
  });

  it("a client job: the client's payment less the subcontractor", () => {
    renderKind("client");
    expect(forecastRow()).toHaveTextContent("+$8,300");
  });

  it("a project with nothing filed yet shows no row", () => {
    const data = kindSample("new", devProjectsCash.projects[0]);
    renderWithProviders(<ProjectDetailScreen sample={data.project} sampleCash={data.cash} sampleInvestment={data.investment} sampleMenuRow={data.row} />);
    expect(screen.queryByRole("link", { name: /^צפוי לחודש הבא/ })).not.toBeInTheDocument();
  });
});
