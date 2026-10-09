import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnpaidScreen, unpaidAge } from "./unpaid-screen";
import { ToastProvider } from "../ui/toast";

afterEach(() => {
  vi.useRealTimers();
});

/** The default matcher folds the no-break space into a space; this keeps it. */
const exact = { normalizer: (text: string) => text };

describe("Unpaid row hint (FLOW-353)", () => {
  it("names today and yesterday, and counts older days", () => {
    expect(unpaidAge(0)).toBe("היום");
    expect(unpaidAge(1)).toBe("אתמול");
    expect(unpaidAge(37)).toBe("לפני 37 ימים");
  });

  it("keeps the date, the age and the mark whole, each part opening with its separator", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToastProvider>
            <UnpaidScreen
              sample={[
                { id: "a", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח א", project_name: "פרויקט דוגמה", open_gross_agorot: 10_000n, open_net_agorot: 10_000n, marked_paid_at: "2026-10-08T08:00:00Z" },
                { id: "b", description: "חשבונית", doc_date: "2026-10-07", customer_name: "לקוח ב", project_name: null, open_gross_agorot: 10_000n, open_net_agorot: 10_000n },
              ]}
            />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const age = screen.getByText("·\u00A0לפני 37 ימים", exact);
    expect(age).toHaveClass("ui-nowrap");
    expect(screen.getByText("·\u00A001/09", exact)).toHaveClass("ui-nowrap");
    expect(screen.getByText("סומן כשולם · ממתין לסנכרון", exact)).toHaveClass("ui-nowrap");
    // The project name may wrap, so it is not held whole.
    expect(age.parentElement?.textContent).toContain("·\u00A0פרויקט דוגמה");
    expect(screen.getByText("·\u00A0אתמול", exact)).toHaveClass("ui-nowrap");
  });
});
