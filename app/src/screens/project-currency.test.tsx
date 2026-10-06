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
    const categoryAmount = screen.getAllByText("−$1,250")[0];
    expect(categoryAmount?.closest("bdi")).toHaveAttribute("dir", "ltr");
    fireEvent.click(screen.getByText("תנועות אחרונות"));
    const txnAmount = screen.getByText("Sample vendor").closest(".ui-row")?.querySelector(".ui-num");
    expect(txnAmount?.textContent).toBe("−$1,250");
    expect(screen.queryByRole("link", { name: /categories/ })).not.toBeInTheDocument();
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
