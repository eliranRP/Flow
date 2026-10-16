import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { InvoiceScreen } from "./invoice-screen";
import { ToastProvider } from "../ui/toast";
import type { UnpaidInvoice } from "../unpaid";

const invoice = (id: string, name: string, documentUrl: string | null): UnpaidInvoice => ({
  id, description: "חשבונית", doc_date: "2026-09-01", customer_name: name, project_name: null,
  open_gross_agorot: 10_000n, open_net_agorot: 10_000n, document_url: documentUrl,
});

function renderInvoice(sample: UnpaidInvoice[], id: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/unpaid/${id}`]}>
        <ToastProvider>
          <Routes>
            <Route path="/unpaid/:invoiceId" element={<InvoiceScreen sample={sample} />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Invoice page document and mark (FLOW-335, FLOW-367)", () => {
  it("opens SUMIT's document in a new tab, and shows no link for a host that is not SUMIT's", () => {
    renderInvoice([invoice("a", "לקוח א", "https://pay.sumit.co.il/x/1")], "a");
    const link = screen.getByRole("link", { name: /PDF מ־SUMIT/ });
    expect(link.getAttribute("href")).toBe("https://pay.sumit.co.il/x/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows no document row for an invoice SUMIT has no page for", () => {
    renderInvoice([invoice("b", "לקוח ב", "https://example.com/x")], "b");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("marks the invoice paid from the page, and ביטול clears the mark", () => {
    renderInvoice([invoice("a", "לקוח א", null)], "a");
    fireEvent.click(screen.getByRole("button", { name: "סימון כשולם" }));
    expect(screen.getByRole("button", { name: "ביטול הסימון" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול הסימון" }));
    expect(screen.getByRole("button", { name: "סימון כשולם" })).toBeInTheDocument();
  });
});
