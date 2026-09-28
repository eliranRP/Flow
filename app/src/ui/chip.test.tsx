import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip, StatusPill } from "./chip";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Chip", () => {
  it("covers suggested, choice, selected, and disabled, plus a status pill", () => {
    expectRtl();
    render(
      <>
        <Chip kind="suggested">אחרון</Chip>
        <Chip kind="choice">חומרים</Chip>
        <Chip kind="choice" pressed>
          עבודה
        </Chip>
        <Chip kind="disabled">מוסתר</Chip>
        <StatusPill>שולם</StatusPill>
      </>,
    );
    const choice = screen.getByRole("button", { name: "חומרים" });
    expectTarget(choice);
    expectThemePaint(choice, "color");
    expect(screen.getByRole("button", { name: "מוסתר" })).toBeDisabled();
    expect(screen.getByText("שולם").tagName).toBe("SPAN");
  });
});
