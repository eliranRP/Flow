import type { ProjectDetail } from "@flow/shared";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("ProjectDetailScreen currency", () => {
  it("renders USD profit in dollars on the profit page", () => {
    renderProfit(usdProject());
    expect(screen.getAllByText("+$2,750").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /categories/ })).not.toBeInTheDocument();
  });

  it("links a USD category to its drill-down in dollars", () => {
    renderProfit(usdProject());
    fireEvent.click(screen.getByRole("radio", { name: "לפי קטגוריה" }));
    const row = screen.getByText("Utilities").closest("a");
    // The currency travels with the link, so the drill-down reads in dollars.
    expect(row?.getAttribute("href")).toBe("/projects/p-usd/categories/cat-1?currency=USD");
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
