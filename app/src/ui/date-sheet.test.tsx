import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DateSheet } from "./date-sheet";
import { dayLabel, israelToday, shiftDays } from "./date-math";

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
});
