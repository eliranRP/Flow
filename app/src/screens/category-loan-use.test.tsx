import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { CategoriesScreen } from "./categories-screen";
import { categoryLoanUses, loanUseLine } from "./category-loan-use";

// FLOW-106 §3.5. Invented data.
const CATEGORIES = [
  { id: "c1", name: "חומרים", kind: "expense" as const, hidden: false, is_default: true, excluded_from_pnl: false, lines: 42 },
  { id: "c2", name: "ריבית בנק", kind: "expense" as const, hidden: false, is_default: false, excluded_from_pnl: false, lines: 12, loan_used: true },
  { id: "c3", name: "עמלות בנק", kind: "expense" as const, hidden: false, is_default: false, excluded_from_pnl: false, lines: 4, loan_used: true },
];
const LOANS = [
  { name: "משכנתא לדוגמה", interest_category_id: "c2", escrow_category_id: null, principal_category_id: null },
];

function openMenu(name: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>
            <CategoriesScreen sample={CATEGORIES} sampleLoans={LOANS} />
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: `עוד, ${name}` }));
  return screen.findByRole("dialog", { name });
}

describe("a loan's own category in Settings → Categories (FLOW-106 §3.5)", () => {
  it("names the first loan by name for each interest, escrow or principal category, and skips fees", () => {
    const uses = categoryLoanUses([
      { name: "ב הלוואה", interest_category_id: "x", escrow_category_id: "y", principal_category_id: null },
      { name: "א הלוואה", interest_category_id: "x", escrow_category_id: null, principal_category_id: "z" },
    ]);
    expect(uses.get("x")).toEqual({ loanName: "א הלוואה", part: "interest" });
    expect(uses.get("y")).toEqual({ loanName: "ב הלוואה", part: "escrow" });
    expect(uses.get("z")).toEqual({ loanName: "א הלוואה", part: "principal" });
    expect(loanUseLine({ loanName: "א הלוואה", part: "escrow" })).toBe("קטגוריה של הלוואה\u00a0· \u2068א הלוואה\u2069\u00a0· מסים וביטוח");
  });

  it("shows the locked line and hides the P&L action on a category a loan names", async () => {
    const sheet = await openMenu("ריבית בנק");
    expect(sheet.querySelector(".ui-cat-fixed")).toHaveTextContent("קטגוריה של הלוואה · \u2068משכנתא לדוגמה\u2069 · ריבית");
    expect(within(sheet).queryByRole("button", { name: /לספור ברווח/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "מחיקה" })).not.toBeInTheDocument();
  });

  it("keeps a fees category free", async () => {
    const sheet = await openMenu("עמלות בנק");
    expect(within(sheet).queryByText(/קטגוריה של הלוואה/)).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "לא לספור ברווח" })).toBeInTheDocument();
  });
});
