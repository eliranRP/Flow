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

function show(sample: NonNullable<TransactionDetail>, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
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

function pnlSwitch() {
  return screen.getByRole("switch", { name: "ברווח והפסד" });
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
  it("takes the line out with the switch row, shows the pill, and undoes from the toast", async () => {
    show(base);
    expect(screen.queryByText("מחוץ לרווח")).toBeNull();
    expect(pnlSwitch()).toBeChecked();
    // On: no hint (design review).
    expect(pnlSwitch()).not.toHaveAttribute("aria-describedby");
    fireEvent.click(pnlSwitch());
    expect(await screen.findByText("ספק לדוגמה · מחוץ לרווח והפסד")).toBeTruthy();
    expect(screen.getByText("מחוץ לרווח")).toBeTruthy();
    expect(pnlSwitch()).not.toBeChecked();
    expect(screen.getByText("רק השורה הזו. הקטגוריה לא משתנה.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("ספק לדוגמה · ברווח והפסד")).toBeTruthy();
    await waitFor(() => { expect(screen.queryByText("מחוץ לרווח")).toBeNull(); });
  });

  it("brings one line of a kept-out category back in and marks it", async () => {
    show({ ...base, category_excluded_from_pnl: true, in_pnl: false });
    expect(screen.getByText("מחוץ לרווח")).toBeTruthy();
    expect(screen.getByText("הקטגוריה חומרים מחוץ לרווח והפסד. אפשר להחזיר רק את השורה הזו.")).toBeTruthy();
    fireEvent.click(pnlSwitch());
    expect(await screen.findByText("ספק לדוגמה · ברווח והפסד")).toBeTruthy();
    expect(screen.queryByText("מחוץ לרווח")).toBeNull();
    expect(within(document.querySelector(".ui-status-row") as HTMLElement).getByText("ברווח והפסד")).toBeTruthy();
  });

  it("locks a loan line", () => {
    show({ ...base, pnl_fixed: true, pnl_state: "mixed" });
    expect(screen.queryByRole("switch", { name: "ברווח והפסד" })).toBeNull();
    expect(screen.getByText("תשלום הלוואה · נספר לפי הפיצול")).toBeTruthy();
    expect(screen.queryByText("חלקית ברווח")).toBeNull();
  });

  it("shows ⋯ only on a manual line, with delete alone (FLOW-329)", () => {
    show(base);
    expect(screen.queryByRole("button", { name: "עוד" })).toBeNull();
  });

  it("opens delete from ⋯ on a manual line", () => {
    show({ ...base, source: "manual" });
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const sheet = screen.getByRole("dialog", { name: "עוד" });
    expect(within(sheet).getAllByRole("button").map((button) => button.textContent)).toContain("מחיקה");
    expect(within(sheet).queryByText(/רווח והפסד/)).toBeNull();
  });

  it("locks a line with a loan split as a loan line, not as a split by category", () => {
    const client = new QueryClient();
    const part = (id: string, name: "principal" | "interest" | "escrow") => ({ id, part: name, amountMinor: 1n, scheduledMinor: 1n, needsReview: false, loanId: "loan-1" });
    client.setQueryData(["loan-split", "t-1"], {
      companyId: "c-1", lineMinor: 3n, currency: "ILS", byParts: true, loans: [], categoryIds: {},
      splits: [part("s-1", "principal"), part("s-2", "interest"), part("s-3", "escrow")],
    });
    show({ ...base, pnl_state: "mixed" }, client);
    expect(screen.queryByRole("switch", { name: "ברווח והפסד" })).toBeNull();
    expect(screen.queryByRole("link", { name: /לפי הקטגוריות בפיצול/ })).toBeNull();
    expect(screen.getByText("תשלום הלוואה · נספר לפי הפיצול")).toBeTruthy();
    expect(screen.queryByText("חלקית ברווח")).toBeNull();
  });

  it("locks a mixed split and opens its split by category (FLOW-124)", () => {
    // The line's own category counts, but some of its parts are kept out.
    show({ ...base, pnl_state: "mixed" });
    expect(screen.getByText("חלקית ברווח")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "ברווח והפסד" })).toBeNull();
    expect(screen.getByRole("link", { name: /ברווח והפסד, לפי הקטגוריות בפיצול/ })).toHaveAttribute("href", "/transactions/t-1/split-category");
  });

  it("marks a split line whose parts are all kept out, and brings it back in with true", async () => {
    show({ ...base, pnl_state: "out" });
    expect(screen.getByText("מחוץ לרווח")).toBeTruthy();
    expect(screen.getByText("הקטגוריות בפיצול מחוץ לרווח והפסד. אפשר להחזיר רק את השורה הזו.")).toBeTruthy();
    expect(pnlSwitch()).not.toBeChecked();
    fireEvent.click(pnlSwitch());
    expect(await screen.findByText("ספק לדוגמה · ברווח והפסד")).toBeTruthy();
  });
});

describe("linePnlState with the server's state", () => {
  it("reads the parts, and a loan line ignores mixed", () => {
    expect(linePnlState({ category_excluded_from_pnl: false }, null, "mixed")).toMatchObject({ out: false, mixed: true, next: false });
    expect(linePnlState({ category_excluded_from_pnl: false }, null, "out")).toMatchObject({ out: true, partsOut: true, next: true });
    expect(linePnlState({ category_excluded_from_pnl: false }, false, "out")).toMatchObject({ out: true, partsOut: false, next: null });
    expect(linePnlState({ category_excluded_from_pnl: true }, true, "in")).toMatchObject({ out: false, forcedIn: true, next: null });
    expect(linePnlState({ pnl_fixed: true, in_pnl: true }, null, "mixed")).toMatchObject({ out: false, mixed: false });
  });

  it("a line split by category always writes true or false, never null", () => {
    // Its parts follow their own categories under null, which the line's category can't predict.
    expect(linePnlState({ category_excluded_from_pnl: false }, false, "out", true)).toMatchObject({ out: true, next: true });
    expect(linePnlState({ category_excluded_from_pnl: true }, true, "in", true)).toMatchObject({ out: false, next: false });
    expect(linePnlState({ category_excluded_from_pnl: false }, null, "mixed", true)).toMatchObject({ next: false });
  });
});
