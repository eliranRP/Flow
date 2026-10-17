import type { ProjectDetail } from "@flow/shared";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectDetailScreen } from "./flow-screens";
import type { ProjectSection } from "./project-detail-screen";
import { renderWithProviders } from "../test-render";
import { ProjectProfitScreen } from "./project-profit-screen";

/** The board's project profit page, on a project with no month rows (its figures come from the project). */
function renderProfit(sample: NonNullable<ProjectDetail>) {
  return renderWithProviders(
    <ProjectProfitScreen
      sample={{ project: sample, months: { basis: "cash", from: null, to: null, project_id: sample.id, after_overhead: false, base_currency: sample.base_currency ?? "ILS", months: [], by_currency: [] } }}
    />,
  );
}

function usdProject(): NonNullable<ProjectDetail> {
  return {
    id: "p-usd",
    name: "Harbor Sample",
    status: "active",
    state_label: "פעיל",
    budget_agorot: null,
    income_agorot: 0n,
    direct_agorot: 0n,
    shared_agorot: 0n,
    profit_agorot: 0n,
    by_currency: [{
      currency: "USD",
      income_minor: 400_000n,
      direct_minor: 125_000n,
      shared_minor: 0n,
      profit_minor: 275_000n,
    }],
    categories_by_currency: [{
      currency: "USD",
      id: "cat-1",
      name: "Utilities",
      amount_minor: 125_000n,
    }],
    categories: [],
    pending_count: 0,
    transactions: [{
      id: "t1",
      description: "Sample vendor",
      doc_date: "2026-09-10",
      amount_net: -125_000n,
      currency: "USD",
      direction: "expense",
      category: "Utilities",
    }],
  };
}

function renderProject(sample: NonNullable<ProjectDetail>, section: ProjectSection = "overview") {
  return renderWithProviders(<ProjectDetailScreen sample={sample} section={section} />);
}

describe("ProjectDetailScreen currency", () => {
  it("renders USD profit, band, categories, and signed transaction rows", () => {
    const profit = renderProfit(usdProject());
    expect(screen.getAllByText("+$2,750").length).toBeGreaterThan(0);
    profit.unmount();
    const expenses = renderProject(usdProject(), "expenses");
    expect(screen.queryByText("אין עדיין הוצאות מסווגות.")).not.toBeInTheDocument();
    // Rows under הוצאות לפי קטגוריה carry no minus (FLOW-328).
    expect(screen.queryByText("−$1,250")).not.toBeInTheDocument();
    const categoryAmount = screen.getAllByText("$1,250")[0];
    expect(categoryAmount?.closest("bdi")).toHaveAttribute("dir", "ltr");
    expenses.unmount();
    // FLOW-340 C: the lines are their own screen, where the transaction row keeps its minus.
    renderProject(usdProject(), "transactions");
    const txnAmount = screen.getByText("Sample vendor").closest(".ui-row")?.querySelector(".ui-num");
    // The project's lines show real agorot only, no ".00", as Search does (FLOW-340 C, FLOW-339 C).
    expect(txnAmount?.textContent).toBe("−$1,250");
    expect(txnAmount?.querySelector(".ui-num-cents")).toBeNull();
    expect(screen.queryByRole("link", { name: /categories/ })).not.toBeInTheDocument();
  });

  it("links a USD category to its drill-down in dollars", () => {
    renderProject(usdProject(), "expenses");
    // A transaction row's hint names the category too; the category row is the one titled Utilities.
    const row = screen.getAllByText("Utilities").find((el) => el.closest(".ui-row-title") != null)?.closest("a");
    // The project's period travels with it (FLOW-411), then the currency.
    expect(row?.getAttribute("href")).toMatch(/^\/projects\/p-usd\/categories\/cat-1\?period=[^&]+(&at=[^&]+)?&currency=USD$/);
  });

  it("shows waiting USD lines once, in dollars, with no ₪0 row", () => {
    renderProject({
      ...usdProject(),
      pending_count: 2,
      pending_agorot: 0n,
      pending_other_currencies: [{ currency: "USD", expense_minor: -3_500n, count: 2 }],
    }, "expenses");
    expect(screen.getAllByText("2 ממתינות לאישור")).toHaveLength(1);
    const pendingRow = screen.getByText("2 ממתינות לאישור").closest(".ui-row");
    expect(pendingRow?.querySelector(".ui-num")?.textContent).toBe("$35");
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
  });

  it("splits waiting lines per currency in a mixed project", () => {
    const mixed = {
      ...usdProject(),
      income_agorot: 100_000n,
      direct_agorot: 20_000n,
      profit_agorot: 80_000n,
      by_currency: [
        { currency: "ILS", income_minor: 100_000n, direct_minor: 20_000n, shared_minor: 0n, profit_minor: 80_000n },
        { currency: "USD", income_minor: 400_000n, direct_minor: 125_000n, shared_minor: 0n, profit_minor: 275_000n },
      ],
      pending_count: 3,
      pending_agorot: 1_000n,
      pending_other_currencies: [{ currency: "USD", expense_minor: -3_500n, count: 2 }],
    };
    renderProject(mixed, "expenses");
    const ilsRow = screen.getByText("1 ממתינה לאישור").closest(".ui-row");
    expect(ilsRow?.querySelector(".ui-num")?.textContent).toBe("₪10");
    const usdRow = screen.getByText("2 ממתינות לאישור").closest(".ui-row");
    expect(usdRow?.querySelector(".ui-num")?.textContent).toBe("$35");
  });

  it("keeps ILS rendering for older payloads", () => {
    renderProfit({
      ...usdProject(),
      by_currency: undefined,
      categories_by_currency: undefined,
      income_agorot: 100_000n,
      direct_agorot: 20_000n,
      shared_agorot: 0n,
      profit_agorot: 80_000n,
      categories: [{ id: "c", name: "Materials", amount_agorot: 20_000n }],
      transactions: [],
    });
    expect(screen.getAllByText("+₪800").length).toBeGreaterThan(0);
  });

  it("takes the overhead share off the company currency's row only (0147)", () => {
    renderProfit({
      ...usdProject(),
      base_currency: "USD",
      after_overhead: true,
      overhead_weighted: true,
      overhead_share_agorot: 90_000n,
      overhead_share_minor: 75_000n,
      income_agorot: 100_000n,
      direct_agorot: 20_000n,
      profit_agorot: 80_000n,
      profit_after_overhead_agorot: -10_000n,
      by_currency: [
        { currency: "USD", income_minor: 400_000n, direct_minor: 125_000n, shared_minor: 0n, profit_minor: 275_000n },
      ],
    });
    // The profit after the share is the USD row's ($2,750 less $750); the shekel row is not touched.
    expect(screen.getByText("רווח אחרי הוצאות כלליות").nextSibling).toHaveTextContent("$2,000");
    expect(screen.getByText("חלק בהוצאות הכלליות").nextSibling).toHaveTextContent("$750");
  });

  it("shows no after-share rows when the share is unknown or the overhead is not weighted (0147)", () => {
    const shared = { ...usdProject(), base_currency: "USD", after_overhead: true, overhead_weighted: true, overhead_share_minor: 75_000n };
    for (const project of [
      { ...shared, overhead_share_minor: null },
      { ...shared, overhead_weighted: false },
    ]) {
      const view = renderProfit(project);
      expect(screen.getAllByText("+$2,750").length).toBeGreaterThan(0);
      expect(screen.queryByText("רווח אחרי הוצאות כלליות")).toBeNull();
      view.unmount();
    }
  });
});
