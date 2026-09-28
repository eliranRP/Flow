import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectTarget } from "./test-support";
import { Toggle } from "./toggle";

describe("Toggle", () => {
  it("is a 44px switch and shows not-allowed when disabled", () => {
    render(<Toggle label="סיכום שבועי" checked={false} disabled onChange={() => undefined} />);
    const control = screen.getByRole("switch", { name: "סיכום שבועי" });
    expect(control).toBeDisabled();
    const row = control.closest("label");
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) return;
    expectTarget(row);
    expect(getComputedStyle(row).cursor).toBe("not-allowed");
  });
});
