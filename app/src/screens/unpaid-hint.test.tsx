import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("Unpaid hint (FLOW-353, FLOW-356, FLOW-357)", () => {
  it("names today, yesterday and two days ago, and counts older days", () => {
    expect(unpaidAge(0)).toBe("היום");
    expect(unpaidAge(1)).toBe("אתמול");
    expect(unpaidAge(2)).toBe("לפני יומיים");
    expect(unpaidAge(3)).toBe("לפני 3 ימים");
    expect(unpaidAge(37)).toBe("לפני 37 ימים");
  });

  it("shows only the age, or the mark, on a row (FLOW-357)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    renderTwo();
    expect(screen.getByRole("button", { name: /לקוח א/ })).toHaveTextContent("סומן כשולם · ממתין לסנכרון");
    expect(screen.getByRole("button", { name: /לקוח א/ })).not.toHaveTextContent("01/09");
    expect(screen.getByRole("button", { name: /לקוח ב/ })).toHaveTextContent("אתמול");
  });

  it("keeps the sheet's date, age and mark whole, each part but the last ending with its separator", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    renderTwo();
    fireEvent.click(screen.getByRole("button", { name: /לקוח א/ }));
    const sheet = within(await screen.findByRole("dialog", { name: "לקוח א" }));
    // A wrapped line never starts with "·": every part but the last ends with it.
    const age = sheet.getByText("לפני 37 ימים", exact);
    expect(age).toHaveClass("ui-nowrap");
    expect(sheet.getByText("01/09\u00A0·", exact)).toHaveClass("ui-nowrap");
    expect(sheet.getByText("סומן כשולם · ממתין לסנכרון\u00A0·", exact)).toHaveClass("ui-nowrap");
    // The project name may wrap, so it is not held whole.
    expect(age.parentElement?.textContent).toContain("פרויקט דוגמה\u00A0· לפני 37 ימים");
    expect(age.parentElement?.textContent.trimStart().startsWith("·")).toBe(false);
  });
});

function renderTwo() {
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
}
