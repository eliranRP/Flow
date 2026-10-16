import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COUNTED_REASON_LOAN, COUNTED_REASON_OTHER, CountedInRow, CountedInSheet, countedInValue } from "./counted-in";

describe("countedInValue (FLOW-366, guide §7.10)", () => {
  it("names both switches on, and the one that is off with its reason", () => {
    expect(countedInValue(true, true, null)).toEqual({ text: "רווח ותזרים", off: false });
    expect(countedInValue(false, true, COUNTED_REASON_LOAN)).toEqual({ text: "תזרים בלבד · קרן הלוואה", off: true });
    expect(countedInValue(false, true, null)).toEqual({ text: `תזרים בלבד · ${COUNTED_REASON_OTHER}`, off: true });
    expect(countedInValue(true, false, null)).toEqual({ text: "רווח בלבד · לא בתזרים", off: true });
    expect(countedInValue(false, false, null)).toEqual({ text: "לא נספר", off: true });
  });
});

describe("CountedInRow", () => {
  it("opens the sheet from its row, with the value in its name", () => {
    const onOpen = vi.fn();
    render(<CountedInRow pnl cash reason={null} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /נספר ב רווח ותזרים/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("is static when locked, with its hint and no sheet to open", () => {
    render(<CountedInRow pnl={false} cash reason={COUNTED_REASON_LOAN} locked lockedHint="לפי חלקי ההלוואה" onOpen={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("לפי חלקי ההלוואה")).toBeInTheDocument();
  });
});

describe("CountedInSheet", () => {
  it("sets the P&L and the cash switch, and says the change is for this line only", () => {
    const onPnl = vi.fn();
    const onCash = vi.fn();
    render(<CountedInSheet open onOpenChange={vi.fn()} pnl cash={false} reason={null} onPnl={onPnl} onCash={onCash} />);
    expect(screen.getByText("רק השורה הזו. הקטגוריה לא משתנה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "נספר ברווח" }));
    expect(onPnl).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("switch", { name: "נספר בתזרים" }));
    expect(onCash).toHaveBeenCalledWith(true);
  });
});
