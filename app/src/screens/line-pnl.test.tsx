import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TransactionDetail } from "@flow/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { linePnlState, TransactionScreen } from "./flow-screens";

const base: NonNullable<TransactionDetail> = {
  id: "t-1",
  description: "ספק לדוגמה",
  direction: "expense",
  doc_date: "2026-07-01",
  amount_gross: -120000n,
  amount_net: -120000n,
  vat_amount: 0n,
  vat_status: "source",
  source: "sumit",
  pnl_role: "project",
  review_status: "approved",
  project_id: "p1",
  project_name: "פרויקט לדוגמה",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: "ספק לדוגמה",
  customer_name: null,
  allocations: [],
  in_pnl_override: null,
  category_excluded_from_pnl: false,
  in_pnl: true,
  pnl_fixed: false,
};

function show(sample: NonNullable<TransactionDetail>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>
            <TransactionScreen sample={sample} />
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function openMore() {
  fireEvent.click(screen.getByRole("button", { name: "עוד" }));
  return screen.getByRole("dialog");
}

describe("linePnlState", () => {
  it("going back to the category's state clears the override", () => {
    expect(linePnlState({ category_excluded_from_pnl: false }, null)).toMatchObject({ out: false, next: false });
    expect(linePnlState({ category_excluded_from_pnl: false }, false)).toMatchObject({ out: true, next: null });
    expect(linePnlState({ category_excluded_from_pnl: true }, null)).toMatchObject({ out: true, next: true });
    expect(linePnlState({ category_excluded_from_pnl: true }, true)).toMatchObject({ out: false, forcedIn: true, next: null });
  });

  it("a guessed kept-out category counts until it is confirmed", () => {
    expect(linePnlState({ category_excluded_from_pnl: true, category_suggested: true }, null)).toMatchObject({ out: false, forcedIn: false, next: false });
    expect(linePnlState({ category_excluded_from_pnl: true, category_suggested: true }, false)).toMatchObject({ out: true, next: null });
    expect(linePnlState({ category_excluded_from_pnl: true, category_suggested: false }, null)).toMatchObject({ out: true, next: true });
    expect(linePnlState({ category_excluded_from_pnl: true, category_suggested: true, pnl_fixed: true, in_pnl: false }, null)).toMatchObject({ out: true });
    // A loan-split line whose own category is a guessed kept-out one counts, as the server says.
    expect(linePnlState({ category_excluded_from_pnl: true, category_suggested: true, pnl_fixed: true, in_pnl: true }, null)).toMatchObject({ out: false });
  });
});

describe("one line out of the P&L", () => {
  it("takes the line out from the more sheet, shows the pill, and undoes from the toast", async () => {
    show(base);
    expect(screen.queryByText("מחוץ לרווח")).toBeNull();
    const sheet = openMore();
    expect(within(sheet).getByText("הכסף נשאר בתזרים, ולא נספר כהכנסה או הוצאה.")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "מחוץ לרווח והפסד" }));
    expect(await screen.findByText("ספק לדוגמה · מחוץ לרווח והפסד")).toBeTruthy();
    expect(screen.getByText("מחוץ לרווח")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("ספק לדוגמה · ברווח והפסד")).toBeTruthy();
    await waitFor(() => { expect(screen.queryByText("מחוץ לרווח")).toBeNull(); });
  });

  it("brings one line of a kept-out category back in and marks it", async () => {
    show({ ...base, category_excluded_from_pnl: true, in_pnl: false });
    expect(screen.getByText("מחוץ לרווח")).toBeTruthy();
    const sheet = openMore();
    expect(within(sheet).getByText("הקטגוריה חומרים מחוץ לרווח והפסד. אפשר להחזיר רק את השורה הזו.")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "החזרה לרווח והפסד" }));
    expect(await screen.findByText("ספק לדוגמה · ברווח והפסד")).toBeTruthy();
    expect(screen.queryByText("מחוץ לרווח")).toBeNull();
    expect(screen.getByText("ברווח והפסד")).toBeTruthy();
  });

  it("locks a loan line", () => {
    show({ ...base, pnl_fixed: true });
    const sheet = openMore();
    expect(within(sheet).queryByRole("button", { name: "מחוץ לרווח והפסד" })).toBeNull();
    expect(within(sheet).getByText("תשלום הלוואה · נספר לפי החלוקה")).toBeTruthy();
  });
});
