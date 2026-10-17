import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RecurringScreen } from "../screens/recurring-screen";
import { RECURRING_FIXTURE, RECURRING_MISSING_FIXTURE } from "../recurring-sample";
import { ToastProvider } from "./toast";

function renderScreen(props: Partial<Parameters<typeof RecurringScreen>[0]> = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/recurring"]}>
        <ToastProvider>
          <RecurringScreen now={new Date("2026-10-11T12:00:00Z")} sample={RECURRING_FIXTURE} missing={RECURRING_MISSING_FIXTURE} {...props} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the recurring list's ignore (FLOW-447b)", () => {
  it("ignores a late bill by its button, moves it to its group, and undoes it", async () => {
    renderScreen();
    const late = screen.getByText("לא הגיעו").closest("section");
    expect(late).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "התעלמות מההתראה: Brightline Power" }));
    expect(within(late as HTMLElement).queryByText("Brightline Power")).toBeNull();
    expect(within(late as HTMLElement).getByText("1")).toBeTruthy();
    expect(await screen.findByText("התעלמת מההתראה")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(within(late as HTMLElement).getByText("Brightline Power")).toBeTruthy();
    }, { timeout: 4000 });
    expect(within(late as HTMLElement).getByText("באיחור 8 ימים")).toBeTruthy();
  }, 20_000);

  it("opens the swiped row over its action, and that action ignores the bill", async () => {
    renderScreen({ openId: "power" });
    const power = screen.getByText("Brightline Power").closest("li") as HTMLElement;
    act(() => {
      fireEvent.click(within(power).getByRole("button", { name: "התעלמות מההתראה" }));
    });
    expect(await screen.findByText("התעלמת מההתראה")).toBeTruthy();
  });

  it("gives a non-late row no ignore control, and opens its charge page", () => {
    renderScreen();
    const hoa = screen.getByText("Juniper Pointe HOA").closest("li") as HTMLElement;
    expect(within(hoa).queryByRole("button")).toBeNull();
    expect(within(hoa).getByRole("link")).toHaveAttribute("href", "/recurring/expense/hoa");
  });

  it("opens the charge page of every row, late or not", () => {
    renderScreen();
    for (const name of ["Brightline Power", "Elm Row unit 2", "Harborlink Internet", "Bayside Water Utility"]) {
      const item = screen.getByText(name).closest("li") as HTMLElement;
      const link = within(item).getByRole("link");
      expect(link.getAttribute("href")).toMatch(/^\/recurring\/(expense|income)\//);
    }
    expect(screen.getByText("Elm Row unit 2").closest("a")).toHaveAttribute("href", "/recurring/income/rent-elm");
  });

  it("shows the error state with a retry when the schedule read fails", () => {
    renderScreen({ failed: true });
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeTruthy();
  });
});
