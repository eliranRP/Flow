import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "./chip";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Chip", () => {
  it("covers suggested, choice, pressed, and disabled", () => {
    expectRtl();
    render(
      <>
        <Chip kind="suggested">אחרון</Chip>
        <Chip kind="choice">חומרים</Chip>
        <Chip kind="choice" pressed>
          עבודה
        </Chip>
        <Chip kind="disabled">מוסתר</Chip>
      </>,
    );
    const choice = screen.getByRole("button", { name: "חומרים" });
    expectTarget(choice);
    expectThemePaint(choice, "color");
    expect(screen.getByRole("button", { name: "עבודה" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "מוסתר" })).toBeDisabled();
  });
});
