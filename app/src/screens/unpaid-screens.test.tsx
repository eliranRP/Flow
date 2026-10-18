import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnpaidScreen } from "./unpaid-screen";
import { ToastProvider } from "../ui/toast";
import { type UnpaidInvoice } from "../unpaid";
import { InvoiceScreen } from "./invoice-screen";

// --- unpaid-hint.test.tsx

afterEach(() => {
  vi.useRealTimers();
});

describe("Unpaid rows (FLOW-357, FLOW-367)", () => {
  it("shows the age and the mark line on a row, and the row opens the invoice page", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    renderList(twoRows());
    const one = within(screen.getByRole("link", { name: /לקוח א/ }).closest("li") as HTMLElement);
    expect(one.getByText("פתוחה 37 ימים")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /לקוח א/ })).toHaveAttribute("href", "/unpaid/a");
    const two = screen.getByRole("link", { name: /לקוח ב/ }).closest("li") as HTMLElement;
    expect(within(two).getByText("פתוחה 1 ימים")).toBeInTheDocument();
  });

  it("marks a marked row with its line and a ביטול, and no date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    renderList([{ id: "a", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח א", project_name: "פרויקט דוגמה", open_gross_agorot: 10_000n, open_net_agorot: 10_000n, marked_paid_at: "2026-10-08T08:00:00Z" }]);
    const row = screen.getByRole("link", { name: /לקוח א/ }).closest("li") as HTMLElement;
    expect(within(row).getAllByText("סומן כשולם · ממתין לסנכרון").length).toBeGreaterThan(0);
    expect(within(row).getByRole("button", { name: "ביטול" })).toBeInTheDocument();
    expect(row.textContent).not.toContain("01/09");
  });

  it("marks an over-30-days row in the signal colour", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    renderList(twoRows());
    const row = screen.getByRole("link", { name: /לקוח א/ }).closest("li") as HTMLElement;
    expect(row.querySelector(".ui-inv-age")).toHaveAttribute("data-over", "true");
  });
});

function twoRows(): UnpaidInvoice[] {
  return [
    { id: "a", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח א", project_name: "פרויקט דוגמה", open_gross_agorot: 10_000n, open_net_agorot: 10_000n },
    { id: "b", description: "חשבונית", doc_date: "2026-10-07", customer_name: "לקוח ב", project_name: null, open_gross_agorot: 10_000n, open_net_agorot: 10_000n },
  ];
}

function renderList(sample: UnpaidInvoice[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ToastProvider>
          <UnpaidScreen sample={sample} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
// --- unpaid-document.test.tsx

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