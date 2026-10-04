import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { StepLists } from "./steps";

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      if (name === "get_dashboard") {
        return Promise.resolve({
          data: {
            company_id: "company-1",
            name: "אלפא",
            vat_registered: true,
            basis: "cash",
            from: "2026-10-01",
            to: "2026-10-31",
            income_agorot: 0,
            direct_agorot: 0,
            shared_agorot: 0,
            overhead_agorot: 0,
            expense_agorot: 0,
            net_profit_agorot: 0,
            prev_income_agorot: null,
            prev_expense_agorot: null,
            prev_net_agorot: null,
            active_projects: 0,
            review_count: 0,
            projects: [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

describe("setup lists when SUMIT was skipped", () => {
  it("shows no projects and the nine default categories", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <BooksProvider>
            <StepLists sumitConnected={false} onSkip={() => undefined} onConfirm={() => undefined} />
          </BooksProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("link", { name: "אין פרויקטים" })).toBeInTheDocument();
    expect(screen.getByText("עוד אין פרויקטים. אפשר להוסיף אחר כך.")).toBeInTheDocument();
    const categories = await screen.findByRole("link", { name: "9 קטגוריות" });
    expect(categories).toHaveTextContent("חומרים, קבלני משנה, עבודה");
    expect(categories).toHaveTextContent("ועוד");
    expect(categories).toHaveTextContent("6");
  });
});
