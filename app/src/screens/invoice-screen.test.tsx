import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { InvoiceScreen } from "./invoice-screen";
import { UnpaidScreen } from "./unpaid-screen";
import { invoicesSample, invoicesSummary } from "../dev/invoices-sample";
import { unpaidOpenRows, unpaidTotals } from "../unpaid";
import { ToastProvider } from "../ui/toast";

// FLOW-367: the fixture's list adds up to the open total, the bank match is on the page, and the
// over-30-days line is there only when an invoice is over 30 days.
describe("Open invoices (FLOW-367)", () => {
  it("the fixture's three open rows add up to the 21,300 USD total", () => {
    const rows = invoicesSample();
    const total = unpaidTotals(rows).find((item) => item.currency === "USD");
    expect(total?.minor).toBe(2_130_000n);
    expect(unpaidOpenRows(rows)).toHaveLength(3);
  });

  it("shows the over-30-days line for the oldest invoice, and not when none is over 30", () => {
    const first = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ToastProvider><UnpaidScreen sample={invoicesSample()} summary={invoicesSummary()} /></ToastProvider></MemoryRouter></QueryClientProvider>);
    expect(first.container.querySelector(".ui-inv-overdue")?.textContent).toContain("פתוחים יותר מ־30 ימים");
    first.unmount();
    renderList(invoicesSample().map((row) => ({ ...row, doc_date: "2026-10-01" })));
    expect(document.querySelectorAll(".ui-inv-overdue")).toHaveLength(0);
  });

  it("offers זה התשלום and לא זה on the page of an invoice with a match", () => {
    renderPage("inv-1051");
    const card = screen.getByRole("region", { name: "תשלום תואם בבנק" });
    expect(within(card).getByRole("button", { name: "זה התשלום" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "לא זה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "סימון כשולם" })).toBeNull();
  });

  it("drops the match card with לא זה, and shows the mark instead", () => {
    renderPage("inv-1051");
    fireEvent.click(screen.getByRole("button", { name: "לא זה" }));
    expect(screen.queryByRole("region", { name: "תשלום תואם בבנק" })).toBeNull();
    expect(screen.getByRole("button", { name: "סימון כשולם" })).toBeInTheDocument();
  });

  it("marks an unpaid invoice with no match from its page, and ביטול shows, with no match card", () => {
    renderPage("inv-1043");
    fireEvent.click(screen.getByRole("button", { name: "סימון כשולם" }));
    expect(screen.getByRole("button", { name: "ביטול הסימון" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "תשלום תואם בבנק" })).toBeNull();
  });
});

function renderList(rows: ReturnType<typeof invoicesSample>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ToastProvider>
          <UnpaidScreen sample={rows} summary={invoicesSummary()} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPage(id: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/unpaid/${id}`]}>
        <ToastProvider>
          <Routes>
            <Route path="/unpaid/:invoiceId" element={<InvoiceScreen sample={invoicesSample()} summary={invoicesSummary()} />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
