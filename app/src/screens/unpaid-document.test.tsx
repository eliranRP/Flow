import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { UnpaidRow } from "@flow/shared";
import { UnpaidScreen } from "./unpaid-screen";
import { ToastProvider } from "../ui/toast";

const invoice = (id: string, name: string, documentUrl: string | null): UnpaidRow => ({
  id, description: "חשבונית", doc_date: "2026-09-01", customer_name: name, project_name: null,
  open_gross_agorot: 10_000n, open_net_agorot: 10_000n, document_url: documentUrl,
});

function renderUnpaid(sample: UnpaidRow[]) {
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

describe("Unpaid invoice sheet (FLOW-335, FLOW-357)", () => {
  it("opens the invoice on a tap, with SUMIT's document in a new tab and no link otherwise", async () => {
    renderUnpaid([
      invoice("a", "לקוח א", "https://pay.sumit.co.il/x/1"),
      invoice("b", "לקוח ב", "https://example.com/x"),
      invoice("c", "לקוח ג", null),
    ]);
    // Rows are buttons now: the list has no links and no per-row "סימון כשולם".
    expect(screen.queryByRole("link", { name: /לקוח/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "סימון כשולם" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /לקוח א/ }));
    const sheet = await screen.findByRole("dialog", { name: "לקוח א" });
    const link = within(sheet).getByRole("link", { name: /פתיחת החשבונית/ });
    expect(link.getAttribute("href")).toBe("https://pay.sumit.co.il/x/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain("נפתח בלשונית חדשה");
    expect(within(sheet).getByRole("button", { name: "סימון כשולם" })).toBeInTheDocument();
  });

  it("shows no document link for an invoice SUMIT has no page for", async () => {
    renderUnpaid([invoice("b", "לקוח ב", "https://example.com/x"), invoice("c", "לקוח ג", null)]);
    fireEvent.click(screen.getByRole("button", { name: /לקוח ב/ }));
    const sheet = await screen.findByRole("dialog", { name: "לקוח ב" });
    expect(within(sheet).queryByRole("link")).toBeNull();
  });

  it("marks the invoice paid from the sheet, closes it, and ביטול on the toast clears the mark", async () => {
    renderUnpaid([invoice("a", "לקוח א", null), invoice("b", "לקוח ב", null)]);
    fireEvent.click(screen.getByRole("button", { name: /לקוח א/ }));
    const sheet = await screen.findByRole("dialog", { name: "לקוח א" });
    fireEvent.click(within(sheet).getByRole("button", { name: "סימון כשולם" }));
    expect(await screen.findByText(/סומן כשולם\. החשבונית תצא מהרשימה/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /לקוח א/ })).toHaveTextContent("סומן כשולם · ממתין לסנכרון");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("הסימון בוטל.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /לקוח א/ })).not.toHaveTextContent("ממתין לסנכרון");
  });

  it("drops the head's total with one invoice, whose amount is on its row", () => {
    renderUnpaid([invoice("a", "לקוח א", null)]);
    expect(screen.queryByText("לגבייה")).toBeNull();
  });
});
