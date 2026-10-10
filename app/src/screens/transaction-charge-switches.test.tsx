import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PaymentRecurring, TransactionDetail } from "@flow/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { TransactionScreen } from "./flow-screens";

// FLOW-415 (a-3). Invented data only.
const base: NonNullable<TransactionDetail> = {
  id: "t-1",
  description: "אור חשמל",
  direction: "expense",
  doc_date: "2026-10-04",
  amount_gross: -255_000n,
  amount_net: -255_000n,
  vat_amount: 0n,
  vat_status: "source",
  source: "sumit",
  pnl_role: "project",
  review_status: "approved",
  project_id: "p1",
  project_name: "בניין לדוגמה",
  category_id: "c1",
  category_name: "חשמל",
  supplier_name: "אור חשמל",
  customer_name: null,
  allocations: [],
  in_pnl_override: null,
  category_excluded_from_pnl: false,
  in_pnl: true,
  pnl_fixed: false,
};

const found: PaymentRecurring = {
  transaction_id: "t-1",
  party: { direction: "expense", id: "s1", name: "אור חשמל", currency: "ILS" },
  recurring: true,
  override: null,
  detected: true,
  typical_day: 4,
  typical_amount_minor: -185_000n,
};

function show(sample: NonNullable<TransactionDetail>, recurring: PaymentRecurring | null) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>
            <TransactionScreen sample={sample} sampleRecurring={recurring} />
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("payment page: cash and recurring switches (FLOW-415)", () => {
  it("draws both under נספר ברווח, with the pace and זוהה לבד on a found charge", () => {
    show(base, found);
    const switches = screen.getAllByRole("switch").map((input) => input.getAttribute("aria-label"));
    expect(switches.slice(-3)).toEqual(["נספר ברווח", "נספר בתזרים", "חיוב קבוע"]);
    expect(screen.getByRole("switch", { name: "נספר בתזרים" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "חיוב קבוע" })).toBeChecked();
    expect(screen.getByText(/זוהה לבד/).closest(".ui-row-hint")?.textContent).toBe("כל חודש ב־4 · זוהה לבד");
  });

  it("turns the charge off with an undo toast, and ביטול puts it back", async () => {
    show(base, found);
    fireEvent.click(screen.getByRole("switch", { name: "חיוב קבוע" }));
    await waitFor(() => { expect(screen.getByText("אור חשמל · לא חיוב קבוע")).toBeInTheDocument(); });
    expect(screen.getByRole("switch", { name: "חיוב קבוע" })).not.toBeChecked();
    // Off: no hint.
    expect(screen.queryByText(/זוהה לבד/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(screen.getByRole("switch", { name: "חיוב קבוע" })).toBeChecked(); });
    expect(screen.getByText(/זוהה לבד/)).toBeInTheDocument();
  });

  it("keeps a line out of the cash view with an undo toast", async () => {
    show(base, found);
    fireEvent.click(screen.getByRole("switch", { name: "נספר בתזרים" }));
    await waitFor(() => { expect(screen.getByText("אור חשמל · לא נספר בתזרים")).toBeInTheDocument(); });
    expect(screen.getByRole("switch", { name: "נספר בתזרים" })).not.toBeChecked();
  });

  it("reads הכנסה קבועה on an income line", () => {
    show({ ...base, direction: "income", supplier_name: null, customer_name: "לקוח לדוגמה" }, { ...found, party: { direction: "income", id: "c9", name: "לקוח לדוגמה", currency: "ILS" } });
    expect(screen.getByRole("switch", { name: "הכנסה קבועה" })).toBeInTheDocument();
  });

  it("locks the recurring switch when the line has no supplier or customer", () => {
    show(base, { ...found, party: null, recurring: false, detected: false, typical_day: null });
    const locked = screen.getByRole("switch", { name: "חיוב קבוע" });
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("אין ספק או לקוח בשורה")).toBeInTheDocument();
  });

  it("locks the cash row on a split whose parts differ", () => {
    show({ ...base, cash_state: "mixed" }, found);
    expect(screen.queryByRole("switch", { name: "נספר בתזרים" })).toBeNull();
    expect(screen.getAllByText("לפי הקטגוריות בפיצול").length).toBeGreaterThan(0);
  });
});
