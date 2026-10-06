import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { DEFAULT_CATEGORY_NAMES, visibleCategoryNames } from "./copy";
import { StepLists } from "./steps";

const categories = vi.hoisted(() => ({ rows: [] as Array<{ id: string; name: string; kind: "expense" | "income"; hidden: boolean; is_default: boolean }> }));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      if (name === "list_categories") return Promise.resolve({ data: categories.rows, error: null });
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

function category(name: string, hidden = false) {
  return { id: name, name, kind: "expense" as const, hidden, is_default: true };
}

describe("setup lists when SUMIT was skipped", () => {
  it("shows no projects and the nine default categories", async () => {
    categories.rows = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <BooksProvider>
            <StepLists onSkip={() => undefined} onConfirm={() => undefined} />
          </BooksProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("link", { name: "אין פרויקטים" })).toBeInTheDocument();
    expect(screen.getByText("עוד אין פרויקטים. אפשר להוסיף אחר כך.")).toBeInTheDocument();
    const row = await screen.findByRole("link", { name: "9 קטגוריות" });
    expect(row).toHaveTextContent("חומרים, קבלני משנה, עבודה");
    expect(row).toHaveTextContent("ועוד");
    expect(row).toHaveTextContent("6");
  });

  it("counts visible non-system categories and ignores the loan seeds", async () => {
    categories.rows = [
      ...DEFAULT_CATEGORY_NAMES.map((name) => category(name)),
      category("תשלומי הלוואה"),
      category("העברות"),
      category("העברות"),
      category("ריבית משכנתא"),
      category("מסים וביטוח"),
      category("מוסתרת", true),
    ];
    expect(visibleCategoryNames(categories.rows)).toHaveLength(9);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <BooksProvider>
            <StepLists onSkip={() => undefined} onConfirm={() => undefined} />
          </BooksProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("link", { name: "9 קטגוריות" })).toBeInTheDocument();
    expect(screen.queryByText("14 קטגוריות")).not.toBeInTheDocument();
  });
});
