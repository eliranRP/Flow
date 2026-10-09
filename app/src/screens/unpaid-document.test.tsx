import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { UnpaidScreen } from "./unpaid-screen";
import { ToastProvider } from "../ui/toast";

describe("Unpaid row with a SUMIT document (FLOW-335)", () => {
  it("opens the document in a new tab when the link is SUMIT's, and stays still otherwise", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToastProvider>
            <UnpaidScreen
              sample={[
                { id: "a", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח א", project_name: null, open_gross_agorot: 10_000n, open_net_agorot: 10_000n, document_url: "https://pay.sumit.co.il/x/1" },
                { id: "b", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח ב", project_name: null, open_gross_agorot: 10_000n, open_net_agorot: 10_000n, document_url: "https://example.com/x" },
                { id: "c", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח ג", project_name: null, open_gross_agorot: 10_000n, open_net_agorot: 10_000n, document_url: null },
              ]}
            />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole("link", { name: /לקוח א/ });
    expect(link.getAttribute("href")).toBe("https://pay.sumit.co.il/x/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain("נפתח בלשונית חדשה");
    expect(screen.queryByRole("link", { name: /לקוח ב/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /לקוח ג/ })).toBeNull();
  });
});
