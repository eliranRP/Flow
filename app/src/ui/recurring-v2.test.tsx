import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recurringToast } from "../recurring-toast";
import { RecurringScreen } from "../screens/recurring-screen";
import { RECURRING_FIXTURE, RECURRING_MISSING_FIXTURE } from "../recurring-sample";
import { RecurringList } from "./recurring-list";
import { RecurringAskBox, RecurringMatchBox } from "./recurring-match-box";
import { ToastProvider } from "./toast";

function renderScreen(props: Partial<Parameters<typeof RecurringScreen>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/recurring"]}>
        <ToastProvider>
          <RecurringScreen now={new Date("2026-10-11T12:00:00Z")} sample={RECURRING_FIXTURE} missing={RECURRING_MISSING_FIXTURE} {...props} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sums = {
  subtitle: "אוקטובר 2026",
  currency: "USD",
  late: [],
  groups: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("Recurring v2: the month card (FLOW-963)", () => {
  it("leads with what is still to come this month", () => {
    renderScreen();
    const card = screen.getByRole("region", { name: "החודש" });
    expect(card.querySelector(".ui-recurring-takeaway")?.textContent).toMatch(/^עד סוף החודש: לשלם עוד \$[\d,]+, לקבל עוד \$[\d,]+$/);
  });

  it("leaves out a side with nothing recurring, and draws no line with neither", () => {
    const { rerender } = render(
      <MemoryRouter>
        <RecurringList {...sums} outflow={{ total: 9_600n, paid: 0n, toCome: 9_600n }} inflow={{ total: 0n, got: 0n, toCome: 0n }} />
      </MemoryRouter>,
    );
    expect(document.querySelector(".ui-recurring-takeaway")?.textContent).toBe("עד סוף החודש: לשלם עוד $96");
    rerender(
      <MemoryRouter>
        <RecurringList {...sums} outflow={{ total: 0n, paid: 0n, toCome: 0n }} inflow={{ total: 0n, got: 0n, toCome: 0n }} />
      </MemoryRouter>,
    );
    expect(document.querySelector(".ui-recurring-takeaway")).toBeNull();
  });

  it("says offline which moment the rows are from", () => {
    renderScreen({ offlineSince: Date.parse("2026-10-11T06:41:00Z") });
    expect(document.querySelector(".ui-page-offline")?.textContent).toBe("אין חיבור · מוצג המצב מ־09:41מתחבר מחדש…");
  });
});

describe("Recurring v2: the answers (FLOW-963)", () => {
  it("are two buttons of the same kind, and the match's no says what it means", () => {
    render(
      <>
        <RecurringAskBox text="לא שולם" hint="" onStill={() => undefined} onEnded={() => undefined} />
        <RecurringMatchBox name="Other" amount="$1" date="08/10" income={false} onYes={() => undefined} onNo={() => undefined} />
      </>,
    );
    const ask = screen.getByRole("region", { name: "עדיין קבוע?" });
    const [still, ended] = within(ask).getAllByRole("button");
    expect(still?.className.replace("ui-recurring-match-yes", "")).toBe(ended?.className.replace("ui-recurring-match-no", ""));
    expect(screen.getByRole("button", { name: "לא, זה משהו אחר" })).toBeTruthy();
  });
});

describe("Recurring v2: the toasts (decision 0215)", () => {
  it("hang under the header; an undo stays 5s, a note 4s", () => {
    expect(recurringToast({ message: "x", action: "ביטול", onAction: () => undefined })).toMatchObject({ place: "top", durationMs: 5000 });
    expect(recurringToast({ message: "x" })).toMatchObject({ place: "top", durationMs: 4000 });
  });

  it("the list's ignore toast sits under the header and keeps its ביטול for 5s", async () => {
    renderScreen();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "התעלמות מההתראה: Brightline Power" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("התעלמת מההתראה")).toBeTruthy();
    expect(document.querySelector(".ui-toast-host")).toHaveAttribute("data-place", "top");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByRole("button", { name: "ביטול" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
  });
});
