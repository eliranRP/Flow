import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnpaidScreen, unpaidAge } from "./unpaid-screen";
import { ToastProvider } from "../ui/toast";
import type { UnpaidInvoice } from "../unpaid";

afterEach(() => {
  vi.useRealTimers();
});

describe("Unpaid rows (FLOW-353, FLOW-357, FLOW-367)", () => {
  it("names today, yesterday and two days ago, and counts older days", () => {
    expect(unpaidAge(0)).toBe("היום");
    expect(unpaidAge(1)).toBe("אתמול");
    expect(unpaidAge(2)).toBe("לפני יומיים");
    expect(unpaidAge(3)).toBe("לפני 3 ימים");
    expect(unpaidAge(37)).toBe("לפני 37 ימים");
  });

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
