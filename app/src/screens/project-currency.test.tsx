import type { ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectDetailScreen } from "./flow-screens";

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

function renderProject(sample: NonNullable<ProjectDetail>) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ProjectDetailScreen sample={sample} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectDetailScreen currency", () => {
  it("renders USD profit, band, categories, and signed transaction rows", () => {
    renderProject(usdProject());
    expect(screen.getByText("$2,750")).toBeInTheDocument();
    expect(screen.queryByText("אין עדיין הוצאות מסווגות.")).not.toBeInTheDocument();
    // Rows under הוצאות לפי קטגוריה carry no minus (FLOW-328).
    expect(screen.queryByText("−$1,250")).not.toBeInTheDocument();
    const categoryAmount = screen.getAllByText("$1,250")[0];
    expect(categoryAmount?.closest("bdi")).toHaveAttribute("dir", "ltr");
    fireEvent.click(screen.getByText("תנועות אחרונות"));
    const txnAmount = screen.getByText("Sample vendor").closest(".ui-row")?.querySelector(".ui-num");
    // Transaction rows show cents like Mercury, ".00" included, drawn small (decision 0120, option C).
    expect(txnAmount?.textContent).toBe("−$1,250.00");
    expect(txnAmount?.querySelector(".ui-num-cents")?.textContent).toBe(".00");
    expect(screen.queryByRole("link", { name: /categories/ })).not.toBeInTheDocument();
  });

  it("shows waiting USD lines once, in dollars, with no ₪0 row", () => {
    renderProject({
      ...usdProject(),
      pending_count: 2,
      pending_agorot: 0n,
      pending_other_currencies: [{ currency: "USD", expense_minor: -3_500n, count: 2 }],
    });
    expect(screen.getAllByText("2 ממתינות לאישור")).toHaveLength(1);
    const pendingRow = screen.getByText("2 ממתינות לאישור").closest(".ui-row");
    expect(pendingRow?.querySelector(".ui-num")?.textContent).toBe("$35");
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
  });

  it("splits waiting lines per currency in a mixed project and draws one band line per currency", () => {
    renderProject({
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
    });
    expect(screen.getByText("₪800")).toBeInTheDocument();
    expect(screen.getByText("$2,750")).toBeInTheDocument();
    expect(document.querySelectorAll(".ui-band-figures")).toHaveLength(2);
    const ilsRow = screen.getByText("1 ממתינה לאישור").closest(".ui-row");
    expect(ilsRow?.querySelector(".ui-num")?.textContent).toBe("₪10");
    const usdRow = screen.getByText("2 ממתינות לאישור").closest(".ui-row");
    expect(usdRow?.querySelector(".ui-num")?.textContent).toBe("$35");
  });

  it("keeps ILS rendering for older payloads", () => {
    renderProject({
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
    expect(screen.getByText("₪800")).toBeInTheDocument();
  });
});
