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

describe("Unpaid row hint (FLOW-353, FLOW-356)", () => {
  it("names today, yesterday and two days ago, and counts older days", () => {
    expect(unpaidAge(0)).toBe("היום");
    expect(unpaidAge(1)).toBe("אתמול");
    expect(unpaidAge(2)).toBe("לפני יומיים");
    expect(unpaidAge(3)).toBe("לפני 3 ימים");
    expect(unpaidAge(37)).toBe("לפני 37 ימים");
  });

  it("keeps the date, the age and the mark whole, each part but the last ending with its separator", () => {
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
    // A wrapped line never starts with "·": every part but the last ends with it.
    const age = screen.getByText("לפני 37 ימים", exact);
    expect(age).toHaveClass("ui-nowrap");
    expect(screen.getByText("01/09\u00A0·", exact)).toHaveClass("ui-nowrap");
    expect(screen.getByText("סומן כשולם · ממתין לסנכרון\u00A0·", exact)).toHaveClass("ui-nowrap");
    // The project name may wrap, so it is not held whole.
    expect(age.parentElement?.textContent).toContain("פרויקט דוגמה\u00A0· לפני 37 ימים");
    expect(screen.getByText("07/10\u00A0·", exact)).toHaveClass("ui-nowrap");
    expect(screen.getByText("אתמול", exact)).toHaveClass("ui-nowrap");
    for (const hint of [age.parentElement, screen.getByText("אתמול", exact).parentElement]) {
      expect(hint?.textContent.trimStart().startsWith("·")).toBe(false);
    }
  });
});
