import { render, screen } from "@testing-library/react";
import { describe, it } from "vitest";
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
});
