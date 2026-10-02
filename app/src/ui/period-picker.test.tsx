import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { dayLabel, formatDisplay, inclusiveDays, israelToday, rangeLengthLabel } from "./date-math";
import { PeriodPicker, RangeSheet } from "./period-picker";
import { expectRtl, expectTarget } from "./test-support";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <PeriodPicker
      pill="כל התקופה"
      open={open}
      onOpenChange={setOpen}
      options={[{ label: "החודש", onSelect: () => undefined }]}
    />
  );
}

describe("PeriodPicker", () => {
  it("opens the period dialog from a 44px pill", () => {
    expectRtl();
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const pill = screen.getByRole("button", { name: "כל התקופה" });
    expectTarget(pill);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
    expectTarget(screen.getByRole("radio", { name: "החודש" }));
  });
});

describe("RangeSheet", () => {
  it("sets from on the first day and to on the second", () => {
    const today = israelToday();
    const [year, month] = today.split("-");
    const from = `${year ?? ""}-${month ?? ""}-01`;
    const to = today;
    expect(from <= to).toBe(true);
    let applied: [string, string] | null = null;
    render(
      <MemoryRouter>
      <RangeSheet
        open
        onOpenChange={() => undefined}
        onApply={(nextFrom, nextTo) => {
          applied = [nextFrom, nextTo];
        }}
      />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: dayLabel(from) }));
    fireEvent.click(screen.getByRole("button", { name: dayLabel(to) }));
    expect(screen.getByText(formatDisplay(from))).toBeInTheDocument();
    expect(screen.getByText(formatDisplay(to))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: rangeLengthLabel(inclusiveDays(from, to)) }));
    expect(applied).toEqual([from, to]);
  });
});
