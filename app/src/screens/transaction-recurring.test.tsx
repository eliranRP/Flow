import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PaymentRecurring, TransactionDetail } from "@flow/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { loadReadSchemas } from "../load-read-schemas";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { TransactionScreen } from "./flow-screens";

// Ported from transaction-charge-switches.test.tsx (FLOW-415), which tested the switch rows that the
// recurring card and the counted-in sheet replaced. Invented data only.
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
  pace: "month",
  pace_override: null,
  detected_pace: "month",
  next_due_month: "2026-11",
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

const recurringRow = () => screen.getByRole("button", { name: /תשלום קבוע/ });

beforeAll(async () => {
  await loadReadSchemas();
  show(base, found);
  // The first mount is paid here; the queries of the first test then resolve at once.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
});

describe("transaction page: recurring card and counted-in sheet (FLOW-415, FLOW-366)", () => {
  it("draws the recurring row with the pace and זוהה לבד on a found charge", () => {
    show(base, found);
    expect(recurringRow()).toBeInTheDocument();
    expect(recurringRow().textContent).toMatch(/כל חודש/);
    expect(recurringRow().textContent).toMatch(/זוהה לבד/);
  });

  it("opens כל כמה זמן from the row, changes the pace with an undo toast, and ביטול puts it back (FLOW-415 D)", async () => {
    show(base, found);
    fireEvent.click(recurringRow());
    expect(await screen.findByRole("radiogroup", { name: "כל כמה זמן" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "כל חודש" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "כל רבעון" }));
    await waitFor(() => { expect(recurringRow().textContent).toMatch(/כל רבעון/); });
    await waitFor(() => { expect(screen.queryByRole("radiogroup", { name: "כל כמה זמן" })).toBeNull(); });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(recurringRow().textContent).toMatch(/כל חודש/); });
  });

  it("shows the row as לא קבוע with no pace while the charge is off", () => {
    show(base, { ...found, recurring: false, override: false, detected: true });
    expect(screen.getByRole("button", { name: /לא קבוע/ })).toBeInTheDocument();
    expect(screen.queryByText(/כל חודש/)).toBeNull();
  });

  it("marks the charge לא קבוע from the same sheet with an undo toast, and ביטול puts it back", async () => {
    show(base, found);
    fireEvent.click(recurringRow());
    fireEvent.click(await screen.findByRole("radio", { name: "לא קבוע" }));
    await waitFor(() => { expect(screen.getByText("סומן כלא קבוע")).toBeInTheDocument(); });
    // The pace sheet is still closing; until it unmounts, its open dialog hides the toast's ביטול from the accessibility tree.
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(recurringRow()).toBeInTheDocument(); });
  });

  it("keeps a line out of the cash view from the counted-in sheet, with an undo toast", async () => {
    show(base, found);
    fireEvent.click(screen.getByRole("button", { name: /^נספר ב/ }));
    fireEvent.click(await screen.findByRole("switch", { name: "נספר בתזרים" }));
    await waitFor(() => { expect(screen.getByText("הוצא מהתזרים")).toBeInTheDocument(); });
    expect(screen.getByRole("switch", { name: "נספר בתזרים" })).not.toBeChecked();
  });

  it("reads הכנסה קבועה on an income line", () => {
    show({ ...base, direction: "income", supplier_name: null, customer_name: "לקוח לדוגמה" }, { ...found, party: { direction: "income", id: "c9", name: "לקוח לדוגמה", currency: "ILS" } });
    expect(screen.getByRole("button", { name: /הכנסה קבועה/ })).toBeInTheDocument();
  });

  it("locks the recurring row when the line has no supplier or customer", () => {
    show(base, { ...found, party: null, recurring: false, detected: false, typical_day: null });
    const locked = screen.getByText("אין ספק או לקוח בשורה").closest("button");
    expect(locked).toBeDisabled();
  });

  it("locks the cash row on a split whose parts differ", () => {
    show({ ...base, pnl_state: "mixed" }, found);
    expect(screen.getAllByText("לפי הקטגוריות בפיצול").length).toBeGreaterThan(0);
  });
});
