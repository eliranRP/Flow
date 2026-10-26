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
    const late = screen.getByRole("region", { name: "לא הגיעו · 2" });
    fireEvent.click(screen.getByRole("button", { name: "התעלמות מההתראה: Brightline Power" }));
    expect(within(late).queryByText("Brightline Power")).toBeNull();
    expect(within(late).getByRole("heading", { name: "לא הגיעו · 1" })).toBeTruthy();
    expect(await screen.findByText("התעלמת מההתראה")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => {
      expect(within(late).getByText("Brightline Power")).toBeTruthy();
    }, { timeout: 4000 });
    expect(within(late).getByText("באיחור 8 ימים")).toBeTruthy();
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
    expect(screen.getByRole("heading", { name: "קבועים" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "הקבועים לא נטענו" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toHaveAttribute("href", "/help");
  });
});

describe("the late box's question (the board's עדיין קבוע?)", () => {
  it("asks a late charge with no match whether it still recurs; the one with a match does not ask", () => {
    renderScreen();
    const late = screen.getByRole("region", { name: /^לא הגיעו · \d+$/ });
    expect(within(late).getByText("היה אמור להגיע עד היום ומחכה להחלטה שלך.")).toBeTruthy();
    expect(within(late).getByText("לא התקבל ב־01/10. עדיין קבוע?")).toBeTruthy();
    expect(within(late).getAllByRole("button", { name: "כן, עדיין קבוע" })).toHaveLength(1);
  });

  it("כן, עדיין קבוע sets the alert aside, with its own toast", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "כן, עדיין קבוע" }));
    expect(await screen.findByText("נמשיך לצפות לו")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: /^לא הגיעו · \d+$/ })).queryByText("Elm Row unit 2")).toBeNull();
  });

  it("הסתיים ends the charge through the write, and its undo runs the write's undo", async () => {
    const ended: unknown[] = [];
    let undone = false;
    renderScreen({
      writes: {
        dismiss: () => Promise.resolve(),
        restore: () => Promise.resolve(),
        end: (target) => {
          ended.push(target);
          return Promise.resolve(() => {
            undone = true;
            return Promise.resolve();
          });
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "הסתיים" }));
    expect(await screen.findByText("Elm Row unit 2 הוסר מהקבועים ומהצפי")).toBeTruthy();
    expect(ended).toEqual([{ direction: "income", partyId: "rent-elm", currency: "USD", projectId: "p-elm-row" }]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    });
    await waitFor(() => { expect(undone).toBe(true); });
  });
});

describe("הסתיים on a party split by project (decision 0185)", () => {
  // The rent's party also pays at Birch Lane: the switch is the charge's (decision 0188), so ending one ends that one.
  const elm = RECURRING_FIXTURE.find((item) => item.party_id === "rent-elm");
  if (elm == null) throw new Error("fixture");
  const split = [...RECURRING_FIXTURE, { ...elm, state: "arrived" as const, amount_minor: 165000, project_id: "p-birch-lane", project_name: "Birch Lane" }];

  it("names the charge's project to the write and in the toast", async () => {
    const ended: unknown[] = [];
    renderScreen({
      sample: split,
      writes: {
        dismiss: () => Promise.resolve(),
        restore: () => Promise.resolve(),
        end: (target) => {
          ended.push(target);
          return Promise.resolve(() => Promise.resolve());
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "הסתיים" }));
    expect(await screen.findByText("Elm Row unit 2 · Elm Row הוסר מהקבועים ומהצפי")).toBeTruthy();
    expect(ended).toEqual([{ direction: "income", partyId: "rent-elm", currency: "USD", projectId: "p-elm-row" }]);
  });

  it("sends one write for a double tap", async () => {
    let calls = 0;
    renderScreen({
      writes: {
        dismiss: () => Promise.resolve(),
        restore: () => Promise.resolve(),
        end: () => {
          calls += 1;
          return Promise.resolve(() => Promise.resolve());
        },
      },
    });
    const button = screen.getByRole("button", { name: "הסתיים" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText("Elm Row unit 2 הוסר מהקבועים ומהצפי")).toBeTruthy();
    expect(calls).toBe(1);
  });
});

describe("the month card and the sides (the board's two columns)", () => {
  it("totals income and expenses side by side, and heads each side with what it expects", () => {
    renderScreen();
    const card = screen.getByRole("region", { name: "החודש" });
    expect(within(card).getByText("נכנס החודש")).toBeTruthy();
    expect(within(card).getByText("+$5,600")).toBeTruthy();
    expect(within(card).getByText("התקבל $3,950")).toBeTruthy();
    expect(within(card).getByText("יוצא החודש")).toBeTruthy();
    expect(screen.getByText("הכנסות קבועות")).toBeTruthy();
    expect(screen.getByText("הוצאות קבועות")).toBeTruthy();
  });
});
