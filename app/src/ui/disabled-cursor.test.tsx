import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { IconButton } from "./icon-button";

function cursorOf(element: Element): string {
  return getComputedStyle(element).cursor;
}

describe("disabled cursor", () => {
  it("uses not-allowed on a disabled Button, IconButton, and toggle row, and progress while busy", () => {
    const onClick = vi.fn();
    render(
      <>
        <Button variant="primary" disabled>שמירה</Button>
        <Button variant="secondary" disabled>שינוי</Button>
        <Button variant="pill" disabled>סימון</Button>
        <Button variant="danger" disabled>מחיקה</Button>
        <Button variant="danger-tint" disabled>מחיקה רכה</Button>
        <Button variant="ghost" disabled>דלג</Button>
        <Button busy onClick={onClick}>שומר</Button>
        <IconButton label="סגירה" disabled>✕</IconButton>
        <Checkbox label="הצגת פרויקטים שהסתיימו" checked={false} disabled onChange={() => undefined} />
      </>,
    );

    for (const name of ["שמירה", "שינוי", "סימון", "מחיקה", "מחיקה רכה", "דלג", "סגירה"]) {
      const control = screen.getByRole("button", { name });
      expect(cursorOf(control), name).toBe("not-allowed");
      expect(getComputedStyle(control).pointerEvents, name).not.toBe("none");
    }

    const busy = screen.getByRole("button", { name: "שומר" });
    expect(cursorOf(busy)).toBe("progress");
    expect(getComputedStyle(busy).pointerEvents).not.toBe("none");
    fireEvent.click(busy);
    expect(onClick).not.toHaveBeenCalled();

    const toggle = screen.getByRole("checkbox", { name: "הצגת פרויקטים שהסתיימו" });
    expect(toggle.closest("label")).toHaveClass("ui-toggle");
    expect(cursorOf(toggle)).toBe("not-allowed");
    expect(cursorOf(toggle.closest("label") as Element)).toBe("not-allowed");
  });
});
