import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringScreen, recurringView } from "../screens/recurring-screen";
import { RecurringList, RecurringListEmpty } from "./recurring-list";
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("קבועים v3 (FLOW-1048, V3-Recurring)", () => {
  it("heads with Back to בית, the title, the month line and what is still to pay", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "קבועים" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "חזרה לבית" })).toBeTruthy();
    expect(screen.getByText("אוקטובר 2026 • נכון ל־11/10 • 15 קבועים")).toBeTruthy();
    expect(document.querySelector(".ui-recurring-sum-figure")?.textContent).toBe("$962");
  });

  it("filters the groups to the expenses or the income with the segment (V3-Recurring)", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("radio", { name: "הכנסות" }));
    expect(screen.queryByRole("region", { name: "חשמל ומים" })).toBeNull();
    expect(screen.getByRole("region", { name: "שכירות" })).toBeTruthy();
  });

  it("leads with the late charges as cards that open their charge page", () => {
    renderScreen();
    const late = screen.getByRole("region", { name: "לא הגיעו" });
    const links = within(late).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/recurring/expense/power", "/recurring/income/rent-elm"]);
    expect(within(late).getByText(/Brightline Power · אולי הגיע בשם אחר/)).toBeTruthy();
    expect(within(late).getByText(/Elm Row unit 2 · באיחור 10 ימים/)).toBeTruthy();
  });

  it("hides a late card on this device with its X, and הצגה brings it back", () => {
    vi.useFakeTimers();
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /^הסתרה: Brightline Power/ }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const late = screen.getByRole("region", { name: "לא הגיעו" });
    expect(within(late).queryByText(/Brightline Power/)).toBeNull();
    expect(localStorage.getItem("flow.attention.recurring")).toContain("late:");
    fireEvent.click(within(late).getByRole("button", { name: "1 הוסתרו · הצגה" }));
    expect(within(late).getByText(/Brightline Power/)).toBeTruthy();
  });

  it("keeps a late charge in its group too, marked and worded as late", () => {
    renderScreen();
    const group = screen.getByRole("region", { name: "חשמל ומים" });
    const power = within(group).getByText("Brightline Power").closest("a") as HTMLElement;
    expect(power).toHaveAttribute("href", "/recurring/expense/power");
    expect(power.querySelector(".ui-status-mark-late")).not.toBeNull();
    expect(within(power).getByText(/באיחור 8 ימים/)).toBeTruthy();
  });

  it("heads each group on one line, with what is left and what was paid", () => {
    renderScreen();
    const group = screen.getByRole("region", { name: "חשמל ומים" });
    expect(group.querySelector(".ui-group-head-line")).not.toBeNull();
    expect(group.querySelector(".ui-group-summary")?.textContent).toMatch(/^עוד \$[\d,]+ · שולם \$[\d,]+$/);
  });

  it("marks a paid row with the check and says so in words, with its change under the amount", () => {
    renderScreen();
    const water = screen.getByText("Bayside Water Utility").closest("a") as HTMLElement;
    expect(water.querySelector(".ui-status-mark-paid")).not.toBeNull();
    expect(within(water).getByText(/^שולם/)).toBeTruthy();
    expect(within(water).getByText("▲ 38%")).toBeTruthy();
  });

  it("opens the charge page of every row", () => {
    renderScreen();
    expect(screen.getByText("Juniper Pointe HOA").closest("a")).toHaveAttribute("href", "/recurring/expense/hoa");
    expect(screen.getAllByText("Elm Row unit 2").map((node) => node.closest("a")?.getAttribute("href"))).toContain("/recurring/income/rent-elm");
  });

  it("shows the error state with a retry when the schedule read fails, under the title", () => {
    renderScreen({ failed: true });
    expect(screen.getByRole("heading", { name: "קבועים" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "הקבועים לא נטענו" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toHaveAttribute("href", "/help");
  });

  it("says offline which moment the rows are from", () => {
    renderScreen({ offlineSince: Date.parse("2026-10-11T06:41:00Z") });
    expect(document.querySelector(".ui-page-offline")?.textContent).toBe("אין חיבור · מוצג המצב מ־09:41מתחבר מחדש…");
  });
});

describe("the add row (FLOW-1014)", () => {
  const add = <button type="button">הוספת קבוע</button>;

  it("ends the list, after the groups (V3-Recurring)", () => {
    render(
      <MemoryRouter>
        <RecurringList {...recurringView(RECURRING_FIXTURE, "2026-10-11")} addLine={add} />
      </MemoryRouter>,
    );
    const button = screen.getByRole("button", { name: "הוספת קבוע" });
    expect(button.previousElementSibling?.classList.contains("ui-recurring-group")).toBe(true);
    expect(button.nextElementSibling).toBeNull();
  });

  it("is the empty screen's one action", () => {
    render(
      <MemoryRouter>
        <RecurringListEmpty addLine={add} />
      </MemoryRouter>,
    );
    expect(screen.getByText("עוד Flow לומד")).toBeTruthy();
    expect(screen.getByRole("button", { name: "הוספת קבוע" }).closest(".ui-empty-action")).not.toBeNull();
  });
});
