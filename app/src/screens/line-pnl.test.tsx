import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TransactionDetail } from "@flow/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { LineSplitRead } from "../line-split";
import { beforeAll, describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { loadReadSchemas } from "../load-read-schemas";
import { ToastProvider } from "../ui/toast";
import { linePnlState, TransactionScreen } from "./flow-screens";

// The pill, not the toast's parts: a toast in parts shows them hidden from queries (FLOW-426).

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

/** The split row navigates, so this render has the split route to land on. */
function showRouted(sample: NonNullable<TransactionDetail>, split: LineSplitRead | null = null) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/transactions/t-1"]}>
            <Routes>
              <Route path="/transactions/:transactionId" element={<TransactionScreen sample={sample} sampleLineSplit={split} />} />
              <Route path="/transactions/:transactionId/split-category" element={<p>split-category</p>} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** The P&L switch sits in the נספר ב sheet, so the sheet opens first (FLOW-366). */
function pnlSwitch() {
  return screen.getByRole("switch", { name: "נספר ברווח" });
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

// The first render of the screen in a file is a cold start (about 1.5s in jsdom: the first mount and the first
// role queries). Pay it here, outside the timed tests, then clear the DOM so the first test starts empty.
beforeAll(async () => {
  await loadReadSchemas();
  show(base);
  await screen.findByRole("button", { name: /^נספר ב/ }, { timeout: 8000 });
  cleanup();
});

describe("one line out of the P&L", () => {
  it("takes the line out from the נספר ב sheet, and undoes from the toast", async () => {
    show(base);
    expect(screen.getByRole("button", { name: /^נספר ב רווח ותזרים/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^נספר ב/ }));
    expect(pnlSwitch()).toBeChecked();
    // On: the switch is described by the line's category (the redesign's hint; the old no-hint check no longer holds).
    expect(pnlSwitch()).toHaveAccessibleDescription("לפי הקטגוריה");
    fireEvent.click(pnlSwitch());
    expect(await screen.findByText("הוצא מהרווח")).toBeTruthy();
    expect(pnlSwitch()).not.toBeChecked();
    expect(screen.getByText("רק השורה הזו. הקטגוריה לא משתנה.")).toBeTruthy();
    // Off: the hint names the state; the old category sentence was removed by the redesign.
    expect(pnlSwitch()).toHaveAccessibleDescription("כבוי לשורה הזו");
    fireEvent.click(screen.getByText("ביטול"));
    expect(await screen.findByText("נספר ברווח")).toBeTruthy();
    expect(pnlSwitch()).toBeChecked();
  });

  it("brings one line of a kept-out category back in from the sheet", async () => {
    show({ ...base, category_excluded_from_pnl: true, in_pnl: false });
    expect(screen.getByRole("button", { name: /^נספר ב תזרים בלבד · הוצא מהרווח/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^נספר ב/ }));
    fireEvent.click(pnlSwitch());
    expect(await screen.findByText("נספר ברווח")).toBeTruthy();
    expect(within(document.querySelector(".ui-counted-sheet") as HTMLElement).getByRole("switch", { name: "נספר ברווח" })).toBeChecked();
  });

  it("locks a loan line; with no loan split it counts by its category (FLOW-329)", () => {
    show({ ...base, pnl_fixed: true, pnl_state: "mixed" });
    expect(screen.queryByRole("button", { name: /^נספר ב/ })).toBeNull();
    expect(screen.getByText("תשלום הלוואה · לפי הקטגוריה")).toBeTruthy();
    expect(screen.queryByText(/לפי הפיצול/)).toBeNull();
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
    expect(screen.queryByRole("button", { name: /^נספר ב/ })).toBeNull();
    expect(screen.getByText("לפי חלקי ההלוואה")).toBeTruthy();
  });

  it("locks a mixed split, and its פיצול row stays open (FLOW-124)", async () => {
    // The line's own category counts, but some of its parts are kept out.
    const split: LineSplitRead = {
      transactionId: "t-1",
      currency: "ILS",
      lineMinor: 120_000n,
      partsMatch: true,
      parts: [
        { category_id: "c1", category_name: "חומרים", project_id: "p1", project_name: "פרויקט לדוגמה", amount_minor: 60_000n, percent: 50, rest: false },
        { category_id: "c2", category_name: "שיפוץ", project_id: null, project_name: null, amount_minor: 60_000n, percent: null, rest: true },
      ],
    };
    showRouted({ ...base, pnl_state: "mixed" }, split);
    expect(screen.queryByRole("button", { name: /^נספר ב/ })).toBeNull();
    expect(screen.getByText("לפי הקטגוריות בפיצול")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^פיצול/ }));
    expect(await screen.findByText("split-category")).toBeTruthy();
  });

  it("a split line whose parts are all kept out counts again from the sheet", async () => {
    show({ ...base, pnl_state: "out" });
    fireEvent.click(screen.getByRole("button", { name: /^נספר ב/ }));
    expect(pnlSwitch()).not.toBeChecked();
    fireEvent.click(pnlSwitch());
    expect(await screen.findByText("נספר ברווח")).toBeTruthy();
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
