import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DateSheet } from "./date-sheet";
import { dayLabel, israelToday, monthTitle, shiftDays } from "./date-math";

function renderSheet(shortcuts?: boolean) {
  const applied: string[] = [];
  render(
    <MemoryRouter>
      <DateSheet
        open
        onOpenChange={() => undefined}
        title="תאריך"
        value={israelToday()}
        allowFuture
        shortcuts={shortcuts}
        onApply={(iso) => {
          applied.push(iso);
        }}
      />
    </MemoryRouter>,
  );
  return applied;
}

function pick(iso: string, direction: "חודש קודם" | "חודש הבא") {
  const name = dayLabel(iso);
  for (let step = 0; step < 4 && screen.queryByRole("button", { name }) == null; step += 1) {
    fireEvent.click(screen.getByRole("button", { name: direction }));
  }
  const day = screen.getByRole("button", { name });
  expect(day).toBeEnabled();
  fireEvent.click(day);
}

describe("DateSheet", () => {
  it("shows היום and אתמול when a screen leaves the shortcuts prop off", () => {
    render(
      <MemoryRouter>
        <DateSheet
          open
          onOpenChange={() => undefined}
          title="תאריך"
          value={israelToday()}
          onApply={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "היום" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אתמול" })).toBeInTheDocument();
  });

  it("hides the shortcuts and still selects a past day and a future day", () => {
    const today = israelToday();
    const past = shiftDays(today, -1);
    const future = shiftDays(today, 40);
    const applied = renderSheet(false);
    expect(screen.queryByRole("button", { name: "היום" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אתמול" })).not.toBeInTheDocument();
    pick(past, "חודש קודם");
    fireEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(applied).toEqual([past]);
    pick(future, "חודש הבא");
    fireEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(applied).toEqual([past, future]);
  });

  it("jumps to an old year from the month title and keeps the month (FLOW-115)", () => {
    const applied: string[] = [];
    render(
      <MemoryRouter>
        <DateSheet open onOpenChange={() => undefined} title="תאריך" value="2026-03-15" onApply={(iso) => { applied.push(iso); }} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: `${monthTitle(2026, 2)}, בחירת שנה` }));
    const years = screen.getByRole("group", { name: "שנה" });
    expect(screen.getByRole("button", { name: "חודש קודם" })).toBeDisabled();
    // No future days: the newest year is this year; a loan start reaches decades back.
    const thisYear = Number(israelToday().slice(0, 4));
    const buttons = years.querySelectorAll("button");
    expect(buttons[0]?.textContent).toBe(String(thisYear));
    expect(buttons[buttons.length - 1]?.textContent).toBe(String(thisYear - 40));
    fireEvent.click(screen.getByRole("button", { name: "2004" }));
    expect(screen.queryByRole("group", { name: "שנה" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: dayLabel("2004-03-15") }));
    fireEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(applied).toEqual(["2004-03-15"]);
  });

  it("keeps a picked year's month inside min and max", () => {
    render(
      <MemoryRouter>
        <DateSheet open onOpenChange={() => undefined} title="תאריך" value="2024-11-10" allowFuture min="2023-06-01" max="2025-02-20" onApply={() => undefined} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: `${monthTitle(2024, 10)}, בחירת שנה` }));
    const years = screen.getByRole("group", { name: "שנה" });
    expect([...years.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["2025", "2024", "2023"]);
    fireEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(screen.getByRole("button", { name: `${monthTitle(2025, 1)}, בחירת שנה` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${monthTitle(2025, 1)}, בחירת שנה` }));
    fireEvent.click(screen.getByRole("button", { name: "2023" }));
    expect(screen.getByRole("button", { name: `${monthTitle(2023, 5)}, בחירת שנה` })).toBeInTheDocument();
  });
});
