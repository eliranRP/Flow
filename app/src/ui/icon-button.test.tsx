import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconButton } from "./icon-button";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("IconButton", () => {
  it("is a 44px target and keeps token colour in dark mode", () => {
    expectRtl();
    render(<IconButton label="סגירה">✕</IconButton>);
    const button = screen.getByRole("button", { name: "סגירה" });
    expectTarget(button);
    expectThemePaint(button, "color");
  });

  it("presses with opacity only", () => {
    render(<IconButton label="סגירה">✕</IconButton>);
    const button = screen.getByRole("button", { name: "סגירה" });
    expect(button).toHaveClass("m-press");
    expect(button).not.toHaveClass("m-press-scale");
  });
});
