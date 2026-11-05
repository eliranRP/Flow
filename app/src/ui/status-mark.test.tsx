import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusMark } from "./status-mark";

describe("StatusMark (FLOW-1043)", () => {
  it("draws each kind as its own shape, hidden from the reader", () => {
    const { container } = render(
      <>
        <StatusMark kind="due" />
        <StatusMark kind="late" />
        <StatusMark kind="paid" />
        <StatusMark kind="once" />
      </>,
    );
    const marks = [...container.querySelectorAll(".ui-status-mark")];
    expect(marks).toHaveLength(4);
    for (const mark of marks) expect(mark).toHaveAttribute("aria-hidden", "true");
    const [due, late, paid, once] = marks;
    expect(due).toHaveClass("ui-status-mark-due");
    expect(due?.childElementCount).toBe(0);
    expect(late).toHaveClass("ui-status-mark-late");
    expect(late?.childElementCount).toBe(0);
    expect(paid).toHaveClass("ui-status-mark-paid");
    expect(paid?.querySelector("svg")).not.toBeNull();
    expect(once).toHaveClass("ui-status-mark-once");
    expect(once?.querySelector(".ui-status-mark-dot")).not.toBeNull();
  });
});
